import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/main/schema'
import { buildSnapshot, decrypt, deriveKey, encrypt, mergeSnapshot, runSync, setupFolder } from '../src/main/sync'

function newDb(): Database.Database {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  MIGRATIONS.forEach((m) => m(d))
  return d
}

const T0 = Date.UTC(2026, 0, 10, 10)

function seed(d: Database.Database): void {
  d.prepare("INSERT INTO deck(id, name, created_at, updated_at) VALUES ('deck1', 'Bio', ?, ?)").run(T0, T0)
  d.prepare("INSERT INTO note(id, kind, fields, tags, created_at, updated_at) VALUES ('n1', 'basic', ?, '', ?, ?)").run(
    JSON.stringify({ front: 'Q', back: 'A' }),
    T0,
    T0
  )
  d.prepare(
    "INSERT INTO card(id, note_id, deck_id, ord, state, due, created_at, updated_at, meta_at) VALUES ('c1', 'n1', 'deck1', 0, 0, ?, ?, ?, ?)"
  ).run(T0, T0, T0, T0)
}

function addReview(d: Database.Database, id: string, at: number, rating: number): void {
  d.prepare(
    "INSERT INTO review(id, card_id, reviewed_at, rating, duration_ms, state_before, was_new, prev_state) VALUES (?, 'c1', ?, ?, 1000, '{}', 0, 0)"
  ).run(id, at, rating)
}

const snap = (d: Database.Database, id: string): ReturnType<typeof buildSnapshot> => buildSnapshot(d, id, id, [])

describe('fusion de deux appareils', () => {
  it('additionne les révisions et recalcule la carte', () => {
    const a = newDb()
    const b = newDb()
    seed(a)
    seed(b)
    addReview(a, 'ra1', T0 + 1000, 3)
    addReview(a, 'ra2', T0 + 86_400_000, 3)
    addReview(b, 'rb1', T0 + 2000, 1)

    mergeSnapshot(a, snap(b, 'B'), 0.9)
    mergeSnapshot(b, snap(a, 'A'), 0.9)

    const count = (d: Database.Database): number => (d.prepare('SELECT COUNT(*) n FROM review').get() as { n: number }).n
    expect(count(a)).toBe(3)
    expect(count(b)).toBe(3)
    // Même historique => même état d'ordonnancement sur les deux PC.
    const state = (d: Database.Database): unknown => d.prepare('SELECT state, due, stability, difficulty, reps, lapses FROM card WHERE id = ?').get('c1')
    expect(state(a)).toEqual(state(b))
    expect((state(a) as { reps: number }).reps).toBe(3)
  })

  it('est idempotente', () => {
    const a = newDb()
    const b = newDb()
    seed(a)
    seed(b)
    addReview(b, 'rb1', T0 + 2000, 3)
    const first = mergeSnapshot(a, snap(b, 'B'), 0.9)
    const second = mergeSnapshot(a, snap(b, 'B'), 0.9)
    expect(first.newReviews).toBe(1)
    expect(second.newReviews).toBe(0)
    expect(second.recomputed).toBe(0)
  })

  it('garde le dernier changement d’une note et archive l’ancienne version', () => {
    const a = newDb()
    const b = newDb()
    seed(a)
    seed(b)
    b.prepare("UPDATE note SET fields = ?, updated_at = ? WHERE id = 'n1'").run(JSON.stringify({ front: 'Q2', back: 'A2' }), T0 + 5000)
    mergeSnapshot(a, snap(b, 'B'), 0.9)
    expect(JSON.parse((a.prepare("SELECT fields FROM note WHERE id = 'n1'").get() as { fields: string }).fields).front).toBe('Q2')
    expect((a.prepare('SELECT COUNT(*) n FROM note_history').get() as { n: number }).n).toBe(1)
    // Un changement plus ancien ne l'emporte pas.
    const c = newDb()
    seed(c)
    c.prepare("UPDATE note SET fields = ?, updated_at = ? WHERE id = 'n1'").run(JSON.stringify({ front: 'old', back: 'old' }), T0 + 10)
    mergeSnapshot(a, snap(c, 'C'), 0.9)
    expect(JSON.parse((a.prepare("SELECT fields FROM note WHERE id = 'n1'").get() as { fields: string }).fields).front).toBe('Q2')
  })

  it('propage les suppressions douces et crée les notes nouvelles', () => {
    const a = newDb()
    const b = newDb()
    seed(a)
    seed(b)
    b.prepare("UPDATE note SET deleted_at = ?, updated_at = ? WHERE id = 'n1'").run(T0 + 100, T0 + 100)
    b.prepare("UPDATE card SET deleted_at = ?, meta_at = ? WHERE id = 'c1'").run(T0 + 100, T0 + 100)
    b.prepare("INSERT INTO note(id, kind, fields, tags, created_at, updated_at) VALUES ('n2', 'basic', ?, ' x ', ?, ?)").run(JSON.stringify({ front: 'Nouveau', back: 'Oui' }), T0 + 200, T0 + 200)
    b.prepare("INSERT INTO card(id, note_id, deck_id, ord, state, due, created_at, updated_at, meta_at) VALUES ('c2', 'n2', 'deck1', 0, 0, ?, ?, ?, ?)").run(T0, T0 + 200, T0 + 200, T0 + 200)
    const st = mergeSnapshot(a, snap(b, 'B'), 0.9)
    expect(st.newNotes).toBe(1)
    expect((a.prepare("SELECT deleted_at FROM note WHERE id = 'n1'").get() as { deleted_at: number }).deleted_at).toBe(T0 + 100)
    expect((a.prepare("SELECT COUNT(*) n FROM note_fts WHERE note_fts MATCH 'Nouveau'").get() as { n: number }).n).toBe(1)
  })

  it('un déplacement de carte n’est pas écrasé par une simple révision plus récente ailleurs', () => {
    const a = newDb()
    const b = newDb()
    seed(a)
    seed(b)
    a.prepare("INSERT INTO deck(id, name, created_at, updated_at) VALUES ('deck2', 'Autre', ?, ?)").run(T0, T0)
    a.prepare("UPDATE card SET deck_id = 'deck2', meta_at = ?, updated_at = ? WHERE id = 'c1'").run(T0 + 100, T0 + 100)
    // B révise la carte plus tard (updated_at plus récent) mais ne la déplace pas.
    addReview(b, 'rb1', T0 + 9000, 3)
    b.prepare("UPDATE card SET updated_at = ? WHERE id = 'c1'").run(T0 + 9000)
    mergeSnapshot(a, snap(b, 'B'), 0.9)
    expect((a.prepare("SELECT deck_id FROM card WHERE id = 'c1'").get() as { deck_id: string }).deck_id).toBe('deck2')
  })
})

