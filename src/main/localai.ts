import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { totalmem } from 'os'
import { join } from 'path'
import type { LocalAiStatus, LocalModelInfo } from '../shared/types'
import { dataDir } from './db'

/*
 * IA intégrée : un petit modèle open source (Qwen 2.5) tourne sur le PC grâce à llama.cpp.
 * Gratuit, illimité, hors ligne une fois le modèle téléchargé. Les réponses JSON sont contraintes par une grammaire,
 * ce qui garantit des cartes bien formées même avec un petit modèle.
 */

interface ModelDef {
  id: LocalModelInfo['id']
  label: string
  description: string
  uri: string
  sizeMb: number
  /** Nom de fichier produit par node-llama-cpp : sert à savoir si le modèle est déjà installé. */
  match: RegExp
}

const MODELS: ModelDef[] = [
  {
    id: 'light',
    label: 'Léger',
    description: 'Pour les petits PC. Cartes simples, rapide.',
    uri: 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M',
    sizeMb: 1100,
    match: /Qwen2\.5-1\.5B-Instruct.*Q4_K_M/i
  },
  {
    id: 'balanced',
    label: 'Équilibré',
    description: 'Bon compromis qualité / vitesse, même sans carte graphique.',
    uri: 'hf:Qwen/Qwen2.5-3B-Instruct-GGUF:Q4_K_M',
    sizeMb: 2100,
    match: /Qwen2\.5-3B-Instruct.*Q4_K_M/i
  },
  {
    id: 'best',
    label: 'Précis',
    description: 'Le plus fin en français. Idéal avec une carte graphique de 6 Go ou plus.',
    uri: 'hf:bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M',
    sizeMb: 4700,
    match: /Qwen2\.5-7B-Instruct.*Q4_K_M/i
  }
]

export const modelsDir = (): string => join(dataDir(), 'models')

// L'import dynamique évite que le bundler transforme ce module (ESM) en require().
const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any

type Sink = (event: string, payload: unknown) => void
let sink: Sink = () => undefined
export const setLocalAiSink = (s: Sink): void => {
  sink = s
}

let engine: { llama: any; model: any; modelId: string; path: string } | null = null // eslint-disable-line @typescript-eslint/no-explicit-any
let idleTimer: NodeJS.Timeout | null = null
let downloading: { id: string; downloaded: number; total: number; cancel: () => Promise<void> } | null = null
let chain: Promise<unknown> = Promise.resolve()

function installedFile(def: ModelDef): string | null {
  const dir = modelsDir()
  if (!existsSync(dir)) return null
  const f = readdirSync(dir).find((n) => n.endsWith('.gguf') && def.match.test(n) && !n.endsWith('.part'))
  if (!f) return null
  const p = join(dir, f)
  // Un téléchargement interrompu laisse parfois un fichier plus petit que prévu.
  return statSync(p).size > def.sizeMb * 1024 * 1024 * 0.9 ? p : null
}

let hw: { gpu: string | false; vramMb: number } | null = null
async function probeHardware(): Promise<{ gpu: string | false; vramMb: number }> {
  if (hw) return hw
  try {
    const { getLlama } = await dynImport('node-llama-cpp')
    const llama = await getLlama()
    const vram = llama.gpu ? await llama.getVramState() : { total: 0 }
    hw = { gpu: llama.gpu as string | false, vramMb: Math.round(vram.total / 1024 / 1024) }
  } catch {
    hw = { gpu: false, vramMb: 0 }
  }
  return hw
}

export function recommend(vramMb: number, ramMb: number): LocalModelInfo['id'] {
  if (vramMb >= 5500) return 'best'
  if (ramMb >= 7000) return 'balanced'
  return 'light'
}

export async function localStatus(selected: string): Promise<LocalAiStatus> {
  const h = await probeHardware()
  const ramMb = Math.round(totalmem() / 1024 / 1024)
  const rec = recommend(h.vramMb, ramMb)
  return {
    gpu: h.gpu,
    vramMb: h.vramMb,
    ramMb,
    selected,
    loaded: !!engine,
    downloading: downloading ? { id: downloading.id, downloaded: downloading.downloaded, total: downloading.total } : null,
    models: MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      sizeMb: m.sizeMb,
      installed: !!installedFile(m),
      recommended: m.id === rec
    }))
  }
}

