import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Captures du README avec les VRAIES données : MNEMO_QA_REALSHOTS=1, MNEMO_QA_DIR=<sortie>,
 * MNEMO_USER_DATA=<copie de la base>. Aucune donnée n'est modifiée ; fenêtre jamais affichée.
 */
export async function runRealShots(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const log: string[] = []
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(1400)
  }
  const shot = async (name: string): Promise<void> => {
    await wait(500)
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
    log.push(`ok     ${name}`)
  }
  const key = async (keyCode: string): Promise<void> => {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'char', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await wait(300)
  }

  try {
    await wait(2000)
    const decks = await invoke<{ id: string; name: string; fullName: string; hasChildren: boolean; totalCards: number; dueCount: number; newCount: number; learnCount: number }[]>('deck.list')
    const settings = await invoke<{ userName: string; theme: string }>('settings.get')
    log.push(`info   nom=${settings.userName} thème=${settings.theme} decks=${decks.length}`)
    for (const d of decks.slice(0, 40)) log.push(`info   deck ${d.fullName} (${d.totalCards} cartes, ${d.dueCount + d.newCount + d.learnCount} à faire)`)
    const leaves = decks.filter((d) => !d.hasChildren && d.totalCards > 0)
    const todo = (d: (typeof decks)[number]): number => d.dueCount + d.newCount + d.learnCount
    const best = [...leaves].sort((a, b) => todo(b) - todo(a) || b.totalCards - a.totalCards)[0]
    log.push(`info   deck choisi : ${best ? best.fullName : 'aucun'}`)

    await js('location.reload()')
    await wait(2000)
    const setTheme = async (t: string): Promise<void> => {
      await invoke('settings.set', { theme: t, skin: '', accentColor: '' })
      await js('location.reload()')
      await wait(2200)
    }

    // Clair : les captures principales du README.
    await setTheme('light')
    await go({ name: 'home' })
    await shot('accueil')
    if (best) {
      await go({ name: 'deck', id: best.id })
      await shot('deck')
    }
    await go({ name: 'library' })
    await shot('bibliotheque')
    await go({ name: 'stats' })
    await shot('statistiques')
    await go({ name: 'notebook' })
    await shot('planning')
    await go({ name: 'sheets' })
    await shot('fiches')
    await go({ name: 'ai' })
    await wait(4000)
    await js(`document.querySelectorAll('.la-where code').forEach((e) => { e.textContent = String.fromCharCode(67, 58, 92) + 'Users' + String.fromCharCode(92) + 'Toi' + String.fromCharCode(92) + 'AppData' + String.fromCharCode(92) + 'Roaming' + String.fromCharCode(92) + 'Mnemo' + String.fromCharCode(92) + 'models' })`)
    await shot('ia')
    await go({ name: 'prepa' })
    await shot('cahier-de-prepa')
    await go({ name: 'home' })
    await js(`window.__mnemo.getState().openImport({})`)
    await wait(1800)
    await shot('import')
    await js(`window.__mnemo.getState().openImport(null)`)
    await wait(400)
    await go({ name: 'review', deckId: best ? best.id : null })
    await shot('revision-question')
    await key(' ')
    await shot('revision')

    // Sombre.
    await setTheme('dark')
    await shot('revision-sombre')
    await go({ name: 'home' })
    await shot('accueil-sombre')
    await go({ name: 'stats' })
    await shot('statistiques-sombre')
    await go({ name: 'library' })
    await shot('bibliotheque-sombre')
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'realshots.txt'), log.join(String.fromCharCode(10)))
  }
}
