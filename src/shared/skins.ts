/**
 * Thèmes colorés. Chaque thème choisit un mode de base (clair ou sombre, qui règle le reste : ombres, code, etc.)
 * puis remplace les surfaces, les textes et l'accent. La barre latérale n'est jamais redéfinie : elle suit toujours `--bg`.
 */
export interface Skin {
  id: string
  name: { fr: string; en: string }
  base: 'light' | 'dark'
  bg: string
  surface: string
  surface2: string
  surface3: string
  text: string
  text2: string
  muted: string
  faint: string
  accent: string
  accentHover: string
  /** Accent lisible comme texte sur le fond. */
  accentInk: string
  /** Texte posé sur un bouton d'accent. */
  onAccent: string
}

const DARK_ON = '#14110d'

export const SKINS: Skin[] = [
  // — clairs —
  { id: 'sepia', name: { fr: 'Sépia', en: 'Sepia' }, base: 'light', bg: '#f3ead7', surface: '#fbf5e6', surface2: '#ece2cc', surface3: '#e0d4b8', text: '#3b2f22', text2: '#55452f', muted: '#76674d', faint: '#b0a285', accent: '#a4552b', accentHover: '#8f4824', accentInk: '#9a4e26', onAccent: '#ffffff' },
  { id: 'sauge', name: { fr: 'Sauge', en: 'Sage' }, base: 'light', bg: '#eff1ea', surface: '#fbfcf8', surface2: '#e6e9df', surface3: '#d8dccf', text: '#1f261c', text2: '#364132', muted: '#6c7664', faint: '#a0a898', accent: '#4f7a45', accentHover: '#43693a', accentInk: '#44703b', onAccent: '#ffffff' },
  { id: 'rose', name: { fr: 'Rose poudré', en: 'Blush' }, base: 'light', bg: '#f9eff0', surface: '#fffafa', surface2: '#f2e4e6', surface3: '#e6d3d6', text: '#2a1a1e', text2: '#4a3237', muted: '#85686f', faint: '#b59ea3', accent: '#b5405f', accentHover: '#9f3652', accentInk: '#a53856', onAccent: '#ffffff' },
  { id: 'lavande', name: { fr: 'Lavande', en: 'Lavender' }, base: 'light', bg: '#f2eff7', surface: '#fcfbfe', surface2: '#e9e5f1', surface3: '#dbd5e8', text: '#1f1a2b', text2: '#3a3350', muted: '#756e8b', faint: '#a8a2bb', accent: '#7a54b0', accentHover: '#6a4799', accentInk: '#6c479f', onAccent: '#ffffff' },
  { id: 'abricot', name: { fr: 'Abricot', en: 'Apricot' }, base: 'light', bg: '#fbf0e6', surface: '#fffaf5', surface2: '#f4e5d6', surface3: '#e8d3be', text: '#2b1d12', text2: '#4b3626', muted: '#876e5b', faint: '#b8a291', accent: '#c25a17', accentHover: '#a94d12', accentInk: '#a94d12', onAccent: '#ffffff' },
  // — sombres —
  { id: 'oled', name: { fr: 'Noir pur', en: 'Pure black' }, base: 'dark', bg: '#000000', surface: '#0d0d0d', surface2: '#080808', surface3: '#1a1a1a', text: '#f2f2f0', text2: '#bdbcb4', muted: '#8f8e87', faint: '#5f5e59', accent: '#d97757', accentHover: '#e48a6c', accentInk: '#e8896a', onAccent: DARK_ON },
  { id: 'graphite', name: { fr: 'Graphite', en: 'Graphite' }, base: 'dark', bg: '#242424', surface: '#2e2e2e', surface2: '#292929', surface3: '#3a3a3a', text: '#f4f4f2', text2: '#cfcfc9', muted: '#a09f98', faint: '#75746e', accent: '#e0805f', accentHover: '#ea9374', accentInk: '#ec9677', onAccent: DARK_ON },
  { id: 'cafe', name: { fr: 'Café', en: 'Coffee' }, base: 'dark', bg: '#1a1411', surface: '#251d18', surface2: '#1f1814', surface3: '#31271f', text: '#f5ece3', text2: '#d3c4b4', muted: '#a08f7d', faint: '#75685a', accent: '#d4935a', accentHover: '#e2a56e', accentInk: '#e6a870', onAccent: DARK_ON },
  { id: 'foret', name: { fr: 'Forêt', en: 'Forest' }, base: 'dark', bg: '#121612', surface: '#1b221b', surface2: '#161b16', surface3: '#263026', text: '#eef3ec', text2: '#c2cdbe', muted: '#8f9c8b', faint: '#647060', accent: '#7fb069', accentHover: '#92c27c', accentInk: '#93c47d', onAccent: DARK_ON },
  { id: 'prune', name: { fr: 'Prune', en: 'Plum' }, base: 'dark', bg: '#181218', surface: '#221a22', surface2: '#1d151d', surface3: '#2f242f', text: '#f6eef6', text2: '#d2c3d2', muted: '#a08fa0', faint: '#756775', accent: '#c77dba', accentHover: '#d690ca', accentInk: '#d894cc', onAccent: DARK_ON },
  { id: 'bordeaux', name: { fr: 'Bordeaux', en: 'Burgundy' }, base: 'dark', bg: '#1a1112', surface: '#251819', surface2: '#1f1415', surface3: '#322123', text: '#f7eded', text2: '#d6c2c3', muted: '#a58d8f', faint: '#7a6567', accent: '#e0707a', accentHover: '#ea858d', accentInk: '#ec8891', onAccent: DARK_ON },
  { id: 'ambre', name: { fr: 'Ambre', en: 'Amber' }, base: 'dark', bg: '#16140e', surface: '#201d14', surface2: '#1b1912', surface3: '#2c281b', text: '#f6f1e3', text2: '#d4ccb2', muted: '#a39b83', faint: '#787259', accent: '#e0a526', accentHover: '#ecb544', accentInk: '#eab23c', onAccent: '#1a1405' },
  { id: 'terminal', name: { fr: 'Terminal', en: 'Terminal' }, base: 'dark', bg: '#0a0e0a', surface: '#121812', surface2: '#0e130e', surface3: '#1b241b', text: '#d6f5d6', text2: '#a9d6a9', muted: '#78a078', faint: '#4f704f', accent: '#4ade80', accentHover: '#6ee79a', accentInk: '#5be58f', onAccent: '#04120a' }
]

