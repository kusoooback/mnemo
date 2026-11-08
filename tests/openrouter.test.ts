import { createServer, type Server } from 'http'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

// Coffre des secrets en mémoire (pas de chiffrement du système en test).
vi.mock('../src/main/secrets', () => {
  const store = new Map<string, string>()
  return {
    getSecret: (k: string) => store.get(k) ?? null,
    hasSecret: (k: string) => store.has(k),
    setSecret: (k: string, v: string | null) => (v ? store.set(k, v) : store.delete(k))
  }
})

let server: Server
let base = ''
let hits = 0
let mode: 'ok' | 'limit' | 'first-limited' | 'auth' = 'ok'
let lastAuth = ''
const modelsSeen: string[] = []

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mnemo-or-'))
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/v1/auth/key') return res.end(JSON.stringify({ data: { label: 'ma-cle', is_free_tier: true } }))
      hits++
      lastAuth = String(req.headers.authorization)
      const asked = (JSON.parse(body) as { model?: string; reasoning?: unknown; max_tokens?: number }).model ?? ''
      modelsSeen.push(asked)
      if (mode === 'auth') {
        res.statusCode = 401
        return res.end(JSON.stringify({ error: { code: 401, message: 'No auth credentials found' } }))
      }
      if (mode === 'first-limited' && asked.includes('nemotron-3-ultra')) {
        res.statusCode = 429
        return res.end(JSON.stringify({ error: { code: 429, message: 'saturé' } }))
      }
      if (mode === 'limit') {
        res.statusCode = 429
        return res.end(JSON.stringify({ error: { code: 429, message: 'rate limit' } }))
      }
      const cards = JSON.stringify({ cards: [{ type: 'basic', front: 'Quelle est la dérivée de $e^x$ ?', back: '$e^x$', text: '', extra: '' }] })
      res.end(JSON.stringify({ choices: [{ message: { content: `<think>je réfléchis</think>${cards}` } }], usage: { prompt_tokens: 12, completion_tokens: 7 } }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
})
afterAll(() => server.close())

describe('OpenRouter', () => {
  it('génère des cartes, retire la réflexion du modèle et ne coûte rien avec un modèle gratuit', async () => {
    const { openDb } = await import('../src/main/db')
    openDb()
    const ai = await import('../src/main/ai')
    ai.aiConfigure({ provider: 'openrouter', baseUrl: base, key: 'sk-or-test' })
    expect(ai.aiStatus()).toMatchObject({ provider: 'openrouter', model: ai.BEST_FREE_MODEL, ready: true })
    expect(ai.BEST_FREE_MODEL).toMatch(/:free$/) // 100 % gratuit
    const cards = await ai.aiGenerate('La dérivée de exp est exp. '.repeat(40), 3, 'fr', '')
    expect(cards).toHaveLength(1)
    expect(cards[0].front).toContain('dérivée')
    expect(lastAuth).toBe('Bearer sk-or-test')
    expect(ai.aiStatus().monthCost).toBe(0)
    expect((await ai.aiTest()).message).toMatch(/Clé valide/)
  })

  it('prend le plus gros modèle gratuit, et passe au suivant quand il est saturé', async () => {
    const ai = await import('../src/main/ai')
    modelsSeen.length = 0
    mode = 'ok'
    await ai.aiGenerate('La dérivée de exp est exp. '.repeat(40), 3, 'fr', '')
    expect(modelsSeen[0]).toBe(ai.BEST_FREE_MODEL)
    modelsSeen.length = 0
    mode = 'first-limited'
    const cards = await ai.aiGenerate('La dérivée de exp est exp. '.repeat(40), 3, 'fr', '')
    expect(cards).toHaveLength(1) // la réponse du deuxième modèle est bien utilisée
    expect(modelsSeen.some((m) => m.includes('gemma-4-31b'))).toBe(true)
    mode = 'ok'
  })

  it('une clé refusée donne un message clair, sans essayer les autres modèles', async () => {
    const ai = await import('../src/main/ai')
    modelsSeen.length = 0
    mode = 'auth'
    await expect(ai.aiGenerate('Un cours assez long. '.repeat(40), 3, 'fr', '')).rejects.toThrow(/Clé OpenRouter refusée/)
    expect(new Set(modelsSeen).size).toBe(1)
    mode = 'ok'
  })

  it('se met en pause quand la limite est atteinte au lieu de marteler le serveur', async () => {
    const ai = await import('../src/main/ai')
    mode = 'limit'
    await expect(ai.aiGenerate('Un cours assez long. '.repeat(40), 3, 'fr', '')).rejects.toThrow(/Limite de requêtes/)
    const after = hits
    // Pause de 30 minutes : le deuxième appel n'atteint même pas le serveur.
    await expect(ai.aiGenerate('Un autre cours assez long. '.repeat(40), 3, 'fr', '')).rejects.toThrow(/pause/)
    expect(hits).toBe(after)
  })
})
