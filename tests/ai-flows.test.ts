import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  shell: { openPath: async () => '' },
  BrowserWindow: class {},
  Notification: class {
    static isSupported = (): boolean => false
  },
  safeStorage: { isEncryptionAvailable: () => false }
}))

/*
 * Flux IA de bout en bout avec un faux modèle (Ollama) qui répond selon la consigne reçue :
 * tri de document, création de cartes, relecture, fiche de révision.
 */

type Reply = { content: string }
const state = {
  cards: '' as string,
  review: '' as string,
  summaries: [] as string[],
  triage: '{"category":"cours","chapter":"Ensembles et applications"}',
  calls: { cards: 0, review: 0, summary: 0, triage: 0 },
  prompts: [] as { kind: string; system: string; user: string }[]
}

let server: Server
let base = ''

const card = (front: string, back: string): Record<string, string> => ({ type: 'basic', front, back, text: '', extra: '' })
const cloze = (text: string): Record<string, string> => ({ type: 'cloze', front: '', back: '', text, extra: '' })
const json = (cards: unknown[]): string => JSON.stringify({ cards })

const COURSE =
  'Une application f de E dans F est injective si deux éléments distincts de E ont des images distinctes. ' +
  'Elle est surjective si tout élément de F possède au moins un antécédent. Elle est bijective si elle est à la fois injective et surjective. ' +
  'La composée de deux applications bijectives est bijective et sa réciproque est la composée des réciproques dans l’ordre inverse. '.repeat(1) +
  'Le théorème de Bayes relie les probabilités conditionnelles : la probabilité de A sachant B vaut la probabilité de B sachant A fois la probabilité de A, divisée par la probabilité de B. '

const LONG_COURSE = COURSE.repeat(3)

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mnemo-flows-'))
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'x' }] }))
      const msgs = (JSON.parse(body) as { messages: { content: string }[] }).messages
      const system = msgs[0]?.content ?? ''
      const user = msgs[1]?.content ?? ''
      let kind = 'cards'
      let reply: Reply = { content: state.cards }
      if (system.includes('Tu tries les documents')) {
        kind = 'triage'
        reply = { content: state.triage }
      } else if (system.includes('relecteur exigeant')) {
        kind = 'review'
        reply = { content: state.review }
      } else if (/fiches? de r[ée]vision/i.test(system)) {
        kind = 'summary'
        reply = { content: state.summaries.shift() ?? '# Fiche\n\n## À retenir\n- Une idée utile pour réviser.\n' }
      }
      state.calls[kind as keyof typeof state.calls]++
      state.prompts.push({ kind, system, user })
      res.end(JSON.stringify({ message: reply, prompt_eval_count: 10, eval_count: 10 }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const { openDb } = await import('../src/main/db')
  openDb()
  const ai = await import('../src/main/ai')
  ai.aiConfigure({ provider: 'ollama', baseUrl: base, model: 'x' })
})
afterAll(() => server.close())

const reset = (): void => {
  state.cards = ''
  state.review = ''
  state.summaries = []
  state.triage = '{"category":"cours","chapter":"Ensembles et applications"}'
  state.calls = { cards: 0, review: 0, summary: 0, triage: 0 }
  state.prompts = []
}

