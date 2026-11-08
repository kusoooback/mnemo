import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ocrImage } from './ocr'

/** OCR dans l'application empaquetée (MNEMO_QA_OCR=1) : vérifie que les fichiers retirés du paquet ne manquent pas. */
export async function runOcr(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  try {
    const url = await win.webContents.executeJavaScript(
      `(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 160; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 160); x.fillStyle = '#000'; x.font = '56px sans-serif'; x.fillText('Bonjour le monde 2026', 30, 100); return c.toDataURL('image/png') })()`
    )
    const png = Buffer.from(String(url).split(',')[1], 'base64')
    const t = Date.now()
    const text = await ocrImage(png)
    log.push(`texte lu : « ${text} » (${Date.now() - t} ms)`)
    log.push(/Bonjour/i.test(text) && /2026/.test(text) ? 'ok     OCR fonctionne (PNG)' : 'ECHEC  OCR illisible (PNG)')
    const jpg = await win.webContents.executeJavaScript(
      `(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 160; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 160); x.fillStyle = '#000'; x.font = '56px sans-serif'; x.fillText('Photo du cahier 1989', 30, 100); return c.toDataURL('image/jpeg', 0.8) })()`
    )
    const jtext = await ocrImage(Buffer.from(String(jpg).split(',')[1], 'base64'))
    log.push(`texte lu (JPEG) : « ${jtext} »`)
    log.push(/cahier/i.test(jtext) && /1989/.test(jtext) ? 'ok     OCR fonctionne (JPEG)' : 'ECHEC  OCR illisible (JPEG)')
    const dyn = new Function('s', 'return import(s)') as (s: string) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const { getLlama } = await dyn('node-llama-cpp')
    const llama = await getLlama({ gpu: false, build: 'never' })
    log.push(`ok     moteur d’IA locale chargé (gpu=${String(llama.gpu)})`)
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'ocr.txt'), log.join(String.fromCharCode(10)))
  }
}
