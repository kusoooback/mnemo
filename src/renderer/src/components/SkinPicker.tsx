import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { SKINS, contrast, customSkin, customSkinId, parseCustomSkin, skinById, type Skin } from '@shared/skins'
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

/** « Mon thème » : trois couleurs au choix, le reste est déduit. Le code affiché se copie pour le partager, et se colle pour en recevoir un. */
function CustomTheme(): React.JSX.Element {
  const t = useT()
  const { settings, patchSettings, toast } = useStore()
  const cur = parseCustomSkin(settings.skin)
  const [c, setC] = useState(cur ?? { bg: '#f4efe6', text: '#2b2b2b', accent: '#c0562b' })
  const [code, setCode] = useState('')
  const sk = customSkin(c.bg, c.text, c.accent)
  const fixed = contrast(c.text, sk.bg) < 9
  const id = customSkinId(c.bg, c.text, c.accent)
  const apply = (v: { bg: string; text: string; accent: string }): void => void patchSettings({ skin: customSkinId(v.bg, v.text, v.accent) })
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(id)
      toast(t('set.myTheme.copied'))
    } catch {
      toast(t('rs.copyFail'), { kind: 'error' })
    }
  }
  const paste = (): void => {
    const p = parseCustomSkin(code)
    if (!p) return toast(t('set.myTheme.bad'), { kind: 'error' })
    setC(p)
    apply(p)
    setCode('')
  }
  const field = (k: 'bg' | 'text' | 'accent', label: string): React.JSX.Element => (
    <label className="ct-field">
      <input type="color" className="color-input" value={c[k]} aria-label={label} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
      <span>{label}</span>
    </label>
  )
  return (
    <div className="ct">
      <div className="eyebrow" style={{ margin: '14px 0 8px' }}>{t('set.myTheme')}</div>
      <div className="ct-row">
        <Tile skin={sk} on={!!cur && customSkinId(cur.bg, cur.text, cur.accent) === id} lang={settings.language} onPick={() => apply(c)} />
        <div className="ct-ctl">
          <div className="ct-fields">
            {field('bg', t('set.myTheme.bg'))}
            {field('text', t('set.myTheme.text'))}
            {field('accent', t('set.myTheme.accent'))}
          </div>
          {fixed && <div className="d">{t('set.myTheme.contrast')}</div>}
          <div className="ct-actions">
            <button className="btn btn-sm btn-primary" onClick={() => apply(c)}>{t('set.myTheme.apply')}</button>
            <button className="link-btn" onClick={() => void copy()} title={t('set.myTheme.shareHelp')}>
              <Copy size={12} /> {t('set.myTheme.share')} <code>{id}</code>
            </button>
          </div>
          <div className="ct-actions">
            <input className="input" style={{ maxWidth: 260 }} value={code} placeholder={t('set.myTheme.paste')} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && paste()} />
            <button className="btn btn-sm" disabled={!code.trim()} onClick={paste}>{t('set.myTheme.use')}</button>
          </div>
        </div>
      </div>
    </div>
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
      <CustomTheme />
    </div>
  )
}
