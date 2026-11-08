import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '1.0.0-test' },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

type Json = Record<string, any>
let port = 0
let token = ''
let changes = 0

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, json: (await res.json()) as Json }
}

describe('Passerelle locale (connexion de Claude)', () => {
  let bridge: typeof import('../src/main/bridge')

  beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), 'mnemo-bridge-'))
    const { openDb } = await import('../src/main/db')
    openDb()
    bridge = await import('../src/main/bridge')
    const st = await bridge.startBridge(() => changes++, 48700)
    port = st.port
    token = JSON.parse(readFileSync(join(userData, bridge.BRIDGE_FILE), 'utf8')).token
  })
  afterAll(async () => {
    await bridge.stopBridge()
  })

  it('écrit le port et un jeton dans bridge.json, et écoute en local', () => {
    expect(port).toBeGreaterThanOrEqual(48700)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuse les requêtes sans jeton ou avec un mauvais jeton', async () => {
    const bad = await fetch(`http://127.0.0.1:${port}/v1/status`)
    expect(bad.status).toBe(401)
    const wrong = await call('GET', '/v1/status', undefined, { Authorization: 'Bearer nope' })
    expect(wrong.status).toBe(401)
  })

  it('refuse une page web (en-tête Origin)', async () => {
    const web = await call('GET', '/v1/status', undefined, { Origin: 'https://evil.example' })
    expect(web.status).toBe(403)
  })

  it('crée un deck, ajoute des cartes basiques et à trous, ignore les doublons', async () => {
    changes = 0
    const r = await call('POST', '/v1/cards', {
      deck: 'HGG::Chapitre 1',
      cards: [
        { front: 'Quelle date marque le début de la Première Guerre mondiale ?', back: '28 juillet 1914', tags: ['hgg'] },
        { text: 'La bataille de Verdun a eu lieu en {{c1::1916}}.' },
        { type: 'basic-reverse', front: 'Armistice', back: 'Arrêt des combats' },
        { front: 'Quelle date marque le début de la Première Guerre mondiale ?', back: 'x' },
        { text: 'Pas de trou ici' },
        { front: '', back: 'orpheline' }
      ]
    })
    expect(r.status).toBe(200)
    expect(r.json.added).toBe(3)
    expect(r.json.duplicates).toBe(1)
    expect(r.json.errors).toBe(2)
    expect(r.json.created).toBe(true)
    expect(changes).toBeGreaterThan(0)

    // Le deck est retrouvé sans tenir compte des accents ni de la casse, et on n'en crée pas un second.
    const again = await call('POST', '/v1/cards', { deck: 'hgg::chapitre 1', cards: [{ front: 'Qui était Clemenceau en 1918 ?', back: 'Président du Conseil' }] })
    expect(again.json.created).toBe(false)
    const decks = (await call('GET', '/v1/decks')).json as unknown as { name: string; cards: number }[]
    expect(decks.filter((d) => d.name === 'HGG::Chapitre 1')).toHaveLength(1)
    // basique (1) + à trous (1) + réversible (2 cartes) + nouvelle carte (1)
    expect(decks.find((d) => d.name === 'HGG::Chapitre 1')?.cards).toBe(5)
  })

  it('refuse un deck inconnu quand create_deck est faux, et un lot vide', async () => {
    expect((await call('POST', '/v1/cards', { deck: 'Inconnu', create_deck: false, cards: [{ front: 'Quelle est la capitale ?', back: 'Paris' }] })).status).toBe(404)
    expect((await call('POST', '/v1/cards', { deck: 'X', cards: [] })).status).toBe(400)
  })

  it('crée une fiche Markdown lisible dans « Fiches »', async () => {
    const r = await call('POST', '/v1/sheets', { title: 'La Grande Guerre', markdown: '## Causes\n> [!KEY] À retenir\n> Alliances, nationalismes, impérialismes.' })
    expect(r.status).toBe(200)
    expect(r.json.id).toBeTruthy()
    const { getDb } = await import('../src/main/db')
    const row = getDb().prepare('SELECT title, source, text FROM document WHERE id = ?').get(r.json.id) as { title: string; source: string; text: string }
    expect(row.source).toBe('fiche')
    expect(row.text.startsWith('# La Grande Guerre')).toBe(true)
    expect((await call('POST', '/v1/sheets', { title: 'Vide', markdown: '' })).status).toBe(400)
  })

  it('cherche des cartes existantes', async () => {
    const r = await call('GET', '/v1/search?q=Verdun')
    expect(r.status).toBe(200)
    expect(r.json.total).toBeGreaterThanOrEqual(1)
  })

  it('serveur MCP : initialise, liste les outils et ajoute des cartes via la passerelle', async () => {
    const child = spawn(process.execPath, [join(__dirname, '..', 'mcp', 'mnemo-mcp.mjs')], { env: { ...process.env, MNEMO_DATA_DIR: userData } })
    const lines: Json[] = []
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i = buf.indexOf('\n')
      while (i >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)))
        buf = buf.slice(i + 1)
        i = buf.indexOf('\n')
      }
    })
    const rpc = async (id: number, method: string, params?: unknown): Promise<Json> => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      for (let t = 0; t < 100; t++) {
        const hit = lines.find((l) => l.id === id)
        if (hit) return hit
        await new Promise((r) => setTimeout(r, 50))
      }
      throw new Error('pas de réponse MCP')
    }
    try {
      const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18' })
      expect(init.result.serverInfo.name).toBe('mnemo')
      expect(init.result.instructions).toContain('UNE seule idée par carte')
      const tools = await rpc(2, 'tools/list')
      expect(tools.result.tools.map((t: Json) => t.name)).toEqual(expect.arrayContaining(['mnemo_add_cards', 'mnemo_create_sheet', 'mnemo_list_decks']))
      const add = await rpc(3, 'tools/call', { name: 'mnemo_add_cards', arguments: { deck: 'MCP', cards: [{ front: 'Que fait le serveur MCP de Mnémo ?', back: 'Il relie Claude à Mnémo' }] } })
      expect(add.result.isError).toBeUndefined()
      expect(JSON.parse(add.result.content[0].text).added).toBe(1)
    } finally {
      child.kill()
    }
  })

  it('à l’arrêt, le jeton disparaît et le port se ferme', async () => {
    await bridge.stopBridge()
    expect(existsSync(join(userData, bridge.BRIDGE_FILE))).toBe(false)
    expect(bridge.bridgeState().running).toBe(false)
    await expect(fetch(`http://127.0.0.1:${port}/v1/status`)).rejects.toThrow()
  })
})
