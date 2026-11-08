import { CloudOff, FolderOpen, Laptop, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'

const errText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function SyncPage(): React.JSX.Element {
  const t = useT()
  const { settings, patchSettings, bump, toast } = useStore()
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [folder, setFolder] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [name, setName] = useState(settings.deviceName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async (): Promise<void> => setSt(await call('sync.status'))
  useEffect(() => {
    void load()
  }, [])

  const lang = settings.language === 'fr' ? 'fr-FR' : 'en-GB'
  const when = (ts: number | null): string =>
    ts ? new Date(ts).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : t('sync.never')

  const enable = async (): Promise<void> => {
    setError('')
    if (pass !== pass2) return setError(t('sync.mismatch'))
    setBusy(true)
    try {
      if (name.trim()) await patchSettings({ deviceName: name.trim() })
      setSt(await call('sync.setup', folder, pass))
      setPass('')
      setPass2('')
      await bump()
      toast(t('sync.done'))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await call('sync.now')
      if (!r.ok) setError(r.error ?? t('sync.error'))
      else {
        toast(t('sync.done'))
        await bump()
      }
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!st) return <div className="page" />

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('sync.title')}</h1>
          <p className="page-sub">{t('sync.sub')}</p>
        </div>
      </div>

      {st.configured ? (
        <>
          <div className="card card-pad">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <ShieldCheck size={22} color="var(--good)" style={{ marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div className="serif" style={{ fontSize: '1.375rem' }}>{t('sync.active')}</div>
                <div className="muted selectable" style={{ fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>{st.folder}</div>
                <div style={{ marginTop: 8 }}>{t('sync.lastSync', { date: when(st.lastSync) })}</div>
                {st.lastResult?.ok && (
                  <div className="muted num" style={{ fontSize: '0.8125rem' }}>
                    {t('sync.result', { notes: st.lastResult.newNotes, reviews: st.lastResult.newReviews, updated: st.lastResult.updated })}
                  </div>
                )}
              </div>
              <button className="btn btn-primary" disabled={busy} onClick={() => void syncNow()}>
                {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                {busy ? t('sync.running') : t('sync.now')}
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 14 }}>
              {t('sync.auto')} {t('sync.safety')}
            </p>
          </div>

          <div className="section-head">
            <h2>{t('sync.devices')}</h2>
          </div>
          <div className="card set-card">
            {st.devices.map((d) => (
              <div className="backup-row" key={d.id}>
                <Laptop size={18} color="var(--muted)" />
                <span style={{ flex: 1, fontWeight: 500 }}>
                  {d.name} {d.isSelf && <span className="tag">{t('sync.thisDevice')}</span>}
                </span>
                <span className="muted" style={{ fontSize: '0.8125rem' }}>{when(d.lastSync)}</span>
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: 20 }}>
            <button
              className="btn btn-ghost btn-danger"
              onClick={async () => {
                setSt(await call('sync.disable'))
                toast(t('sync.disabled'))
              }}
            >
              <CloudOff size={16} />
              {t('sync.disable')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="card card-pad">
            <div style={{ fontWeight: 500, marginBottom: 8 }}>{t('sync.howTitle')}</div>
            <ol className="muted" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>{t('sync.how1')}</li>
              <li>{t('sync.how2')}</li>
              <li>{t('sync.how3')}</li>
            </ol>
          </div>

          <div className="card card-pad" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="field-label">{t('sync.folder')}</label>
              <div className="row">
                <input className="input" readOnly value={folder} placeholder="C:\Users\…\OneDrive\Mnemo" />
                <button
                  className="btn"
                  onClick={async () => {
                    const f = await call('sync.pickFolder')
                    if (f) setFolder(f)
                  }}
                >
                  <FolderOpen size={16} />
                  {t('sync.chooseFolder')}
                </button>
              </div>
            </div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">{t('sync.pass')}</label>
                <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">{t('sync.pass2')}</label>
                <input className="input" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="off" />
              </div>
            </div>
            <div className="warn">
              <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
              {t('sync.passWarn')}
            </div>
            <div>
              <label className="field-label">{t('sync.deviceName')}</label>
              <input className="input" style={{ maxWidth: 280 }} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error && (
              <div className="warn" style={{ background: 'var(--again-soft)' }}>
                <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
                <span className="selectable">{error}</span>
              </div>
            )}
            <div className="row">
              <span className="muted" style={{ fontSize: '0.8125rem', flex: 1 }}>{t('sync.serverSoon')}</span>
              <button className="btn btn-primary" disabled={busy || !folder || pass.length < 8} onClick={() => void enable()}>
                {busy && <Loader2 size={16} className="spin" />}
                {t('sync.enable')}
              </button>
            </div>
          </div>
        </>
      )}
      {st.configured && error && (
        <div className="warn" style={{ background: 'var(--again-soft)', marginTop: 14 }}>
          <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
          <span className="selectable">{error}</span>
        </div>
      )}
    </div>
  )
}
