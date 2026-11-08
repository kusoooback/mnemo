import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Rendu des cartes avec formules (LaTeX, trous) à la révision : MNEMO_QA_REVIEW=1, MNEMO_QA_DIR=<sortie>. */
export async function runReview(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const shot = async (name: string): Promise<void> => {
    await wait(700)
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  }
  const key = async (keyCode: string): Promise<void> => {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'char', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await wait(250)
  }
  await wait(1500)
  await invoke('settings.set', { onboarded: true, theme: 'light' })
  await js('location.reload()')
  await wait(1300)
  const deck = await invoke<string>('deck.create', 'Prépa ECG::Mathématiques::Ensembles et applications', null)
  await invoke('note.add', {
    kind: 'cloze',
    deckId: deck,
    fields: { text: 'Pour tout {{c1::$x \\in E$}}, on a $f(x) \\in F$ si $f$ est une application de $E$ dans $F$.', extra: '' },
    tags: ['ia-auto']
  })
  await invoke('note.add', {
    kind: 'basic',
    deckId: deck,
    fields: { front: 'Quelle est la définition d’une application $f : E \\to F$ **injective** ?', back: 'Pour tous $x, y \\in E$, $f(x) = f(y) \\Rightarrow x = y$.' },
    tags: ['ia-auto']
  })
  await js('location.reload()')
  await wait(1200)
  await js(`(() => { const el = [...document.querySelectorAll('button')].find(e => e.textContent && e.textContent.includes('Commencer la révision')); if (el) el.click() })()`)
  await wait(700)
  await shot('r1-front')
  await key(' ')
  await shot('r2-back')
  await key('3')
  await shot('r3-next-front')
  await key(' ')
  await shot('r4-next-back')
}
