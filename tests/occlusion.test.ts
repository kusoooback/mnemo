import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { paintBoxes } from '../src/main/occlusion'
import { boxCount, occlusionBack, occlusionFront, parseBoxes } from '../src/renderer/src/lib/occlusion'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  shell: { openPath: async () => '' },
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const IMG = `mnemo-media://${'a'.repeat(64)}.png`
const BOXES = JSON.stringify([
  { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
  { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }
])

describe('Occlusion d’image : rendu', () => {
  it('lit les zones et ignore les valeurs absurdes', () => {
    expect(boxCount(BOXES)).toBe(2)
    expect(parseBoxes('pas du json')).toEqual([])
    expect(parseBoxes('{"x":1}')).toEqual([])
    expect(parseBoxes(JSON.stringify([{ x: 0.1, y: 0.1, w: 0, h: 0.5 }, { x: 2, y: -1, w: 0.5, h: 0.5 }]))).toEqual([{ x: 1, y: 0, w: 0.5, h: 0.5 }])
  })

  it('recto : toutes les zones masquées, celle de la carte mise en évidence', () => {
    const html = occlusionFront({ image: IMG, boxes: BOXES }, 2)
    expect(html).toContain(IMG)
    expect((html.match(/occ-box/g) ?? []).length).toBe(2)
    expect((html.match(/occ-box active/g) ?? []).length).toBe(1)
    expect(html).not.toContain('occ-box open')
  })

  it('verso : la zone de la carte est dévoilée, les autres restent masquées', () => {
    const html = occlusionBack({ image: IMG, boxes: BOXES }, 1)
    expect((html.match(/occ-box open/g) ?? []).length).toBe(1)
    expect((html.match(/class="occ-box"/g) ?? []).length).toBe(1)
  })

  it('refuse une adresse d’image qui n’est pas un média de l’application', () => {
    const html = occlusionFront({ image: 'https://exemple.fr/x.png" onerror="alert(1)', boxes: BOXES }, 1)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror')
  })
})

describe('Occlusion d’image : cartes', () => {
  beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), 'mnemo-occ-'))
    const { openDb } = await import('../src/main/db')
    openDb()
  })

  it('crée une carte par zone, retrouve la note et ne pollue pas la recherche', async () => {
    const { addNote, createDeck, getNote, updateNote } = await import('../src/main/repo')
    const { getDb } = await import('../src/main/db')
    const deck = createDeck('Biologie::Schémas', null)
    const id = addNote({ kind: 'occlusion', deckId: deck, fields: { image: IMG, boxes: BOXES, extra: 'Cellule animale' }, tags: [] })
    expect(getNote(id)?.cards.map((c) => c.ord)).toEqual([1, 2])
    const fts = getDb().prepare('SELECT content FROM note_fts WHERE note_id = ?').get(id) as { content: string }
    expect(fts.content).toBe('Cellule animale')

    // Une troisième zone ajoute une carte ; en retirer une jamais révisée la supprime.
    updateNote(id, { kind: 'occlusion', fields: { image: IMG, boxes: JSON.stringify([...parseBoxes(BOXES), { x: 0, y: 0, w: 0.1, h: 0.1 }]), extra: '' }, tags: [] })
    expect(getNote(id)?.cards.length).toBe(3)
    updateNote(id, { kind: 'occlusion', fields: { image: IMG, boxes: BOXES, extra: '' }, tags: [] })
    expect(getNote(id)?.cards.length).toBe(2)
  })

  it('refuse une note sans aucune zone', async () => {
    const { addNote, createDeck } = await import('../src/main/repo')
    const deck = createDeck('Vide', null)
    expect(() => addNote({ kind: 'occlusion', deckId: deck, fields: { image: IMG, boxes: '[]', extra: '' }, tags: [] })).toThrow(/zone/)
  })
})

describe('Occlusion d’image : peinture pour l’export Anki', () => {
  const W = 40
  const H = 20
  const px = (buf: Uint8Array, x: number, y: number): number[] => [...buf.slice((y * W + x) * 4, (y * W + x) * 4 + 3)]
  const blank = (): Uint8Array => new Uint8Array(W * H * 4).fill(200)
  const boxes = [
    { x: 0, y: 0, w: 0.25, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.25, h: 0.5 }
  ]

  it('recto : les zones sont pleines, celle de la carte est teintée mais laisse voir l’image', () => {
    const buf = blank()
    paintBoxes(buf, W, H, boxes, 2, false)
    expect(px(buf, 3, 4)).toEqual([0x3f, 0x61, 0xc6]) // zone cachée : argile pleine (BGRA)
    const active = px(buf, 25, 15)
    expect(active).not.toEqual([200, 200, 200])
    expect(active[0]).toBeGreaterThan(0x3f) // mélange avec l'image : pas opaque
    expect(px(buf, 35, 2)).toEqual([200, 200, 200]) // hors zones : intact
  })

  it('verso : la zone de la carte est dévoilée (seul son cadre reste), les autres restent masquées', () => {
    const buf = blank()
    paintBoxes(buf, W, H, boxes, 2, true)
    expect(px(buf, 25, 15)).toEqual([200, 200, 200])
    expect(px(buf, 20, 10)).toEqual([0x3f, 0x61, 0xc6]) // cadre de la zone dévoilée
    expect(px(buf, 3, 4)).toEqual([0x3f, 0x61, 0xc6])
  })
})
