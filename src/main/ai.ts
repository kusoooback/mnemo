import { norm as normText } from '../shared/quiz'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, TEXT_EXTENSIONS, VIDEO_EXTENSIONS } from '../shared/docs'
import { dialog, type BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import { unzipSync } from 'fflate'
import type {
  AiCallRow,
  AiCardProposal,
  AiDiagnosis,
  AiEstimate,
  FreeModel,
  AiProviderId,
  AiStatus
} from '../shared/types'
import { cleanSummary, finalizeDrafts } from './cardgen'
import { getDb } from './db'
import { anyInstalledModel, hasInstalledModel, localChat } from './localai'
import { getSecret, hasSecret, setSecret } from './secrets'
import { getSettings, newId, setSettings } from './util'

/*
 * Couche d'abstraction IA.
 *  - Ollama : modèle local, rien ne sort du PC.
 *  - OpenAI (et toute API compatible : LM Studio, OpenRouter, Groq…) : clé de l'utilisateur.
 *  - Anthropic : clé de l'utilisateur.
 * Sans fournisseur configuré, l'app reste pleinement utilisable.
 * Pour ajouter un fournisseur : une entrée dans PROVIDERS qui sait faire `chat()`.
 */

/** Un tour de conversation passé (pour l'assistant : le modèle voit ce qui a déjà été dit). */
export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const withHistory = (system: string, user: string, history: Turn[] = []): { role: string; content: string }[] => [
  { role: 'system', content: system },
  ...history,
  { role: 'user', content: user }
]

interface ChatResult {
  text: string
  tokensIn: number
  tokensOut: number
}

interface Provider {
  label: string
  defaultModel: string
  defaultBase: string
  needsKey: boolean
  local: boolean
  chat(o: { base: string; model: string; key: string | null; system: string; user: string; history?: Turn[]; maxTokens: number; json: boolean; schema?: Record<string, unknown> }): Promise<ChatResult>
  test(o: { base: string; key: string | null }): Promise<{ ok: boolean; message: string; models?: string[] }>
}

async function http(url: string, init: RequestInit, timeoutMs = 300_000): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    const body = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`)
    return JSON.parse(body)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Le fournisseur IA n’a pas répondu à temps.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// En test, pas d'attente réelle.
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, process.env.VITEST ? 0 : ms))
let lastOpenRouterCall = 0
/** Limite atteinte : on ne réessaie pas OpenRouter avant cette heure (le modèle local prend le relais). */
let cloudPausedUntil = 0

/** Appel OpenRouter avec le rythme des comptes gratuits (≈ 20 requêtes/min) et relances en cas de limite atteinte. */
async function openRouterChat(base: string, key: string | null, body: Record<string, unknown>): Promise<{ choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastOpenRouterCall + 3200 - Date.now()
    if (wait > 0) await sleep(wait)
    lastOpenRouterCall = Date.now()
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 180_000)
    let status = 0
    let text = ''
    let retryAfter = 0
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/mnemo-app', 'X-Title': 'Mnémo' },
        body: JSON.stringify(body),
        signal: ctl.signal
      })
      status = res.status
      text = await res.text()
      retryAfter = Number(res.headers.get('retry-after')) || 0
    } catch (e) {
      if (attempt >= 3) throw new Error((e as Error).name === 'AbortError' ? 'OpenRouter n’a pas répondu à temps.' : `OpenRouter injoignable : ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
    let parsed: { error?: { code?: number; message?: string }; choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } = {}
    try {
      parsed = JSON.parse(text || '{}')
    } catch {
      /* corps illisible */
    }
    // Les erreurs de limite arrivent aussi avec un code 200 et un objet « error ».
    const code = parsed.error?.code ?? status
    const retryable = status === 0 || code === 429 || code === 408 || (code >= 500 && code < 600)
    if (retryable) {
      if (attempt >= (code === 429 ? 1 : 4)) {
        throw new OrError(code === 429 ? 'Limite de requêtes OpenRouter atteinte : réessaie plus tard ou ajoute un crédit sur openrouter.ai.' : `OpenRouter est indisponible (${code}).`, code)
      }
      await sleep(Math.min(60_000, retryAfter > 0 ? retryAfter * 1000 : 4000 * 2 ** attempt))
      continue
    }
    if (status >= 400 || parsed.error) throw new OrError(`${status} — ${parsed.error?.message ?? text.slice(0, 300)}`, code || status)
    return parsed
  }
}

/** Modèles gratuits d'OpenRouter, les plus gros d'abord (la liste est publique, aucune clé n'est nécessaire). */
export async function openrouterModels(): Promise<FreeModel[]> {
  type M = { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; architecture?: { modality?: string } }
  const j = (await http('https://openrouter.ai/api/v1/models', {}, 20_000)) as { data?: M[] }
  const size = (id: string): number => Number(/(\d+(?:\.\d+)?)b\b/i.exec(id)?.[1] ?? 0)
  const rank = (id: string): number => (id === BEST_FREE_MODEL ? 2 : id === 'openrouter/free' ? 1 : 0)
  return (j.data ?? [])
    .filter((m) => String(m.pricing?.prompt) === '0' && String(m.pricing?.completion) === '0')
    .filter((m) => (m.architecture?.modality ?? 'text->text').split('->')[1]?.trim() === 'text')
    .filter((m) => !/safety|guard|moderation|embed|tts|lyria/i.test(m.id))
    .map((m) => ({ id: m.id, name: m.name ?? m.id, context: m.context_length ?? 0 }))
    .sort((a, b) => rank(b.id) - rank(a.id) || size(b.id) - size(a.id) || b.context - a.context)
    .slice(0, 30)
}

/** Le plus gros modèle gratuit d'OpenRouter, puis des remplaçants si le premier est saturé (les modèles gratuits le sont souvent). */
export const BEST_FREE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free'
const FREE_CHAIN = [BEST_FREE_MODEL, 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'openrouter/free']
const isFreeModel = (m: string): boolean => m === 'openrouter/free' || m.endsWith(':free')

