import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  shell: { openPath: async () => '' },
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const COURSE =
  'La mitochondrie est l’organite qui produit l’ATP par phosphorylation oxydative. '.repeat(6) +
  'Le noyau contient l’ADN et dirige la vie de la cellule. Le ribosome synthétise les protéines à partir de l’ARN messager.'

/** Un contenu différent pour chaque identifiant : sinon le tri y voit (à raison) des doublons. */
const uniqueCourse = (id: string): string => `${COURSE} ${Array.from({ length: 70 }, (_, k) => `terme${id}n${k}`).join(' ')}`

const RECENT = `<html><head><title>Nouveautés</title></head><body><h1>ECG1 de Test</h1>
<select id="matiere"><option value="tout">Filtrer par matière</option><option value="general">Pas de matière associée</option>
<option value="maths">Mathématiques</option><option value="angl">Anglais</option></select>
<article class="recents"><h3><span class="icon-doc-pdf"></span>&nbsp;<a href="download?id=11">Cours cellule</a></h3>
<p class="publi">Publication le 09/10 à 18h50</p><div><p>Document de 552&nbsp;ko, dans <a href="docs?rep=19">Anglais/SEQUENCE 1 - Brave New World</a></p></div></article>
<article class="recents"><h3><span class="icon-doc"></span>&nbsp;<a href="download?id=12">Colle semaine 3</a></h3>
<p class="publi">Publication le 02/10 à 16h05</p><div><p>Document de 12&nbsp;ko, dans <a href="docs?rep=20">Mathématiques/Colles</a></p></div></article>
</body></html>`

const AGENDA = (extra: string): string => `<html><body><section><div id="calendrier">
<table class="evenements"><thead><tr><th class="autremois">28</th><th class="autremois">29</th><th class="autremois">30</th><th>1</th><th>2</th><th>3</th><th>4</th></tr></thead><tbody></tbody></table>
<table class="evenements"><thead><tr><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th>10</th><th>11</th></tr></thead><tbody><tr>
<td></td><td></td><td data-id="5"><p class="evnmt evnmt1">DS de mathématiques</p></td><td></td><td data-id="6"><p class="evnmt evnmt2">Colle d'anglais</p></td><td data-id="13"><p class="evnmt evnmt3">Vacances</p></td><td></td></tr></tbody></table>
${extra}</div></section></body></html>`

let site: Server
let ollama: Server
let base = ''
let ollamaBase = ''

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mnemo-prepa-'))
  site = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname.replace('/ecg1', '')
    const send = (body: string | Buffer, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}): void => {
      res.writeHead(200, { 'Content-Type': type, ...extra })
      res.end(body)
    }
    if (path === '/' || path === '') return send('<html><head><title>ECG1 de Test</title></head><body><h1>ECG1 de Test</h1><footer>Ce site est réalisé par le logiciel Cahier de prépa</footer></body></html>')
    if (path === '/recent') return send(RECENT)
    if (path === '/docs') {
      if (url.search === '?maths') return send('<div class="warning">Ce contenu est protégé. Vous devez vous connecter pour l’afficher.</div>')
      return send('<a href="docs?rep=30">Chapitre 1</a> <a href="download?id=13">Fiche formules</a>')
    }
    if (path === '/agenda') return send(AGENDA(''))
    if (path === '/download') {
      const id = url.searchParams.get('id')
      if (id === '99') return send('<div class="warning">Ce contenu est protégé.</div>')
      return send(Buffer.from(uniqueCourse(id ?? '0'), 'utf8'), 'text/plain', { 'Content-Disposition': `attachment; filename="cours-${id}.txt"` })
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}/ecg1/`

  ollama = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'x' }] }))
      const content = JSON.stringify({
        cards: [
          { type: 'basic', front: 'Quel organite produit l’ATP ?', back: 'La mitochondrie.' },
          { type: 'cloze', text: 'Le {{c1::noyau}} contient l’ADN.', extra: '' }
        ]
      })
      res.end(JSON.stringify({ message: { content: body.includes('fiche') ? '# Fiche\n- point clé' : content }, prompt_eval_count: 10, eval_count: 10 }))
    })
  })
  await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r))
  ollamaBase = `http://127.0.0.1:${(ollama.address() as { port: number }).port}`
})
afterAll(() => {
  site.close()
  ollama.close()
})

