import { describe, expect, it } from 'vitest'
import { PAPERS, SWATCHES, arrowHead, fontSize, hasInk, paintItem, paintPaper, type Item } from '../src/renderer/src/lib/draw'

/** Un faux contexte 2D qui note ce qu'on lui demande, pour vérifier le rendu sans navigateur. */
function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(
    {},
    {
      get: (_t, k: string) => {
        if (k === 'save' || k === 'restore') return () => log.push(k)
        return (...a: unknown[]) => log.push(`${k}(${a.map((x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x)).join(',')})`)
      },
      set: (_t, k: string, v) => {
        state[k] = v
        log.push(`${k}=${v}`)
        return true
      }
    }
  ) as unknown as CanvasRenderingContext2D
  return { ctx, log }
}

describe('Carnet de dessin : modèle et rendu', () => {
  it('la pointe d’une flèche est symétrique autour de la tige et à l’arrivée', () => {
    const [h1, h2] = arrowHead([0, 0], [100, 0], 4)
    expect(h1[0]).toBeCloseTo(h2[0])
    expect(h1[1]).toBeCloseTo(-h2[1])
    expect(h1[0]).toBeLessThan(100)
    // même chose pour une flèche verticale
    const [v1, v2] = arrowHead([0, 0], [0, 100], 4)
    expect(v1[1]).toBeCloseTo(v2[1])
    expect(v1[0]).toBeCloseTo(-v2[0])
  })

  it('la gomme efface l’encre sans toucher au fond ; le surligneur est translucide', () => {
    const erase = recorder()
    paintItem(erase.ctx, { t: 'path', tool: 'eraser', color: '#000000', size: 8, pts: [[0, 0], [10, 10], [20, 0]] })
    expect(erase.log).toContain('globalCompositeOperation=destination-out')
    const mark = recorder()
    paintItem(mark.ctx, { t: 'path', tool: 'marker', color: '#f08c00', size: 8, pts: [[0, 0], [10, 10]] })
    expect(mark.log).toContain('globalAlpha=0.35')
    expect(mark.log.find((l) => l.startsWith('lineWidth='))).toBe(`lineWidth=${8 * 2.4}`)
  })

  it('un clic laisse un point, un tracé vide ne dessine rien', () => {
    const dot = recorder()
    paintItem(dot.ctx, { t: 'path', tool: 'pen', color: '#000000', size: 4, pts: [[5, 5]] })
    expect(dot.log.some((l) => l.startsWith('lineTo(5.01'))).toBe(true)
    const none = recorder()
    paintItem(none.ctx, { t: 'path', tool: 'pen', color: '#000000', size: 4, pts: [] })
    expect(none.log.filter((l) => l === 'stroke()')).toHaveLength(0)
  })

  it('dessine les formes et le texte avec la couleur choisie', () => {
    const r = recorder()
    paintItem(r.ctx, { t: 'shape', kind: 'rect', color: '#e03131', size: 4, a: [30, 20], b: [10, 50] })
    expect(r.log).toContain('strokeStyle=#e03131')
    expect(r.log).toContain('rect(10,20,20,30)') // coins normalisés même si on tire vers le haut-gauche
    const t = recorder()
    paintItem(t.ctx, { t: 'text', color: '#1971c2', size: 4, at: [3, 4], text: 'a\nb' })
    expect(t.log).toContain('fillStyle=#1971c2')
    expect(t.log.filter((l) => l.startsWith('fillText'))).toEqual(['fillText(a,3,4)', `fillText(b,3,${Math.round((4 + fontSize(4) * 1.2) * 100) / 100})`])
  })

  it('le fond quadrillé trace des lignes, pas le papier uni ni sous une image', () => {
    const grid = recorder()
    paintPaper(grid.ctx, 'grid', null, 100, 100)
    expect(grid.log.filter((l) => l.startsWith('moveTo')).length).toBeGreaterThan(4)
    const plain = recorder()
    paintPaper(plain.ctx, 'cream', null, 100, 100)
    expect(plain.log.filter((l) => l.startsWith('moveTo'))).toHaveLength(0)
    expect(plain.log).toContain('fillStyle=#f6f1e4')
  })

  it('ne considère pas une page vide (ou seulement gommée) comme un dessin', () => {
    const empty: Item[] = [{ t: 'path', tool: 'eraser', color: '#000', size: 4, pts: [[1, 1]] }, { t: 'path', tool: 'pen', color: '#000', size: 4, pts: [] }]
    expect(hasInk(empty)).toBe(false)
    expect(hasInk([...empty, { t: 'text', color: '#000', size: 4, at: [0, 0], text: 'x' }])).toBe(true)
  })

  it('propose des couleurs valides et des fonds uniques', () => {
    for (const c of SWATCHES) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(PAPERS.map((p) => p.id)).size).toBe(PAPERS.length)
  })
})
