import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Changer d'écran ne fait rien perdre : MNEMO_QA_KEEP=1, MNEMO_QA_DIR=<sortie>. Fenêtre jamais affichée. */
export async function runKeep(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  try {
    await inner(win, log)
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'keep.txt'), log.join(String.fromCharCode(10)))
  }
}

async function inner(win: BrowserWindow, log: string[]): Promise<void> {
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const check = (ok: boolean, what: string): void => {
    log.push(`${ok ? 'ok     ' : 'ECHEC  '} ${what}`)
  }
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(800)
  }
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const count = (sel: string): Promise<number> => js<number>(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
  const val = (sel: string): Promise<string> => js<string>(`(document.querySelector(${JSON.stringify(sel)}) || {}).value ?? ''`)
  const type = (sel: string, v: string): Promise<boolean> =>
    js<boolean>(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )
  const key = (k: string): Promise<void> => js<void>(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)

  await wait(1500)
  await invoke('settings.set', { onboarded: true, tourDone: true, userName: 'Malo' })
  await js('location.reload()')
  await wait(1300)
  const deckId = await invoke<string>('deck.create', 'QA Keep', null)
  for (let i = 0; i < 12; i++) await invoke('note.add', { kind: 'basic', deckId, fields: { front: `Question ${i}`, back: `Réponse ${i}` }, tags: [] })
  await js(`window.__mnemo.getState().refreshDecks()`)
  await wait(500)

  // 1. Génération IA : le texte collé survit à un tour par d'autres écrans.
  await go({ name: 'ai' })
  check(await type('.main-scroll textarea', 'Le traité de Versailles (1919) met fin à la Première Guerre mondiale.'), 'texte saisi dans Génération IA')
  await go({ name: 'library' })
  await go({ name: 'stats' })
  await go({ name: 'ai' })
  check((await val('.main-scroll textarea')).startsWith('Le traité de Versailles'), 'Génération IA : le texte est toujours là après deux autres écrans')

  // 2. Bibliothèque : la recherche reste.
  await go({ name: 'library' })
  await type('.main-scroll input.input', 'Question 7')
  await wait(500)
  await go({ name: 'settings' })
  await go({ name: 'library' })
  check((await val('.main-scroll input.input')) === 'Question 7', 'Bibliothèque : la recherche est conservée')

  // 3. Un seul écran visible, les autres sont cachés.
  check((await count('.main-scroll')) === 1, 'un seul écran visible à la fois')
  check((await count('.main-kept')) >= 3, `les écrans visités restent en vie (${await count('.main-kept')})`)

  // 4. Position de défilement des réglages.
  await go({ name: 'settings' })
  const dims = await js<string>(`(() => { const e = document.querySelector('.main-scroll'); e.scrollTop = 900; return e.scrollHeight + '/' + e.clientHeight + '/' + e.scrollTop })()`)
  log.push('info   Réglages scrollHeight/clientHeight/scrollTop = ' + dims)
  await wait(300)
  await go({ name: 'home' })
  await go({ name: 'settings' })
  const top = await js<number>(`document.querySelector('.main-scroll').scrollTop`)
  check(top > 700, `Réglages : position de défilement retrouvée (${Math.round(top)})`)

  // 5. Quiz en cours : conservé, et ses raccourcis clavier se taisent quand on est ailleurs.
  await go({ name: 'quiz' })
  await js(`(() => { const s = document.querySelector('[data-testid="qz-deck"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(deckId)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await wait(900)
  await js(`document.querySelector('[data-testid="qz-start"]').click()`)
  await wait(900)
  check(await has('[data-testid="qz-question"]'), 'quiz lancé')
  await go({ name: 'stats' })
  await key('1')
  await key('Enter')
  await wait(300)
  await go({ name: 'quiz' })
  check(await has('[data-testid="qz-question"]'), 'Quiz : toujours en cours au retour')
  check(!(await has('[data-testid="qz-feedback"]')), 'Quiz : les touches pressées ailleurs n’ont rien répondu')
  await key('1')
  await wait(300)
  check(await has('[data-testid="qz-feedback"]'), 'Quiz : les raccourcis refonctionnent sur la page')

  // 6. Données : une carte ajoutée pendant qu'on est ailleurs apparaît au retour dans la bibliothèque.
  await go({ name: 'library' })
  await invoke('note.add', { kind: 'basic', deckId, fields: { front: 'Nouvelle carte unique zzz', back: 'x' }, tags: [] })
  await js(`window.__mnemo.getState().bump()`)
  await go({ name: 'home' })
  await go({ name: 'library' })
  await type('.main-scroll input.input', 'zzz')
  await wait(900)
  check((await js<string>(`document.body.innerText`)).includes('Nouvelle carte unique zzz'), 'Bibliothèque : données rafraîchies au retour')

  // 7. Les decks : quelques-uns seulement sont gardés.
  const ids: string[] = []
  for (let i = 0; i < 6; i++) ids.push(await invoke<string>('deck.create', `D${i}`, null))
  await js(`window.__mnemo.getState().refreshDecks()`)
  for (const id of ids) await go({ name: 'deck', id })
  const deckPages = await js<number>(`document.querySelectorAll('.main-kept, .main-scroll').length`)
  check(deckPages < 14, `les écrans de decks sont limités (${deckPages} écrans en vie)`)
  check((await count('.main-scroll')) === 1, 'toujours un seul écran visible')
}