describe('Cahier de Prépa : lecture des pages', () => {
  it('normalise les adresses', async () => {
    const { normalizeBase } = await import('../src/main/prepa')
    expect(normalizeBase('cahier-de-prepa.fr/ecg1-clemenceau')).toBe('https://cahier-de-prepa.fr/ecg1-clemenceau/')
    expect(normalizeBase('https://cahier-de-prepa.fr/ecg1-clemenceau/docs?hgg')).toBe('https://cahier-de-prepa.fr/ecg1-clemenceau/')
    expect(normalizeBase('https://x.fr/')).toBe('https://x.fr/')
  })

  it('extrait matières, documents et dossiers de la page des nouveautés', async () => {
    const { parseSubjects, parseRecent } = await import('../src/main/prepa')
    const subjects = parseSubjects(RECENT)
    expect(subjects).toEqual([{ slug: 'maths', name: 'Mathématiques' }, { slug: 'angl', name: 'Anglais' }])
    const docs = parseRecent(RECENT, subjects, new Date(2026, 9, 10))
    expect(docs).toHaveLength(2)
    expect(docs[0]).toMatchObject({ remoteId: '11', title: 'Cours cellule', subject: 'Anglais', folder: 'SEQUENCE 1 - Brave New World', kind: 'doc' })
    expect(docs[1].subject).toBe('Mathématiques')
    expect(docs[1].kind).toBe('colle')
    expect(new Date(docs[0].publishedAt as number).getMonth()).toBe(9)
  })

  it('lit l’agenda et reconnaît les évaluations', async () => {
    const { parseAgenda, eventKind } = await import('../src/main/prepa')
    const ev = parseAgenda(AGENDA(''), 2026, 10)
    const titles = ev.map((e) => e.title)
    expect(titles).toEqual(['DS de mathématiques', 'Colle d\'anglais', 'Vacances'])
    expect(new Date(ev[0].date).getDate()).toBe(7)
    expect(new Date(ev[1].date).getDate()).toBe(9)
    expect(eventKind('DS de mathématiques')).toBe('examen')
    expect(eventKind('Colle d\'anglais')).toBe('devoir')
    expect(eventKind('Vacances')).toBeNull()
  })

  it('lit les répertoires d’une page de documents', async () => {
    const { parseDocsPage, isProtected } = await import('../src/main/prepa')
    const p = parseDocsPage('<a href="docs?rep=30">Chapitre 1</a><a href="download?id=13">Fiche formules</a><a href="download?id=13">Fiche formules</a>')
    expect(p.folders).toEqual([{ rep: '30', label: 'Chapitre 1' }])
    expect(p.files).toMatchObject([{ id: '13', label: 'Fiche formules' }])
    expect(isProtected('<div class="warning">Ce contenu est protégé. Vous devez…</div>')).toBe(true)
  })

  it('lit la vraie mise en page des répertoires (relevée sur un Cahier de Prépa connecté)', async () => {
    const { parseDocsPage } = await import('../src/main/prepa')
    const root = `<p id="parentsdoc" class="topbarre"><span class="nom">Répertoire racine</span></p>
  <p class="rep"><span class="repcontenu">(1 répertoire)</span> <a href="?general"><span class="icon-rep"></span><span class="nom">Général</span></a></p>
  <p class="rep"><span class="repcontenu">(9 répertoires, 2 documents)</span> <a href="?maths"><span class="icon-rep"></span><span class="nom">Mathématiques</span></a></p>
  <h3>Documents récents</h3>
  <p class="doc"><span class="docdonnees">(pdf, 08/10/2026, 75&nbsp;ko)</span> <a href="download?id=3885&amp;v=93cfd"><span class="icon-doc-pdf"></span><span class="nom">Mathématiques/Distanciel/Système linéaire S1 exercice 6</span></a></p>`
    const r = parseDocsPage(root)
    expect(r.roots).toEqual([{ slug: 'general', label: 'Général' }, { slug: 'maths', label: 'Mathématiques' }])
    expect(r.files).toEqual([]) // la section « Documents récents » est ignorée

    const maths = `<p class="rep"><span class="repcontenu">(5 documents)</span> <a href="?rep=483"><span class="icon-rep"></span><span class="nom">Distanciel</span></a></p>
  <p class="rep" data-id="477"><span class="repcontenu">(4 documents)</span> <a href="?rep=477"><span class="icon-rep"></span><span class="nom">DM</span></a></p>
  <p class="doc" data-id="127"><span class="docdonnees">(pdf, 03/10/2020, 1&nbsp;Mo)</span> <a href="download?id=127&amp;v=e7b62"><span class="icon-doc-pdf"></span><span class="nom">Exercices de calcul</span></a></p>
  <h3>Documents récents</h3>
  <p class="doc"><span class="docdonnees">(pdf, 06/10/2026, 116&nbsp;ko)</span> <a href="download?id=3882&amp;v=0cc34"><span class="icon-doc-pdf"></span><span class="nom">Mathématiques/DM/DM3</span></a></p>`
    const m = parseDocsPage(maths)
    expect(m.roots).toEqual([])
    expect(m.folders).toEqual([{ rep: '483', label: 'Distanciel' }, { rep: '477', label: 'DM' }])
    expect(m.files).toHaveLength(1)
    expect(m.files[0]).toMatchObject({ id: '127', label: 'Exercices de calcul', ext: 'pdf', size: '1 Mo' })
    expect(new Date(m.files[0].publishedAt as number).getFullYear()).toBe(2020)
  })
})

