import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { deflateSync } from 'fflate'

/** Contrôle visuel du lecteur de documents : MNEMO_QA_VIEWER=1, MNEMO_QA_PDF=<un PDF>, MNEMO_QA_DIR=<sortie>. */
export async function runViewer(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const click = (text: string): Promise<boolean> =>
    js(`(() => {
      const els = [...document.querySelectorAll('button, .deck-row, .nav-item, .t-row, .a')];
      const el = els.find(e => e.textContent && e.textContent.trim().includes(${JSON.stringify(text)}));
      if (el) { el.click(); return true } return false })()`)
  const shot = async (name: string): Promise<void> => {
    await wait(900)
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  }
  const log: string[] = []
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2) log.push(`[${level}] ${message}`)
  })

  await wait(1500)
  await invoke('settings.set', { onboarded: true, theme: 'light' })
  await js('location.reload()')
  await wait(1300)

  // Fichiers de test : un .tex, une image PNG 1x1 agrandie (rouge), un texte.
  const tex = join(outDir, 'cours.tex')
  writeFileSync(
    tex,
    '\\documentclass{article}\n\\begin{document}\n\\section{Probabilités}\nSoit $X$ une variable aléatoire. On a\n\\[ E(X)=\\sum_{k} k\\,P(X=k) \\]\n\\begin{itemize}\\item \\textbf{Linéarité} de l\'espérance\\item Formule de Bayes\\end{itemize}\n\\end{document}\n'
  )
  const crc = (buf: Uint8Array): number => {
    let c = ~0
    for (const b of buf) {
      c ^= b
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const W = 160
  const raw = new Uint8Array((W * 3 + 1) * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) raw.set([198, 97 + (x % 60), 63 + (y % 80)], y * (W * 3 + 1) + 1 + x * 3)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, W)
  dv.setUint32(4, W)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))].map((c) => Buffer.from(c)))
  const img = join(outDir, 'schema.png')
  writeFileSync(img, png)

  const files = [process.env.MNEMO_QA_PDF as string, tex, img].filter(Boolean)
  const added = await invoke<{ added: number; ids: string[]; failed: string[] }>('docs.addPaths', files)
  log.push(`ajoutés: ${added.added} ${JSON.stringify(added.failed)}`)

  await click('Cahier de Prépa')
  await wait(500)
  await click('Mes documents')
  await shot('v1-documents')
  const titles = ['cours', 'schema']
  const pdfTitle = process.env.MNEMO_QA_PDF ? (process.env.MNEMO_QA_PDF.split(/[\\/]/).pop() as string).replace(/\.pdf$/i, '') : ''
  for (const [i, t] of [pdfTitle, ...titles].entries()) {
    if (!t) continue
    await click('Cahier de Prépa')
    await wait(300)
    await click('Mes documents')
    await wait(400)
    const ok = await js<boolean>(`(() => { const el = [...document.querySelectorAll('.t-row .a')].find(e => e.textContent.trim() === ${JSON.stringify(t)}); if (el) { el.click(); return true } return false })()`)
    log.push(`${t}: ${ok}`)
    await wait(i === 0 ? 4000 : 0)
    await shot(`v2-${i}-${t.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`)
    if (t === 'cours') {
      await click('Aperçu')
      await shot('v3-tex-preview')
    }
  }
  writeFileSync(join(outDir, 'viewer.txt'), log.join('\n'))
}
