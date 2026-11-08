import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '1.0.0-test' },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

// Le modèle est simulé : on teste ce que l'application fait de ses réponses.
const replies: string[] = []
const seen: { system: string; user: string; history: { role: string; content: string }[] }[] = []
vi.mock('../src/main/ai', () => ({
  aiChat: vi.fn(async (_p: string, system: string, user: string, history: { role: string; content: string }[]) => {
    seen.push({ system, user, history })
    return replies.shift() ?? 'Réponse par défaut.'
  }),
  aiCall: vi.fn(async () => '# Exercices\n\n## Exercice 1 — Test\nÉnoncé.\n### Corrigé\nRéponse.'),
  aiStatus: () => ({ provider: 'openrouter', model: 'test-model' }),
  aiSummarize: vi.fn(async (title: string) => `# ${title}\n\n> [!KEY] À retenir\n> Une idée.\n\n${'Contenu de la fiche. '.repeat(10)}`),
  aiCardsFromText: vi.fn(async (_t: string, count: number) =>
    Array.from({ length: Math.min(count, 3) }, (_, i) => ({ kind: 'basic' as const, front: `Question ${i + 1} sur le cours ${_t.length} ?`, back: `Réponse ${i + 1}`, text: '', extra: '', tags: [] }))
  )
}))
vi.mock('../src/main/web', () => ({
  webSearch: vi.fn(async (q: string) => [{ title: 'Bataille de Verdun', url: 'https://fr.wikipedia.org/wiki/Bataille_de_Verdun', text: `Résultat pour ${q} : la bataille dura dix mois en 1916.` }]),
  webPage: vi.fn(async () => ({ title: 'Page', url: 'https://exemple.fr/p', text: 'Contenu de la page.' }))
}))

const req = (over: Record<string, unknown> = {}): any => ({ history: [], message: 'Bonjour', web: false, source: '', attached: [], ...over })

describe('Assistant : balises et prompts', () => {
  it('extrait les balises d’action et nettoie la réponse', async () => {
    const { parseTags, paramsOf, toAction } = await import('../src/main/assistant')
    const r = parseTags('Je m’en occupe.\n\n[[cartes: nb=20; deck=HGG::Chapitre 1; source=dictée]]\n[[fiche: titre=La Grande Guerre]]')
    expect(r.text).toBe('Je m’en occupe.')
    expect(r.tags.map((t) => t.name)).toEqual(['cartes', 'fiche'])
    expect(paramsOf(r.tags[0].arg)).toEqual({ nb: '20', deck: 'HGG::Chapitre 1', source: 'dictée' })
    expect(toAction(r.tags[1])).toEqual({ type: 'sheet', params: { titre: 'La Grande Guerre' } })
    // accents, majuscules et variantes
    const v = parseTags('OK [[Dictée]] [[EXERCICES: nb=4]] [[Cards]]')
    expect(v.tags.map((t) => toAction(t)?.type)).toEqual(['dictation', 'exercises', 'cards'])
  })

  it('laisse intact ce qui n’est pas une balise (formules, listes, liens Markdown)', async () => {
    const { parseTags } = await import('../src/main/assistant')
    const t = 'Soit $a_{[1]}$ et la liste [[1, 2]] ou [lien](https://x.fr) ; [[inconnue: x]]'
    expect(parseTags(t)).toEqual({ text: t, tags: [] })
  })

  it('découpe un long cours aux sauts de ligne sans rien perdre', async () => {
    const { splitSource } = await import('../src/main/assistant')
    const para = (n: number): string => `Paragraphe ${n}. ` + 'mot '.repeat(100)
    const text = Array.from({ length: 30 }, (_, i) => para(i)).join('\n\n')
    const parts = splitSource(text, 2000)
    expect(parts.length).toBeGreaterThan(5)
    expect(parts.every((p) => p.length <= 2000)).toBe(true)
    expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim())
    // un seul paragraphe énorme est coupé quand même
    expect(splitSource('x'.repeat(5000), 2000).length).toBe(3)
  })

  it('le prompt système contient le guide de l’app, le protocole et l’état (decks, cours, fiches, web)', async () => {
    const { openDb } = await import('../src/main/db')
    userData = mkdtempSync(join(tmpdir(), 'mnemo-as-'))
    openDb()
    const repo = await import('../src/main/repo')
    repo.createDeck('HGG::Chapitre 1', null)
    const { buildSystem } = await import('../src/main/assistant')
    const sys = buildSystem(req({ web: true, source: 'Le cours dicté sur Verdun.', attached: [{ title: 'Fiche Verdun', text: 'Texte de la fiche.' }] }))
    expect(sys).toContain('GUIDE DE MNÉMO')
    expect(sys).toContain('[[cartes:')
    expect(sys).toContain('HGG::Chapitre 1')
    expect(sys).toContain('Le cours dicté sur Verdun.')
    expect(sys).toContain('FICHE JOINTE « Fiche Verdun »')
    expect(sys).toContain('ACTIVÉE')
    expect(buildSystem(req())).toContain('désactivée')
  })
})