class OrError extends Error {
  constructor(
    message: string,
    public code: number
  ) {
    super(message)
  }
}

const PROVIDERS: Record<Exclude<AiProviderId, 'none'>, Provider> = {
  builtin: {
    label: 'IA intégrée (gratuite, sur ton PC)',
    defaultModel: 'balanced',
    defaultBase: '',
    needsKey: false,
    local: true,
    async chat({ model, system, user, history, maxTokens, schema }) {
      return localChat(model, { system, user, history, schema, maxTokens })
    },
    async test() {
      return hasInstalledModel(getSettings().aiModel || 'balanced')
        ? { ok: true, message: 'Le modèle intégré est installé et prêt.' }
        : { ok: false, message: 'Le modèle intégré n’est pas encore téléchargé.' }
    }
  },
  ollama: {
    label: 'Ollama (local)',
    defaultModel: 'llama3.1',
    defaultBase: 'http://localhost:11434',
    needsKey: false,
    local: true,
    async chat({ base, model, system, user, history, json }) {
      const r = (await http(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          ...(json ? { format: 'json' } : {}),
          messages: withHistory(system, user, history)
        })
      })) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number }
      return { text: r.message?.content ?? '', tokensIn: r.prompt_eval_count ?? 0, tokensOut: r.eval_count ?? 0 }
    },
    async test({ base }) {
      try {
        const r = (await http(`${base}/api/tags`, {}, 5000)) as { models?: { name: string }[] }
        const models = (r.models ?? []).map((m) => m.name)
        return { ok: true, message: models.length ? `${models.length} modèle(s) installé(s).` : 'Ollama répond, mais aucun modèle n’est installé (ollama pull llama3.1).', models }
      } catch {
        return { ok: false, message: 'Ollama ne répond pas. Est-il lancé ? (https://ollama.com)' }
      }
    }
  },
  openrouter: {
    label: 'OpenRouter (modèles gratuits en ligne)',
    defaultModel: BEST_FREE_MODEL,
    defaultBase: 'https://openrouter.ai/api/v1',
    needsKey: true,
    local: false,
    async chat({ base, model, key, system, user, history, maxTokens }) {
      // Modèle gratuit : on essaie le meilleur, puis les suivants s'il est saturé ou indisponible.
      const chain = isFreeModel(model) ? [model, ...FREE_CHAIN.filter((m) => m !== model)] : [model]
      let last: Error = new Error('Aucun modèle OpenRouter disponible.')
      let all429 = true
      for (const candidate of chain) {
        try {
          // Les modèles « raisonneurs » dépensent des jetons à réfléchir : on leur laisse de la marge.
          const r = await openRouterChat(base, key, {
            model: candidate,
            max_tokens: maxTokens + 2000,
            temperature: 0.3,
            reasoning: { effort: 'low' },
            messages: withHistory(system, user, history)
          })
          const msg = r.choices?.[0]?.message
          const raw = typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((p: { text?: string }) => p.text ?? '').join('') : ''
          const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
          if (!text) throw new OrError('Réponse vide.', 204)
          return { text, tokensIn: r.usage?.prompt_tokens ?? 0, tokensOut: r.usage?.completion_tokens ?? 0 }
        } catch (e) {
          last = e as Error
          const code = (e as OrError).code ?? 0
          if (code === 401 || code === 403) throw new Error('Clé OpenRouter refusée : vérifie-la dans Réglages → Intégrations.')
          if (code !== 429) all429 = false
        }
      }
      if (all429) cloudPausedUntil = Date.now() + 30 * 60_000
      throw last
    },
    async test({ base, key }) {
      try {
        const r = (await http(`${base}/auth/key`, { headers: { Authorization: `Bearer ${key}` } }, 10_000)) as { data?: { label?: string; is_free_tier?: boolean; limit_remaining?: number | null } }
        const free = r.data?.is_free_tier
        return { ok: true, message: `Clé valide${r.data?.label ? ` (${r.data.label})` : ''}${free ? ' · compte gratuit : environ 20 requêtes par minute et 50 par jour (1000 par jour après un crédit de 10 $ sur OpenRouter).' : '.'}` }
      } catch (e) {
        return { ok: false, message: `Clé refusée ou OpenRouter injoignable : ${(e as Error).message}` }
      }
    }
  },
  openai: {
    label: 'OpenAI / compatible',
    defaultModel: 'gpt-4o-mini',
    defaultBase: 'https://api.openai.com/v1',
    needsKey: true,
    local: false,
    async chat({ base, model, key, system, user, history, maxTokens, json }) {
      const r = (await http(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages: withHistory(system, user, history)
        })
      })) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      return {
        text: r.choices?.[0]?.message?.content ?? '',
        tokensIn: r.usage?.prompt_tokens ?? 0,
        tokensOut: r.usage?.completion_tokens ?? 0
      }
    },
    async test({ base, key }) {
      try {
        const r = (await http(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }, 10_000)) as { data?: { id: string }[] }
        return { ok: true, message: 'Connexion réussie.', models: (r.data ?? []).map((m) => m.id).slice(0, 60) }
      } catch (e) {
        return { ok: false, message: `Échec : ${(e as Error).message}` }
      }
    }
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-haiku-5-5',
    defaultBase: 'https://api.anthropic.com/v1',
    needsKey: true,
    local: false,
    async chat({ base, model, key, system, user, history, maxTokens }) {
      const r = (await http(`${base}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [...(history ?? []), { role: 'user', content: user }] })
      })) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
      return {
        text: (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
        tokensIn: r.usage?.input_tokens ?? 0,
        tokensOut: r.usage?.output_tokens ?? 0
      }
    },
    async test({ base, key }) {
      try {
        const r = (await http(`${base}/models`, { headers: { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' } }, 10_000)) as { data?: { id: string }[] }
        return { ok: true, message: 'Connexion réussie.', models: (r.data ?? []).map((m) => m.id) }
      } catch (e) {
        return { ok: false, message: `Échec : ${(e as Error).message}` }
      }
    }
  }
}

export const AI_PROVIDERS = Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel, defaultBase: p.defaultBase, needsKey: p.needsKey }))

const keyName = (provider: string): string => `ai.key.${provider}`

function monthStart(): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function aiStatus(): AiStatus {
  const s = getSettings()
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(cost), 0) cost, COUNT(*) n FROM ai_call WHERE at >= ?')
    .get(monthStart()) as { cost: number; n: number }
  const p = s.aiProvider === 'none' ? null : PROVIDERS[s.aiProvider]
  const hasKey = s.aiProvider !== 'none' && hasSecret(keyName(s.aiProvider))
  const ready =
    s.aiProvider === 'builtin'
      ? hasInstalledModel(s.aiModel || 'balanced')
      : s.aiProvider === 'ollama'
        ? true
        : s.aiProvider !== 'none' && hasKey
  return {
    ready,
    provider: s.aiProvider,
    model: s.aiModel || p?.defaultModel || '',
    baseUrl: s.aiBaseUrl || p?.defaultBase || '',
    hasKey,
    monthCost: row.cost,
    monthCalls: row.n,
    cap: s.aiMonthlyCap,
    priceIn: s.aiPriceIn,
    priceOut: s.aiPriceOut
  }
}

export function aiConfigure(p: {
  provider?: AiProviderId
  model?: string
  baseUrl?: string
  priceIn?: number
  priceOut?: number
  monthlyCap?: number
  key?: string | null
}): AiStatus {
  const patch: Record<string, unknown> = {}
  const provider = p.provider ?? getSettings().aiProvider
  if (p.provider !== undefined) {
    patch.aiProvider = p.provider
    // Changer de fournisseur remet ses valeurs par défaut.
    if (p.provider !== 'none') {
      patch.aiModel = p.model ?? PROVIDERS[p.provider].defaultModel
      patch.aiBaseUrl = p.baseUrl ?? PROVIDERS[p.provider].defaultBase
      patch.aiPriceIn = p.priceIn ?? (PROVIDERS[p.provider].local ? 0 : getSettings().aiPriceIn)
      patch.aiPriceOut = p.priceOut ?? (PROVIDERS[p.provider].local ? 0 : getSettings().aiPriceOut)
    }
  } else {
    if (p.model !== undefined) patch.aiModel = p.model
    if (p.baseUrl !== undefined) patch.aiBaseUrl = p.baseUrl.replace(/\/+$/, '')
    if (p.priceIn !== undefined) patch.aiPriceIn = Math.max(0, p.priceIn)
    if (p.priceOut !== undefined) patch.aiPriceOut = Math.max(0, p.priceOut)
  }
  if (p.monthlyCap !== undefined) patch.aiMonthlyCap = Math.max(0, p.monthlyCap)
  if (Object.keys(patch).length) setSettings(patch as never)
  if (p.key !== undefined && provider !== 'none') setSecret(keyName(provider), p.key)
  return aiStatus()
}

function active(): { p: Provider; base: string; model: string; key: string | null; id: string } {
  const s = getSettings()
  if (s.aiProvider === 'none') throw new Error('Aucun fournisseur IA configuré (Réglages → Intégrations).')
  const p = PROVIDERS[s.aiProvider]
  const key = getSecret(keyName(s.aiProvider))
  if (p.needsKey && !key) throw new Error('Clé d’API manquante pour ce fournisseur.')
  return { p, base: (s.aiBaseUrl || p.defaultBase).replace(/\/+$/, ''), model: s.aiModel || p.defaultModel, key, id: s.aiProvider }
}

export async function aiTest(): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    const a = active()
    return await a.p.test({ base: a.base, key: a.key })
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// Schémas volontairement « plats » : la grammaire du modèle local gère mal les unions (anyOf).
const FLAT_CARD = {
  type: 'object',
  properties: {
    type: { enum: ['basic', 'cloze'] },
    front: { type: 'string' },
    back: { type: 'string' },
    text: { type: 'string' },
    extra: { type: 'string' }
  },
  required: ['type', 'front', 'back', 'text', 'extra']
}

const CARD_SCHEMA = {
  type: 'object',
  properties: { cards: { type: 'array', minItems: 2, maxItems: 40, items: FLAT_CARD } },
  required: ['cards']
}

const DIAG_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { enum: ['ok', 'ambiguous', 'too-long', 'multiple-answers', 'other'] },
    issues: { type: 'array', items: { type: 'string' } },
    suggestion: { type: 'object', properties: { ...FLAT_CARD.properties, type: { enum: ['basic', 'cloze', 'none'] } }, required: FLAT_CARD.required }
  },
  required: ['verdict', 'issues', 'suggestion']
}

const LOCAL_CHUNK = 6000
/** Modèle en ligne : gros morceaux, donc peu d'appels (les comptes gratuits en autorisent peu par jour). */
const chunkSize = (): number => (['openrouter', 'openai', 'anthropic'].includes(getSettings().aiProvider) ? 24_000 : LOCAL_CHUNK)
const tokens = (chars: number): number => Math.ceil(chars / 3.6)

export function aiEstimate(text: string, count: number): AiEstimate {
  const s = getSettings()
  const st = aiStatus()
  const chunks = Math.max(1, Math.ceil(text.length / chunkSize()))
  const tokensIn = tokens(text.length) + chunks * 350
  const tokensOut = Math.ceil(count * 110)
  const local = s.aiProvider === 'ollama' || s.aiProvider === 'builtin'
  const cost = local || s.aiProvider === 'none' ? 0 : (tokensIn * s.aiPriceIn + tokensOut * s.aiPriceOut) / 1e6
  return { chars: text.length, tokensIn, tokensOut, cost, chunks, overCap: !local && s.aiMonthlyCap > 0 && st.monthCost + cost > s.aiMonthlyCap }
}

async function call(purpose: string, system: string, user: string, maxTokens: number, json: boolean, schema?: Record<string, unknown>, history?: Turn[]): Promise<string> {
  const a = active()
  const s = getSettings()
  const st = aiStatus()
  const free = a.p.local || (a.id === 'openrouter' && (a.model === 'openrouter/free' || a.model.endsWith(':free')))
  if (!free && s.aiMonthlyCap > 0 && st.monthCost >= s.aiMonthlyCap)
    throw new Error(`Plafond mensuel atteint (${st.monthCost.toFixed(2)} / ${s.aiMonthlyCap}). Augmente-le dans les réglages pour continuer.`)
  let r: ChatResult
  let used = a.id
  try {
    if (a.id === 'openrouter' && Date.now() < cloudPausedUntil) throw new Error('OpenRouter en pause (limite atteinte).')
    r = await a.p.chat({ base: a.base, model: a.model, key: a.key, system, user, history, maxTokens, json, schema })
    if (!r.text.trim()) throw new Error('Réponse vide du fournisseur.')
  } catch (e) {
    // En ligne en panne ou limite atteinte : on reprend avec le modèle installé sur le PC, plutôt que d'échouer.
    const local = !a.p.local && s.aiFallbackLocal ? anyInstalledModel() : null
    if (!local) throw e
    r = await PROVIDERS.builtin.chat({ base: '', model: local, key: null, system, user, history, maxTokens, json, schema })
    used = 'builtin'
  }
  const tin = r.tokensIn || tokens(system.length + user.length + (history ?? []).reduce((n, h) => n + h.content.length, 0))
  const tout = r.tokensOut || tokens(r.text.length)
  const cost = used === 'builtin' || free ? 0 : (tin * s.aiPriceIn + tout * s.aiPriceOut) / 1e6
  getDb()
    .prepare('INSERT INTO ai_call(id, at, provider, model, tokens_in, tokens_out, cost, purpose) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), Date.now(), used, used === 'builtin' && a.id !== 'builtin' ? 'local (secours)' : a.model, tin, tout, cost, purpose)
  return r.text
}

/** Appel brut au modèle (tri de documents, etc.). */
export const aiCall = call

/** Conversation : le modèle reçoit aussi les tours précédents. */
export const aiChat = (purpose: string, system: string, user: string, history: Turn[], maxTokens: number): Promise<string> => call(purpose, system, user, maxTokens, false, undefined, history)

export function aiLog(): AiCallRow[] {
  return (
    getDb().prepare('SELECT id, at, provider, model, tokens_in, tokens_out, cost, purpose FROM ai_call ORDER BY at DESC LIMIT 100').all() as {
      id: string
      at: number
      provider: string
      model: string
      tokens_in: number
      tokens_out: number
      cost: number
      purpose: string
    }[]
  ).map((r) => ({ id: r.id, at: r.at, provider: r.provider, model: r.model, tokensIn: r.tokens_in, tokensOut: r.tokens_out, cost: r.cost, purpose: r.purpose }))
}

/** Extrait le premier objet/tableau JSON d'une réponse de modèle (qui ajoute parfois du texte autour). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    /* on cherche un bloc */
  }
  const a = Math.min(...['[', '{'].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))))
  const b = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'))
  if (a === Infinity || b <= a) throw new Error('Réponse du modèle illisible (pas de JSON).')
  return JSON.parse(t.slice(a, b + 1))
}

/**
 * Réponse tronquée ou mal fermée (le modèle a bouclé, ou n'avait plus de place) : on récupère les objets complets
 * qu'elle contient plutôt que de tout perdre.
 */
export function salvageObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const starts: number[] = []
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') starts.push(i)
    else if (ch === '}' && starts.length) {
      const start = starts.pop() as number
      try {
        const o = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
        // Une carte, pas l'objet englobant { "cards": [...] }.
        if (o && typeof o === 'object' && !('cards' in o) && ('front' in o || 'text' in o)) out.push(o)
      } catch {
        /* objet abîmé : on passe au suivant */
      }
    }
  }
  return out
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function normalizeProposals(raw: unknown): AiCardProposal[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>).cards ?? (raw as Record<string, unknown>).flashcards ?? Object.values(raw)[0])
      : []
  if (!Array.isArray(arr)) return []
  const out: AiCardProposal[] = []
  for (const c of arr as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue
    const type = str(c.type).toLowerCase()
    const text = str(c.text) || str(c.cloze)
    const front = str(c.front) || str(c.question) || str(c.q)
    const back = str(c.back) || str(c.answer) || str(c.a)
    const tags = Array.isArray(c.tags) ? (c.tags as unknown[]).map(str).filter(Boolean) : []
    if ((type === 'cloze' || (!front && text)) && /\{\{c\d+::/.test(text)) out.push({ kind: 'cloze', front: '', back: '', text, extra: str(c.extra), tags })
    else if (front && back) out.push({ kind: 'basic', front, back, text: '', extra: '', tags })
  }
  return out
}

const LANG: Record<string, string> = { fr: 'français', en: 'English' }

export let lastRawReply = ''

/** « Sujet : les suites numériques » : cartes ou fiche sans document, d'après les connaissances du modèle. */
const TOPIC = /^\s*Sujet\s*:\s*([\s\S]+)$/i

export async function aiGenerate(text: string, count: number, lang: 'fr' | 'en', hint: string): Promise<AiCardProposal[]> {
  const clean = text.replace(/\r/g, '').trim()
  if (!clean) throw new Error('Aucun texte à analyser.')
  const chunks: string[] = []
  const CHUNK = chunkSize()
  for (let i = 0; i < clean.length; i += CHUNK) {
    let end = Math.min(clean.length, i + CHUNK)
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end)
      if (nl > i + CHUNK / 2) end = nl
    }
    chunks.push(clean.slice(i, end))
    i = end - CHUNK // la boucle ajoute CHUNK
  }
  const per = Math.max(3, Math.ceil(count / chunks.length))
  const system = `Tu crées des cartes de révision (flashcards) de grande qualité pour la répétition espacée.
Règles :
- une seule idée par carte, question complète et compréhensible sans le document (jamais « selon le texte », « ci-dessus ») ;
- CARTES COURTES : question de 20 mots maximum ; réponse de 25 mots maximum (une seule phrase, ou une liste de 4 éléments au plus, sans phrases d'introduction) ; ne recopie jamais de paragraphes ;
- si une réponse a besoin de plus de 25 mots, c'est qu'il y a plusieurs idées : fais plusieurs cartes, chacune avec sa propre question ;
- ne retiens que l'essentiel à savoir pour un examen : définitions, théorèmes et propriétés, méthodes, formules, dates et faits clés, exemples types ;
- IGNORE tout ce qui est pratique ou administratif (groupes, horaires, salles, noms d'enseignants, consignes, numéros d'exercice) ;
- pas de doublons, pas de carte triviale.
Cartes à trous : une phrase de 30 mots maximum avec UN seul trou (deux au maximum) sur le mot clé ({{c1::réponse}}), jamais une phrase presque entièrement masquée.
Écris toutes les formules en LaTeX entre $…$ (ex. $x^2$, $\\sum_{k=1}^{n} u_k$, $A \\subset B$) ; le texte fourni note les exposants ^{…} et les indices _{…}. Langue des cartes : ${LANG[lang]}.
Exemples de BONNES cartes :
{"type":"basic","front":"Quelle est la définition d'une application injective ?","back":"Une application f : E → F est injective si deux éléments distincts de E ont des images distinctes.","text":"","extra":""}
{"type":"cloze","front":"","back":"","text":"Une application est {{c1::surjective}} si tout élément de l'ensemble d'arrivée possède au moins un antécédent.","extra":""}
MAUVAISES cartes (à ne jamais écrire) : un recto qui est une affirmation ou une étiquette (« Remarque », « Théorème 3 »), un trou sur un mot banal, la recopie d'un énoncé d'exercice ou d'une démonstration entière.
Réponds UNIQUEMENT avec du JSON, sans texte autour : un objet {"cards":[…]}. Chaque carte a TOUJOURS les cinq champs type, front, back, text, extra :
- carte de type "basic" : front = question précise, back = réponse courte, text = "" et extra = "" ;
- carte de type "cloze" : text = phrase complète avec {{c1::mot à retrouver}}, extra = précision facultative, front = "" et back = "".
Une carte "cloze" doit toujours contenir {{c1::…}} dans text. Écris des cartes utiles pour un examen, pas des paraphrases du texte.`
  const all: AiCardProposal[] = []
  for (const [i, chunk] of chunks.entries()) {
    const topic = TOPIC.exec(chunk)?.[1]
    const user = topic
      ? `Crée environ ${per} cartes de révision sur le sujet : « ${topic.trim()} ».\nIl n'y a pas de texte source : appuie-toi sur tes connaissances (niveau classe préparatoire). N'écris que ce dont tu es certain : exact, précis, sans approximation ; si tu hésites, n'écris pas la carte.${hint ? `\nConsigne de l'utilisateur : ${hint}` : ''}`
      : `Crée environ ${per} cartes à partir de ce cours (partie ${i + 1}/${chunks.length}).${hint ? `\nConsigne de l'utilisateur : ${hint}` : ''}\n\n---\n${chunk}\n---`
    const reply = await call('génération de cartes', system, user, Math.min(4000, per * 220 + 400), true, CARD_SCHEMA)
    lastRawReply = reply
    try {
      all.push(...normalizeProposals(extractJson(reply)))
    } catch {
      all.push(...normalizeProposals(salvageObjects(reply)))
    }
  }
  const seen = new Set<string>()
  return all.filter((c) => {
    const k = (c.kind === 'cloze' ? c.text : c.front).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export async function aiDiagnose(front: string, back: string, kind: string): Promise<AiDiagnosis> {
  const system = `Tu relis des cartes de révision. Évalue si la carte est bonne : non ambiguë, une seule réponse attendue, assez courte.
Réponds UNIQUEMENT avec ce JSON : {"verdict":"ok|ambiguous|too-long|multiple-answers|other","issues":["court constat en français"],"suggestion":null ou {"type":"basic|cloze","front":"","back":"","text":"","extra":""}}.
Propose une reformulation seulement si la carte a un problème.`
  const reply = await call('diagnostic de carte', system, `Type : ${kind}\nRecto/texte : ${front}\nVerso : ${back}`, 700, true, DIAG_SCHEMA)
  const j = extractJson(reply) as Record<string, unknown>
  const verdicts = ['ok', 'ambiguous', 'too-long', 'multiple-answers', 'other']
  const sugRaw = j.suggestion as Record<string, unknown> | null
  const sug = sugRaw && ['basic', 'cloze'].includes(str(sugRaw.type)) ? sugRaw : null
  return {
    verdict: (verdicts.includes(str(j.verdict)) ? str(j.verdict) : 'other') as AiDiagnosis['verdict'],
    issues: Array.isArray(j.issues) ? (j.issues as unknown[]).map(str).filter(Boolean) : [],
    suggestion: sug
      ? { kind: str(sug.type) === 'cloze' ? 'cloze' : 'basic', front: str(sug.front), back: str(sug.back), text: str(sug.text), extra: str(sug.extra) }
      : null
  }
}

export async function aiExplain(cardId: string): Promise<string> {
  const row = getDb()
    .prepare('SELECT n.kind, n.fields FROM card c JOIN note n ON n.id = c.note_id WHERE c.id = ?')
    .get(cardId) as { kind: string; fields: string } | undefined
  if (!row) throw new Error('Carte introuvable')
  const f = JSON.parse(row.fields) as Record<string, string>
  const system = `Tu es un tuteur bienveillant. L'élève vient de rater une carte de révision. Explique en 4 phrases maximum pourquoi la réponse est correcte, donne un exemple concret ou un moyen mnémotechnique, et suggère un lien avec une notion voisine. Pas de préambule. Markdown autorisé. Réponds dans la langue de la carte.`
  return (await call('explication d’une erreur', system, `Carte (${row.kind}) :\n${Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n')}`, 600, false)).trim()
}

const DISTRACTOR_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, wrong: { type: 'array', items: { type: 'string' } } }, required: ['id', 'wrong'] } } },
  required: ['items']
}

