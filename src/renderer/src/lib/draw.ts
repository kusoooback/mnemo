/*
 * Carnet de dessin : le modèle (une liste d'éléments rejouable, donc annuler / rétablir gratuits) et son rendu sur un canvas.
 * Tout reste local : le dessin devient une image PNG rangée comme les autres images des cartes.
 */

export type Pt = [number, number]
export type PathTool = 'pen' | 'marker' | 'eraser'
export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse'
export type Tool = PathTool | ShapeKind | 'text'

export type Item =
  | { t: 'path'; tool: PathTool; color: string; size: number; pts: Pt[] }
  | { t: 'shape'; kind: ShapeKind; color: string; size: number; a: Pt; b: Pt }
  | { t: 'text'; color: string; size: number; at: Pt; text: string }

export type Paper = 'white' | 'cream' | 'slate' | 'grid' | 'lined'

export const CANVAS_W = 1000
export const CANVAS_H = 625
export const PAPERS: { id: Paper; bg: string; line: string }[] = [
  { id: 'white', bg: '#ffffff', line: '' },
  { id: 'cream', bg: '#f6f1e4', line: '' },
  { id: 'slate', bg: '#262b33', line: '' },
  { id: 'grid', bg: '#ffffff', line: '#d6dae3' },
  { id: 'lined', bg: '#fffef8', line: '#c9d6ee' }
]

/** Couleurs proposées d'office (l'utilisateur peut en choisir n'importe quelle autre). */
export const SWATCHES = ['#1b1b1b', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#d6336c', '#868e96', '#ffffff']
export const SIZES = [2, 4, 8, 16, 28]

export const fontSize = (size: number): number => 14 + size * 2

/** Sommets de la pointe d'une flèche qui arrive en `b` depuis `a`. */
export function arrowHead(a: Pt, b: Pt, size: number): [Pt, Pt] {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const len = 10 + size * 2.2
  const at = (d: number): Pt => [b[0] - len * Math.cos(ang + d), b[1] - len * Math.sin(ang + d)]
  return [at(Math.PI / 6), at(-Math.PI / 6)]
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  if (pts.length === 1) {
    ctx.lineTo(pts[0][0] + 0.01, pts[0][1] + 0.01) // un simple clic laisse un point rond
    return
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0], last[1])
}

export function paintItem(ctx: CanvasRenderingContext2D, it: Item): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (it.t === 'path') {
    if (!it.pts.length) {
      ctx.restore()
      return
    }
    ctx.strokeStyle = it.color
    ctx.lineWidth = it.tool === 'marker' ? it.size * 2.4 : it.size
    if (it.tool === 'marker') ctx.globalAlpha = 0.35
    if (it.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out'
    tracePath(ctx, it.pts)
    ctx.stroke()
  } else if (it.t === 'shape') {
    ctx.strokeStyle = it.color
    ctx.lineWidth = it.size
    const [a, b] = [it.a, it.b]
    ctx.beginPath()
    if (it.kind === 'rect') ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    else if (it.kind === 'ellipse') ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2)
    else {
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      if (it.kind === 'arrow') {
        const [h1, h2] = arrowHead(a, b, it.size)
        ctx.moveTo(h1[0], h1[1])
        ctx.lineTo(b[0], b[1])
        ctx.lineTo(h2[0], h2[1])
      }
    }
    ctx.stroke()
  } else {
    ctx.fillStyle = it.color
    ctx.font = `600 ${fontSize(it.size)}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textBaseline = 'top'
    it.text.split('\n').forEach((line, i) => ctx.fillText(line, it.at[0], it.at[1] + i * fontSize(it.size) * 1.2))
  }
  ctx.restore()
}

/** Dessine le fond : couleur du papier, éventuelle image à annoter, puis quadrillage ou lignes. */
export function paintPaper(ctx: CanvasRenderingContext2D, paper: Paper, under: CanvasImageSource | null, w = CANVAS_W, h = CANVAS_H): void {
  const p = PAPERS.find((x) => x.id === paper) ?? PAPERS[0]
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, w, h)
  if (under) {
    const iw = (under as HTMLImageElement).naturalWidth || w
    const ih = (under as HTMLImageElement).naturalHeight || h
    const s = Math.min(w / iw, h / ih)
    ctx.drawImage(under, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s)
  }
  if (p.line && !under) {
    ctx.strokeStyle = p.line
    ctx.lineWidth = 1
    ctx.beginPath()
    const step = 25
    if (paper === 'grid') {
      for (let x = step; x < w; x += step) {
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, h)
      }
    }
    for (let y = step; y < h; y += step) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(w, y + 0.5)
    }
    ctx.stroke()
  }
}

/** Le dessin n'est pas vide ? (évite d'enregistrer une page blanche par erreur) */
export const hasInk = (items: Item[]): boolean => items.some((i) => i.t !== 'path' || (i.tool !== 'eraser' && i.pts.length > 0))