describe('Cahier de Prépa : import complet', () => {
  it('analyse le site, télécharge, range par matière, crée cartes, fiches et échéances', async () => {
    const { openDb } = await import('../src/main/db')
    openDb()
    const ai = await import('../src/main/ai')
    ai.aiConfigure({ provider: 'ollama', baseUrl: ollamaBase, model: 'x' })
    const { fetchHttp, scanSite, importPrepa, documentsDir } = await import('../src/main/prepa')
    const { listDocuments } = await import('../src/main/documents')
    const nb = await import('../src/main/notebook')
    const http = fetchHttp(fetch)

    const scan = await scanSite(http, base, new Date(2026, 9, 10))
    expect(scan.subjects).toHaveLength(2)
    expect(scan.docs.map((d) => d.remoteId).sort()).toEqual(['11', '12', '13'])
    expect(scan.protectedPages).toBeGreaterThanOrEqual(1)
    expect(scan.events.length).toBeGreaterThan(0)

    const progress: string[] = []
    const r = await importPrepa(
      http,
      { baseUrl: base, remoteIds: ['11', '12', '13'], deckRoot: 'Prépa', addToNotebook: true, generateCards: true, makeSummary: true, cardsPerDoc: 6 },
      (p) => progress.push(p.phase)
    )
    expect(r.downloaded).toBe(3)
    expect(r.failed).toBe(0)
    expect(r.cards).toBeGreaterThanOrEqual(2)
    expect(r.summaries).toBe(2) // la « colle » est un énoncé : ni cartes ni fiche
    expect(r.ignored).toBe(1)
    expect(progress).toContain('download')
    expect(progress).toContain('cards')
    expect(progress.at(-1)).toBe('done')

    const docs = listDocuments()
    expect(docs).toHaveLength(3)
    expect(docs.map((d) => d.subject).sort()).toEqual(['Anglais', 'Général', 'Mathématiques'])
    expect(existsSync(documentsDir())).toBe(true)
    expect(docs.every((d) => d.hasText)).toBe(true)
    expect(docs.find((d) => d.title === 'Colle semaine 3')?.category).toBe('admin')
    expect(docs.find((d) => d.title === 'Cours cellule')?.category).toBe('cours')

    // Les decks suivent la structure du site, les échéances arrivent dans le cahier de texte.
    const { listDecks } = await import('../src/main/repo')
    const names = listDecks().map((d) => d.fullName)
    expect(names).toContain('Prépa::Anglais::Cellule') // matière puis chapitre, pas le dossier du site
    expect(names).toContain('Prépa::Mathématiques')

    // Réimport : rien n'est retéléchargé ni dupliqué.
    const again = await importPrepa(http, { baseUrl: base, remoteIds: ['11'], deckRoot: 'Prépa', addToNotebook: true, generateCards: true, makeSummary: true, cardsPerDoc: 6 }, () => undefined)
    expect(again.downloaded).toBe(0)
    expect(again.skipped).toBe(1)
    expect(again.cards).toBe(0)

    const entries = nb.listEntries()
    expect(entries.some((e) => e.kind === 'examen' && /DS de math/i.test(e.title))).toBe(true)
    expect(entries.some((e) => /vacances/i.test(e.title))).toBe(false)
  })
})

