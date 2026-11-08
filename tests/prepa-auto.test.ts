import { createServer, type Server } from 'http'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  shell: { openPath: async () => '' },
  BrowserWindow: class {},
  Notification: class {
    static isSupported = (): boolean => false
  },
  safeStorage: { isEncryptionAvailable: () => false }
}))
// Pas de session Electron en test : on parle directement au faux site.
vi.mock('../src/main/prepa-electron', async () => {
  const { fetchHttp } = await import('../src/main/prepa')
  return { electronHttp: () => fetchHttp(fetch), autoLogin: async () => false }
})

const COURSE = 'Le théorème de Bayes relie probabilités conditionnelles et probabilités totales. '.repeat(8)
const uniqueCourse = (id: string): string => `${COURSE} ${Array.from({ length: 70 }, (_, k) => `terme${id}n${k}`).join(' ')}`

const article = (id: number, title: string, rep: string): string =>
  `<article class="recents"><h3><span class="icon-doc-pdf"></span>&nbsp;<a href="download?id=${id}">${title}</a></h3>
<p class="publi">Publication le 09/10 à 18h50</p><div><p>Document de 12&nbsp;ko, dans <a href="docs?rep=${rep}">Mathématiques/Cours</a></p></div></article>`

let site: Server
let ollama: Server
let base = ''
let withNew = false

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mnemo-prepa-auto-'))
  site = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname.replace('/cl', '')
    const send = (body: string | Buffer, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}): void => {
      res.writeHead(200, { 'Content-Type': type, ...extra })
      res.end(body)
    }
    if (path === '/' || path === '') return send('<html><head><title>Classe</title></head><body><h1>Classe</h1><footer>Ce site est réalisé par le logiciel Cahier de prépa</footer></body></html>')
    if (path === '/recent')
      return send(
        `<html><body><select id="matiere"><option value="tout">Filtrer</option><option value="maths">Mathématiques</option></select>${article(21, 'Chapitre 1', '1')}${withNew ? article(22, 'Chapitre 2', '1') + article(23, 'Chapitre 2 (copie)', '1') : ''}</body></html>`
      )
    if (path === '/docs') return send('<html><body></body></html>')
    if (path === '/agenda') return send('<html><body></body></html>')
    if (path === '/download') return send(Buffer.from(uniqueCourse(url.searchParams.get('id') === '23' ? '22' : (url.searchParams.get('id') ?? '0')), 'utf8'), 'text/plain', { 'Content-Disposition': `attachment; filename="cours-${url.searchParams.get('id')}.txt"` })
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}/cl/`

  ollama = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'x' }] }))
      const content = JSON.stringify({
        cards: [
          { type: 'basic', front: `Question ${Math.random()} sur Bayes ?`, back: 'P(A|B)P(B)/P(A)' , text: '', extra: '' },
          { type: 'cloze', text: `Bayes ${Math.random()} : {{c1::probabilités conditionnelles}}`, front: '', back: '', extra: '' }
        ]
      })
      res.end(JSON.stringify({ message: { content: body.includes('fiche') ? '# Fiche\n- Bayes' : content }, prompt_eval_count: 5, eval_count: 5 }))
    })
  })
  await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r))
})
afterAll(() => {
  site.close()
  ollama.close()
})

describe('Synchronisation automatique du Cahier de Prépa', () => {
  it('ne fait rien tant que l’élève n’a pas fait un premier import', async () => {
    const { openDb } = await import('../src/main/db')
    openDb()
    const { setSettings } = await import('../src/main/util')
    setSettings({ prepaUrl: base })
    const { runPrepaAuto } = await import('../src/main/prepa-auto')
    const events: string[] = []
    const r = await runPrepaAuto(() => null, (_w, type) => events.push(type))
    expect(r.state).toBe('off')
    expect(events).toEqual([])
  })

  it('importe tout au lancement, puis seulement les nouveautés ensuite', async () => {
    const ai = await import('../src/main/ai')
    ai.aiConfigure({ provider: 'ollama', baseUrl: `http://127.0.0.1:${(ollama.address() as { port: number }).port}`, model: 'x' })
    const { setSettings } = await import('../src/main/util')
    setSettings({ prepaUrl: base, prepaAuto: true })
    const { runPrepaAuto } = await import('../src/main/prepa-auto')
    const { listDocuments } = await import('../src/main/documents')

    const sent: string[] = []
    const first = await runPrepaAuto(() => null, (_w, type, payload) => sent.push(type === 'prepa-auto' ? `auto:${(payload as { state: string }).state}` : type))
    expect(first.state).toBe('done')
    if (first.state !== 'done') return
    expect(first.result.downloaded).toBe(1)
    expect(first.result.cards).toBeGreaterThanOrEqual(2)
    expect(first.result.summaries).toBe(1)
    expect(sent).toContain('auto:start')
    expect(sent).toContain('auto:done')
    expect(listDocuments()).toHaveLength(1)

    // Rien de nouveau : aucun téléchargement, aucune carte en double.
    const quiet = await runPrepaAuto(() => null, () => undefined)
    expect(quiet.state === 'done' && quiet.result.downloaded).toBe(0)
    expect(quiet.state === 'done' && quiet.result.cards).toBe(0)

    // Le professeur publie un nouveau cours : il arrive tout seul.
    withNew = true
    const next = await runPrepaAuto(() => null, () => undefined)
    expect(next.state === 'done' && next.result.downloaded).toBe(2)
    expect(next.state === 'done' && next.result.cards).toBeGreaterThanOrEqual(2)
    // La copie du même cours n'est pas traitée comme un nouveau cours.
    expect(next.state === 'done' && next.result.duplicates).toBe(1)
    expect(listDocuments()).toHaveLength(3)
    expect(listDocuments().filter((d) => d.category === 'doublon')).toHaveLength(1)
  })

  it('respecte l’interrupteur et reste silencieux hors ligne', async () => {
    const { setSettings } = await import('../src/main/util')
    const { runPrepaAuto } = await import('../src/main/prepa-auto')
    setSettings({ prepaAuto: false })
    expect((await runPrepaAuto(() => null, () => undefined)).state).toBe('off')
    setSettings({ prepaAuto: true, prepaUrl: 'http://127.0.0.1:1/cl/' })
    const off = await runPrepaAuto(() => null, () => undefined)
    expect(off.state).toBe('error')
  })
})
