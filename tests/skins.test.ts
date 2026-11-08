import { describe, expect, it } from 'vitest'
import { accentFrom, contrast, SKINS, skinById } from '../src/shared/skins'
import { SKIN_VAR_NAMES, skinVars } from '../src/renderer/src/lib/skins'

const rgb = (hex: string): number[] => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16))

describe('Thèmes colorés', () => {
  it('ont des identifiants uniques et des couleurs valides', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length)
    expect(SKINS.length).toBeGreaterThanOrEqual(12)
    for (const s of SKINS) {
      for (const [k, v] of Object.entries(s)) if (typeof v === 'string' && k !== 'id' && k !== 'base') expect(v, `${s.id}.${k}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.name.fr && s.name.en).toBeTruthy()
    }
    expect(skinById('inconnu')).toBeUndefined()
    expect(skinById('')).toBeUndefined()
  })

  it('les thèmes sombres ont des fonds neutres ou chauds, jamais bleutés', () => {
    for (const s of SKINS.filter((x) => x.base === 'dark')) {
      for (const k of ['bg', 'surface', 'surface2', 'surface3'] as const) {
        const [r, g, b] = rgb(s[k])
        expect(b - Math.max(r, g), `${s.id}.${k} ne doit pas tirer vers le bleu`).toBeLessThanOrEqual(3)
      }
    }
  })

  it('le texte reste lisible partout', () => {
    for (const s of SKINS) {
      expect(contrast(s.text, s.bg), `${s.id} texte/fond`).toBeGreaterThanOrEqual(10)
      expect(contrast(s.text, s.surface), `${s.id} texte/carte`).toBeGreaterThanOrEqual(10)
      expect(contrast(s.text2, s.bg), `${s.id} texte 2`).toBeGreaterThanOrEqual(7)
      expect(contrast(s.muted, s.bg), `${s.id} texte discret`).toBeGreaterThanOrEqual(4)
      expect(contrast(s.accentInk, s.bg), `${s.id} accent en texte`).toBeGreaterThanOrEqual(3.5)
      expect(contrast(s.onAccent, s.accent), `${s.id} texte du bouton`).toBeGreaterThanOrEqual(3.8)
    }
  })

  it('ne redéfinissent jamais la barre latérale : elle suit toujours le fond', () => {
    for (const s of SKINS) {
      const vars = skinVars(s, s.base, '#336699')
      expect(Object.keys(vars)).not.toContain('--sidebar')
      expect(vars['--bg']).toBe(s.bg)
    }
    expect(SKIN_VAR_NAMES).not.toContain('--sidebar')
    expect(SKIN_VAR_NAMES).toContain('--bg')
    expect(SKIN_VAR_NAMES).toContain('--accent')
  })

  it('une couleur d’accent seule ne touche ni le fond ni le texte', () => {
    const vars = skinVars(undefined, 'dark', '#22aa66')
    expect(vars['--accent']).toBe('#22aa66')
    expect(vars['--bg']).toBeUndefined()
    expect(vars['--text']).toBeUndefined()
    expect(skinVars(undefined, 'dark', '')).toEqual({})
    expect(skinVars(undefined, 'dark', 'pas une couleur')).toEqual({})
  })

  it('choisit un texte lisible sur n’importe quelle couleur d’accent', () => {
    expect(accentFrom('#ffe14d', 'light')?.onAccent).toBe('#14110d') // jaune : texte sombre
    expect(accentFrom('#1a3d8f', 'light')?.onAccent).toBe('#ffffff') // bleu foncé : texte blanc
    expect(accentFrom('#0a0a0a', 'dark')?.accentInk).not.toBe('#0a0a0a') // sur fond sombre, l'accent texte est éclairci
    expect(accentFrom('zzz', 'light')).toBeNull()
    for (const c of ['#c6613f', '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#808080']) {
      const a = accentFrom(c, 'light')!
      expect(contrast(a.onAccent, a.accent), c).toBeGreaterThanOrEqual(4)
    }
  })
})
