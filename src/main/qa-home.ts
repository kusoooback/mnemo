import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { startJob } from './jobs'

/** Contrôle visuel de l'accueil avec des tâches de fond simulées : MNEMO_QA_HOME=1, MNEMO_QA_DIR=<sortie>. */
export async function runHome(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const click = (text: string): Promise<boolean> =>
    js(`(() => { const el = [...document.querySelectorAll('button')].find(e => e.textContent && e.textContent.trim().includes(${JSON.stringify(text)})); if (el) { el.click(); return true } return false })()`)
  const shot = async (name: string): Promise<void> => {
    await wait(700)
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  }

  await wait(1500)
  await invoke('settings.set', { onboarded: true, theme: 'light', prepaAuto: true, prepaLastSync: Date.now() - 25 * 60000 })
  await js('location.reload()')
  await wait(1300)
  await invoke('data.createSample')

  const files = [join(outDir, 'cours.tex'), join(outDir, 'enonce.txt'), join(outDir, 'copie.txt')]
  writeFileSync(files[0], '\\section{Probabilités}\n' + 'Soit $X$ une variable aléatoire discrète. '.repeat(30))
  writeFileSync(files[1], 'Exercice 1. Calculer ... '.repeat(30))
  writeFileSync(files[2], 'Exercice 1. Calculer ... '.repeat(30))
  await invoke('docs.addPaths', files)

  // Tâches simulées : import en cours, modèle sans pourcentage, deux terminées.
  const done = startJob('cards', 'Cartes : Ensembles et applications')
  done.finish('9 cartes créées.')
  const failed = startJob('prepa', 'Cahier de Prépa')
  failed.fail('Le site ne répond pas.')
  const imp = startJob('prepa', 'Import du Cahier de Prépa', { cancellable: true })
  imp.set(37, 119, 'Création des cartes · Fonctions de R dans R - continuité')
  const model = startJob('model', 'Téléchargement du modèle IA (balanced)', { cancellable: true })
  model.set(900, 2100, '900 / 2100 Mo')
  const scan = startJob('scan', 'Analyse du Cahier de Prépa', { detail: 'Lecture des matières…' })
  void scan
  await wait(800)
  await click('Accueil').catch(() => false)
  await shot('h1-home-light')
  await click('Activité')
  await shot('h2-activity-light')
  await invoke('settings.set', { theme: 'dark' })
  await wait(600)
  await shot('h3-activity-dark')
  await click('Activité')
  await shot('h4-home-dark')
}
