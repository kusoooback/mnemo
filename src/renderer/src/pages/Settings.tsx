import { Download, FolderOpen, History } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppInfo, BackupInfo, Language, ThemeMode } from '@shared/types'
import { call } from '../api'
import { SkinPicker } from '../components/SkinPicker'
import { Switch, useConfirm } from '../components/ui'
import { useT } from '../i18n'
import { formatBytes } from '../lib/format'
import { useStore } from '../store'

export function Settings(): React.JSX.Element {
  const t = useT()
  const { settings, patchSettings, toast, go } = useStore()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [name, setName] = useState(settings.userName)
  const [confirm, confirmNode] = useConfirm()

  useEffect(() => {
    void call('app.info').then(setInfo)
    void call('backup.list').then(setBackups)
  }, [])

  const themes: { v: ThemeMode; k: 'set.theme.light' | 'set.theme.dark' | 'set.theme.system' }[] = [
    { v: 'light', k: 'set.theme.light' },
    { v: 'dark', k: 'set.theme.dark' },
    { v: 'system', k: 'set.theme.system' }
  ]

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t('set.title')}</h1>
      </div>

      <div className="set-group">
        <h2>{t('set.appearance')}</h2>
        <div className="card set-card">
          <div className="set-row">
            <div className="info">
              <div className="t">{t('set.theme')}</div>
            </div>
            <div className="ctrl segmented">
              {themes.map((x) => (
                <button key={x.v} className={!settings.skin && settings.theme === x.v ? 'on' : ''} onClick={() => void patchSettings({ theme: x.v, skin: '' })}>
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
              <button className="btn btn-sm" disabled={!settings.accentColor} onClick={() => void patchSettings({ accentColor: '' })}>
                {t('set.accentReset')}
              </button>
            </div>
          </div>
          <div className="set-row">
            <div className="info">
              <div className="t">{t('set.language')}</div>
            </div>
            <div className="ctrl segmented">
              {(['fr', 'en'] as Language[]).map((l) => (
                <button key={l} className={settings.language === l ? 'on' : ''} onClick={() => void patchSettings({ language: l })}>
                  {l === 'fr' ? 'Français' : 'English'}
                </button>
              ))}
            </div>
          </div>
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
              <div className="t">{t('set.autoZoom')}</div>
              <div className="d">{t('set.autoZoomDesc')}</div>
            </div>
            <div className="ctrl">
              <Switch on={settings.autoZoom} label={t('set.autoZoom')} onChange={(v) => void patchSettings({ autoZoom: v })} />
            </div>
          </div>
          <div className="set-row">
            <div className="info">
              <div className="t">{t('set.dyslexia')}</div>
              <div className="d">{t('set.dyslexiaDesc')}</div>
            </div>
            <div className="ctrl">
              <Switch on={settings.dyslexia} label={t('set.dyslexia')} onChange={(v) => void patchSettings({ dyslexia: v })} />
            </div>
          </div>
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
                onBlur={() => name !== settings.userName && void patchSettings({ userName: name.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="set-group">
        <h2>{t('set.study')}</h2>
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
                onChange={(e) => void patchSettings({ newPerDay: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
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
              <b className="num" style={{ width: 52, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {Math.round(settings.retention * 100)} %
              </b>
            </div>
          </div>
          <div className="set-row">
            <div className="info">
              <div className="t">{t('set.guarantee')}</div>
              <div className="d">{t('set.guaranteeDesc')}</div>
            </div>
            <div className="ctrl">
              <Switch on={settings.prepaGuarantee} label={t('set.guarantee')} onChange={(v) => void patchSettings({ prepaGuarantee: v })} />
            </div>
          </div>
          <div className="set-row">
            <div className="info">
              <div className="t">{t('pp.auto')}</div>
              <div className="d">{t('pp.autoDesc')}</div>
            </div>
            <div className="ctrl">
              <Switch on={settings.prepaAuto} label={t('pp.auto')} onChange={(v) => void patchSettings({ prepaAuto: v })} />
            </div>
          </div>
          <div className="set-row">
            <div className="info">
              <div className="t">{t('set.timer')}</div>
              <div className="d">{t('set.timerDesc')}</div>
            </div>
            <div className="ctrl">
              <Switch on={settings.showTimer} label={t('set.timer')} onChange={(v) => void patchSettings({ showTimer: v })} />
            </div>
          </div>
        </div>
      </div>

      <div className="set-group">
        <h2>{t('nav.integrations')}</h2>
        <div className="card set-card">
          <div className="set-row">
            <div className="info">
              <div className="t">{t('set.manageIntegrations')}</div>
              <div className="d">{t('set.manageIntegrationsDesc')}</div>
            </div>
            <div className="ctrl">
              <button className="btn" onClick={() => go({ name: 'integrations' })}>{t('nav.integrations')}</button>
              <button className="btn" onClick={() => go({ name: 'sync' })}>{t('nav.sync')}</button>
            </div>
          </div>
        </div>
      </div>

      <div className="set-group">
        <h2>{t('set.data')}</h2>
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

        <div className="section-head" style={{ marginTop: 28 }}>
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
                {new Date(b.createdAt).toLocaleString(settings.language === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span className="muted num">{formatBytes(b.size)}</span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  if (!(await confirm({ title: t('set.restore'), text: t('set.restoreConfirm', { name: b.name }), confirmLabel: t('set.restore') }))) return
                  await call('backup.restore', b.name)
                }}
              >
                {t('set.restore')}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="set-group">
        <h2>{t('set.about')}</h2>
        <div className="card card-pad">
          <p className="muted selectable">{t('set.aboutText')}</p>
          <p className="faint" style={{ marginTop: 10, fontSize: '0.8125rem' }}>
            {t('set.version')} {info?.version} · SQLite · FSRS
          </p>
        </div>
      </div>
      {confirmNode}
    </div>
  )
}
