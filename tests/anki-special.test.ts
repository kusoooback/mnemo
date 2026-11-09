import Database from 'better-sqlite3'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { zipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

beforeEach(async () => {
  const { closeDb, openDb } = await import('../src/main/db')
  closeDb()
  userData = mkdtempSync(join(tmpdir(), 'mnemo-anki-special-'))
  openDb()
})

describe('Gabarits de cartes Anki', () => {
  it('rend les champs, les sections conditionnelles et FrontSide', async () => {
    const { renderAnkiTemplate, renderAnkiAnswer } = await import('../src/main/anki')
    const f = new Map([
      ['Mot', 'chien'],
      ['Sens', 'dog'],
      ['Inverse', ''],
      ['Note', '<b>animal</b>']
    ])
    expect(renderAnkiTemplate('{{Mot}}', f)).toBe('chien')
    expect(renderAnkiTemplate('{{#Inverse}}{{Sens}}{{/Inverse}}', f)).toBe('')
    expect(renderAnkiTemplate('{{^Inverse}}pas d’inverse{{/Inverse}}', f)).toBe('pas d’inverse')
    expect(renderAnkiTemplate('{{#Note}}[{{text:Note}}]{{/Note}}', f)).toBe('[animal]')
    expect(renderAnkiTemplate('{{type:Sens}}{{Mot}}', f)).toBe('chien')
    const q = renderAnkiTemplate('{{Mot}}', f)
    expect(renderAnkiAnswer('{{FrontSide}}<hr id=answer>{{Sens}}', q, f)).toBe('dog')
    expect(renderAnkiAnswer('{{FrontSide}}<br>{{Sens}}', q, f)).toBe('<br>dog')
  })
})

/** Collection Anki « ancien format » minimale, avec des types de notes variés. */
function legacyApkg(crt: number): Buffer {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
    CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);
    CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
    CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);
  `)
  const tmpl = (name: string, ord: number, qfmt: string, afmt: string): object => ({ name, ord, qfmt, afmt })
  const fld = (name: string, ord: number): object => ({ name, ord })
  const models = {
    '100': {
      id: 100, name: 'Vocabulaire (inverse facultatif)', type: 0,
      flds: [fld('Mot', 0), fld('Sens', 1), fld('Inverse', 2)],
      tmpls: [
        tmpl('Carte 1', 0, '{{Mot}}', '{{FrontSide}}<hr id=answer>{{Sens}}'),
        tmpl('Carte 2', 1, '{{#Inverse}}{{Sens}}{{/Inverse}}', '{{FrontSide}}<hr id=answer>{{Mot}}')
      ]
    },
    '101': {
      id: 101, name: 'Question en deuxième champ', type: 0,
      flds: [fld('Titre', 0), fld('Question', 1), fld('Reponse', 2)],
      tmpls: [tmpl('Carte 1', 0, '{{Question}}', '{{FrontSide}}<hr id=answer>{{Reponse}}')]
    },
    '102': {
      id: 102, name: 'À trous avec titre', type: 1,
      flds: [fld('Titre', 0), fld('Texte', 1)],
      tmpls: [tmpl('Cloze', 0, '{{cloze:Texte}}', '{{cloze:Texte}}')]
    },
    '103': {
      id: 103, name: 'Image Occlusion', type: 1,
      flds: [fld('Occlusion', 0), fld('Image', 1)],
      tmpls: [tmpl('Cloze', 0, '{{cloze:Occlusion}}', '{{cloze:Occlusion}}')]
    }
  }
  const decks = {
    '1': { id: 1, name: 'Default', conf: 1 },
    '10': { id: 10, name: 'Cours', conf: 2 },
    '11': { id: 11, name: 'Cours::Maths', conf: 2 }
  }
  const dconf = { '1': { new: { perDay: 20 } }, '2': { new: { perDay: 30 } } }
  db.prepare('INSERT INTO col VALUES (1, ?, 0, 0, 11, 0, 0, 0, ?, ?, ?, ?, ?)').run(crt, '{}', JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf), '{}')
  const note = db.prepare('INSERT INTO notes VALUES (?, ?, ?, 0, 0, ?, ?, 0, 0, 0, ?)')
  const card = db.prepare('INSERT INTO cards VALUES (?, ?, 11, ?, 0, 0, ?, ?, ?, ?, 2500, ?, 0, 0, 0, 0, 0, ?)')
  // 1 : vocabulaire sans inverse (une seule carte, à réviser depuis hier)
  note.run(1, 'g1', 100, '', 'chat\x1fcat\x1f', '')
  card.run(1, 1, 0, 2, 2, 99, 10, 3, '{}')
  // 2 : vocabulaire avec inverse (deux cartes ; la seconde est reportée à demain dans Anki)
  note.run(2, 'g2', 100, '', 'chien\x1fdog\x1foui', '')
  card.run(2, 2, 0, 2, 2, 2, 20, 3, '{}')
  card.run(3, 2, 1, 2, -2, 2, 20, 3, '{}')
  // 3 : la question est dans le deuxième champ, révision prévue dans 5 jours
  note.run(3, 'g3', 101, '', 'Géo\x1fQuelle est la capitale de la France ?\x1fParis', '')
  card.run(4, 3, 0, 2, 2, 105, 30, 4, '{}')
  // 4 : texte à trous dont le trou est dans le deuxième champ
  note.run(4, 'g4', 102, '', 'Biologie\x1fLa {{c1::mitochondrie}} produit l’ATP.', '')
  card.run(5, 4, 0, 0, 0, 0, 0, 0, '{}')
  // 5 : occlusion d'image (non reprise)
  note.run(5, 'g5', 103, '', '{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}\x1f<img src="a.png">', '')
  card.run(6, 5, 0, 0, 0, 0, 0, 0, '{}')
  const buf = db.serialize()
  db.close()
  return Buffer.from(zipSync({ 'collection.anki2': new Uint8Array(buf), media: new TextEncoder().encode('{}') }))
}

describe('Import Anki : types de notes spéciaux et échéances', () => {
  const crt = Math.floor(Date.now() / 1000 / 86400) * 86400 - 100 * 86400

  it('importe tous les types de notes avec ce qu’Anki affichait', async () => {
    const { importApkg } = await import('../src/main/anki')
    const { getDb } = await import('../src/main/db')
    const report = importApkg(legacyApkg(crt))
    expect(report.skipped).toBe(0)
    expect(report.warnings.join(' ')).toMatch(/occlusion/i)
    const notes = (getDb().prepare('SELECT kind, fields, source FROM note ORDER BY source').all() as { kind: string; fields: string; source: string }[]).map((n) => ({
      ...n,
      fields: JSON.parse(n.fields) as Record<string, string>
    }))
    const bySource = (s: string): { kind: string; fields: Record<string, string> } => notes.find((n) => n.source === s) as never
    // Vocabulaire : le champ « Inverse » (« oui ») ne pollue plus la réponse, et la carte inverse n'existe que si elle est demandée.
    expect(bySource('anki:g1#0').fields).toMatchObject({ front: 'chat', back: 'cat' })
    expect(notes.some((n) => n.source === 'anki:g1#1')).toBe(false)
    expect(bySource('anki:g2#0').fields).toMatchObject({ front: 'chien', back: 'dog' })
    expect(bySource('anki:g2#1').fields).toMatchObject({ front: 'dog', back: 'chien' })
    // La question est lue dans le bon champ.
    expect(bySource('anki:g3#0').fields).toMatchObject({ front: 'Quelle est la capitale de la France ?', back: 'Paris' })
    // Le trou n'est pas dans le premier champ.
    expect(bySource('anki:g4').kind).toBe('cloze')
    expect(bySource('anki:g4').fields.text).toContain('{{c1::mitochondrie}}')
    // L'occlusion n'est pas importée comme du texte illisible.
    expect(notes.some((n) => n.source === 'anki:g5')).toBe(false)
  })

  it('garde les échéances d’Anki, les cartes reportées et la limite de nouvelles cartes', async () => {
    const { importApkg } = await import('../src/main/anki')
    const { getDb } = await import('../src/main/db')
    importApkg(legacyApkg(crt))
    const due = (source: string): { due: number; state: number; buried_until: number } =>
      getDb()
        .prepare('SELECT c.due, c.state, c.buried_until FROM card c JOIN note n ON n.id = c.note_id WHERE n.source = ?')
        .get(source) as never
    // « due » d'Anki = nombre de jours depuis la création de la collection.
    expect(due('anki:g3#0').due).toBe((crt + 105 * 86400) * 1000)
    expect(due('anki:g3#0').state).toBe(2)
    expect(due('anki:g2#0').due).toBe((crt + 2 * 86400) * 1000)
    expect(due('anki:g2#1').buried_until).toBeGreaterThan(Date.now())
    const limit = (name: string): number | null =>
      (getDb().prepare('SELECT new_per_day n FROM deck WHERE name = ? COLLATE NOCASE').get(name) as { n: number | null }).n
    expect(limit('Maths')).toBe(30)
    expect(limit('Cours')).toBe(30)
  })
})

describe('Reporter à demain', () => {
  it('écarte aussi les cartes en apprentissage jusqu’au lendemain', async () => {
    const { createSample } = await import('../src/main/data')
    const study = await import('../src/main/study')
    const { getDb } = await import('../src/main/db')
    createSample()
    const first = study.next(null)!
    getDb().prepare('UPDATE card SET state = 1, due = ? WHERE id = ?').run(Date.now() - 1000, first.cardId)
    expect(study.counts(null).learnCount).toBe(1)
    expect(study.next(null)?.cardId).toBe(first.cardId)
    study.bury(first.cardId)
    expect(study.counts(null).learnCount).toBe(0)
    expect(study.next(null)?.cardId).not.toBe(first.cardId)
  })
})
