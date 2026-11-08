import {
  Accessibility,
  BookOpenCheck,
  Database,
  Download,
  FolderOpen,
  GraduationCap,
  History,
  Info,
  Layers,
  Palette,
  Plug,
  RefreshCw,
  User,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppInfo, BackupInfo, Language, ThemeMode } from '@shared/types'
import { call } from '../api'
import { SkinPicker } from '../components/SkinPicker'
import { Switch, useConfirm } from '../components/ui'
import { useT, type Key } from '../i18n'
import { formatBytes } from '../lib/format'
import { usePage } from '../lib/keepalive'
import { useStore } from '../store'

export function Settings(): React.JSX.Element {
  const t = useT()
  const { settings, patchSettings, toast, go, setTour } = useStore()
  const { shown } = usePage()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [name, setName] = useState(settings.userName)
  const [confirm, confirmNode] = useConfirm()

  useEffect(() => {
    void call('app.info').then(setInfo)
    void call('backup.list').then(setBackups)
  }, [shown])

  const themes: { v: ThemeMode; k: 'set.theme.light' | 'set.theme.dark' | 'set.theme.system' }[] = [
    { v: 'light', k: 'set.theme.light' },
    { v: 'dark', k: 'set.theme.dark' },
    { v: 'system', k: 'set.theme.system' }
  ]

  const sections: { id: string; icon: LucideIcon; label: Key }[] = [
    { id: 'general', icon: User, label: 'set.general' },
    { id: 'appearance', icon: Palette, label: 'set.appearance' },
    { id: 'cards', icon: Layers, label: 'set.cardsGroup' },
    { id: 'access', icon: Accessibility, label: 'set.access' },
    { id: 'study', icon: GraduationCap, label: 'set.study' },
    { id: 'prepa', icon: BookOpenCheck, label: 'set.prepaGroup' },
    { id: 'connect', icon: Plug, label: 'set.connect' },
    { id: 'data', icon: Database, label: 'set.data' },
    { id: 'about', icon: Info, label: 'set.about' }
  ]
  const [active, setActive] = useState('general')
  const rootRef = useRef<HTMLDivElement>(null)

  // La rubrique visible met en valeur son entrée dans le menu de gauche.
  useEffect(() => {
    const root = rootRef.current?.closest('.main-scroll') ?? null
    const els = sections
      .map((x) => document.getElementById('set-' + x.id))
      .filter((e): e is HTMLElement => !!e)
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id.replace('set-', ''))
      },
      { root, rootMargin: '-10% 0px -70% 0px' }
    )
    els.forEach((e) => obs.observe(e))
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const jump = (id: string): void => {
    setActive(id)
    document.getElementById('set-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const section = (
    id: string,
    title: Key,
    desc: Key | null,
    children: React.ReactNode
  ): React.JSX.Element => (
    <section className="set-section" id={'set-' + id}>
      <header>
        <h2>{t(title)}</h2>
        {desc && <p>{t(desc)}</p>}
      </header>
      {children}
    </section>
  )

  return (
    <div className="page settings" ref={rootRef}>
      <div className="page-head">
        <h1 className="page-title">{t('set.title')}</h1>
      </div>

      <div className="set-layout">
        <nav className="set-nav" aria-label={t('set.nav')}>
          {sections.map((x) => (
            <button key={x.id} className={active === x.id ? 'on' : ''} onClick={() => jump(x.id)}>
              <x.icon size={16} />
              {t(x.label)}
            </button>
          ))}
        </nav>

        <div className="set-body">
          {section(
            'general',
            'set.general',
            null,
            <div className="card set-card">
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.profile')}</div>
                  <div className="d">{t('set.profileDesc')}</div>
                </div>
                <div className="ctrl">
                  <input
                    className="input"
                    style={{ width: 180 }}
                    value={name}
                    maxLength={40}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() =>
                      name !== settings.userName && void patchSettings({ userName: name.trim() })
                    }
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </div>
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.language')}</div>
                </div>
                <div className="ctrl segmented">
                  {(['fr', 'en'] as Language[]).map((l) => (
                    <button
                      key={l}
                      className={settings.language === l ? 'on' : ''}
                      onClick={() => void patchSettings({ language: l })}
                    >
                      {l === 'fr' ? 'Français' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.tour')}</div>
                  <div className="d">{t('set.tourD')}</div>
                </div>
                <div className="ctrl">
                  <button className="btn" onClick={() => setTour(true)} data-testid="set-tour">
                    {t('tour.replay')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {section(
            'appearance',
            'set.appearance',
            null,
            <div className="card set-card">
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.theme')}</div>
                </div>
                <div className="ctrl segmented">
                  {themes.map((x) => (
                    <button
                      key={x.v}
                      className={!settings.skin && settings.theme === x.v ? 'on' : ''}
                      onClick={() => void patchSettings({ theme: x.v, skin: '' })}
                    >
                      {t(x.k)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="set-row" style={{ display: 'block' }}>
                <div className="info" style={{ marginBottom: 10 }}>
                  <div className="t">{t('set.skins')}</div>
                  <div className="d">{t('set.skinsDesc')}</div>
                </div>
                <SkinPicker />
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.accent')}</div>
                  <div className="d">{t('set.accentDesc')}</div>
                </div>
                <div className="ctrl" style={{ gap: 8 }}>
                  <input
                    type="color"
                    className="color-input"
                    aria-label={t('set.accent')}
                    value={settings.accentColor || '#c6613f'}
                    onChange={(e) => void patchSettings({ accentColor: e.target.value })}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={!settings.accentColor}
                    onClick={() => void patchSettings({ accentColor: '' })}
                  >
                    {t('set.accentReset')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {section(
            'cards',
            'set.cardsGroup',
            null,
            <div className="card set-card">
              <div className="set-row" style={{ display: 'block' }}>
                <div className="info" style={{ marginBottom: 10 }}>
                  <div className="t">{t('set.cards')}</div>
                  <div className="d">{t('set.cardsDesc')}</div>
                </div>
                <div className="cs-row">
                  <div className="ctrl segmented" role="group" aria-label={t('set.cardFont')}>
                    {(
                      [
                        ['', 'set.cardFont.serif'],
                        ['sans', 'set.cardFont.sans'],
                        ['mono', 'set.cardFont.mono'],
                        ['readable', 'set.cardFont.readable']
                      ] as const
                    ).map(([v, k]) => (
                      <button
                        key={v}
                        className={settings.cardFont === v ? 'on' : ''}
                        onClick={() => void patchSettings({ cardFont: v })}
                      >
                        {t(k)}
                      </button>
                    ))}
                  </div>
                  <div className="ctrl segmented" role="group" aria-label={t('set.cardAlign')}>
                    {(
                      [
                        ['left', 'set.cardAlign.left'],
                        ['center', 'set.cardAlign.center']
                      ] as const
                    ).map(([v, k]) => (
                      <button
                        key={v}
                        className={settings.cardAlign === v ? 'on' : ''}
                        onClick={() => void patchSettings({ cardAlign: v })}
                      >
                        {t(k)}
                      </button>
                    ))}
                  </div>
                  <div className="ctrl" style={{ width: 200 }}>
                    <span style={{ fontSize: 12 }}>A</span>
                    <input
                      type="range"
                      min={0.8}
                      max={1.6}
                      step={0.1}
                      value={settings.cardScale}
                      aria-label={t('set.cardScale')}
                      onChange={(e) => void patchSettings({ cardScale: Number(e.target.value) })}
                    />
                    <span style={{ fontSize: 20 }}>A</span>
                  </div>
                  <button
                    className="btn btn-sm"
                    disabled={
                      !settings.cardFont &&
                      settings.cardScale === 1 &&
                      settings.cardAlign === 'left'
                    }
                    onClick={() =>
                      void patchSettings({ cardFont: '', cardScale: 1, cardAlign: 'left' })
                    }
                  >
                    {t('set.cardReset')}
                  </button>
                </div>
                <div className="cs-preview">
                  <div className="rv-q md">{t('set.cardSample.q')}</div>
                  <div className="rv-a md">{t('set.cardSample.a')}</div>
                </div>
              </div>
            </div>
          )}

          {section(
            'access',
            'set.access',
            null,
            <div className="card set-card">
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.fontSize')}</div>
                </div>
                <div className="ctrl" style={{ width: 220 }}>
                  <span style={{ fontSize: 12 }}>A</span>
                  <input
                    type="range"
                    min={0.85}
                    max={1.4}
                    step={0.05}
                    value={settings.fontScale}
                    onChange={(e) => void patchSettings({ fontScale: Number(e.target.value) })}
                  />
                  <span style={{ fontSize: 20 }}>A</span>
                </div>
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.dyslexia')}</div>
                  <div className="d">{t('set.dyslexiaDesc')}</div>
                </div>
                <div className="ctrl">
                  <Switch
                    on={settings.dyslexia}
                    label={t('set.dyslexia')}
                    onChange={(v) => void patchSettings({ dyslexia: v })}
                  />
                </div>
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.autoZoom')}</div>
                  <div className="d">{t('set.autoZoomDesc')}</div>
                </div>
                <div className="ctrl">
                  <Switch
                    on={settings.autoZoom}
                    label={t('set.autoZoom')}
                    onChange={(v) => void patchSettings({ autoZoom: v })}
                  />
                </div>
              </div>
            </div>
          )}

          {section(
            'study',
            'set.study',
            'set.studyD',
            <div className="card set-card">
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.newPerDay')}</div>
                  <div className="d">{t('set.newPerDayDesc')}</div>
                </div>
                <div className="ctrl">
                  <input
                    className="input num"
                    type="number"
                    style={{ width: 96 }}
                    min={0}
                    max={9999}
                    value={settings.newPerDay}
                    onChange={(e) =>
                      void patchSettings({
                        newPerDay: Math.max(0, Math.round(Number(e.target.value) || 0))
                      })
                    }
                  />
                </div>
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.retention')}</div>
                  <div className="d">{t('set.retentionDesc')}</div>
                </div>
                <div className="ctrl" style={{ width: 260 }}>
                  <input
                    type="range"
                    min={0.7}
                    max={0.97}
                    step={0.01}
                    value={settings.retention}
                    onChange={(e) => void patchSettings({ retention: Number(e.target.value) })}
                  />
                  <b
                    className="num"
                    style={{ width: 52, textAlign: 'right', whiteSpace: 'nowrap' }}
                  >
                    {Math.round(settings.retention * 100)} %
                  </b>
                </div>
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.timer')}</div>
                  <div className="d">{t('set.timerDesc')}</div>
                </div>
                <div className="ctrl">
                  <Switch
                    on={settings.showTimer}
                    label={t('set.timer')}
                    onChange={(v) => void patchSettings({ showTimer: v })}
                  />
                </div>
              </div>
            </div>
          )}

          {section(
            'prepa',
            'set.prepaGroup',
            null,
            <div className="card set-card">
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('set.guarantee')}</div>
                  <div className="d">{t('set.guaranteeDesc')}</div>
                </div>
                <div className="ctrl">
                  <Switch
                    on={settings.prepaGuarantee}
                    label={t('set.guarantee')}
                    onChange={(v) => void patchSettings({ prepaGuarantee: v })}
                  />
                </div>
              </div>
              <div className="set-row">
                <div className="info">
                  <div className="t">{t('pp.auto')}</div>
                  <div className="d">{t('pp.autoDesc')}</div>
                </div>
                <div className="ctrl">
                  <Switch
                    on={settings.prepaAuto}
                    label={t('pp.auto')}
                    onChange={(v) => void patchSettings({ prepaAuto: v })}
                  />
                </div>
              </div>
            </div>
          )}

          {section(
            'connect',
            'set.connect',
            null,
            <div className="set-links">
              <button className="set-link" onClick={() => go({ name: 'integrations' })}>
                <b>
                  <Plug size={16} />
                  {t('set.card.integ')}
                </b>
                <span>{t('set.card.integD')}</span>
              </button>
              <button className="set-link" onClick={() => go({ name: 'sync' })}>
                <b>
                  <RefreshCw size={16} />
                  {t('set.card.sync')}
                </b>
                <span>{t('set.card.syncD')}</span>
              </button>
            </div>
          )}

          {section(
            'data',
            'set.data',
            null,
            <>
              <div className="card set-card">
                <div className="set-row">
                  <div className="info">
                    <div className="t">{t('set.dataDir')}</div>
                    <div className="d selectable">{info?.dataDir}</div>
                    <div className="d">{t('set.dataDirDesc')}</div>
                  </div>
                  <div className="ctrl">
                    <button className="btn" onClick={() => void call('app.openDataDir')}>
                      <FolderOpen size={16} />
                      {t('set.open')}
                    </button>
                  </div>
                </div>
                <div className="set-row">
                  <div className="info">
                    <div className="t">{t('set.export')}</div>
                    <div className="d">{t('set.exportDesc')}</div>
                  </div>
                  <div className="ctrl">
                    <button
                      className="btn"
                      onClick={async () => {
                        const p = await call('data.exportJson')
                        if (p) toast(t('set.exported'))
                      }}
                    >
                      <Download size={16} />
                      {t('set.export')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="section-head set-sub">
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: '1.125rem' }}>{t('set.backups')}</h2>
                  <p className="muted" style={{ fontSize: '0.8125rem' }}>
                    {t('set.backupsDesc')}
                  </p>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    await call('backup.create')
                    setBackups(await call('backup.list'))
                    toast(t('set.backupDone'))
                  }}
                >
                  <History size={15} />
                  {t('set.backupNow')}
                </button>
              </div>
              <div className="card set-card">
                {backups.length === 0 && (
                  <p className="muted" style={{ padding: '16px 0' }}>
                    {t('set.noBackups')}
                  </p>
                )}
                {backups.slice(0, 8).map((b) => (
                  <div className="backup-row" key={b.name}>
                    <span style={{ flex: 1 }}>
                      {new Date(b.createdAt).toLocaleString(
                        settings.language === 'fr' ? 'fr-FR' : 'en-GB',
                        { dateStyle: 'medium', timeStyle: 'short' }
                      )}
                    </span>
                    <span className="muted num">{formatBytes(b.size)}</span>
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        if (
                          !(await confirm({
                            title: t('set.restore'),
                            text: t('set.restoreConfirm', { name: b.name }),
                            confirmLabel: t('set.restore')
                          }))
                        )
                          return
                        await call('backup.restore', b.name)
                      }}
                    >
                      {t('set.restore')}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {section(
            'about',
            'set.about',
            null,
            <div className="card card-pad">
              <p className="muted selectable">{t('set.aboutText')}</p>
              <p className="faint" style={{ marginTop: 10, fontSize: '0.8125rem' }}>
                {t('set.version')} {info?.version} · SQLite · FSRS
              </p>
              <p className="faint" style={{ marginTop: 4, fontSize: '0.8125rem' }}>
                © 2026 Malo · {t('set.license')}
              </p>
            </div>
          )}
        </div>
      </div>
      {confirmNode}
    </div>
  )
}
