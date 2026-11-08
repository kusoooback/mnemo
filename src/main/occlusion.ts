import { nativeImage } from 'electron'
import { join } from 'path'
import { saveImage } from './data'
import { mediaDir } from './db'

/** Occlusion d'image côté principal : peint les zones sur l'image pour l'export Anki (qui ne connaît pas ce type de carte). */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const ACCENT = [0xc6, 0x61, 0x3f] // argile de la marque
const WHITE = [255, 255, 255]
const IMG_OK = /^mnemo-media:\/\/([a-f0-9]{64}\.(?:png|jpe?g))$/

export function parseBoxes(raw: string | undefined): Box[] {
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v)
      ? v
          .map((b) => ({ x: Number(b?.x), y: Number(b?.y), w: Number(b?.w), h: Number(b?.h) }))
          .filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0.005 && b.h > 0.005)
      : []
  } catch {
    return []
  }
}

/** Peint les zones dans un tampon BGRA : zones cachées pleines, zone active teintée (recto) ou simplement cernée (verso). */
export function paintBoxes(bgra: Uint8Array, width: number, height: number, boxes: Box[], active: number, reveal: boolean): void {
  const put = (i: number, [r, g, b]: number[], alpha: number): void => {
    bgra[i] = Math.round(bgra[i] * (1 - alpha) + b * alpha)
    bgra[i + 1] = Math.round(bgra[i + 1] * (1 - alpha) + g * alpha)
    bgra[i + 2] = Math.round(bgra[i + 2] * (1 - alpha) + r * alpha)
    bgra[i + 3] = 255
  }
  const scale = Math.max(1, Math.round(Math.max(width, height) / 600))
  boxes.forEach((b, k) => {
    const x0 = Math.max(0, Math.round(b.x * width))
    const y0 = Math.max(0, Math.round(b.y * height))
    const x1 = Math.min(width, Math.round((b.x + b.w) * width))
    const y1 = Math.min(height, Math.round((b.y + b.h) * height))
    const isActive = k + 1 === active
    const ring = (isActive ? 3 : 2) * scale
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const edge = x - x0 < ring || x1 - 1 - x < ring || y - y0 < ring || y1 - 1 - y < ring
        const i = (y * width + x) * 4
        if (!isActive) put(i, edge ? WHITE : ACCENT, 1)
        else if (edge) put(i, ACCENT, 1)
        else if (!reveal) put(i, ACCENT, 0.6)
      }
    }
  })
}

/** Image de la carte `ord` (1 = première zone), avec ses zones peintes, rangée dans les médias. Null si l'image n'est pas lisible (PNG/JPEG seulement). */
export function renderOcclusion(fields: Record<string, string>, ord: number, reveal: boolean): string | null {
  const m = IMG_OK.exec(fields.image ?? '')
  if (!m) return null
  try {
    const img = nativeImage.createFromPath(join(mediaDir(), m[1]))
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const bgra = Buffer.from(img.toBitmap())
    paintBoxes(bgra, width, height, parseBoxes(fields.boxes), ord, reveal)
    const png = nativeImage.createFromBitmap(bgra, { width, height }).toPNG()
    return saveImage(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, 'image/png')
  } catch {
    return null
  }
}
