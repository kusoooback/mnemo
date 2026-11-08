/** Occlusion d'image : une image, des zones (fractions de 0 à 1) ; chaque zone est une carte. Fonctions pures. */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const IMG_OK = /^mnemo-media:\/\/[a-f0-9]{64}\.(png|jpe?g|gif|webp|svg)$/
const clamp = (n: number): number => Math.min(1, Math.max(0, n))

export function parseBoxes(raw: string | undefined): Box[] {
  try {
    const v = JSON.parse(raw || '[]')
    if (!Array.isArray(v)) return []
    return v
      .map((b) => ({ x: clamp(Number(b?.x)), y: clamp(Number(b?.y)), w: clamp(Number(b?.w)), h: clamp(Number(b?.h)) }))
      .filter((b) => Number.isFinite(b.x + b.y + b.w + b.h) && b.w > 0.005 && b.h > 0.005)
  } catch {
    return []
  }
}

/** Nombre de cartes d'une note d'occlusion (même règle côté principal : une carte par zone, numérotées à partir de 1). */
export const boxCount = (raw: string | undefined): number => parseBoxes(raw).length

const pct = (n: number): string => `${(n * 100).toFixed(3)}%`

function html(fields: Record<string, string>, ord: number, reveal: boolean): string {
  const image = fields.image ?? ''
  if (!IMG_OK.test(image)) return '<span class="faint">…</span>'
  const boxes = parseBoxes(fields.boxes)
    .map((b, i) => {
      const active = i + 1 === ord
      const cls = active ? (reveal ? 'occ-box open' : 'occ-box active') : 'occ-box'
      return `<span class="${cls}" style="left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}"></span>`
    })
    .join('')
  return `<div class="occ"><img src="${image}" alt="" draggable="false">${boxes}</div>`
}

/** Toutes les zones sont masquées, celle à retrouver est mise en évidence ; au verso elle est dévoilée. */
export const occlusionFront = (fields: Record<string, string>, ord: number): string => html(fields, ord, false)
export const occlusionBack = (fields: Record<string, string>, ord: number): string => html(fields, ord, true)