describe('Cahier de Prépa : rangement et relecture', () => {
  it('ignore le menu de gauche et lit matière et chemin dans le fil d’Ariane', async () => {
    const { parseDocsPage } = await import('../src/main/prepa')
    const page = `<nav><a href="docs?rep=19">Chap 1</a><a href="docs?rep=20">SEQUENCE 1</a></nav>
<section>
  <p id="parentsdoc" class="topbarre"><a href="docs" title="Revenir"><span class="icon-rep-open"></span></a><span class="nom"><a href="docs?hgg">Histoire Géopolitique</a>&nbsp;/&nbsp;<a href="docs?rep=19">Chap 1</a></span></p>
  <p class="doc" data-id="5"><span class="docdonnees">(pdf, 03/10/2026, 12&nbsp;ko)</span> <a href="download?id=5&amp;v=a"><span class="icon-doc-pdf"></span><span class="nom">Cours 1</span></a></p>
</section>`
    const r = parseDocsPage(page)
    expect(r.folders).toEqual([]) // le menu n'est pas lu
    expect(r.crumbs).toEqual({ subject: 'Histoire Géopolitique', path: ['Chap 1'] })
    expect(r.files).toHaveLength(1)
  })

  it('remet un document mal rangé dans la bonne matière, relit son texte et supprime les decks vides', async () => {
    const { getDb } = await import('../src/main/db')
    const { fetchHttp, scanSite, importPrepa } = await import('../src/main/prepa')
    const { createDeck, listDecks } = await import('../src/main/repo')
    const http = fetchHttp(fetch)
    await scanSite(http, base, new Date(2026, 9, 10))
    const db = getDb()
    // État laissé par l'ancienne version : mauvaise matière, aucun texte, deck vide au mauvais endroit.
    const wrong = createDeck('Prépa::Général::Chap 1', null)
    db.prepare("UPDATE document SET subject = 'Général', folder = 'Chap 1', deck_id = ?, text = '', category = '' WHERE remote_id = '11'").run(wrong)
    const r = await importPrepa(http, { baseUrl: base, remoteIds: ['11'], deckRoot: 'Prépa', addToNotebook: false, generateCards: false, makeSummary: false, cardsPerDoc: 6 }, () => undefined)
    expect(r.downloaded).toBe(0)
    expect(r.moved).toBe(1)
    expect(r.reread).toBe(1)
    const row = db.prepare("SELECT subject, folder, length(text) AS n FROM document WHERE remote_id = '11'").get() as { subject: string; folder: string; n: number }
    expect(row.subject).toBe('Anglais')
    expect(row.folder).toBe('SEQUENCE 1 - Brave New World')
    expect(row.n).toBeGreaterThan(250)
    const names = listDecks().map((d) => d.fullName)
    expect(names).not.toContain('Prépa::Général::Chap 1')
    expect(names).toContain('Prépa::Anglais::Cellule')
  })

  it('garde un deck pour chaque matière du site, même sans cours sélectionné ni carte (ex. Allemand)', async () => {
    const { getDb } = await import('../src/main/db')
    const { fetchHttp, scanSite, importPrepa, pruneEmptyDecks } = await import('../src/main/prepa')
    const { listDecks, createDeck, deleteDeck } = await import('../src/main/repo')
    const http = fetchHttp(fetch)
    const scan = await scanSite(http, base, new Date(2026, 9, 10))
    // On repart d'un état où le deck de la matière « Mathématiques » n'existe pas.
    for (const d of listDecks().filter((x) => x.fullName === 'Prépa::Mathématiques')) deleteDeck(d.id)
    expect(listDecks().map((d) => d.fullName)).not.toContain('Prépa::Mathématiques')
    // On n'importe QUE le document d'anglais : la matière sans cours doit quand même apparaître.
    await importPrepa(http, { baseUrl: base, remoteIds: ['11'], deckRoot: 'Prépa', addToNotebook: false, generateCards: false, makeSummary: false, cardsPerDoc: 6 }, () => undefined)
    expect(scan.subjects.map((s) => s.name)).toContain('Mathématiques')
    expect(listDecks().map((d) => d.fullName)).toContain('Prépa::Mathématiques')
    // Le nettoyage supprime toujours un chapitre vide qui n'est pas une matière du site.
    createDeck('Prépa::Mathématiques::Chapitre fantôme', null)
    createDeck('Prépa::Divers inutile', null)
    pruneEmptyDecks('Prépa', new Set(scan.subjects.map((s) => s.name.toLowerCase())))
    const names = listDecks().map((d) => d.fullName)
    expect(names).toContain('Prépa::Mathématiques')
    expect(names).not.toContain('Prépa::Mathématiques::Chapitre fantôme')
    expect(names).not.toContain('Prépa::Divers inutile')
    expect(getDb()).toBeTruthy()
  })
})