describe('Création automatique de cartes', () => {
  it('ne garde que de bonnes cartes : formules en LaTeX, ancrées dans le cours, sans doublon ni déchet', async () => {
    reset()
    state.cards = json([
      card('Quelle est la définition d’une application f : E → F injective ?', 'Deux éléments distincts de E ont des images distinctes.'),
      card('Quelle est la définition de l’application f : E → F injective ?', 'Deux éléments distincts de E ont des images distinctes.'), // doublon
      card('Remarque', 'Il s’agit donc d’une façon supplémentaire de montrer que f est bijective'), // étiquette
      card('Quelle est la capitale de l’Australie ?', 'Canberra est la capitale politique de l’Australie.'), // inventée : absente du cours
      card('Qui est dans le groupe de colle 3 ?', 'Martin et Durand'), // administratif
      cloze('Une application est {{c1::surjective}} si tout élément de F possède au moins un antécédent.'),
      cloze('{{c1::Soit}} {{c2::f}} {{c3::une}} {{c4::application}} {{c5::de}} {{c6::E}} {{c7::dans}} {{c8::F}}') // tout masqué
    ])
    const ai = await import('../src/main/ai')
    const cards = await ai.aiCardsFromText(LONG_COURSE, 6, 'fr', 'Document de test')
    const fronts = cards.map((c) => (c.kind === 'cloze' ? c.text : c.front))
    expect(cards).toHaveLength(2)
    expect(fronts[0]).toContain('$f : E \\to F$') // formule en LaTeX
    expect(fronts.join(' ')).not.toMatch(/Remarque|Australie|groupe de colle/)
    expect(cards.some((c) => c.kind === 'cloze' && c.text.includes('{{c1::surjective}}'))).toBe(true)
  })

  it('relit les cartes avec l’IA : garde la version corrigée', async () => {
    reset()
    state.cards = json([
      card('Quelle est la définition d’une application injective ?', 'Deux éléments distincts de E ont des images distinctes.'),
      card('Quelle est la définition d’une application surjective ?', 'Tout élément de F possède au moins un antécédent.')
    ])
    state.review = json([
      card('Quelle est la définition d’une application injective ?', 'Une application est injective si deux éléments distincts de E ont des images distinctes.'),
      card('Quelle est la définition d’une application surjective ?', 'Tout élément de F possède au moins un antécédent.')
    ])
    const ai = await import('../src/main/ai')
    const cards = await ai.aiCardsFromText(LONG_COURSE, 2, 'fr', '')
    expect(state.calls.review).toBe(1)
    expect(cards[0].back).toMatch(/^Une application est injective/)
  })

  it('garde les cartes d’origine si la relecture supprime presque tout ou renvoie n’importe quoi', async () => {
    const ai = await import('../src/main/ai')
    for (const review of [json([card('Quelle est la définition d’une application injective ?', 'Deux éléments distincts ont des images distinctes.')]), 'désolé, je ne peux pas']) {
      reset()
      state.cards = json([
        card('Quelle est la définition d’une application injective ?', 'Deux éléments distincts de E ont des images distinctes.'),
        card('Quelle est la définition d’une application surjective ?', 'Tout élément de F possède au moins un antécédent.'),
        card('Quelle est la définition d’une application bijective ?', 'Elle est à la fois injective et surjective.'),
        card('Que dit le théorème de Bayes ?', 'La probabilité de A sachant B vaut celle de B sachant A fois celle de A, divisée par celle de B.')
      ])
      state.review = review
      const cards = await ai.aiCardsFromText(LONG_COURSE, 4, 'fr', '')
      expect(cards).toHaveLength(4)
    }
  })

  it('récupère les cartes complètes quand la réponse du modèle est coupée en plein milieu', async () => {
    reset()
    const ok = JSON.stringify(card('Quelle est la définition d’une application injective ?', 'Deux éléments distincts de E ont des images distinctes.'))
    state.cards = `{"cards":[${ok},{"type":"basic","front":"Que dit le théo`
    const ai = await import('../src/main/ai')
    const cards = await ai.aiCardsFromText(LONG_COURSE, 3, 'fr', '')
    expect(cards).toHaveLength(1)
    expect(cards[0].front).toContain('injective')
  })

  it('mode « sujet » : demande au modèle d’écrire d’après ses connaissances, sans exiger de texte source', async () => {
    reset()
    state.cards = json([
      card('Quelle est la définition d’une suite arithmétique ?', 'Une suite dont chaque terme s’obtient en ajoutant une constante, la raison, au précédent.'),
      card('Quelle est la formule du terme général d’une suite arithmétique ?', 'u_{n} = u_{0} + n r')
    ])
    const ai = await import('../src/main/ai')
    const cards = await ai.aiCardsFromText('Sujet : les suites arithmétiques', 5, 'fr', '')
    const prompt = state.prompts.find((p) => p.kind === 'cards')
    expect(prompt?.user).toContain('sur le sujet')
    expect(prompt?.user).toContain('suites arithmétiques')
    expect(prompt?.user).not.toContain('---') // pas de document
    expect(cards.length).toBe(2)
    expect(cards[1].back).toContain('$u_{n} = u_{0} + n r$') // formule mise en LaTeX
  })

  it('la consigne demande des cartes atomiques et interdit l’administratif, avec des exemples', async () => {
    reset()
    state.cards = json([card('Quelle est la définition d’une application injective ?', 'Deux éléments distincts de E ont des images distinctes.')])
    const ai = await import('../src/main/ai')
    await ai.aiCardsFromText(LONG_COURSE, 3, 'fr', '')
    const p = state.prompts.find((x) => x.kind === 'cards')?.system ?? ''
    expect(p).toMatch(/une seule idée par carte/)
    expect(p).toMatch(/administratif/)
    expect(p).toMatch(/BONNES cartes/)
    expect(p).toMatch(/LaTeX/)
  })
})

