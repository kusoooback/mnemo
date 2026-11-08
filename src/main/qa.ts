import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { zipSync } from 'fflate'
import { readDocument } from './ai'
import { join } from 'path'

/**
 * Parcours de contrôle visuel : lancé uniquement avec MNEMO_QA_DIR.
 * Navigue dans l'interface et enregistre une capture par écran.
 */
const TAB = String.fromCharCode(9)
const PASTE = [
  ['mitochondrie', 'Centrale énergétique de la cellule'],
  ['ribosome', 'Synthétise les protéines'],
  ['noyau', 'Contient l’ADN'],
  ['Golgi', 'Trie et emballe les protéines']
]
  .map((r) => r.join(TAB))
  .join(String.fromCharCode(10))

export async function runQa(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const shot = async (name: string): Promise<void> => {
    await wait(350)
    const img = await wc.capturePage()
    writeFileSync(join(outDir, `${name}.png`), img.toPNG())
  }
  const click = (text: string): Promise<boolean> =>
    js(`(() => {
      const els = [...document.querySelectorAll('button, .deck-row, .nav-item, .t-row')];
      const el = els.find(e => (e.textContent && e.textContent.trim().includes(${JSON.stringify(text)})) || e.getAttribute('aria-label') === ${JSON.stringify(text)});
      if (el) { el.click(); return true } return false })()`)
  const key = async (keyCode: string, modifiers: ('control' | 'shift')[] = []): Promise<void> => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    wc.sendInputEvent({ type: 'char', keyCode, modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await wait(200)
  }
  wc.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) writeFileSync(join(outDir, 'console.log'), `[${level}] ${message} (${source}:${line})
`, { flag: 'a' })
  })
  const tour = async (p: string, withData: boolean): Promise<void> => {
    await wait(1200)
    await shot(`${p}-01-home`)
    if (withData) {
      await click('Essayer avec un exemple')
      await wait(500)
    } else await click('Découverte')
    await wait(400)
    await shot(`${p}-02-deck`)
    await click('Étudier')
    await wait(500)
    await shot(`${p}-03-review-front`)
    await key(' ')
    await shot(`${p}-04-review-back`)
    await key('3')
    await key(' ')
    await shot(`${p}-05-review-cloze`)
    await key('3')
    await key(' ')
    await shot(`${p}-06-review-math`)
    await key('3')
    await key('3')
    await key(' ')
    await shot(`${p}-06b-review-code`)
    await key('Escape')
    await wait(400)
    await shot(`${p}-07-home`)
    await key('n', ['control'])
    await wait(500)
    await js(`(() => { const t = document.querySelector('textarea'); t.focus(); t.value=''; })()`)
    await shot(`${p}-08-editor`)
    await key('Escape')
    await click('Bibliothèque')
    await wait(700)
    await shot(`${p}-09-library`)
    await click('dérivée')
    await wait(500)
    await click('Verso')
    await shot(`${p}-09b-editor-math`)
    await key('Escape')
    await click('inverser une liste')
    await wait(500)
    await click('Verso')
    await shot(`${p}-09c-editor-code`)
    await key('Escape')
    await click('Statistiques')
    await wait(700)
    await shot(`${p}-10-stats`)
    await click('Réglages')
    await wait(700)
    await shot(`${p}-11-settings`)
    await key('k', ['control'])
    await wait(300)
    await shot(`${p}-12-palette`)
    await key('Escape')
  }
  const checks: string[] = []
  const check = (name: string, ok: boolean, extra = ''): void => void checks.push(`${ok ? 'OK  ' : 'FAIL'} ${name} ${extra}`)
  const counts = (): Promise<string> => js<string>(`document.querySelector('.rv-counts')?.textContent ?? ''`)
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> =>
    js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)

  // Faux Ollama local pour piloter la génération IA de bout en bout.
  const fake = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'llama3.1' }] }))
        return
      }
      const cards = [
        { type: 'basic', front: 'Quel organite produit l’ATP ?', back: 'La **mitochondrie**.' },
        { type: 'cloze', text: 'La {{c1::photosynthèse}} se déroule dans les {{c2::chloroplastes}}.', extra: '' },
        { type: 'basic', front: 'Capitale de l’Australie ?', back: 'Canberra' }
      ]
      void body
      res.end(JSON.stringify({ message: { content: JSON.stringify(cards) }, prompt_eval_count: 200, eval_count: 90 }))
    })
  })
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r))
  const fakePort = (fake.address() as { port: number }).port

  // Lecture de documents (PDF et Word) dans l'application empaquetée.
  try {
    const stream = 'BT /F1 18 Tf 20 100 Td (Bonjour Mnemo cours de biologie) Tj ET'
    const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`
    writeFileSync(join(outDir, 'test.pdf'), pdf)
    const docx = zipSync({ 'word/document.xml': new TextEncoder().encode('<w:document><w:body><w:p><w:r><w:t>Titre du cours</w:t></w:r></w:p><w:p><w:r><w:t>La cellule &amp; son noyau</w:t></w:r></w:p></w:body></w:document>') })
    writeFileSync(join(outDir, 'test.docx'), docx)
    const a = await readDocument(join(outDir, 'test.pdf'))
    const b = await readDocument(join(outDir, 'test.docx'))
    writeFileSync(join(outDir, 'docs.txt'), `PDF: ${a.trim()}
DOCX: ${b.trim()}`)
  } catch (e) {
    writeFileSync(join(outDir, 'docs.txt'), `ERREUR: ${(e as Error).message}`)
  }
  // Relecture de tous les documents d'une base copiée : combien de textes redeviennent lisibles ?
  if (process.env.MNEMO_QA_REREAD) {
    const { getDb } = await import('./db')
    const { readFileSync, existsSync } = await import('fs')
    const { readDocumentBuffer } = await import('./ai')
    const rows = getDb().prepare("SELECT title, ext, path FROM document WHERE deleted_at IS NULL").all() as { title: string; ext: string; path: string }[]
    const out: string[] = []
    let ok = 0
    let empty = 0
    let err = 0
    for (const r of rows) {
      try {
        if (!existsSync(r.path)) throw new Error('fichier absent')
        const t = await readDocumentBuffer(readFileSync(r.path), r.ext)
        if (t.trim().length > 250) ok++
        else {
          empty++
          out.push(`COURT ${t.trim().length} ${r.ext} ${r.title}`)
        }
      } catch (e) {
        err++
        out.push(`ERREUR ${r.ext} ${r.title}: ${(e as Error).message.slice(0, 80)}`)
      }
    }
    writeFileSync(join(outDir, 'reread.txt'), [`${rows.length} documents : ${ok} lisibles, ${empty} sans texte (scannés ?), ${err} erreurs`, ...out].join(String.fromCharCode(10)))
    return
  }
  // Un vrai PDF fourni par la ligne de commande : le message d'erreur exact s'il échoue.
  if (process.env.MNEMO_QA_PDF) {
    try {
      const t = await readDocument(process.env.MNEMO_QA_PDF)
      writeFileSync(join(outDir, 'pdf-real.txt'), `OK ${t.length} caractères\n${t.slice(0, 300)}`)
    } catch (e) {
      writeFileSync(join(outDir, 'pdf-real.txt'), `ERREUR: ${(e as Error).stack ?? (e as Error).message}`)
    }
    // Même PDF, mais par le circuit complet d'import du Cahier de Prépa (faux site local).
    try {
      const { readFileSync } = await import('fs')
      const pdfBytes = readFileSync(process.env.MNEMO_QA_PDF)
      const site = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://x')
        const path = url.pathname.replace('/cl', '')
        const send = (b: string | Buffer, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}): void => {
          res.writeHead(200, { 'Content-Type': type, ...extra })
          res.end(b)
        }
        if (path === '/' || path === '') return send('<html><head><title>Classe</title></head><body><h1>Classe</h1>Cahier de prépa</body></html>')
        if (path === '/recent')
          return send('<html><body><select id="matiere"><option value="tout">F</option><option value="all">Allemand</option></select><article class="recents"><h3><a href="download?id=7">Verbe wissen</a></h3><p class="publi">Publication le 09/10 à 18h50</p><div><p>Document de 12&nbsp;ko, dans <a href="docs?rep=1">Allemand/Verbes</a></p></div></article></body></html>')
        if (path === '/download') return send(pdfBytes, 'application/pdf', { 'Content-Disposition': 'inline; filename="Verbe%20wissen.pdf"' })
        return send('<html><body></body></html>')
      })
      await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
      const base = `http://127.0.0.1:${(site.address() as { port: number }).port}/cl/`
      await invoke('prepa.scan', base)
      const rr = await invoke<{ downloaded: number; warnings: string[] }>('prepa.import', { baseUrl: base, remoteIds: ['7'], deckRoot: 'QA', addToNotebook: false, generateCards: false, makeSummary: false, cardsPerDoc: 6 })
      const docs = await invoke<{ title: string; hasText: boolean }[]>('docs.list')
      writeFileSync(join(outDir, 'pdf-import.txt'), JSON.stringify({ result: rr, docs }, null, 1))
      site.close()
    } catch (e) {
      writeFileSync(join(outDir, 'pdf-import.txt'), `ERREUR: ${(e as Error).stack ?? (e as Error).message}`)
    }
    if (process.env.MNEMO_QA_ONLY_PDF) return
  }

  // IA intégrée : génération réelle avec le modèle local (si présent dans le dossier de données)
  if (process.env.MNEMO_QA_LOCALAI) {
    try {
      const ai = await import('./ai')
      ai.aiConfigure({ provider: 'builtin', model: 'balanced' })
      const ready = ai.aiStatus().ready
      const t0 = Date.now()
      const cards = ready ? await ai.aiGenerate('La mitochondrie produit l’ATP par phosphorylation oxydative. Le noyau contient l’ADN de la cellule. Le ribosome synthétise les protéines à partir de l’ARN messager.', 4, 'fr', '') : []
      writeFileSync(join(outDir, 'localai.txt'), JSON.stringify({ ready, seconds: (Date.now() - t0) / 1000, cards, raw: ai.lastRawReply }, null, 1))
      if (process.env.MNEMO_QA_ONLY_LOCALAI) return
    } catch (e) {
      writeFileSync(join(outDir, 'localai.txt'), `ERREUR: ${(e as Error).stack ?? (e as Error).message}`)
    }
  }

  await wait(1500)
  await shot('00-onboarding')
  await invoke('settings.set', { onboarded: true, theme: 'light' })
  await js('location.reload()')
  await wait(1300)

  await click('Essayer avec un exemple')
  await wait(500)
  await click('Étudier')
  await wait(500)
  const c0 = await counts()
  await key(' ')
  await key('3')
  await wait(300)
  const c1 = await counts()
  check('answer changes queue', c0 !== c1, `${c0} -> ${c1}`)
  await key('z')
  await wait(400)
  check('undo restores counts', c0 === (await counts()), await counts())
  const front0 = await js<string>(`document.querySelector('.rv-q')?.textContent ?? ''`)
  await key('s')
  await wait(400)
  const front1 = await js<string>(`document.querySelector('.rv-q')?.textContent ?? ''`)
  check('suspend moves on', front0 !== front1)
  await key('Escape')
  await wait(400)

  // Import universel : assistant, texte collé façon Quizlet, aperçu et résultat
  await click('Importer')
  await wait(700)
  await shot('18-import-source')
  await click('Coller du texte')
  await wait(300)
  await js(`(() => { const t = document.querySelector('.modal textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(PASTE)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await wait(200)
  await click('Continuer')
  await wait(500)
  await shot('19-import-text-preview')
  await click('Importer 4')
  await wait(900)
  await shot('20-import-done')
  const imported = await invoke<{ total: number }>('card.search', { text: 'ribosome', deckId: null, state: 'all', tag: null, sort: 'created', limit: 5, offset: 0 })
  check('pasted text imported', imported.total === 1, String(imported.total))
  await click('Terminer')
  await wait(400)

  // Cahier de texte : matière, examen lié au deck, tâche
  const decks = await invoke<{ id: string }[]>('deck.list')
  const sid = await invoke<string>('subject.save', { name: 'Biologie', color: '#6b8450', coefficient: 3 })
  await invoke('entry.save', { kind: 'examen', title: 'Partiel de biologie cellulaire', subjectId: sid, dueAt: Date.now() + 12 * 86400000, deckIds: [decks[0].id], notes: '' })
  await invoke('entry.save', { kind: 'devoir', title: 'Compte rendu de TP', subjectId: sid, dueAt: Date.now() + 4 * 86400000, deckIds: [] })
  await invoke('task.save', { title: 'Relire le chapitre 3', recurrence: 'weekly', dueAt: Date.now() + 86400000 })
  await invoke('task.save', { title: 'Imprimer les schémas' })
  await click('Cahier de texte')
  await wait(900)
  await shot('20-notebook-plan')
  await js(`document.querySelector('.main-scroll').scrollTop = 600`)
  await shot('21-notebook-calendar')
  await click('Entrées')
  await wait(400)
  await shot('22-notebook-entries')
  await click('Tâches')
  await wait(400)
  await shot('23-notebook-tasks')
  await click('Nouvelle entrée')
  await wait(500)
  await shot('24-notebook-entry-modal')
  await key('Escape')

  // IA : page non configurée, puis configurée avec le faux Ollama
  await click('Génération IA')
  await wait(600)
  await shot('25-ai-unconfigured')
  await invoke('ai.configure', { provider: 'ollama', baseUrl: `http://127.0.0.1:${fakePort}`, model: 'llama3.1' })
  await js('location.reload()')
  await wait(1300)
  await click('Génération IA')
  await wait(500)
  await js(`(() => { const t = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'La mitochondrie produit l ATP. La photosynthèse se déroule dans les chloroplastes. Canberra est la capitale de l Australie.'); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await wait(200)
  await click('Vérifier avant')
  await wait(500)
  await shot('26-ai-estimate')
  await click('Envoyer et générer')
  await wait(1200)
  await shot('27-ai-review')
  const proposals = await js<number>(`document.querySelectorAll('.t-row, .card textarea').length`)
  check('ai proposals rendered', proposals >= 3, String(proposals))
  await click('Ajouter')
  await wait(800)
  const total = await invoke<{ total: number }>('card.search', { text: '', deckId: null, state: 'all', tag: 'ia', sort: 'created', limit: 50, offset: 0 })
  check('ai cards added with tag', total.total >= 3, String(total.total))

  // Cahier de Prépa : analyse du vrai site public
  await click('Cahier de Prépa')
  await wait(600)
  await shot('26b-prepa-empty')
  await click('Analyser le site')
  await wait(9000)
  await shot('26c-prepa-scan')
  await js(`document.querySelector('.main-scroll').scrollTop = 700`)
  await shot('26d-prepa-options')
  const prepaDocs = await js<number>(`document.querySelectorAll('.t-row').length`)
  check('prepa scan lists documents', prepaDocs > 0, String(prepaDocs))

  // Synchronisation & intégrations
  await click('Synchronisation')
  await wait(500)
  await click('Local')
  await wait(600)
  await shot('28-sync-setup')
  await click('Réglages')
  await wait(500)
  await invoke('settings.set', {})
  await js(`document.querySelector('[aria-label="Réglages"]').click()`)
  await wait(400)
  await click('Intégrations')
  await wait(900)
  await shot('29-integrations-top')
  await js(`document.querySelector('.main-scroll').scrollTop = 900`)
  await shot('30-integrations-mid')
  await js(`document.querySelector('.main-scroll').scrollTop = 2400`)
  await shot('31-integrations-bottom')
  writeFileSync(join(outDir, 'checks.txt'), checks.join(String.fromCharCode(10)))

  await invoke('deck.list').then(async (d) => { for (const x of d as { id: string }[]) await invoke('deck.delete', x.id) })
  await js('location.reload()')
  await wait(1200)
  await tour('light', true)
  await invoke('settings.set', { theme: 'dark' })
  await js('location.reload()')
  await wait(1200)
  await tour('dark', false)
  await invoke('settings.set', { theme: 'system' })
  fake.close()
}
