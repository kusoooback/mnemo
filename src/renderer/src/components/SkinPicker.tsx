import { Check } from 'lucide-react'
import { SKINS, skinById, type Skin } from '@shared/skins'
import { useT } from '../i18n'
import { useStore } from '../store'

/** Aperçu miniature d'un thème : fond, carte, texte et accent tels qu'ils seront affichés. */
function Tile({ skin, on, lang, onPick }: { skin: Skin; on: boolean; lang: 'fr' | 'en'; onPick: () => void }): React.JSX.Element {
  return (
    <button className={`skin-tile ${on ? 'on' : ''}`} onClick={onPick} aria-pressed={on} title={skin.name[lang]}>
      <span className="skin-prev" style={{ background: skin.bg, borderColor: `color-mix(in srgb, ${skin.text} 18%, transparent)` }}>
        <span className="skin-card" style={{ background: skin.surface, borderColor: `color-mix(in srgb, ${skin.text} 14%, transparent)` }}>
          <i style={{ background: skin.text, width: '64%' }} />
          <i style={{ background: skin.muted, width: '88%' }} />
          <b style={{ background: skin.accent }} />
        </span>
      </span>
      <span className="skin-name">
        {skin.name[lang]}
        {on && <Check size={13} />}
      </span>
    </button>
  )
}

export function SkinPicker(): React.JSX.Element {
  const t = useT()
  const { settings, patchSettings } = useStore()
  const lang = settings.language
  const current = skinById(settings.skin)?.id ?? ''
  const group = (base: 'light' | 'dark'): React.JSX.Element => (
    <>
      <div className="eyebrow" style={{ margin: '4px 0 8px' }}>{base === 'light' ? t('set.skinLight') : t('set.skinDark')}</div>
      <div className="skin-grid">
        {SKINS.filter((s) => s.base === base).map((s) => (
          <Tile key={s.id} skin={s} on={current === s.id} lang={lang} onPick={() => void patchSettings({ skin: s.id })} />
        ))}
      </div>
    </>
  )
  return (
    <div className="skin-picker">
      {group('light')}
      <div style={{ height: 12 }} />
      {group('dark')}
    </div>
  )
}