/**
 * Quiz : pour chaque question, 3 mauvaises réponses PLAUSIBLES (les pièges qu'un élève confond vraiment).
 * Renvoie ce qui a pu être fabriqué ; l'appelant complète avec les réponses des autres cartes.
 */
export async function aiDistractors(items: { id: string; q: string; a: string }[]): Promise<Record<string, string[]>> {
  if (!aiStatus().ready) throw new Error('L’IA n’est pas prête : active-la dans Réglages → IA, ou décoche « Réponses piégeuses ».')
  const online = ['openrouter', 'openai', 'anthropic'].includes(getSettings().aiProvider)
  const per = online ? 12 : 5
  const clean = items.slice(0, 60).map((i) => ({ id: String(i.id), q: String(i.q).slice(0, 400), a: String(i.a).slice(0, 240) }))
  const out: Record<string, string[]> = {}
  let lastError: Error | null = null
  const system =
    'Tu fabriques des QCM pour réviser. Pour chaque question, propose 3 MAUVAISES réponses plausibles : des pièges crédibles qu’un élève pourrait confondre avec la bonne, ' +
    'de même nature, de même forme et de longueur proche. Elles ne doivent JAMAIS être correctes ni répéter la bonne réponse. Garde la mise en forme de la bonne réponse ' +
    '(par exemple du LaTeX entre $…$). Même langue que les questions. Réponds uniquement avec du JSON : {"items":[{"id":"…","wrong":["…","…","…"]}]}.'
  for (let i = 0; i < clean.length; i += per) {
    const chunk = clean.slice(i, i + per)
    try {
      const raw = await call('QCM : réponses piégeuses', system, JSON.stringify(chunk.map((c) => ({ id: c.id, question: c.q, bonne_reponse: c.a }))), 250 + chunk.length * 160, true, DISTRACTOR_SCHEMA)
      const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
      const parsed = JSON.parse(json) as { items?: { id?: unknown; wrong?: unknown }[] }
      for (const it of parsed.items ?? []) {
        const src = chunk.find((c) => c.id === String(it.id))
        if (!src || !Array.isArray(it.wrong)) continue
        const seen = new Set([normText(src.a)])
        const wrong: string[] = []
        for (const w of it.wrong) {
          const t = typeof w === 'string' ? w.trim() : ''
          const k = normText(t)
          if (!t || t.length > 240 || !k || seen.has(k)) continue
          seen.add(k)
          wrong.push(t)
          if (wrong.length === 3) break
        }
        if (wrong.length) out[src.id] = wrong
      }
    } catch (e) {
      lastError = e as Error
      if (Object.keys(out).length === 0) break
    }
  }
  if (Object.keys(out).length === 0 && lastError) throw lastError
  return out
}

