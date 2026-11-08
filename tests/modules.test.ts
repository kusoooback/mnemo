import Database from 'better-sqlite3'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { unzipSync } from 'fflate'
import { beforeAll, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const fresh = (): string => (userData = mkdtempSync(join(tmpdir(), 'mnemo-test-')))

describe('Anki : aller-retour .apkg', () => {
  let apkg: Buffer
  let reviewed = 0

  beforeAll(async () => {
    fresh()
    const { openDb } = await import('../src/main/db')
    const { createSample } = await import('../src/main/data')
    const { buildApkg } = await import('../src/main/anki')
    const study = await import('../src/main/study')
    openDb()
    createSample()
    for (let i = 0; i < 3; i++) {
      const c = study.next(null)
      if (!c) break
      study.answer(c.cardId, 3, 2500)
      reviewed++
    }
    apkg = buildApkg(null).data
  })

  it('produit un paquet valide', () => {
    const files = unzipSync(new Uint8Array(apkg))
    expect(Object.keys(files)).toContain('collection.anki2')
    const db = new Database(Buffer.from(files['collection.anki2']), { readonly: true })
    expect((db.prepare('SELECT COUNT(*) n FROM notes').get() as { n: number }).n).toBe(6)
    expect((db.prepare('SELECT COUNT(*) n FROM cards').get() as { n: number }).n).toBe(8)
    expect((db.prepare('SELECT COUNT(*) n FROM revlog').get() as { n: number }).n).toBe(reviewed)
    const col = db.prepare('SELECT models, decks FROM col').get() as { models: string; decks: string }
    expect(Object.keys(JSON.parse(col.models))).toHaveLength(4)
    expect(Object.values(JSON.parse(col.decks) as Record<string, { name: string }>).map((d) => d.name)).toContain('Découverte de Mnémo')
    db.close()
  })

  it('se réimporte à l’identique dans une base vide (cartes, trous, formules, historique)', async () => {
    const { closeDb, openDb, getDb } = await import('../src/main/db')
    closeDb()
    fresh()
    openDb()
    const { importApkg } = await import('../src/main/anki')
    const report = importApkg(apkg)
    expect(report.notes).toBe(6)
    expect(report.cards).toBe(8)
    expect(report.reviews).toBe(reviewed)
    expect(report.skipped).toBe(0)
    expect(report.existing).toBe(0)

    const db = getDb()
    const notes = db.prepare('SELECT kind, fields FROM note').all() as { kind: string; fields: string }[]
    const kinds = notes.map((n) => n.kind).sort()
    expect(kinds).toEqual(['basic', 'basic', 'basic', 'basic', 'basic-reverse', 'cloze'])
    const cloze = JSON.parse(notes.find((n) => n.kind === 'cloze')!.fields)
    expect(cloze.text).toContain('{{c1::ATP}}')
    expect(cloze.text).toContain('{{c2::phosphorylation oxydative::processus}}')
    const math = notes.map((n) => JSON.parse(n.fields)).find((f) => (f.back ?? '').includes('u\'v'))
    expect(math.back).toContain('$$')
    expect(math.front).toContain('$(uv)\'$')
    const code = notes.map((n) => JSON.parse(n.fields)).find((f) => (f.back ?? '').includes('reversed_xs'))
    expect(code.back).toContain('reversed_xs = xs[::-1]')
    // L'historique est rejoué : les cartes révisées ne sont plus « nouvelles ».
    expect((db.prepare('SELECT COUNT(*) n FROM card WHERE state != 0').get() as { n: number }).n).toBeGreaterThan(0)
    expect((db.prepare('SELECT COUNT(*) n FROM review').get() as { n: number }).n).toBe(reviewed)
    expect((db.prepare('SELECT COUNT(*) n FROM deck WHERE deleted_at IS NULL').get() as { n: number }).n).toBe(1)
  })
})

describe('conversions', () => {
  it('convertit le HTML d’Anki en Markdown', async () => {
    const { htmlToMarkdown } = await import('../src/main/anki')
    const media = new Map([['schema.png', 'mnemo-media://abc.png']])
    expect(htmlToMarkdown('Une <b>cellule</b> &amp; son <i>noyau</i><br>ligne 2', media)).toBe('Une **cellule** & son *noyau*\nligne 2')
    expect(htmlToMarkdown('<img src="schema.png">', media)).toBe('![](mnemo-media://abc.png)')
    expect(htmlToMarkdown('\\(x^2\\) et \\[y\\] [sound:a.mp3]', media)).toBe('$x^2$ et $$y$$')
    expect(htmlToMarkdown('{{c1::<b>ATP</b>::indice}}', media)).toBe('{{c1::**ATP**::indice}}')
  })

  it('lit la syntaxe Markdown des cartes', async () => {
    const { parseMarkdownCards } = await import('../src/main/integrations')
    const cards = parseMarkdownCards(
      ['# Cours', 'Capitale de la France :: Paris', '- Hello ::: Bonjour', 'La {{c1::mitose}} divise la cellule', '', 'Quelle est la formule ?', '?', '$E=mc^2$', '', 'Phrase normale sans carte.', '```', 'a :: b', '```'].join('\n')
    )
    expect(cards.map((c) => c.kind)).toEqual(['basic', 'basic-reverse', 'cloze', 'basic'])
    expect(cards[0].fields).toEqual({ front: 'Capitale de la France', back: 'Paris' })
    expect(cards[3].fields.back).toBe('$E=mc^2$')
  })

  it('extrait un JSON de carte même entouré de texte', async () => {
    const { extractJson, normalizeProposals } = await import('../src/main/ai')
    const reply = 'Voici :\n```json\n[{"type":"basic","front":"Q ?","back":"R"},{"type":"cloze","text":"Un {{c1::trou}}"},{"type":"basic","front":"sans réponse"}]\n```'
    const cards = normalizeProposals(extractJson(reply))
    expect(cards).toHaveLength(2)
    expect(cards[1].kind).toBe('cloze')
    expect(normalizeProposals(extractJson('{"cards":[{"question":"a","answer":"b"}]}'))).toHaveLength(1)
    expect(() => extractJson('désolé, je ne peux pas')).toThrow()
  })
})

describe('planning', () => {
  it('propose un rythme de nouvelles cartes jusqu’à l’examen', async () => {
    const { closeDb, openDb } = await import('../src/main/db')
    closeDb()
    fresh()
    openDb()
    const { createSample } = await import('../src/main/data')
    const { saveEntry, saveSubject, planningItems, buildIcs, planningLoad } = await import('../src/main/notebook')
    const deck = createSample()
    const subject = saveSubject({ name: 'Biologie', color: '#6b8450' })
    const inTenDays = Date.now() + 10 * 86_400_000
    saveEntry({ kind: 'examen', title: 'Partiel de bio', subjectId: subject, dueAt: inTenDays, deckIds: [deck] })
    const items = planningItems()
    expect(items).toHaveLength(1)
    expect(items[0].newCards).toBe(8)
    expect(items[0].suggestedNewPerDay).toBe(1) // 8 cartes sur (10 - 2) jours
    const ics = buildIcs()
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('Examen · Partiel de bio (Biologie)')
    const d = new Date()
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(planningLoad(key, 14)).toHaveLength(14)
  })
})
