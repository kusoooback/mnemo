import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Gros profil (MNEMO_QA_PERF=1) : 12 000 cartes, temps de réponse et mémoire. MNEMO_QA_DIR=<sortie>. */
export async function runPerf(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  try {
    await inner(win, log)
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'perf.txt'), log.join(String.fromCharCode(10)))
  }
}

async function inner(win: BrowserWindow, log: string[]): Promise<void> {
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const timed = async (what: string, code: string): Promise<void> => {
    const t = Date.now()
    await js(code)
    log.push(`${what}: ${Date.now() - t} ms`)
  }
  const mem = (what: string): void => {
    const m = app.getAppMetrics().map((p) => `${p.type}=${Math.round(p.memory.workingSetSize / 1024)}`)
    const total = app.getAppMetrics().reduce((a, p) => a + p.memory.workingSetSize, 0)
    log.push(`MEM ${what}: ${m.join(' ')} total=${Math.round(total / 1024)} Mo`)
  }
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(1500)
  }
  const dom = (): Promise<number> => js<number>('document.querySelectorAll("*").length')

  await wait(1500)
  mem('démarrage')

  let t = Date.now()
  const decks: string[] = []
  for (let d = 0; d < 30; d++) decks.push(await js<string>(`window.mnemo.invoke('deck.create', 'Matière ${d}', null)`))
  await js(`(async () => { const decks = ${JSON.stringify(decks)}; for (let i = 0; i < 12000; i++) await window.mnemo.invoke('note.add', { kind: 'basic', deckId: decks[i % 30], fields: { front: 'Question ' + i + ' : dérivée de $x^' + (i % 9 + 2) + '$ ?', back: 'Réponse ' + i + ' : $' + (i % 9 + 2) + 'x^' + (i % 9 + 1) + '$' }, tags: ['t' + (i % 40)] }) })()`)
  log.push(`création de 12000 cartes : ${Date.now() - t} ms`)
  await js(`window.__mnemo.getState().refreshDecks()`)
  await wait(800)
  mem('après création')

  await timed('deck.list', `window.mnemo.invoke('deck.list')`)
  await timed('stats.get (tout)', `window.mnemo.invoke('stats.get', null)`)
  await timed('card.search 100', `window.mnemo.invoke('card.search', { text: '', deckId: null, state: 'all', tag: null, sort: 'created', limit: 100, offset: 0 })`)
  await timed('card.search texte "dérivée de $x^5"', `window.mnemo.invoke('card.search', { text: 'Question 77', deckId: null, state: 'all', tag: null, sort: 'alpha', limit: 100, offset: 0 })`)
  await timed('tags.list', `window.mnemo.invoke('tags.list')`)

  for (const r of [{ name: 'home' }, { name: 'library' }, { name: 'stats' }, { name: 'quiz' }, { name: 'home' }]) {
    t = Date.now()
    await go(r)
    log.push(`page ${r.name} (1,5 s d’attente incluse) : DOM=${await dom()} nœuds`)
  }
  await go({ name: 'library' })
  await js(`(() => { const s = document.querySelector('.main-scroll'); if (s) s.scrollTop = 1e9 })()`)
  await wait(1200)
  log.push(`bibliothèque après défilement : DOM=${await dom()} nœuds`)
  mem('après navigation')
  log.push(`heap renderer: ${await js<string>('Math.round(performance.memory.usedJSHeapSize / 1048576) + " Mo"')}`)
  log.push('ok     terminé')
}
