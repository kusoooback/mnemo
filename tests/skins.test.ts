import { describe, expect, it } from 'vitest'
import { accentFrom, contrast, customSkin, customSkinId, parseCustomSkin, SKINS, skinById } from '../src/shared/skins'
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

describe('Thème sur mesure', () => {
  const sets: [string, string, string][] = [
    ['#f4efe6', '#2b2b2b', '#c0562b'],
    ['#10151f', '#e8ecf4', '#4da3ff'],
    ['#ffffff', '#000000', '#ffe14d'],
    ['#0b3d2e', '#f3f0e0', '#f2c94c'],
    ['#fdf0f5', '#d8c8cf', '#b5405f'], // texte choisi trop pâle : doit être corrigé
    ['#222222', '#2a2a2a', '#336699'] // texte quasi invisible sur fond sombre
  ]

  it('déduit un thème complet et lisible à partir de trois couleurs', () => {
    for (const [bg, text, accent] of sets) {
      const s = customSkin(bg, text, accent)
      const tag = `${bg}/${text}/${accent}`
      for (const [k, v] of Object.entries(s)) if (typeof v === 'string' && k !== 'id' && k !== 'base') expect(v, `${tag} ${k}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(contrast(s.text, s.bg), `${tag} texte/fond`).toBeGreaterThanOrEqual(9)
      expect(contrast(s.text, s.surface), `${tag} texte/carte`).toBeGreaterThanOrEqual(7)
      expect(contrast(s.text, s.surface3), `${tag} texte/relief`).toBeGreaterThanOrEqual(6)
      expect(contrast(s.muted, s.bg), `${tag} discret`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(s.accentInk, s.bg), `${tag} accent en texte`).toBeGreaterThanOrEqual(3.5)
      expect(contrast(s.onAccent, s.accent), `${tag} bouton`).toBeGreaterThanOrEqual(3.8)
    }
  })

  it('choisit le mode clair ou sombre d’après le fond, et suit la règle de la barre latérale', () => {
    expect(customSkin('#f4efe6', '#2b2b2b', '#c0562b').base).toBe('light')
    expect(customSkin('#10151f', '#e8ecf4', '#4da3ff').base).toBe('dark')
    const vars = skinVars(customSkin('#10151f', '#e8ecf4', '#4da3ff'), 'dark')
    expect(vars['--bg']).toBe('#10151f')
    expect(Object.keys(vars)).not.toContain('--sidebar')
  })

  it('s’identifie par un code partageable, relu à l’identique', () => {
    const id = customSkinId('#F4EFE6', '#2b2b2b', '#C0562B')
    expect(id).toBe('custom:f4efe6:2b2b2b:c0562b')
    expect(parseCustomSkin(id)).toEqual({ bg: '#f4efe6', text: '#2b2b2b', accent: '#c0562b' })
    expect(skinById(id)?.bg).toBe('#f4efe6')
    expect(skinById(id)?.name.fr).toBe('Mon thème')
  })

  it('refuse les codes mal formés ou dangereux', () => {
    for (const bad of ['custom:zzzzzz:000000:000000', 'custom:fff:000:000', 'custom:f4efe6:2b2b2b', 'custom:f4efe6:2b2b2b:c0562b:00', 'custom:f4efe6:2b2b2b:c0562b;}body{display:none', '<script>', 'sepia2']) {
      expect(parseCustomSkin(bad), bad).toBeNull()
      expect(skinById(bad), bad).toBeUndefined()
    }
  })
})