describe('Fiches de révision', () => {
  it('retire le préambule, ajoute le titre, supprime les sections vides', async () => {
    reset()
    state.summaries = ['Voici la fiche demandée :\n\n## À retenir\n- Une injection n’identifie pas deux éléments.\n\n## Définitions\n\n## Méthodes\n- Raisonner par contraposée.\n']
    const ai = await import('../src/main/ai')
    const md = await ai.aiSummarize('Applications', LONG_COURSE)
    expect(md.startsWith('# Applications')).toBe(true)
    expect(md).not.toMatch(/Voici la fiche/)
    expect(md).not.toMatch(/## Définitions/)
    expect(md).toMatch(/## Méthodes/)
  })

  it('la consigne demande une fiche belle : encadrés, tableaux, formules, révision finale', async () => {
    reset()
    state.summaries = ['# Applications\n\n> [!KEY] À retenir\n> - Une idée utile pour réviser.\n']
    const ai = await import('../src/main/ai')
    await ai.aiSummarize('Applications', LONG_COURSE)
    const p = state.prompts.find((x) => x.kind === 'summary')?.system ?? ''
    for (const needle of ['[!KEY]', '[!DEFINITION]', '[!THEOREM]', '[!METHOD]', '[!WARNING]', '[!EXAMPLE]', 'TABLEAU', 'LaTeX', 'Pour réviser', 'pas d\'emoji']) expect(p).toContain(needle)
  })

  it('refait un essai quand la première réponse est vide', async () => {
    reset()
    state.summaries = ['ok', '# Applications\n\n## À retenir\n- Définitions d’injective, surjective et bijective, à connaître.\n']
    const ai = await import('../src/main/ai')
    const md = await ai.aiSummarize('Applications', LONG_COURSE)
    expect(state.calls.summary).toBe(2)
    expect(md).toMatch(/injective/)
  })

  it('« Créer une fiche » : enregistrée dans Mes documents, lisible, modifiable, avec notes', async () => {
    reset()
    const { addMarkdownDocument, documentInfo, saveDocumentSource, documentSource, saveDocumentNotes } = await import('../src/main/docfiles')
    const { listDocuments } = await import('../src/main/documents')
    const id = addMarkdownDocument('Suites numériques', '# Suites numériques\n\n## À retenir\n- Une suite arithmétique a une raison constante.\n')
    const info = documentInfo(id)
    expect(info).toMatchObject({ title: 'Suites numériques', ext: 'md', kind: 'text', subject: 'Fiches' })
    expect(listDocuments().find((d) => d.id === id)?.category).toBe('cours')
    saveDocumentSource(id, documentSource(id) + '\n## Pièges\n- Confondre raison et premier terme.\n')
    expect(documentInfo(id).text).toMatch(/Confondre raison/)
    saveDocumentNotes(id, 'à revoir avant le DS')
    expect(documentInfo(id).notes).toBe('à revoir avant le DS')
  })
})

describe('Cartes depuis un document de la bibliothèque', () => {
  it('« Cartes » sur un document : cartes propres dans un deck, sans doublon au deuxième clic', async () => {
    reset()
    state.cards = json([
      card('Quelle est la définition d’une application injective ?', 'Deux éléments distincts de E ont des images distinctes.'),
      card('Quelle est la définition d’une application surjective ?', 'Tout élément de F possède au moins un antécédent.'),
      card('Remarque', 'Il s’agit de montrer que f est bijective')
    ])
    const file = join(userData, 'cours-applications.txt')
    writeFileSync(file, LONG_COURSE)
    const { addDocumentPaths } = await import('../src/main/docfiles')
    const { makeCards, listDocuments } = await import('../src/main/documents')
    const { listDecks } = await import('../src/main/repo')
    const added = await addDocumentPaths([file], 'Mathématiques')
    expect(added.added).toBe(1)
    const id = added.ids[0]
    expect(await makeCards(id, 5)).toBe(2) // l'étiquette « Remarque » est écartée
    expect(listDecks().some((d) => d.fullName.startsWith('Documents::Mathématiques'))).toBe(true)
    expect(listDocuments().find((d) => d.id === id)?.cards).toBe(2)
    expect(await makeCards(id, 5)).toBe(0) // mêmes cartes : rien n'est dupliqué
  })

  it('ajoute deux fois le même fichier : le deuxième est repéré comme doublon', async () => {
    reset()
    const file = join(userData, 'copie.txt')
    writeFileSync(file, LONG_COURSE)
    const { addDocumentPaths } = await import('../src/main/docfiles')
    const { listDocuments } = await import('../src/main/documents')
    const r = await addDocumentPaths([file], 'Mathématiques')
    expect(r.added).toBe(1)
    expect(listDocuments().find((d) => d.id === r.ids[0])?.category).toBe('doublon')
  })
})

describe('Ajout manuel et reclassement', () => {
  it('trie un fichier ajouté à la main (énoncé de DS écarté) et laisse l’utilisateur reclasser', async () => {
    reset()
    const ds = join(userData, 'DS2 probabilités.txt')
    writeFileSync(ds, 'Durée : 4 heures. Calculatrice interdite. Exercice 1. Calculer E(X). '.repeat(10))
    const notes = join(userData, 'cours probabilités.txt')
    writeFileSync(notes, 'Une variable aléatoire discrète prend un nombre fini ou dénombrable de valeurs. '.repeat(10))
    const { addDocumentPaths, setDocumentCategory, documentInfo } = await import('../src/main/docfiles')
    const { listDocuments, makeCards } = await import('../src/main/documents')
    const r = await addDocumentPaths([ds, notes], 'Mathématiques')
    const byTitle = (t: string) => listDocuments().find((d) => d.title === t)
    expect(byTitle('DS2 probabilités')?.category).toBe('exercices') // pas de cartes pour un énoncé
    expect(['cours', 'methode']).toContain(byTitle('cours probabilités')?.category)
    // Le tri s'est trompé ? L'utilisateur reclasse en un clic ; un document « cours » a alors un chapitre.
    setDocumentCategory(r.ids[0], 'cours')
    expect(documentInfo(r.ids[0]).category).toBe('cours')
    expect(listDocuments().find((d) => d.id === r.ids[0])?.chapter).not.toBe('')
    expect(() => setDocumentCategory(r.ids[0], 'n’importe quoi')).toThrow()
    state.cards = json([card('Que dit la définition d’une variable aléatoire discrète ?', 'Elle prend un nombre fini ou dénombrable de valeurs.')])
    expect(await makeCards(r.ids[0], 3)).toBeGreaterThanOrEqual(0)
  })
})

describe('Tri des documents par l’IA', () => {
  it('suit l’IA pour les cas flous, et retombe sur les règles si elle répond n’importe quoi', async () => {
    const { triageDocument } = await import('../src/main/triage')
    const doc = { title: 'doc 4', subject: 'Maths', folder: 'Divers', text: LONG_COURSE }
    reset()
    state.triage = '{"category":"methode","chapter":"Rédaction des preuves"}'
    expect(await triageDocument(doc, [])).toMatchObject({ category: 'methode', chapter: 'Rédaction des preuves', by: 'ia' })
    reset()
    state.triage = '{"category":"nimporte","chapter":""}'
    expect((await triageDocument(doc, [])).category).toBe('cours')
    reset()
    state.triage = 'pas du json'
    expect((await triageDocument(doc, [])).by).toBe('regles')
  })

  it('réutilise le nom d’un chapitre déjà connu (accents et majuscules près)', async () => {
    reset()
    state.triage = '{"category":"cours","chapter":"ensembles et applications"}'
    const { triageDocument } = await import('../src/main/triage')
    const t = await triageDocument({ title: 'doc 9', subject: 'Maths', folder: 'Divers', text: LONG_COURSE }, ['Ensembles et Applications'])
    expect(t.chapter).toBe('Ensembles et Applications')
  })

  it('un DS, un corrigé ou une info pratique ne passe jamais par l’IA et ne donne aucune carte', async () => {
    reset()
    const { triageDocument, CARD_CATEGORIES } = await import('../src/main/triage')
    for (const d of [
      { title: 'DS1 corrigé', folder: '' },
      { title: 'Ensembles et applications', folder: 'Réponses aux exercices' },
      { title: 'Groupes de colles 2026-2027', folder: 'Documents annexes' },
      { title: 'sujet 4', folder: 'DS de l’année dernière' }
    ]) {
      const t = await triageDocument({ ...d, subject: 'Maths', text: LONG_COURSE }, [])
      expect(CARD_CATEGORIES.has(t.category)).toBe(false)
    }
    expect(state.calls.triage).toBe(0)
  })
})

describe('Tâches de fond', () => {
  it('suivent la progression, s’arrêtent à la demande et se terminent proprement', async () => {
    const { startJob, cancelJob, listJobs } = await import('../src/main/jobs')
    const job = startJob('prepa', 'Import test', { cancellable: true })
    job.set(3, 10, 'Création des cartes · Cours')
    expect(listJobs().find((j) => j.id === job.id)).toMatchObject({ status: 'running', done: 3, total: 10, cancellable: true })
    cancelJob(job.id)
    expect(job.cancelled).toBe(true)
    job.finish('Arrêté')
    expect(listJobs().find((j) => j.id === job.id)?.status).toBe('cancelled')
    const quiet = startJob('cards', 'Rien')
    quiet.discard()
    expect(listJobs().some((j) => j.id === quiet.id)).toBe(false)
  })
})

describe('Estimation et fournisseurs', () => {
  it('un modèle local est toujours gratuit', async () => {
    const ai = await import('../src/main/ai')
    const e = ai.aiEstimate(LONG_COURSE, 10)
    expect(e.cost).toBe(0)
    expect(e.overCap).toBe(false)
  })

  it('les cartes créées par l’IA sont retrouvables par l’étiquette ia-auto', async () => {
    const { listDecks } = await import('../src/main/repo')
    expect(listDecks().length).toBeGreaterThan(0)
    expect(existsSync(userData)).toBe(true)
    expect(readFileSync(join(userData, 'cours-applications.txt'), 'utf8').length).toBeGreaterThan(100)
  })
})
