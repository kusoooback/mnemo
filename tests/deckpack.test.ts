import { createHash } from 'crypto'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

beforeEach(async () => {
  const { closeDb, openDb } = await import('../src/main/db')
  closeDb()
  userData = mkdtempSync(join(tmpdir(), 'mnemo-pack-'))
  openDb()
})

async function seed(): Promise<{ deckId: string; url: string }> {
  const repo = await import('../src/main/repo')
  const { saveImage } = await import('../src/main/data')
  const url = saveImage(PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) as ArrayBuffer, 'image/png')
  const deckId = repo.createDeck('Python::Boucles', null)
  const root = repo.createDeck('Python', null)
  repo.addNote({ kind: 'basic', deckId, fields: { front: 'Que fait range(3) ?', back: `0, 1, 2 ![](${url})` }, tags: ['python', 'bases'] })
  repo.addNote({ kind: 'cloze', deckId: root, fields: { text: 'Une liste se déclare avec des {{c1::crochets}}.', extra: '' }, tags: [] })
  return { deckId: root, url }
}

describe('Paquets partageables (.mnemodeck)', () => {
  it('exporte un deck avec ses sous-decks, ses étiquettes et ses images, puis le relit à l’identique', async () => {
    const { deckId, url } = await seed()
    const { buildPack, readPack } = await import('../src/main/deckpack')
    const { buf, pack } = buildPack(deckId, { name: 'Python', author: 'Moi' })
    expect(buf.subarray(0, 6).toString('latin1')).toBe('MNDK1\n')
    expect(pack.notes).toHaveLength(2)
    expect(pack.notes.map((n) => n.deck).sort()).toEqual(['', 'Boucles'])
    expect(Object.keys(pack.media)).toEqual([url.replace('mnemo-media://', '')])
    const back = readPack(buf)
    expect(back.name).toBe('Python')
    expect(back.notes.find((n) => n.kind === 'basic')?.tags).toEqual(['python', 'bases'])
    expect(Object.keys(back.media)).toHaveLength(1)
  })

  it('n’emporte aucun historique de révision ni réglage', async () => {
    const { deckId } = await seed()
    const { buildPack } = await import('../src/main/deckpack')
    const json = JSON.stringify(buildPack(deckId).pack)
    for (const k of ['stability', 'reviewed_at', 'due', 'settings', 'apiKey']) expect(json).not.toContain(k)
  })

  it('s’installe dans un nouveau deck racine, ignore les doublons et recopie les images', async () => {
    const { deckId } = await seed()
    const { buildPack, installPack, previewPack, readPack } = await import('../src/main/deckpack')
    const repo = await import('../src/main/repo')
    const pack = readPack(buildPack(deckId).buf)

    // Importé dans la même base : tout est déjà là.
    expect(previewPack(pack).duplicates).toBe(2)
    expect(installPack(pack, 'Python (copie)')).toMatchObject({ added: 0, duplicates: 2 })

    // Importé dans une base vide.
    const { closeDb, openDb } = await import('../src/main/db')
    closeDb()
    userData = mkdtempSync(join(tmpdir(), 'mnemo-pack2-'))
    openDb()
    expect(previewPack(pack).duplicates).toBe(0)
    const r = installPack(pack, 'Reçu')
    expect(r).toMatchObject({ added: 2, duplicates: 0, skipped: 0, deck: 'Reçu' })
    const names = repo.listDecks().map((d) => d.fullName).sort()
    expect(names).toEqual(['Reçu', 'Reçu::Boucles'])
    const hash = createHash('sha256').update(PNG).digest('hex')
    const { mediaDir } = await import('../src/main/db')
    expect(existsSync(join(mediaDir(), `${hash}.png`))).toBe(true)
    // Une seconde installation ne crée rien de plus.
    expect(installPack(pack, 'Reçu')).toMatchObject({ added: 0, duplicates: 2 })
  })

  it('refuse un fichier qui n’est pas un paquet, ou corrompu', async () => {
    const { readPack } = await import('../src/main/deckpack')
    expect(() => readPack(Buffer.from('coucou'))).toThrow(/pas un paquet/)
    expect(() => readPack(Buffer.concat([Buffer.from('MNDK1\n'), Buffer.from('pas du gzip')]))).toThrow(/illisible/)
    const bad = (o: unknown): Buffer => Buffer.concat([Buffer.from('MNDK1\n'), gzipSync(Buffer.from(JSON.stringify(o)))])
    expect(() => readPack(bad({ format: 2, app: 'mnemo', notes: [] }))).toThrow(/version/)
    expect(() => readPack(bad({ format: 1, app: 'mnemo', notes: [] }))).toThrow(/vide/)
  })

  it('élimine les cartes invalides et les images truquées d’un paquet hostile', async () => {
    const { readPack } = await import('../src/main/deckpack')
    const goodName = `${createHash('sha256').update(PNG).digest('hex')}.png`
    const evil = Buffer.from('<script>alert(1)</script>')
    const pack = {
      format: 1,
      app: 'mnemo',
      name: 'x',
      notes: [
        { kind: 'basic', fields: { front: 'ok', back: 'ok' }, tags: ['a'], deck: '' },
        { kind: 'hack', fields: { front: 'a' }, tags: [], deck: '' },
        { kind: 'basic', fields: { 'a/../b': 'x' }, tags: [], deck: '' },
        { kind: 'basic', fields: { front: 5 }, tags: [], deck: '' },
        { kind: 'basic', fields: { front: 'trop long'.repeat(10_000) }, tags: [], deck: '' }
      ],
      media: {
        [goodName]: PNG.toString('base64'),
        '../../evil.png': PNG.toString('base64'),
        [`${'a'.repeat(64)}.png`]: PNG.toString('base64'), // empreinte qui ne correspond pas
        [`${createHash('sha256').update(evil).digest('hex')}.png`]: evil.toString('base64'), // pas une image
        [`${'b'.repeat(64)}.svg`]: evil.toString('base64') // svg refusé
      }
    }
    const r = readPack(Buffer.concat([Buffer.from('MNDK1\n'), gzipSync(Buffer.from(JSON.stringify(pack)))]))
    expect(r.notes).toHaveLength(1)
    expect(Object.keys(r.media)).toEqual([goodName])
  })
})
