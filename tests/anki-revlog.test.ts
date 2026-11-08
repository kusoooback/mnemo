import Database from 'better-sqlite3'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const tmp = (): string => mkdtempSync(join(tmpdir(), 'mnemo-revlog-'))

beforeEach(async () => {
  const { closeDb, openDb } = await import('../src/main/db')
  closeDb()
  userData = tmp()
  openDb()
})

/** Retour d'un testeur sur Mac : deux révisions dans la même milliseconde faisaient échouer l'export (clé primaire). */
describe('Export Anki : identifiants de révision uniques', () => {
  it('décale de 1 ms les révisions tombées dans la même milliseconde, sans erreur', async () => {
    const { createSample } = await import('../src/main/data')
    const { buildApkg } = await import('../src/main/anki')
    const study = await import('../src/main/study')
    const { getDb } = await import('../src/main/db')
    createSample()
    for (let i = 0; i < 4; i++) study.answer(study.next(null)!.cardId, 3, 1000)
    // Toutes les révisions à la même milliseconde, sur des cartes différentes.
    getDb().prepare('UPDATE review SET reviewed_at = 1760000000000').run()
    const apkg = buildApkg(null)
    expect(apkg.cards).toBeGreaterThan(0)

    const files = unzipSync(new Uint8Array(apkg.data))
    const dbFile = join(tmp(), 'c.anki2')
    writeFileSync(dbFile, files['collection.anki2'])
    const anki = new Database(dbFile, { readonly: true })
    const ids = (anki.prepare('SELECT id FROM revlog ORDER BY id').all() as { id: number }[]).map((r) => r.id)
    anki.close()
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    expect(ids).toEqual([1760000000000, 1760000000001, 1760000000002, 1760000000003])
  })

  it('se réimporte (même plusieurs fois) sans perdre ni dupliquer de révision', async () => {
    const { createSample } = await import('../src/main/data')
    const { buildApkg, importApkg } = await import('../src/main/anki')
    const study = await import('../src/main/study')
    const { closeDb, openDb, getDb } = await import('../src/main/db')
    createSample()
    for (let i = 0; i < 3; i++) study.answer(study.next(null)!.cardId, 3, 1000)
    getDb().prepare('UPDATE review SET reviewed_at = 1760000000000').run()
    const apkg = buildApkg(null)

    closeDb()
    userData = tmp()
    openDb()
    expect(importApkg(apkg.data).reviews).toBe(3)
    expect(importApkg(apkg.data).reviews).toBe(0)
    expect((getDb().prepare('SELECT COUNT(*) n FROM review').get() as { n: number }).n).toBe(3)
  })

  it('exporte sans planter même quand toutes les révisions sont presque simultanées (test aléatoire)', async () => {
    const { createSample } = await import('../src/main/data')
    const { buildApkg } = await import('../src/main/anki')
    const study = await import('../src/main/study')
    createSample()
    for (let i = 0; i < 6; i++) study.answer(study.next(null)!.cardId, (1 + (i % 4)) as 1 | 2 | 3 | 4, 500)
    expect(() => buildApkg(null)).not.toThrow()
  })
})
