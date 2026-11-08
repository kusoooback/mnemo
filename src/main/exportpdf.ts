import { app, BrowserWindow, dialog, shell } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/*
 * Export d'une fiche en PDF : une vraie page A4 composée à part (polices, formules, encadrés en couleur, pied de page
 * numéroté, aucun élément de l'application), pas une impression de l'écran.
 */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const safeName = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Fiche'

/** Mise en page « papier » : couleurs explicites (pas de variables), encadrés qui ne se coupent pas entre deux pages. */
const PAPER_CSS = `
@page { size: A4; margin: 17mm 19mm 21mm 19mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1d1d1b; background: #fff; font-family: 'Inter Variable', Inter, 'Segoe UI', Arial, sans-serif; font-size: 10.2pt; line-height: 1.58; }
.paper { padding: 0; }
.brand { display: flex; align-items: center; justify-content: space-between; margin: 0 0 18px; padding-bottom: 10px; border-bottom: 2.5px solid #c6613f; font-size: 8pt; letter-spacing: .12em; text-transform: uppercase; color: #7b7974; }
.brand b { color: #c6613f; letter-spacing: .14em; }
.sheet h1 { font-family: 'Newsreader Variable', Newsreader, Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 25pt; line-height: 1.12; letter-spacing: -.01em; margin: 4px 0 6px; color: #151515; }
.sheet h1 + p { color: #6b6962; font-style: italic; font-size: 11pt; margin: 0 0 16px; }
.sheet h2 { font-family: 'Newsreader Variable', Newsreader, Georgia, serif; font-weight: 600; font-size: 15pt; margin: 22px 0 9px; padding-bottom: 5px; border-bottom: .6pt solid #d9d7ce; break-after: avoid; }
.sheet h3 { font-size: 11.5pt; margin: 16px 0 6px; break-after: avoid; }
.sheet p { margin: 5px 0; }
.sheet ul, .sheet ol { margin: 5px 0; padding-left: 1.25em; }
.sheet li { margin: 2px 0; }
.sheet strong { font-weight: 650; }
.sheet code { font-family: Consolas, 'Courier New', monospace; font-size: 9pt; background: #f1f0ea; padding: 0 3px; border-radius: 3px; }
.sheet pre { background: #f6f5f1; padding: 9px 12px; border-radius: 8px; overflow: hidden; break-inside: avoid; }
.sheet .katex { font-size: 1.04em; }
.sheet .katex-display { margin: 8px 0; padding: 7px 10px; background: #f6f5f1; border-radius: 8px; break-inside: avoid; overflow: hidden; }
.callout { --c: #c6613f; margin: 10px 0; padding: 8px 13px 9px; border-radius: 9px; border: .6pt solid color-mix(in srgb, var(--c) 34%, white); border-left: 3pt solid var(--c); background: color-mix(in srgb, var(--c) 8%, white); break-inside: avoid; }
.callout-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin-bottom: 3px; }
.callout-kind { font-size: 7.4pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--c); }
.callout-name { font-weight: 650; }
.callout-body > :first-child { margin-top: 0; }
.callout-body > :last-child { margin-bottom: 0; }
.callout-key { background: color-mix(in srgb, var(--c) 13%, white); border-left-width: 4pt; }
.callout-definition { --c: #c6613f; }
.callout-theorem { --c: #55534d; background: #f3f2ee; }
.callout-property { --c: #6b8450; }
.callout-method { --c: #b8873f; }
.callout-warning { --c: #b5503c; }
.callout-example { --c: #8a6f4e; }
.callout-note { --c: #7b7974; }
table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 10px 0; border: .6pt solid #d9d7ce; border-radius: 8px; overflow: hidden; font-size: 9.6pt; break-inside: avoid; }
th { background: #f1f0ea; text-align: left; font-weight: 650; padding: 6px 10px; }
td { padding: 6px 10px; border-top: .6pt solid #e4e2d9; vertical-align: top; }
thead th { border-top: 0; }
blockquote { margin: 8px 0; padding: 4px 12px; border-left: 2pt solid #d9d7ce; color: #55534d; }
`

export interface PdfInput {
  title: string
  subtitle: string
  /** HTML déjà nettoyé de la fiche (rendu Markdown : encadrés, formules KaTeX, tableaux). */
  html: string
  /** Feuille de style de l'application limitée aux polices et aux formules (chemins absolus). */
  css: string
}

export function paperHtml({ title, subtitle, html, css }: PdfInput): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}\n${PAPER_CSS}</style></head>
<body><div class="paper"><div class="brand"><b>Mnémo</b><span>${esc(subtitle || 'Fiche de révision')}</span></div><article class="sheet md">${html}</article></div></body></html>`
}

/** Compose la fiche dans une fenêtre invisible, l'imprime en PDF A4 et l'enregistre. Renvoie le chemin, ou null si annulé. */
export async function exportPdf(parent: BrowserWindow | null, input: PdfInput): Promise<string | null> {
  const qaDir = process.env.MNEMO_QA_DIR
  let target: string
  if (qaDir) {
    mkdirSync(qaDir, { recursive: true })
    target = join(qaDir, `${safeName(input.title)}.pdf`)
  } else {
    const opts = {
      title: 'Exporter la fiche en PDF',
      defaultPath: join(app.getPath('documents'), `${safeName(input.title)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    target = res.filePath
  }
  const dir = join(app.getPath('temp'), 'mnemo-pdf')
  mkdirSync(dir, { recursive: true })
  const page = join(dir, `fiche-${Date.now()}.html`)
  writeFileSync(page, paperHtml(input), 'utf8')
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    await win.loadFile(page)
    // Les polices (texte et formules) doivent être chargées avant l'impression.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250)))')
    const footer = `<div style="width:100%;padding:0 19mm;font-family:Arial,sans-serif;font-size:7.5px;color:#8a8880;display:flex;justify-content:space-between"><span>${esc(input.title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer,
      preferCSSPageSize: true
    })
    writeFileSync(target, pdf)
    return target
  } finally {
    win.destroy()
    try {
      rmSync(page, { force: true })
    } catch {
      /* fichier temporaire : sans importance */
    }
  }
}

export function revealFile(path: string): void {
  shell.showItemInFolder(path)
}