/** Le meilleur modèle déjà installé sur le PC (pour reprendre la main quand le fournisseur en ligne échoue). */
export function anyInstalledModel(): string | null {
  for (const id of ['best', 'balanced', 'light']) {
    const def = MODELS.find((m) => m.id === id)
    if (def && installedFile(def)) return id
  }
  return null
}

export function hasInstalledModel(selected: string): boolean {
  const def = MODELS.find((m) => m.id === selected) ?? MODELS[1]
  return !!installedFile(def)
}

export async function downloadModel(id: string): Promise<void> {
  const def = MODELS.find((m) => m.id === id)
  if (!def) throw new Error('Modèle inconnu')
  if (downloading) throw new Error('Un téléchargement est déjà en cours.')
  mkdirSync(modelsDir(), { recursive: true })
  const { createModelDownloader } = await dynImport('node-llama-cpp')
  const dl = await createModelDownloader({
    modelUri: def.uri,
    dirPath: modelsDir(),
    showCliProgress: false,
    onProgress: ({ downloadedSize, totalSize }: { downloadedSize: number; totalSize: number }) => {
      if (downloading) {
        downloading.downloaded = downloadedSize
        downloading.total = totalSize
      }
      sink('ai-download', { id, downloaded: downloadedSize, total: totalSize })
    }
  })
  downloading = { id, downloaded: 0, total: def.sizeMb * 1024 * 1024, cancel: () => dl.cancel() }
  try {
    await dl.download()
    sink('ai-download', { id, done: true })
  } catch (e) {
    sink('ai-download', { id, error: (e as Error).message })
    throw e
  } finally {
    downloading = null
  }
}

export async function cancelDownload(): Promise<void> {
  await downloading?.cancel()
}

export function deleteModel(id: string): void {
  const def = MODELS.find((m) => m.id === id)
  const f = def && installedFile(def)
  if (f) unlinkSync(f)
  if (engine && engine.modelId === id) void unload()
}

async function unload(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  const e = engine
  engine = null
  try {
    await e?.model.dispose()
  } catch {
    /* déjà libéré */
  }
}

async function ensure(selected: string): Promise<NonNullable<typeof engine>> {
  const def = MODELS.find((m) => m.id === selected) ?? MODELS[1]
  const path = installedFile(def)
  if (!path) throw new Error('Le modèle d’IA intégré n’est pas encore installé. Active-le depuis « Intégrations ».')
  if (engine && engine.modelId === def.id) return engine
  await unload()
  const { getLlama } = await dynImport('node-llama-cpp')
  const llama = await getLlama()
  const model = await llama.loadModel({ modelPath: path })
  engine = { llama, model, modelId: def.id, path }
  return engine
}

export interface LocalChat {
  system: string
  user: string
  schema?: Record<string, unknown>
  maxTokens: number
}

/** Une réponse du modèle local. Les appels sont mis en file : un seul modèle, une seule conversation à la fois. */
export function localChat(selected: string, o: LocalChat): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const run = async (): Promise<{ text: string; tokensIn: number; tokensOut: number }> => {
    const e = await ensure(selected)
    const { LlamaChatSession } = await dynImport('node-llama-cpp')
    const context = await e.model.createContext({ contextSize: 8192 })
    try {
      const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: o.system })
      const grammar = o.schema ? await e.llama.createGrammarForJsonSchema(o.schema) : undefined
      let n = 0
      const text: string = await session.prompt(o.user, {
        grammar,
        maxTokens: o.maxTokens,
        temperature: 0.3,
        onTextChunk: () => {
          n++
          if (n % 8 === 0) sink('ai-progress', { tokens: n })
        }
      })
      return {
        text,
        tokensIn: e.model.tokenize(o.system + o.user).length,
        tokensOut: e.model.tokenize(text).length
      }
    } finally {
      await context.dispose()
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => void unload(), 10 * 60 * 1000)
    }
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next
}

export async function shutdownLocalAi(): Promise<void> {
  await unload()
}