describe('chiffrement et dossier partagé', () => {
  it('chiffre, déchiffre et refuse une mauvaise clé', () => {
    const k1 = deriveKey('phrase-secrete-1', Buffer.from('0123456789abcdef'))
    const k2 = deriveKey('autre-phrase', Buffer.from('0123456789abcdef'))
    const blob = encrypt(k1, Buffer.from('bonjour'))
    expect(decrypt(k1, blob).toString()).toBe('bonjour')
    expect(() => decrypt(k2, blob)).toThrow()
    expect(blob.includes(Buffer.from('bonjour'))).toBe(false)
  })

  it('refuse une mauvaise phrase de récupération pour un dossier existant', () => {
    const folder = mkdtempSync(join(tmpdir(), 'mnemo-sync-'))
    setupFolder(folder, 'ma-phrase-longue')
    expect(() => setupFolder(folder, 'mauvaise-phrase')).toThrow(/incorrecte/)
    expect(() => setupFolder(folder, 'ma-phrase-longue')).not.toThrow()
  })

  it('deux PC se synchronisent via le dossier (aller-retour complet)', () => {
    const folder = mkdtempSync(join(tmpdir(), 'mnemo-sync-'))
    const key = setupFolder(folder, 'ma-phrase-longue')
    const mediaA = mkdtempSync(join(tmpdir(), 'mnemo-mediaA-'))
    const mediaB = mkdtempSync(join(tmpdir(), 'mnemo-mediaB-'))
    const a = newDb()
    const b = newDb()
    seed(a)
    const ctx = (db: Database.Database, id: string, mediaDir: string): Parameters<typeof runSync>[0] => ({
      db, folder, key, deviceId: id, deviceName: id, mediaDir, retention: 0.9
    })
    // A écrit son instantané, B le lit et récupère la note.
    runSync(ctx(a, 'dev-a', mediaA))
    const r1 = runSync(ctx(b, 'dev-b', mediaB))
    expect(r1.newNotes).toBe(1)
    // B révise hors ligne, puis tout le monde se resynchronise.
    addReview(b, 'rb1', T0 + 4000, 3)
    runSync(ctx(b, 'dev-b', mediaB))
    const r2 = runSync(ctx(a, 'dev-a', mediaA))
    expect(r2.newReviews).toBe(1)
    expect((a.prepare('SELECT reps FROM card WHERE id = ?').get('c1') as { reps: number }).reps).toBe(1)
    expect(readdirSync(join(folder, 'mnemo-sync')).filter((f) => f.endsWith('.mnemo')).sort()).toEqual(['dev-a.mnemo', 'dev-b.mnemo'])
    mkdirSync(mediaA, { recursive: true })
  })
})
