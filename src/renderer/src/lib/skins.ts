import { accentFrom, type Skin } from '../../../shared/skins'

/** Variables CSS d'un thème coloré (et/ou d'une couleur d'accent choisie). Jamais `--sidebar` : la barre latérale suit `--bg`. */
export function skinVars(skin: Skin | undefined, base: 'light' | 'dark', customAccent = ''): Record<string, string> {
  const v: Record<string, string> = {}
  if (skin) {
    const t = skin.text
    Object.assign(v, {
      '--bg': skin.bg,
      '--surface': skin.surface,
      '--surface-2': skin.surface2,
      '--surface-3': skin.surface3,
      '--text': skin.text,
      '--text-2': skin.text2,
      '--muted': skin.muted,
      '--faint': skin.faint,
      '--hover': `color-mix(in srgb, ${t} 6%, transparent)`,
      '--active': `color-mix(in srgb, ${t} 10%, transparent)`,
      '--border': `color-mix(in srgb, ${t} 15%, transparent)`,
      '--border-strong': `color-mix(in srgb, ${t} 30%, transparent)`,
      '--hairline': `color-mix(in srgb, ${t} 10%, transparent)`,
      '--code-bg': base === 'dark' ? `color-mix(in srgb, ${skin.bg} 70%, #000000)` : skin.surface2,
      '--heat-0': skin.surface3
    })
  }
  const a = (customAccent && accentFrom(customAccent, base)) || (skin && { accent: skin.accent, accentHover: skin.accentHover, accentInk: skin.accentInk, onAccent: skin.onAccent })
  if (a) {
    Object.assign(v, {
      '--accent': a.accent,
      '--accent-hover': a.accentHover,
      '--accent-ink': a.accentInk,
      '--accent-text': a.onAccent,
      '--accent-btn': a.accent,
      '--accent-btn-hover': a.accentHover,
      '--accent-btn-text': a.onAccent,
      '--accent-soft': `color-mix(in srgb, ${a.accent} 13%, transparent)`,
      '--cloze-bg': `color-mix(in srgb, ${a.accent} 18%, transparent)`,
      '--cloze-fg': a.accentInk,
      '--heat-1': `color-mix(in srgb, ${a.accent} 30%, var(--bg))`,
      '--heat-2': `color-mix(in srgb, ${a.accent} 55%, var(--bg))`,
      '--heat-3': `color-mix(in srgb, ${a.accent} 80%, var(--bg))`,
      '--heat-4': a.accentHover
    })
  }
  return v
}

/** Toutes les variables qu'un thème peut poser : on les retire avant d'en appliquer d'autres. */
export const SKIN_VAR_NAMES = Object.keys(skinVars({ id: '', name: { fr: '', en: '' }, base: 'light', bg: '', surface: '', surface2: '', surface3: '', text: '', text2: '', muted: '', faint: '', accent: '', accentHover: '', accentInk: '', onAccent: '' }, 'light', '#336699'))
