import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Captures des boutons dans plusieurs thèmes : MNEMO_QA_BUTTONS=1, MNEMO_QA_DIR=<sortie>. */
export async function runButtons(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const patch = (p: object): Promise<void> => js(`window.__mnemo.getState().patchSettings(${JSON.stringify(p)})`)
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(900)
  }
  const shot = async (name: string): Promise<void> => writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  const log: string[] = []
  try {
    await wait(1500)
    await js(`window.mnemo.invoke('settings.set', { onboarded: true, tourDone: true, userName: 'Malo' })`)
    await js('location.reload()')
    await wait(1300)
    await js(`window.mnemo.invoke('data.createSample')`)
    await js(`window.__mnemo.getState().refreshDecks()`)
    win.setContentSize(1280, 800)
    const themes: [string, object][] = [
      ['clair', { theme: 'light', skin: '', accentColor: '' }],
      ['sombre', { theme: 'dark', skin: '', accentColor: '' }],
      ['sauge', { skin: 'sauge', accentColor: '' }],
      ['bleu', { theme: 'light', skin: '', accentColor: '#2f6fe4' }]
    ]
    for (const [name, p] of themes) {
      await patch(p)
      await wait(500)
      await go({ name: 'settings' })
      await shot(`reglages-${name}`)
      await js(`document.getElementById('set-connect')?.scrollIntoView()`)
      await wait(700)
      await shot(`reglages-bas-${name}`)
      await js(`(() => { const d = window.__mnemo.getState().decks[0]; window.__mnemo.getState().go({ name: 'review', deckId: d.id }) })()`)
      await wait(900)
      await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /afficher|montrer|show/i.test(x.textContent || '')); if (b) b.click() })()`)
      await wait(500)
      await shot(`revision-${name}`)
      await go({ name: 'home' })
      await shot(`accueil-${name}`)
      await js(`window.__mnemo.getState().toast('12 cartes ajoutées à « Histoire »', { action: { label: 'Annuler', run: () => undefined } })`)
      await wait(700)
      await shot(`notification-${name}`)
      await js(`window.__mnemo.getState().toast('Impossible de lire ce fichier', { kind: 'error' })`)
      await wait(700)
      await shot(`notification-erreur-${name}`)
      log.push(`${(await js<boolean>(`[...document.querySelectorAll('.toast')].length === 2 && [...document.querySelectorAll('.toast')].every(t => +getComputedStyle(t).opacity > 0.95)`)) ? 'ok    ' : 'ECHEC '} deux notifications visibles (${name})`)
      await wait(5600)
      log.push(`ok     notifications retirées (${name}) : ${await js<number>(`document.querySelectorAll('.toast').length`)} restantes`)
    }
    await go({ name: 'integrations' })
    await js(`document.querySelector('.la-where')?.scrollIntoView({ block: 'center' })`)
    await wait(600)
    await shot('ia-locale')
    log.push(`${(await js<boolean>(`!!document.querySelector('.la-where code')`)) ? 'ok    ' : 'ECHEC '} chemin du dossier des modèles affiché : ${await js<string>(`(document.querySelector('.la-where code') || {}).textContent || ''`)}`)
    log.push('ok     captures faites')
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'buttons.txt'), log.join(String.fromCharCode(10)))
  }
}