/* ---------- Lecture de documents ---------- */

interface PdfItem {
  str: string
  transform: number[]
  hasEOL?: boolean
}

/**
 * Remet les éléments d'une page dans l'ordre de lecture en gardant les exposants et indices (x^{2}, u_{n}) :
 * sans cela « e^x − 1 » devient « e x − 1 » et les maths ne veulent plus rien dire.
 */
const COMBINING: Record<string, string> = { '´': '\u0301', '`': '\u0300', 'ˋ': '\u0300', '¨': '\u0308', 'ˆ': '\u0302', '¸': '\u0327' }

/** Les PDF LaTeX écrivent l'accent avant la lettre (« D´emonstration », « fa¸con ») : on les recompose. */
export function fixAccents(text: string): string {
  return text.replace(/([´`ˋ¨ˆ¸])\s?([A-Za-z])/g, (m, accent: string, letter: string) => (COMBINING[accent] ? (letter + COMBINING[accent]).normalize('NFC') : m))
}

export function pageText(items: PdfItem[]): string {
  let out = ''
  let baseY = 0
  let baseSize = 0
  let mode: '' | '^' | '_' = ''
  const close = (): void => {
    if (mode) out += '}'
    mode = ''
  }
  for (const it of items) {
    const t = it.transform ?? [1, 0, 0, 1, 0, 0]
    const size = Math.hypot(t[0], t[1]) || 1
    const y = t[5]
    const blank = it.str.trim() === ''
    if (baseSize === 0) {
      baseSize = size
      baseY = y
    }
    const dy = y - baseY
    const smaller = size < baseSize * 0.82
    if (!blank && smaller && Math.abs(dy) > baseSize * 0.12 && Math.abs(dy) < baseSize * 0.75) {
      const want = dy > 0 ? '^' : '_'
      if (mode !== want) {
        close()
        out += `${want}{`
        mode = want
      }
      out += it.str.trim()
    } else {
      close()
      // Nouvelle ligne : le saut d'ordonnée dépasse l'interligne ou le texte l'indique.
      if (!blank && !smaller && Math.abs(dy) > baseSize * 0.7) {
        out += out.endsWith('\n') ? '' : '\n'
        baseY = y
        baseSize = size
      } else if (!blank && !smaller) baseSize = Math.max(size, baseSize * 0.9)
      out += it.str
    }
    if (it.hasEOL) {
      close()
      out += '\n'
      baseSize = 0
    }
  }
  close()
  return fixAccents(out.replace(/[ \t]+\n/g, '\n'))
}

async function pdfText(buf: Buffer): Promise<string> {
  const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>
  const pdfjs = await dynImport('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(pageText(content.items as PdfItem[]))
  }
  return pages.join('\n\n')
}

function docxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf))
  const xml = files['word/document.xml']
  if (!xml) throw new Error('Document Word illisible.')
  return Buffer.from(xml)
    .toString('utf8')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
}

function xmlText(buf: Uint8Array | undefined): string {
  if (!buf) return ''
  return Buffer.from(buf)
    .toString('utf8')
    .replace(/<\/(w:p|a:p|text:p|text:h)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
}

function pptxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf))
  return Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
    .map((n, i) => `Diapositive ${i + 1}\n${xmlText(files[n])}`)
    .join('\n\n')
}

function rtfText(raw: string): string {
  return raw
    .replace(/\\'([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_m, n: string) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\(par|line)\b ?/g, '\n')
    .replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function notebookText(raw: string): string {
  const nb = JSON.parse(raw) as { cells?: { cell_type: string; source: string[] | string }[] }
  return (nb.cells ?? [])
    .map((c) => {
      const src = Array.isArray(c.source) ? c.source.join('') : c.source
      return c.cell_type === 'code' ? '```python\n' + src + '\n```' : src
    })
    .join('\n\n')
}

function epubText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf))
  return Object.keys(files)
    .filter((n) => /\.(x?html?)$/i.test(n) && !/toc|nav/i.test(n))
    .sort()
    .map((n) => Buffer.from(files[n]).toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' '))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** PDF : texte intégré, et si la page est un scan (presque aucun texte) lecture par OCR. */
async function pdfOrScan(buf: Buffer): Promise<string> {
  let text = ''
  try {
    text = await pdfText(buf)
  } catch {
    /* PDF abîmé : on tente tout de même la lecture par image */
  }
  if (text.replace(/\s/g, '').length >= 80) return text
  try {
    const { ocrPdf } = await import('./ocr')
    const scanned = await ocrPdf(buf)
    return scanned.length > text.length ? scanned : text
  } catch (e) {
    if (text) return text
    throw e
  }
}

/** Texte brut d'un document : PDF (scannés compris), Word, PowerPoint, LibreOffice, LaTeX, RTF, EPUB, notebooks, code, images (OCR)… */
/** Texte d'un fichier, toujours en forme composée (é et non e + accent), quelle que soit la plateforme d'origine. */
export async function readDocumentBuffer(buf: Buffer, extension: string): Promise<string> {
  return (await readDocumentRaw(buf, extension)).normalize('NFC')
}

async function readDocumentRaw(buf: Buffer, extension: string): Promise<string> {
  const ext = extension.toLowerCase().replace(/^\./, '')
  if (ext === 'pdf') return pdfOrScan(buf)
  if (ext === 'docx' || ext === 'dotx') return docxText(buf)
  if (ext === 'pptx') return pptxText(buf)
  if (ext === 'odt' || ext === 'odp' || ext === 'ods') return xmlText(unzipSync(new Uint8Array(buf))['content.xml'])
  if (ext === 'html' || ext === 'htm') return buf.toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  if (ext === 'rtf') return rtfText(buf.toString('latin1'))
  if (ext === 'ipynb') return notebookText(buf.toString('utf8'))
  if (ext === 'epub') return epubText(buf)
  if (ext === 'pages') {
    // Les fichiers Pages contiennent un aperçu PDF de la première page.
    const preview = unzipSync(new Uint8Array(buf))['QuickLook/Preview.pdf']
    if (preview) return pdfOrScan(Buffer.from(preview))
    throw new Error('Fichier Pages sans aperçu lisible : exporte-le en PDF ou en Word.')
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    const { ocrImage } = await import('./ocr')
    return ocrImage(buf)
  }
  if (VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext)) return ''
  if (TEXT_EXTENSIONS.has(ext)) return buf.toString('utf8').replace(/^\uFEFF/, '')
  // Extension inconnue : si le contenu ressemble à du texte, on le lit.
  const head = buf.subarray(0, 2000)
  if (head.length > 0 && !head.includes(0)) return buf.toString('utf8').replace(/^\uFEFF/, '')
  return ''
}

export async function readDocument(path: string): Promise<string> {
  return readDocumentBuffer(readFileSync(path), extname(path))
}

export async function aiPickFile(win: BrowserWindow | null): Promise<{ name: string; text: string } | null> {
  const opts = {
    title: 'Choisir un cours',
    properties: ['openFile' as const],
    filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'md', 'markdown', 'txt'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  const text = await readDocument(res.filePaths[0])
  return { name: basename(res.filePaths[0]), text }
}

/** Fiche de révision en Markdown : titres, définitions, formules, pièges. Les longs documents sont résumés par morceaux. */
export async function aiSummarize(title: string, text: string): Promise<string> {
  const clean = text.replace(/\r/g, '').trim()
  if (!clean) throw new Error('Ce document ne contient pas de texte exploitable.')
  const system = `Tu es un enseignant de classe préparatoire. Tu rédiges des FICHES DE RÉVISION belles, denses et faciles à relire, en Markdown enrichi, en français. Une bonne fiche se lit en deux minutes et remplace le cours.

MISE EN FORME (respecte-la à la lettre) :
1. Une seule ligne de titre : # Titre du chapitre
2. Juste dessous, une phrase d'accroche en italique (*de quoi parle ce chapitre et pourquoi il compte*).
3. L'essentiel d'abord :
> [!KEY] À retenir
> - 3 à 5 puces, l'essentiel absolu
4. Puis des sections numérotées, seulement celles qui ont du contenu : ## 1. Définitions, ## 2. Propriétés et théorèmes, ## 3. Méthodes, ## 4. Pièges et erreurs fréquentes, ## 5. Exemples types (adapte les titres au sujet : en histoire ou en lettres, utilise par exemple Contexte, Acteurs, Dates clés, Enjeux).
5. Chaque notion dans son encadré, avec ces balises exactes :
> [!DEFINITION] Nom de la notion
> énoncé précis, mots clés en **gras**
> [!THEOREM] Nom du théorème
> énoncé avec formules en LaTeX
> [!PROPERTY] Nom de la propriété
> énoncé
> [!METHOD] Objectif de la méthode
> 1. étape
> 2. étape
> [!WARNING] Titre du piège
> l'erreur classique et la bonne façon de faire
> [!EXAMPLE] Titre de l'exemple
> énoncé puis solution rédigée
> [!NOTE] Remarque
> précision utile
6. Dès que des notions se comparent (injective / surjective / bijective, avant / après, deux méthodes), fais un TABLEAU Markdown (| colonne | colonne |) plutôt qu'une liste.
7. Formules en LaTeX : $...$ dans le texte, $$...$$ pour la formule centrale d'un énoncé. Le texte source note les exposants ^{...} et les indices _{...}.
8. Termine par :
## Pour réviser
- 3 questions-éclair auxquelles tu dois savoir répondre sans regarder (liste à puces).

RÈGLES : reformule et hiérarchise au lieu de recopier ; phrases courtes ; chaque encadré tient en quelques lignes ; vocabulaire exact ; pas d'introduction ni de conclusion ; pas d'emoji ; rien d'administratif (groupes, horaires, consignes) ; n'invente rien qui ne soit pas dans le document ; ne mets pas la fiche entre des triples accents graves. Les lignes d'un encadré commencent toutes par ">".`
  const parts: string[] = []
  const CHUNK = chunkSize()
  for (let i = 0; i < clean.length && parts.length < 4; i += CHUNK) parts.push(clean.slice(i, i + CHUNK))
  const out: string[] = []
  for (const [i, part] of parts.entries()) {
    const heading = parts.length > 1 ? `\n(partie ${i + 1}/${parts.length})` : ''
    const topic = TOPIC.exec(part)?.[1]
    const user = topic ? `Sujet : ${topic.trim()}\nIl n'y a pas de document : écris la fiche d'après tes connaissances (niveau classe préparatoire), exacte et précise, sans rien inventer.` : `Document : ${title}${heading}\n\n---\n${part}\n---`
    let reply = (await call('fiche de révision', system, user, 2200, false)).trim()
    if (reply.length < 120) reply = (await call('fiche de révision', system, user, 2200, false)).trim() // réponse vide ou tronquée : un nouvel essai
    out.push(reply)
  }
  return cleanSummary(out.join('\n\n'), title)
}

/** Cartes à partir d'un texte déjà découpé (utilisé pour les documents importés). */
export async function aiCardsFromText(
  text: string,
  count: number,
  lang: 'fr' | 'en',
  hint: string,
  opts: { vocabulary?: boolean; onStep?: (done: number, total: number, label: string) => void } = {}
): Promise<AiCardProposal[]> {
  const topic = TOPIC.test(text)
  // On demande davantage de cartes que nécessaire : la finition en écarte une partie.
  const local = ['builtin', 'ollama'].includes(getSettings().aiProvider)
  const step = opts.onStep ?? ((): void => undefined)
  const review = canReview()
  const total = review ? 3 : 2
  step(0, 0, 'Création des cartes par l’IA… (la première étape est la plus longue)')
  const raw = await aiGenerate(text, Math.min(Math.ceil(count * 1.4), local ? 10 : 30), lang, hint)
  step(1, total, 'Vérification et mise en forme des cartes…')
  let cards = finalizeDrafts(raw, { source: topic ? undefined : text, vocabulary: opts.vocabulary })
  if (cards.length >= 2 && review) {
    step(2, total, 'Relecture des cartes par l’IA (exactitude, clarté)…')
    cards = await reviewCards(cards, topic ? '' : text, lang)
  }
  step(total, total, 'Terminé')
  return cards.slice(0, Math.max(1, count))
}

/** La relecture par l'IA est utile avec un vrai modèle ; le plus petit modèle local s'y perdrait. */
function canReview(): boolean {
  const s = getSettings()
  if (!s.aiReview || s.aiProvider === 'none') return false
  return !(s.aiProvider === 'builtin' && s.aiModel === 'light')
}

const REVIEW_SCHEMA = { type: 'object', properties: { cards: { type: 'array', items: FLAT_CARD } }, required: ['cards'] }

/**
 * Deuxième passage : un relecteur exigeant vérifie chaque carte (exacte, utile, atomique, claire sans le document),
 * la corrige ou la supprime. Si la relecture échoue ou supprime trop, on garde les cartes d'origine.
 */
async function reviewCards(cards: AiCardProposal[], source: string, lang: 'fr' | 'en'): Promise<AiCardProposal[]> {
  try {
    const system = `Tu es un relecteur exigeant de cartes de révision (flashcards). Pour chaque carte, vérifie qu'elle est exacte${source ? ' d\'après l\'extrait fourni' : ''}, utile pour un examen, atomique (une seule idée), claire sans le document, et que la question appelle une seule réponse courte.
RACCOURCIS toute carte trop longue : question de 20 mots maximum, réponse de 25 mots maximum (une phrase, ou 4 éléments au plus) ; si une carte contient plusieurs idées, remplace-la par plusieurs cartes courtes.
Corrige la formulation si besoin (formules en LaTeX entre $…$), ou SUPPRIME la carte si elle est fausse, triviale, ambiguë, hors sujet ou administrative. N'ajoute aucune carte. Langue : ${LANG[lang]}.
Réponds UNIQUEMENT avec le même JSON : {"cards":[…]} (champs type, front, back, text, extra).`
    const payload = JSON.stringify({ cards: cards.map((c) => ({ type: c.kind, front: c.front, back: c.back, text: c.text, extra: c.extra })) })
    const user = `${source ? `Extrait du cours :\n---\n${source.slice(0, chunkSize())}\n---\n\n` : ''}Cartes à relire :\n${payload}`
    const reply = await call('relecture des cartes', system, user, Math.min(4000, cards.length * 240 + 400), true, REVIEW_SCHEMA)
    let parsed: AiCardProposal[]
    try {
      parsed = normalizeProposals(extractJson(reply))
    } catch {
      parsed = normalizeProposals(salvageObjects(reply))
    }
    const reviewed = finalizeDrafts(parsed, { source: source || undefined })
    return reviewed.length >= Math.ceil(cards.length * 0.4) ? reviewed : cards
  } catch {
    return cards
  }
}
