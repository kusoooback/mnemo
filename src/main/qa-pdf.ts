import type { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Export PDF d'une fiche puis conversion de chaque page en image : MNEMO_QA_PDFEXPORT=1, MNEMO_QA_DIR=<sortie>. */
export async function runPdfExport(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const log: string[] = []
  await wait(1500)
  await invoke('settings.set', { onboarded: true })
  await js('location.reload()')
  await wait(1300)

  const NL = String.fromCharCode(10)
  const part = (n: number): string[] => [
    `## ${n}. Définitions et propriétés`,
    '',
    '> [!DEFINITION] Application injective',
    '> $f$ est **injective** si deux éléments distincts de $E$ ont des images distinctes :',
    '> $$\\forall x, y \\in E, \\; f(x) = f(y) \\Rightarrow x = y$$',
    '',
    '> [!THEOREM] Caractérisation de la bijection',
    '> $f$ est bijective si et seulement s’il existe $g : F \\to E$ telle que $g \\circ f = \\mathrm{Id}_E$ et $f \\circ g = \\mathrm{Id}_F$.',
    '',
    '| Notion | Condition | Intuition |',
    '| --- | --- | --- |',
    '| Injective | $f(x) = f(y) \\Rightarrow x = y$ | pas de collision |',
    '| Surjective | $f(E) = F$ | rien n’est oublié |',
    '| Bijective | injective et surjective | correspondance parfaite |',
    '',
    '> [!METHOD] Montrer qu’une application est injective',
    '> 1. Prendre $x, y \\in E$ avec $f(x) = f(y)$.',
    '> 2. Déduire $x = y$ par le calcul.',
    '',
    '> [!WARNING] Confondre injective et surjective',
    '> Injective : au plus un antécédent. Surjective : tout $F$ est atteint.',
    '',
    '> [!EXAMPLE] $x \\mapsto e^x$ de $\\mathbb{R}$ dans $\\mathbb{R}_+^*$',
    '> Bijective, de réciproque $\\ln$ : $\\ln(e^x) = x$.',
    ''
  ]
  const md = [
    '# Applications : injection, surjection, bijection',
    '',
    '*Comment une fonction associe les éléments de deux ensembles, et pourquoi la bijection est la notion centrale.*',
    '',
    '> [!KEY] À retenir',
    '> - Une application $f : E \\to F$ associe à chaque élément de $E$ **un seul** élément de $F$.',
    '> - Elle est **bijective** si elle est à la fois injective et surjective.',
    '',
    ...part(1),
    ...part(2),
    ...part(3),
    '## Pour réviser',
    '- Donne la définition d’une application injective sans regarder.',
    '- Pourquoi $x \\mapsto x^2$ de $\\mathbb{R}$ dans $\\mathbb{R}$ n’est-elle ni injective ni surjective ?',
    ''
  ].join(NL)
  const file = join(outDir, 'fiche-pdf.md')
  writeFileSync(file, md)
  const added = await invoke<{ ids: string[] }>('docs.addPaths', [file])
  await js(`window.__mnemo.getState().go(${JSON.stringify({ name: 'doc', id: added.ids[0] })})`)
  await wait(1800)
  // Clic sur « Exporter en PDF » (le chemin de sortie est imposé par MNEMO_QA_DIR, pas de boîte de dialogue).
  const clicked = await js<boolean>(`(() => { const el = [...document.querySelectorAll('button')].find(e => e.textContent && e.textContent.includes('Exporter en PDF')); if (el) { el.click(); return true } return false })()`)
  log.push(`bouton Exporter en PDF cliqué : ${clicked}`)
  const pdf = join(outDir, 'fiche-pdf.pdf')
  for (let i = 0; i < 40 && !existsSync(pdf); i++) await wait(500)
  if (!existsSync(pdf)) {
    log.push('PDF non créé')
    writeFileSync(join(outDir, 'pdf.txt'), log.join(NL))
    return
  }
  await wait(500)
  const buf = readFileSync(pdf)
  log.push(`PDF créé : ${Math.round(buf.length / 1024)} Ko`)
  const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const pdfjs = await dynImport('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false }).promise
  log.push(`pages : ${doc.numPages}`)
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1.3 })
    const { canvas, context } = doc.canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height))
    await page.render({ canvasContext: context, canvas, viewport: vp }).promise
    writeFileSync(join(outDir, `page-${i}.png`), canvas.toBuffer('image/png'))
  }
  writeFileSync(join(outDir, 'pdf.txt'), log.join(NL))
}
