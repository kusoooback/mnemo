import type { BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startJob } from './jobs'

/** Retours de testeurs (bouton haut-gauche, activités cliquables, dossier de l'assistant) : MNEMO_QA_HUGO=1, MNEMO_QA_DIR=<sortie>. Fenêtre jamais affichée. */
export async function runHugo(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  try {
    await inner(win, log)
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'hugo.txt'), log.join(String.fromCharCode(10)))
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
    await wait(700)
  }

  await wait(1500)
  await invoke('settings.set', { onboarded: true, tourDone: true, userName: 'Malo' })
  await js('location.reload()')
  await wait(1300)

  // 1. Bouton « barre latérale » : c'est bien lui qui reçoit le clic (et non la bande de déplacement de la fenêtre).
  const hit = (sel: string): Promise<string> =>
    js<string>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return 'absent'; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(e) ? 'ok' : 'recouvert par ' + (e && e.className) })()`)
  check((await hit('.sidebar-top .icon-btn')) === 'ok', 'bouton barre latérale : au-dessus de la bande de déplacement')
  const z = await js<string>(`getComputedStyle(document.querySelector('.sidebar-top')).zIndex + '>' + getComputedStyle(document.querySelector('.titlebar')).zIndex`)
  const [zs, zt] = z.split('>').map(Number)
  check(zs > zt, `en-tête de la barre latérale (${zs}) au-dessus de la bande de déplacement (${zt})`)
  await js(`document.querySelector('.sidebar-top .icon-btn').click()`)
  await wait(500)
  check(await js<boolean>(`document.querySelector('.app').classList.contains('sidebar-closed')`), 'bouton barre latérale : replie la barre')
  check((await hit('.floating-toggle')) === 'ok', 'bouton de réouverture : cliquable')
  await js(`document.querySelector('.floating-toggle').click()`)
  await wait(500)
  check(!(await js<boolean>(`document.querySelector('.app').classList.contains('sidebar-closed')`)), 'bouton de réouverture : rouvre la barre')

  // 2. Activité : une tâche terminée est cliquable et ouvre le bon écran.
  const deckId = await invoke<string>('deck.create', 'QA Activité', null)
  const a = startJob('cards', 'Cartes générées')
  a.link({ name: 'deck', id: deckId })
  a.finish('12 cartes créées')
  const m = startJob('model', 'Téléchargement du modèle')
  m.set(5_000_000, 100_000_000)
  const b = startJob('summary', 'Fiche de synthèse')
  b.finish('Fiche prête')
  await wait(600)
  await js(`document.querySelector('.activity-btn').click()`)
  await wait(600)
  const rows = await js<number>(`document.querySelectorAll('.job.link[role="button"]').length`)
  check(rows >= 2, `tâches terminées cliquables (${rows})`)
  const modelText = await js<string>(`[...document.querySelectorAll('.job')].map((e) => e.textContent).join(' | ')`)
  check(!/5000000|5 000 000|100000000/.test(modelText), 'téléchargement de modèle : pas d’octets bruts')
  await js(`[...document.querySelectorAll('.job.link')].find((e) => e.textContent.includes('Cartes générées')).click()`)
  await wait(900)
  const route = await js<{ name: string; id?: string }>(`window.__mnemo.getState().route`)
  check(route.name === 'deck' && route.id === deckId, `clic sur une activité : ouvre le deck créé (${route.name})`)
  await js(`document.querySelector('.activity-btn').click()`).catch(() => undefined)
  await wait(400)
  const open2 = await js<boolean>(`!!document.querySelector('.activity-panel')`)
  if (!open2) await js(`document.querySelector('.activity-btn').click()`)
  await wait(500)
  await js(`[...document.querySelectorAll('.job.link')].find((e) => e.textContent.includes('Fiche de synthèse')).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await wait(900)
  const route2 = await js<{ name: string }>(`window.__mnemo.getState().route`)
  check(route2.name === 'sheets', `Entrée sur une activité : ouvre les fiches (${route2.name})`)

  // 3. Assistant : bouton « Dossier », note du dossier connecté, retrait.
  await go({ name: 'assistant' })
  check(await js<boolean>(`[...document.querySelectorAll('.main-scroll button')].some((b) => b.textContent.trim() === 'Dossier')`), 'assistant : bouton Dossier présent')
  const folder = mkdtempSync(join(tmpdir(), 'mnemo-qa-dossier-'))
  writeFileSync(join(folder, 'cours.md'), '# Cours\n\nLe blocus de Berlin commence en 1948.')
  await invoke('settings.set', { assistantFolder: folder })
  await js(`window.__mnemo.getState().patchSettings({ assistantFolder: ${JSON.stringify(folder)} })`)
  await wait(700)
  check(await js<boolean>(`!!document.querySelector('.main-scroll .as-folder')`), 'assistant : le dossier connecté est affiché')
  await js(`document.querySelector('.main-scroll .as-folder .link-btn').click()`)
  await wait(700)
  check(!(await js<boolean>(`!!document.querySelector('.main-scroll .as-folder')`)), 'assistant : retirer le dossier le déconnecte')
  const saved = await invoke<{ assistantFolder: string }>('settings.get')
  check(saved.assistantFolder === '', 'assistant : réglage vidé')
}
