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

let server: Server
let base = ''
let lastBody: { model?: string; messages?: { role: string; content: string }[] } = {}

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mnemo-ai-'))
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.1' }] }))
      lastBody = JSON.parse(body)
      const user = lastBody.messages?.[1]?.content ?? ''
      const content = user.includes('Type :')
        ? JSON.stringify({ verdict: 'ambiguous', issues: ['Plusieurs réponses possibles'], suggestion: { type: 'basic', front: 'Capitale de la France ?', back: 'Paris' } })
        : 'Voici les cartes :\n```json\n' + JSON.stringify([
            { type: 'basic', front: 'Capitale de la France ?', back: 'Paris' },
            { type: 'cloze', text: 'La {{c1::mitose}} produit deux cellules filles.', extra: '' },
            { type: 'basic', front: 'cassée' }
          ]) + '\n```'
      res.end(JSON.stringify({ message: { content }, prompt_eval_count: 120, eval_count: 60 }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
afterAll(() => server.close())

describe('couche IA (fournisseur local simulé)', () => {
  it('teste la connexion, estime, génère, journalise', async () => {
    const { openDb } = await import('../src/main/db')
    openDb()
    const ai = await import('../src/main/ai')
    // Par défaut : l'IA intégrée, pas encore téléchargée.
    expect(ai.aiStatus()).toMatchObject({ provider: 'builtin', ready: false })
    await expect(ai.aiGenerate('texte', 5, 'fr', '')).rejects.toThrow(/pas encore installé/)
    ai.aiConfigure({ provider: 'none' })
    await expect(ai.aiGenerate('texte', 5, 'fr', '')).rejects.toThrow(/Aucun fournisseur/)

    ai.aiConfigure({ provider: 'ollama', baseUrl: base, model: 'llama3.1' })
    const test = await ai.aiTest()
    expect(test.ok).toBe(true)
    expect(test.models).toContain('llama3.1')

    const est = ai.aiEstimate('x'.repeat(13000), 20)
    expect(est.chunks).toBe(3)
    expect(est.cost).toBe(0) // local : gratuit
    expect(est.overCap).toBe(false)

    const cards = await ai.aiGenerate('Le cours sur la cellule.', 6, 'fr', 'Mets l’accent sur les définitions')
    expect(cards).toHaveLength(2) // la carte cassée est écartée
    expect(cards[1].kind).toBe('cloze')
    expect(lastBody.messages?.[1].content).toContain('Mets l’accent sur les définitions')
    expect(lastBody.messages?.[0].content).toContain('JSON')

    const log = ai.aiLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ provider: 'ollama', tokensIn: 120, tokensOut: 60, cost: 0 })

    const d = await ai.aiDiagnose('Quelle est la capitale ?', 'Paris', 'basic')
    expect(d.verdict).toBe('ambiguous')
    expect(d.suggestion?.back).toBe('Paris')
  })

  it('applique le plafond mensuel aux fournisseurs payants', async () => {
    const ai = await import('../src/main/ai')
    const { getDb } = await import('../src/main/db')
    ai.aiConfigure({ provider: 'openai', baseUrl: base, model: 'x', monthlyCap: 1 })
    getDb().prepare("INSERT INTO ai_call(id, at, provider, model, tokens_in, tokens_out, cost, purpose) VALUES ('z', ?, 'openai', 'x', 1, 1, 1.5, 'test')").run(Date.now())
    // Clé manquante d'abord, puis plafond atteint.
    await expect(ai.aiGenerate('texte', 5, 'fr', '')).rejects.toThrow(/Clé d’API manquante/)
    expect(ai.aiEstimate('x'.repeat(100), 5).overCap).toBe(true)
  })
})