describe('Garantie avant l’échéance', () => {
  it('rapproche une carte qui reviendrait après l’examen, et estime la préparation', async () => {
    const { getDb } = await import('../src/main/db')
    const { createDeck, addNote } = await import('../src/main/repo')
    const study = await import('../src/main/study')
    const nb = await import('../src/main/notebook')
    const deck = createDeck('Examen test', null)
    addNote({ kind: 'basic', deckId: deck, fields: { front: 'Q garantie', back: 'R' }, tags: [] })
    const dayMs = 86400000
    nb.saveEntry({ kind: 'examen', title: 'DS garanti', dueAt: Date.now() + 6 * dayMs, deckIds: [deck] })

    const card = study.next(deck)!
    for (let i = 0; i < 4; i++) {
      const c = study.next(deck)
      if (!c) break
      study.answer(c.cardId, 4, 500) // « Facile » : FSRS voudrait revenir bien après l'examen
      getDb().prepare('UPDATE card SET due = ? WHERE id = ?').run(Date.now() - 1000, c.cardId) // on la remet due pour continuer
    }
    const row = getDb().prepare('SELECT due FROM card WHERE id = ?').get(card.cardId) as { due: number }
    void row
    const c2 = study.next(deck)!
    study.answer(c2.cardId, 4, 500)
    const due = (getDb().prepare('SELECT due FROM card WHERE id = ?').get(c2.cardId) as { due: number }).due
    expect(due).toBeLessThan(Date.now() + 6 * dayMs) // avant l'examen
    expect(due).toBeGreaterThan(Date.now() + 4 * dayMs) // mais pas tout de suite

    const item = nb.planningItems().find((p) => p.title === 'DS garanti')!
    expect(item.readiness).toBeGreaterThan(0)
    expect(item.readiness).toBeLessThanOrEqual(1)
    expect(item.revisitBefore).toBeGreaterThanOrEqual(1)
  })
})
