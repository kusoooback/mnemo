import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, dialog: {}, BrowserWindow: class {}, safeStorage: { isEncryptionAvailable: () => false } }))

const root = join(__dirname, '..', 'community')

describe('Catalogue communautaire', () => {
  it('index.json est valide et chaque paquet correspond à son empreinte', async () => {
    const { parseCatalog } = await import('../src/main/share')
    const { readPack } = await import('../src/main/deckpack')
    const raw = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))
    const list = parseCatalog(raw)
    expect(list.length).toBe(raw.packs.length)
    expect(list.length).toBeGreaterThan(0)
    for (const p of list) {
      const buf = readFileSync(join(root, 'packs', `${p.id}.mnemodeck`))
      expect(createHash('sha256').update(buf).digest('hex')).toBe(p.sha256)
      const pack = readPack(buf)
      expect(pack.notes.length).toBe(p.notes)
    }
    // Aucun paquet orphelin qui ne serait pas dans le catalogue.
    const files = readdirSync(join(root, 'packs')).filter((f) => f.endsWith('.mnemodeck'))
    expect(files.sort()).toEqual(list.map((p) => `${p.id}.mnemodeck`).sort())
  })

  it('les paquets publiés correspondent à leurs sources (node scripts/build-pack.mjs --check)', () => {
    const out = execFileSync(process.execPath, [join(__dirname, '..', 'scripts', 'build-pack.mjs'), '--check'], { encoding: 'utf8' })
    expect(out).toContain('Catalogue cohérent')
  })

  it('ignore les entrées malformées ou dangereuses d’un catalogue reçu', async () => {
    const { parseCatalog } = await import('../src/main/share')
    const sha = 'a'.repeat(64)
    const r = parseCatalog({
      packs: [
        { id: 'ok-pack', title: 'Bon', sha256: sha, notes: 3.9, lang: 'en', tags: ['a', 5] },
        { id: '../evil', title: 'x', sha256: sha },
        { id: 'sans-empreinte', title: 'x' },
        { id: 'ok-pack', title: 'doublon', sha256: sha },
        { id: 'empreinte-courte', title: 'x', sha256: 'abc' },
        null
      ]
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'ok-pack', notes: 3, lang: 'en', tags: ['a'] })
    expect(parseCatalog('nimportequoi')).toEqual([])
    expect(parseCatalog({ packs: 'x' })).toEqual([])
  })
})
