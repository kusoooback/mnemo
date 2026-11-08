import { createRequire } from 'module'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import type { Worker } from 'tesseract.js'

/*
 * Reconnaissance de texte (OCR) 100 % locale : PDF scannés et images.
 * Les modèles français et anglais sont fournis avec l'application, rien n'est téléchargé.
 */

const req = createRequire(__filename)
const unpacked = (p: string): string => {
  const u = p.replace(/app\.asar(?![.\w])/, 'app.asar.unpacked')
  return existsSync(u) ? u : p
}

let worker: Promise<Worker> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let chain: Promise<unknown> = Promise.resolve()

/** Copie les modèles dans un dossier unique (tesseract.js attend un seul dossier de langues). */
function languageDir(): string {
  const dir = join(app.getPath('userData'), 'ocr')
  mkdirSync(dir, { recursive: true })
  for (const lang of ['fra', 'eng']) {
    const target = join(dir, `${lang}.traineddata.gz`)
    if (existsSync(target)) continue
    const packaged = join(process.resourcesPath ?? '', 'tessdata', `${lang}.traineddata.gz`)
    let from = existsSync(packaged) ? packaged : ''
    if (!from) {
      try {
        from = join(dirname(req.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0', `${lang}.traineddata.gz`)
      } catch {
        from = ''
      }
    }
    if (!from || !existsSync(from)) throw new Error(`Modèle OCR « ${lang} » introuvable.`)
    copyFileSync(from, target)
  }
  return dir
}

async function getWorker(): Promise<Worker> {
  if (idleTimer) clearTimeout(idleTimer)
  if (!worker) {
    worker = (async () => {
      const { createWorker } = await import('tesseract.js')
      return createWorker(['fra', 'eng'], 1, {
        langPath: languageDir(),
        gzip: true,
        errorHandler: (e: unknown) => console.error('OCR', e),
        cachePath: join(app.getPath('userData'), 'ocr'),
        corePath: unpacked(dirname(req.resolve('tesseract.js-core/package.json'))),
        workerPath: unpacked(req.resolve('tesseract.js/src/worker-script/node/index.js'))
      })
    })().catch((e) => {
      worker = null
      throw e
    })
  }
  return worker
}

/** Libère la mémoire quand l'OCR ne sert plus. */
function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void shutdownOcr(), 60_000)
}

export async function shutdownOcr(): Promise<void> {
  const w = worker
  worker = null
  if (w) await (await w).terminate().catch(() => undefined)
}

const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

export function ocrImage(png: Buffer): Promise<string> {
  return serial(async () => {
    try {
      const w = await getWorker()
      const { data } = await w.recognize(png)
      return data.text.trim()
    } finally {
      scheduleIdle()
    }
  })
}

/** Rend les pages d'un PDF en images puis les lit (30 pages au plus). */
export async function ocrPdf(buf: Buffer, onPage?: (page: number, total: number) => void, maxPages = 30): Promise<string> {
  const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>
  const pdfjs = await dynImport('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false }).promise
  const total = Math.min(doc.numPages, maxPages)
  const out: string[] = []
  for (let i = 1; i <= total; i++) {
    onPage?.(i, total)
    const page = await doc.getPage(i)
    // ~2000 px de large : assez net pour lire le texte, sans exploser la mémoire.
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(3, Math.max(1.2, 2000 / base.width)) })
    const { canvas, context } = doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await page.render({ canvasContext: context, canvas, viewport }).promise
    const text = await ocrImage(canvas.toBuffer('image/png'))
    if (text) out.push(text)
    page.cleanup()
  }
  return out.join('\n\n')
}
