import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Contrôle visuel de l'adaptation à la taille de la fenêtre : lancé uniquement avec MNEMO_QA_SIZES=1 (et MNEMO_QA_DIR).
 * Une capture par écran et par taille, plus le plein écran.
 */
const SIZES: [number, number][] = [
  [720, 560],
  [1000, 680],
  [1280, 800],
  [1920, 1000],
  [2560, 1300]
]
const PAGES = ['Aujourd’hui', 'Bibliothèque', 'Statistiques', 'Cahier de Prépa', 'Cahier de texte', 'Génération IA']

export async function runSizes(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const click = (text: string): Promise<boolean> =>
    js(`(() => {
      const els = [...document.querySelectorAll('button, .deck-row, .nav-item, .t-row')];
      const el = els.find(e => (e.textContent && e.textContent.trim().includes(${JSON.stringify(text)})) || e.getAttribute('aria-label') === ${JSON.stringify(text)});
      if (el) { el.click(); return true } return false })()`)
  const shot = async (name: string): Promise<void> => {
    await wait(450)
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  }
  const log: string[] = []
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2) log.push(`[${level}] ${message}`)
  })

  await wait(1500)
  await js(`window.mnemo.invoke('settings.set', { onboarded: true, theme: 'light' })`)
  await js('location.reload()')
  await wait(1300)
  await click('Essayer avec un exemple')
  await wait(500)

  win.setMinimumSize(300, 300)
  for (const [w, h] of SIZES) {
    win.setContentSize(w, h)
    await wait(500)
    for (const [i, p] of PAGES.entries()) {
      await click(p)
      await wait(350)
      await shot(`${w}x${h}-${i}-${p.replace(/[^a-zA-Z]/g, '')}`)
    }
    // Révision : la fenêtre doit rester lisible quelle que soit sa taille.
    await click('Aujourd’hui')
    await wait(300)
    await click('Commencer la révision')
    await wait(500)
    await shot(`${w}x${h}-9-review`)
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await wait(300)
    const m = await js<{ sw: number; cw: number }>(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`)
    log.push(`${w}x${h}: scrollWidth ${m.sw} / clientWidth ${m.cw}${m.sw > m.cw ? '  <-- DEBORDEMENT HORIZONTAL' : ''}`)
  }

  win.setFullScreen(true)
  await wait(1200)
  for (const [i, p] of PAGES.entries()) {
    await click(p)
    await wait(350)
    await shot(`full-${i}-${p.replace(/[^a-zA-Z]/g, '')}`)
  }
  win.setFullScreen(false)
  writeFileSync(join(outDir, 'sizes.txt'), log.join('\n'))
}