export function skinById(id: string | undefined): Skin | undefined {
  if (!id) return undefined
  const c = parseCustomSkin(id)
  return c ? customSkin(c.bg, c.text, c.accent) : SKINS.find((s) => s.id === id)
}

/* ---------- Couleur d'accent personnalisée (au choix, sur n'importe quel thème) ---------- */

const hex = (c: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim())
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number] : null
}
const toHex = (rgb: number[]): string => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v * (1 - t) + b[i] * t)

export function luminance(color: string): number {
  const rgb = hex(color)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** À partir d'une seule couleur choisie : survol, texte lisible sur fond et texte posé sur le bouton. */
export function accentFrom(color: string, base: 'light' | 'dark'): Pick<Skin, 'accent' | 'accentHover' | 'accentInk' | 'onAccent'> | null {
  const rgb = hex(color)
  if (!rgb) return null
  const white = [255, 255, 255]
  const black = [0, 0, 0]
  const accent = toHex(rgb)
  return {
    accent,
    accentHover: toHex(mix(rgb, base === 'dark' ? white : black, 0.14)),
    accentInk: toHex(mix(rgb, base === 'dark' ? white : black, base === 'dark' ? 0.22 : 0.12)),
    onAccent: contrast(accent, '#ffffff') >= contrast(accent, '#14110d') ? '#ffffff' : '#14110d'
  }
}

/* ---------- Thème sur mesure : trois couleurs au choix, le reste en est déduit ---------- */

const CUSTOM_RE = /^custom:([0-9a-f]{6}):([0-9a-f]{6}):([0-9a-f]{6})$/

/** « custom:fond:texte:accent » (hexadécimal sans #) : c'est à la fois l'identifiant enregistré et le code qu'on partage. */
export const customSkinId = (bg: string, text: string, accent: string): string => `custom:${[bg, text, accent].map((c) => c.replace('#', '').toLowerCase()).join(':')}`

export function parseCustomSkin(id: string): { bg: string; text: string; accent: string } | null {
  const m = CUSTOM_RE.exec(id.trim().toLowerCase())
  return m ? { bg: `#${m[1]}`, text: `#${m[2]}`, accent: `#${m[3]}` } : null
}

/**
 * Déduit un thème complet de trois couleurs. Le texte est corrigé s'il manque de contraste avec le fond (on ne livre pas
 * un thème illisible), et les gris (texte discret, accent en texte) sont rapprochés du texte jusqu'à rester lisibles.
 */
export function customSkin(bgIn: string, textIn: string, accentIn: string): Skin {
  const bg = toHex(hex(bgIn) ?? [249, 249, 247])
  const dark = luminance(bg) < 0.36
  const base = dark ? 'dark' : 'light'
  const text0 = toHex(hex(textIn) ?? (dark ? [244, 244, 242] : [27, 27, 27]))
  const text = contrast(text0, bg) >= 9 ? text0 : dark ? '#f4f4f2' : '#1b1b1b'
  const rgb = (c: string): number[] => hex(c) ?? [0, 0, 0]
  const mixHex = (a: string, b: string, t: number): string => toHex(mix(rgb(a), rgb(b), t))
  const surfaces = dark
    ? { surface: mixHex(bg, '#ffffff', 0.06), surface2: mixHex(bg, '#ffffff', 0.03), surface3: mixHex(bg, '#ffffff', 0.12) }
    : { surface: mixHex(bg, '#ffffff', 0.6), surface2: mixHex(bg, text, 0.05), surface3: mixHex(bg, text, 0.1) }
  let muted = mixHex(text, bg, 0.45)
  for (let t = 0.4; contrast(muted, bg) < 4.5 && t >= 0; t -= 0.05) muted = mixHex(text, bg, t)
  const a = accentFrom(accentIn, base) ?? accentFrom('#c6613f', base)!
  let ink = a.accentInk
  for (const t of [0.15, 0.3, 0.45, 0.6, 0.8]) {
    if (contrast(ink, bg) >= 3.5) break
    ink = mixHex(a.accent, text, t)
  }
  return {
    id: customSkinId(bg, text0, a.accent),
    name: { fr: 'Mon thème', en: 'My theme' },
    base,
    bg,
    ...surfaces,
    text,
    text2: mixHex(text, bg, 0.2),
    muted,
    faint: mixHex(text, bg, 0.65),
    accent: a.accent,
    accentHover: a.accentHover,
    accentInk: ink,
    onAccent: a.onAccent
  }
}