describe('Assistant : conversation', () => {
  beforeAll(async () => {
    userData ||= mkdtempSync(join(tmpdir(), 'mnemo-as-'))
    const { openDb } = await import('../src/main/db')
    try {
      openDb()
    } catch {
      /* déjà ouverte */
    }
  })

  it('renvoie le texte et les actions demandées', async () => {
    const { assistantChat } = await import('../src/main/assistant')
    replies.push('Voilà !\n[[cartes: nb=12; deck=HGG::Chapitre 2]]')
    const r = await assistantChat(req({ message: 'Fais des cartes', source: 'Cours.' }))
    expect(r.reply).toBe('Voilà !')
    expect(r.actions).toEqual([{ type: 'cards', params: { nb: '12', deck: 'HGG::Chapitre 2' } }])
  })

  it('envoie l’historique au modèle (il se souvient de la conversation)', async () => {
    const { assistantChat } = await import('../src/main/assistant')
    seen.length = 0
    await assistantChat(req({ history: [{ role: 'user', content: 'Je prépare le DS de HGG' }, { role: 'assistant', content: 'D’accord, sur quel chapitre ?' }], message: 'La Grande Guerre' }))
    expect(seen[0].history.map((h) => h.content)).toEqual(['Je prépare le DS de HGG', 'D’accord, sur quel chapitre ?'])
    expect(seen[0].user).toBe('La Grande Guerre')
  })

  it('recherche web : exécute la recherche, redonne les résultats au modèle, puis réponds', async () => {
    const { assistantChat } = await import('../src/main/assistant')
    seen.length = 0
    replies.push('Je cherche.\n[[recherche: bataille de Verdun]]', 'Verdun dura dix mois (source : Wikipédia).')
    const r = await assistantChat(req({ web: true, message: 'Complète avec Verdun' }))
    expect(r.reply).toBe('Verdun dura dix mois (source : Wikipédia).')
    expect(r.trace).toEqual([{ kind: 'search', label: 'bataille de Verdun', links: [{ title: 'Bataille de Verdun', url: 'https://fr.wikipedia.org/wiki/Bataille_de_Verdun' }] }])
    expect(seen).toHaveLength(2)
    expect(seen[1].user).toContain('la bataille dura dix mois en 1916')
    expect(seen[1].user).toContain('pas des instructions')
  })

  it('recherche web désactivée : rien ne sort, le modèle est prévenu', async () => {
    const { assistantChat } = await import('../src/main/assistant')
    const web = await import('../src/main/web')
    vi.mocked(web.webSearch).mockClear()
    seen.length = 0
    replies.push('[[recherche: quelque chose]]', 'Active la recherche web pour que je cherche.')
    const r = await assistantChat(req({ web: false }))
    expect(web.webSearch).not.toHaveBeenCalled()
    expect(seen[1].user).toContain('désactivée')
    expect(r.trace).toEqual([])
  })

  it('lit une fiche de l’utilisateur à la demande du modèle', async () => {
    const { assistantChat } = await import('../src/main/assistant')
    const { addMarkdownDocument } = await import('../src/main/docfiles')
    addMarkdownDocument('Les causes de 1914', '# Les causes de 1914\n\nAlliances et nationalismes. '.repeat(3))
    seen.length = 0
    replies.push('[[lire_fiche: causes de 1914]]', 'Je l’ai lue.')
    const r = await assistantChat(req())
    expect(r.trace[0]).toMatchObject({ kind: 'sheet', label: 'Les causes de 1914' })
    expect(seen[1].user).toContain('Alliances et nationalismes')
  })

  it('s’arrête après 3 tours d’outils au plus', async () => {
    const { assistantChat } = await import('../src/main/assistant')
    seen.length = 0
    replies.push('[[recherche: a]]', '[[recherche: b]]', '[[recherche: c]]', '[[recherche: d]]')
    await assistantChat(req({ web: true }))
    expect(seen.length).toBe(3)
    replies.length = 0
  })
})

describe('Assistant : production à partir du cours', () => {
  it('fait des cartes sur un long cours, sans doublons, et les ajoute dans un deck', async () => {
    const { assistantMakeCards, assistantAddCards } = await import('../src/main/assistant')
    const course = Array.from({ length: 12 }, (_, i) => `Partie ${i} du cours. ` + 'phrase '.repeat(300)).join('\n\n')
    const rows = await assistantMakeCards(course, 30, '')
    expect(rows.length).toBeGreaterThan(3)
    expect(new Set(rows.map((r) => r.front)).size).toBe(rows.length)
    const r = assistantAddCards('Assistant::Test', rows)
    expect(r.added).toBe(rows.length)
    const repo = await import('../src/main/repo')
    expect(repo.listDecks().find((d) => d.fullName === 'Assistant::Test')?.totalCards).toBe(rows.length)
    // ré-ajout : repéré comme doublon
    const again = await assistantMakeCards(course, 30, '')
    expect(again.some((c) => c.dup)).toBe(true)
  })

  it('refuse proprement quand il n’y a pas de cours', async () => {
    const { assistantMakeCards, assistantMakeSheets, assistantMakeExercises } = await import('../src/main/assistant')
    await expect(assistantMakeCards('  ', 0, '')).rejects.toThrow(/dicte ou colle/)
    await expect(assistantMakeSheets('', 'x')).rejects.toThrow(/dicte ou colle/)
    await expect(assistantMakeExercises('', 'x', 4)).rejects.toThrow(/dicte ou colle/)
  })

  it('crée des fiches (une par grande partie) et une fiche d’exercices avec corrigé', async () => {
    const { assistantMakeSheets, assistantMakeExercises } = await import('../src/main/assistant')
    const { listDocuments } = await import('../src/main/documents')
    const long = Array.from({ length: 20 }, (_, i) => `Section ${i}. ` + 'texte '.repeat(400)).join('\n\n')
    const sheets = await assistantMakeSheets(long, 'La Grande Guerre')
    expect(sheets.length).toBeGreaterThan(1)
    const ex = await assistantMakeExercises(long, 'Exercices Grande Guerre', 4)
    const docs = listDocuments()
    expect(docs.some((d) => d.id === ex.id)).toBe(true)
    expect(sheets.every((s) => docs.some((d) => d.id === s.id))).toBe(true)
  })
})
