import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Champ « Clé API » : visible, saisie, enregistrement, message d'erreur : MNEMO_QA_KEY=1, MNEMO_QA_DIR=<sortie>. */
export async function runKey(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const shot = async (name: string): Promise<void> => {
    await wait(700)
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  }
  const log: string[] = []
  await wait(1500)
  await invoke('settings.set', { onboarded: true })
  await js('location.reload()')
  await wait(1300)
  win.setContentSize(1280, 900)

  await js(`window.__mnemo.getState().go({ name: 'ai' })`)
  await wait(900)
  log.push('champ visible sur la page Génération IA : ' + (await js<boolean>(`!!document.querySelector('.apikey input[type=password]')`)))
  await shot('k1-ai-page')

  await js(`window.__mnemo.getState().go({ name: 'integrations' })`)
  await wait(900)
  log.push('champ visible dans Intégrations : ' + (await js<boolean>(`!!document.querySelector('.apikey input[type=password]')`)))
  await shot('k2-integrations')

  // Saisie d'une fausse clé dans le champ (valeur posée comme le ferait le clavier) puis clic sur « Enregistrer et tester ».
  await js(`(() => {
    const input = document.querySelector('.apikey input[type=password]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'sk-or-v1-fausse-cle-de-test')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await wait(300)
  await js(`[...document.querySelectorAll('.apikey button')].find(b => b.textContent.includes('Enregistrer et tester')).click()`)
  await wait(6000)
  const message = await js<string>(`(document.querySelector('.apikey .warn') || {}).textContent || '(aucun message)'`)
  log.push('résultat affiché après clic : ' + message)
  log.push('fournisseur enregistré : ' + JSON.stringify(await invoke('ai.status')))
  await shot('k3-after-save')
  writeFileSync(join(outDir, 'key.txt'), log.join(String.fromCharCode(10)))
}
