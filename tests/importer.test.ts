import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseText } from '../src/shared/textimport'
import type { TextImportRequest } from '../src/shared/types'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const tmp = (): string => mkdtempSync(join(tmpdir(), 'mnemo-imp-'))

beforeEach(async () => {
  const { closeDb, openDb } = await import('../src/main/db')
  closeDb()
  userData = tmp()
  openDb()
})

const textReq = (over: Partial<TextImportRequest> = {}): TextImportRequest => ({
  delimiter: 'auto',
  custom: '',
  rowSeparator: '',
  header: 'auto',
  roles: [],
  kind: 'auto',
  deckMode: 'new',
  deckId: null,
  deckName: 'Import',
  html: false,
  skipDuplicates: true,
  ...over
})

describe('lecture de fichiers texte', () => {
  it('reconnaît l’export « notes en texte » d’Anki et ses colonnes', () => {
    const text = [
      '#separator:tab',
      '#html:true',
      '#guid column:1',
      '#notetype column:2',
      '#deck column:3',
      '#tags column:6',
      'g1\tBasique\tHistoire::Rome\tQui fonda Rome ?<br>(légende)\tRomulus\thistoire antique',
      'g2\tCloze\tHistoire::Rome\tRome fut fondée en {{c1::753}} av. J.-C.\t\thistoire'
    ].join('\n')
    const p = parseText(text)
    expect(p.delimiter).toBe('tab')
    expect(p.html).toBe(true)
    expect(p.rows).toHaveLength(2)
    expect(p.roles).toEqual(['guid', 'kind', 'deck', 'front', 'back', 'tags'])
  })

  it('devine le séparateur et l’en-tête d’un CSV de tableur', () => {
    const p = parseText('Question;Réponse;Tags\n"Capitale; de la France";Paris;geo\nLe 2+2;4;maths')
    expect(p.delimiter).toBe('semicolon')
    expect(p.hasHeader).toBe(true)
    expect(p.rows[0][0]).toBe('Capitale; de la France')
    expect(p.roles.slice(0, 3)).toEqual(['front', 'back', 'tags'])
  })

  it('lit un export Quizlet à séparateurs personnalisés', () => {
    const p = parseText('chat - cat;;chien - dog;;maison - house', { delimiter: 'custom', custom: ' - ', rowSeparator: ';;', header: 'no' })
    expect(p.rows).toEqual([['chat', 'cat'], ['chien', 'dog'], ['maison', 'house']])
  })
})

describe('import de texte', () => {
  it('importe un export Anki texte : decks, trous, étiquettes, HTML, et ne crée pas de doublons au second passage', async () => {
    const { runImport } = await import('../src/main/importer')
    const { getDb } = await import('../src/main/db')
    const text = [
      '#separator:tab',
      '#html:true',
      '#guid column:1',
      '#notetype column:2',
      '#deck column:3',
      '#tags column:6',
      'g1\tBasique\tHistoire::Rome\tQui fonda <b>Rome</b> ?\tRomulus\thistoire antique',
      'g2\tCloze\tHistoire::Rome\tRome fut fondée en {{c1::753}} av. J.-C.\t\thistoire',
      'g3\tBasique\tLangues\tHello\tBonjour\t'
    ].join('\n')
    const parsed = parseText(text)
    const req = { kind: 'text' as const, path: '', name: 'export.txt', text, options: textReq({ deckMode: 'column', html: parsed.html, roles: parsed.roles }) }
    const r1 = runImport(req)
    expect(r1.added).toBe(3)
    expect(r1.decks).toBe(2)
    const db = getDb()
    const note = db.prepare("SELECT kind, fields, tags FROM note WHERE source = 'txt:g1'").get() as { kind: string; fields: string; tags: string }
    expect(JSON.parse(note.fields).front).toBe('Qui fonda **Rome** ?')
    expect(note.tags.trim().split(' ')).toEqual(['histoire', 'antique'])
    expect((db.prepare("SELECT kind FROM note WHERE source = 'txt:g2'").get() as { kind: string }).kind).toBe('cloze')
    const r2 = runImport(req)
    expect(r2.added).toBe(0)
    expect(r2.existing).toBe(3)
  })

  it('ignore les lignes invalides et les doublons', async () => {
    const { runImport } = await import('../src/main/importer')
    const text = 'a\tb\na\tb\nseul\t\nnouveau\tvaleur'
    const r = runImport({ kind: 'text', path: '', name: 'x.tsv', text, options: textReq() })
    expect(r.added).toBe(2)
    expect(r.existing).toBe(1)
    expect(r.invalid).toBe(1)
  })
})

describe('réimport Anki incrémental', () => {
  it('n’ajoute que les nouvelles révisions faites entre-temps', async () => {
    const { createSample } = await import('../src/main/data')
    const { buildApkg, importApkg } = await import('../src/main/anki')
    const study = await import('../src/main/study')
    const { closeDb, openDb, getDb } = await import('../src/main/db')
    createSample()
    study.answer(study.next(null)!.cardId, 3, 1000)
    const v1 = buildApkg(null).data
    await new Promise((r) => setTimeout(r, 5))
    study.answer(study.next(null)!.cardId, 4, 1000)
    study.answer(study.next(null)!.cardId, 2, 1000)
    const v2 = buildApkg(null).data

    closeDb()
    userData = tmp()
    openDb()
    const a = importApkg(v1)
    expect(a.notes).toBe(6)
    expect(a.reviews).toBe(1)
    const b = importApkg(v2)
    expect(b.notes).toBe(0)
    expect(b.existing).toBe(6)
    expect(b.reviews).toBe(2)
    const c = importApkg(v2)
    expect(c.reviews).toBe(0)
    const db = getDb()
    expect((db.prepare('SELECT COUNT(*) n FROM note').get() as { n: number }).n).toBe(6)
    expect((db.prepare('SELECT COUNT(*) n FROM review').get() as { n: number }).n).toBe(3)
  })
})

describe('sauvegarde Mnémo (JSON)', () => {
  it('se réimporte dans une base vide', async () => {
    const { createSample } = await import('../src/main/data')
    const { runImport } = await import('../src/main/importer')
    const study = await import('../src/main/study')
    const { closeDb, openDb, getDb } = await import('../src/main/db')
    createSample()
    study.answer(study.next(null)!.cardId, 3, 1000)
    const db = getDb()
    const file = join(tmp(), 'export.json')
    writeFileSync(
      file,
      JSON.stringify({
        format: 'mnemo-export',
        decks: db.prepare('SELECT * FROM deck').all(),
        notes: db.prepare('SELECT * FROM note').all(),
        cards: db.prepare('SELECT * FROM card').all(),
        reviews: db.prepare('SELECT * FROM review').all(),
        media: []
      })
    )
    closeDb()
    userData = tmp()
    openDb()
    const r = runImport({ kind: 'mnemo', path: file, name: 'export.json' })
    expect(r.added).toBe(6)
    expect(r.reviews).toBe(1)
    expect((getDb().prepare('SELECT COUNT(*) n FROM card WHERE state != 0').get() as { n: number }).n).toBe(1)
  })
})
