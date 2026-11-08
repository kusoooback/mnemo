import { BookOpenCheck, FileText, Layers, Loader2, LogIn, LogOut, Plus, ScanSearch, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiStatus, DocumentRow, PrepaImportResult, PrepaProgress, PrepaScan } from '@shared/types'
import { call } from '../api'
import { LocalAiSetup } from '../components/LocalAiSetup'
import { PdfButton } from '../components/PdfButton'
import { Modal, Switch } from '../components/ui'
import { useT, type Key } from '../i18n'
import { renderMarkdown } from '../lib/render'
import { useStore } from '../store'

const errText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const NO_CARDS = new Set(['exercices', 'corrige', 'admin', 'doublon'])

const sizeText = (n: number): string => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toFixed(1)} Mo`)

/* ---------------- Mes documents ---------------- */

function Documents(): React.JSX.Element {
  const t = useT()
  const { rev, bump, toast, go } = useStore()
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [summary, setSummary] = useState<{ title: string; html: string; sub: string } | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => setDocs(await call('docs.list')), [])
  useEffect(() => {
    void load()
  }, [load, rev])

  const bySubject = useMemo(() => {
    const m = new Map<string, DocumentRow[]>()
    for (const d of docs) m.set(d.subject || '—', [...(m.get(d.subject || '—') ?? []), d])
    return [...m.entries()]
  }, [docs])

  const addFiles = async (): Promise<void> => {
    try {
      const r = await call('docs.add')
      if (r.added) toast(t('dv.added', { n: r.added }))
      if (r.failed.length) toast(r.failed[0], { kind: 'error' })
      await bump()
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    }
  }
  const addBar = (
    <div className="row" style={{ marginBottom: 14 }}>
      <span className="muted" style={{ fontSize: '0.875rem', flex: 1 }}>{t('dv.addHint')}</span>
      <button className="btn btn-sm" onClick={() => void addFiles()}><Plus size={14} />{t('dv.add')}</button>
    </div>
  )

  if (docs.length === 0) return <>{addBar}<div className="card empty"><FileText size={26} color="var(--accent)" /><p>{t('pp.docs.empty')}</p></div></>

  return (
    <>
      {addBar}
      {bySubject.map(([subject, list]) => (
        <div key={subject} style={{ marginBottom: 22 }}>
          <div className="eyebrow">{subject} · {list.length}</div>
          <div className="card table">
            {list.map((d) => (
              <div key={d.id} className="t-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px auto', cursor: 'default' }}>
                <div className="front">
                  <div className="a" style={{ cursor: 'pointer' }} onClick={() => go({ name: 'doc', id: d.id })}>{d.title}</div>
                  <div className="b">
                    <span className={`cat-chip c-${d.category || 'none'}`}>{t(`cat.${d.category || 'none'}` as Key)}</span>{' '}
                    {d.category === 'doublon' ? t('cat.dupOf', { t: d.dupTitle }) + ' · ' : ''}
                    {(d.chapter || d.folder || '—')} · {d.ext.toUpperCase()} · {sizeText(d.size)}{d.cards ? ` · ${t('pp.docs.nCards', { n: d.cards })}` : ''}</div>
                </div>
                <span className="muted" style={{ fontSize: '0.8125rem' }}>{d.hasText ? '' : t('pp.docs.noText')}</span>
                <span className="row" style={{ gap: 2 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => void call('docs.open', d.id).catch((e) => toast(errText(e), { kind: 'error' }))}>{t('pp.docs.open')}</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!d.hasText || NO_CARDS.has(d.category) || busy === `s${d.id}`}
                    title={NO_CARDS.has(d.category) ? t('cat.noCards') : undefined}
                    onClick={async () => {
                      setBusy(`s${d.id}`)
                      try {
                        const s = d.hasSummary ? await call('docs.summary', d.id) : await call('docs.makeSummary', d.id)
                        setSummary({ title: d.title, html: renderMarkdown(s), sub: [d.subject, d.chapter].filter(Boolean).join(' · ') })
                        await load()
                      } catch (e) {
                        toast(errText(e), { kind: 'error' })
                      } finally {
                        setBusy('')
                      }
                    }}
                  >
                    {busy === `s${d.id}` ? <Loader2 size={14} className="spin" /> : null}
                    {t('pp.docs.summary')}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!d.hasText || NO_CARDS.has(d.category) || busy === `c${d.id}`}
                    title={NO_CARDS.has(d.category) ? t('cat.noCards') : undefined}
                    onClick={async () => {
                      setBusy(`c${d.id}`)
                      try {
                        toast(t('pp.docs.cardsDone', { n: await call('docs.makeCards', d.id, 12) }))
                        await bump()
                      } catch (e) {
                        toast(errText(e), { kind: 'error' })
                      } finally {
                        setBusy('')
                      }
                    }}
                  >
                    {busy === `c${d.id}` ? <Loader2 size={14} className="spin" /> : <Layers size={14} />}
                    {t('pp.docs.cards')}
                  </button>
                  <button className="icon-btn" aria-label={t('common.delete')} onClick={async () => { await call('docs.delete', d.id, false); await load() }}>
                    <Trash2 size={15} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {summary && (
        <Modal title={summary.title} onClose={() => setSummary(null)} width={720}>
          <div className="modal-body">
            <div className="row" style={{ marginBottom: 8 }}><PdfButton title={summary.title} subtitle={summary.sub} html={summary.html} /></div>
            <div className="md selectable sheet" style={{ padding: '8px 12px 20px' }} dangerouslySetInnerHTML={{ __html: summary.html }} />
          </div>
        </Modal>
      )}
    </>
  )
}

/* ---------------- Importer depuis le site ---------------- */

function Importer(): React.JSX.Element {
  const t = useT()
  const { settings, go, bump, toast } = useStore()
  const [url, setUrl] = useState(settings.prepaUrl)
  const [scan, setScan] = useState<PrepaScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [saved, setSaved] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [lid, setLid] = useState('')
  const [lpw, setLpw] = useState('')
  const [remember, setRemember] = useState(true)
  const [loginMsg, setLoginMsg] = useState('')
  const [opt, setOpt] = useState({ notebook: true, cards: true, summary: true, per: 12, root: 'Prépa' })
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<PrepaProgress | null>(null)
  const [result, setResult] = useState<PrepaImportResult | null>(null)
  const [error, setError] = useState('')

  const loadAi = useCallback(() => void call('ai.status').then(setAi), [])
  useEffect(() => {
    loadAi()
    void call('prepa.status').then((s) => setSaved(s.hasSavedLogin))
    return window.mnemo.onEvent((e) => e.type === 'prepa-progress' && setProgress(e.payload as PrepaProgress))
  }, [loadAi])

  const doScan = async (): Promise<void> => {
    setScanning(true)
    setError('')
    setResult(null)
    try {
      const s = await call('prepa.scan', url)
      setScan(s)
      setSelected(new Set(s.docs.map((d) => d.remoteId)))
    } catch (e) {
      setError(errText(e))
    } finally {
      setScanning(false)
    }
  }

  const bySubject = useMemo(() => {
    const m = new Map<string, PrepaScan['docs']>()
    for (const d of scan?.docs ?? []) m.set(d.subject || '—', [...(m.get(d.subject || '—') ?? []), d])
    return [...m.entries()]
  }, [scan])

  const toggle = (ids: string[], on: boolean): void =>
    setSelected((s) => {
      const n = new Set(s)
      ids.forEach((i) => (on ? n.add(i) : n.delete(i)))
      return n
    })

  const run = async (): Promise<void> => {
    if (!scan) return
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const r = await call('prepa.import', {
        baseUrl: scan.baseUrl,
        remoteIds: [...selected],
        deckRoot: opt.root,
        addToNotebook: opt.notebook,
        generateCards: opt.cards,
        makeSummary: opt.summary,
        cardsPerDoc: opt.per
      })
      setResult(r)
      await bump()
    } catch (e) {
      setError(errText(e))
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const aiReady = !!ai?.ready
  const events = (scan?.events ?? []).filter((e) => /\bDS\b|colle|concours|examen|devoir|oral|dm\b/i.test(e.title) && e.date > Date.now() - 86400000)

  return (
    <>
      <div className="card card-pad">
        <label className="field-label">{t('pp.url')}</label>
        <div className="row">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cahier-de-prepa.fr/ma-classe/" onKeyDown={(e) => e.key === 'Enter' && void doScan()} />
          <button className="btn btn-primary" disabled={scanning || !url.trim()} onClick={() => void doScan()}>
            {scanning ? <Loader2 size={15} className="spin" /> : <ScanSearch size={16} />}
            {scanning ? t('pp.scanning') : t('pp.scan')}
          </button>
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => setShowLogin(!showLogin)}>
            <LogIn size={14} />
            {t('pp.login')}
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              await call('prepa.loginWindow', url)
              await doScan()
            }}
          >
            {t('pp.loginWindow')}
          </button>
          {saved && (
            <button className="btn btn-ghost btn-sm" onClick={async () => { await call('prepa.logout'); setSaved(false); setLoginMsg('') }}>
              <LogOut size={14} />
              {t('pp.logout')}
            </button>
          )}
          <span className="muted" style={{ fontSize: '0.8125rem' }}>{t('pp.loginHint')}</span>
        </div>
        {showLogin && (
          <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="field-label">{t('pp.loginId')}</label>
              <input className="input" value={lid} onChange={(e) => setLid(e.target.value)} autoComplete="off" />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="field-label">{t('pp.loginPw')}</label>
              <input className="input" type="password" value={lpw} onChange={(e) => setLpw(e.target.value)} autoComplete="off" />
            </div>
            <button
              className="btn btn-dark"
              disabled={!lid || !lpw}
              onClick={async () => {
                const r = await call('prepa.login', url, lid, lpw, remember)
                setLoginMsg(r.message)
                if (r.ok) {
                  setSaved(remember)
                  setLpw('')
                  setShowLogin(false)
                  toast(t('pp.loginOk'))
                  await doScan()
                }
              }}
            >
              {t('pp.login')}
            </button>
            <label className="row" style={{ width: '100%', cursor: 'pointer' }}>
              <input type="checkbox" className="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t('pp.remember')}
            </label>
          </div>
        )}
        {loginMsg && <p className="muted" style={{ marginTop: 8, fontSize: '0.8125rem' }}>{loginMsg}</p>}
        {error && <div className="warn selectable" style={{ marginTop: 12, background: 'var(--again-soft)' }}>{error}</div>}
      </div>

      {scan && (
        <>
          <div className="section-head">
            <h2>{scan.siteName}</h2>
            <span className="muted num" style={{ fontSize: '0.875rem' }}>{t('pp.found', { docs: scan.docs.length, events: events.length, subjects: scan.subjects.length })}</span>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => toggle(scan.docs.map((d) => d.remoteId), true)}>{t('pp.select.all')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => toggle(scan.docs.map((d) => d.remoteId), false)}>{t('pp.select.none')}</button>
          </div>
          {scan.warnings.map((w, i) => <div key={i} className="warn" style={{ marginBottom: 10 }}>{w}</div>)}

          {bySubject.length === 0 && <div className="card empty"><p>{t('pp.nothing')}</p></div>}
          {bySubject.map(([subject, list]) => (
            <div key={subject} style={{ marginBottom: 14 }}>
              <label className="row eyebrow" style={{ cursor: 'pointer' }}>
                <input type="checkbox" className="checkbox" checked={list.every((d) => selected.has(d.remoteId))} onChange={(e) => toggle(list.map((d) => d.remoteId), e.target.checked)} />
                {subject} · {list.length}
              </label>
              <div className="card table">
                {list.map((d) => (
                  <label key={d.remoteId} className="t-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) 90px' }}>
                    <input type="checkbox" className="checkbox" checked={selected.has(d.remoteId)} onChange={(e) => toggle([d.remoteId], e.target.checked)} />
                    <div className="front">
                      <div className="a">{d.title}</div>
                      <div className="b">{d.folder || subject}{d.kind === 'colle' ? ` · ${t('pp.kind.colle')}` : ''}</div>
                    </div>
                    <span className="muted num" style={{ fontSize: '0.8125rem' }}>{d.size}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {events.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 18 }}>{t('pp.events')}</div>
              <div className="card table" style={{ marginBottom: 18 }}>
                {events.slice(0, 8).map((e, i) => (
                  <div key={i} className="t-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 150px', cursor: 'default', minHeight: 44 }}>
                    <span>{e.title}</span>
                    <span className="muted" style={{ fontSize: '0.8125rem' }}>{new Date(e.date).toLocaleDateString(settings.language === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="card card-pad" style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('pp.opt.title')}</div>
            <label className="row" style={{ cursor: 'pointer', marginBottom: 8 }}>
              <input type="checkbox" className="checkbox" checked={opt.notebook} onChange={(e) => setOpt({ ...opt, notebook: e.target.checked })} />
              {t('pp.opt.notebook')}
            </label>
            <label className="row" style={{ cursor: 'pointer', marginBottom: 8 }}>
              <input type="checkbox" className="checkbox" checked={opt.cards} onChange={(e) => setOpt({ ...opt, cards: e.target.checked })} />
              {t('pp.opt.cards')}
            </label>
            <label className="row" style={{ cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" className="checkbox" checked={opt.summary} onChange={(e) => setOpt({ ...opt, summary: e.target.checked })} />
              {t('pp.opt.summary')}
            </label>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              <div style={{ width: 150 }}>
                <label className="field-label">{t('pp.opt.cardsPer')}</label>
                <input className="input num" type="number" min={3} max={40} value={opt.per} onChange={(e) => setOpt({ ...opt, per: Number(e.target.value) || 12 })} />
              </div>
              <div style={{ width: 200 }}>
                <label className="field-label">{t('pp.opt.root')}</label>
                <input className="input" value={opt.root} onChange={(e) => setOpt({ ...opt, root: e.target.value })} />
              </div>
            </div>
            {(opt.cards || opt.summary) && !aiReady && (
              <div style={{ marginTop: 16 }}>
                <p className="muted" style={{ marginBottom: 10, fontSize: '0.875rem' }}>{t('pp.aiOff')}</p>
                <LocalAiSetup onReady={loadAi} />
              </div>
            )}
            <div className="row" style={{ marginTop: 18 }}>
              {running && progress && (
                <span className="muted" style={{ fontSize: '0.875rem' }}>
                  {t(`pp.phase.${progress.phase}` as Key)} · {progress.index}/{progress.total} · {progress.title}
                </span>
              )}
              <span className="spacer" />
              {running && <button className="btn" onClick={() => void call('prepa.cancel')}>{t('pp.cancel')}</button>}
              <button className="btn btn-primary" disabled={running || selected.size === 0} onClick={() => void run()}>
                {running ? <Loader2 size={15} className="spin" /> : <BookOpenCheck size={16} />}
                {t('pp.go', { n: selected.size })}
              </button>
            </div>
          </div>

          {result && (
            <div className="card card-pad" style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600 }}>{t('pp.done')}</div>
              <p className="num" style={{ margin: '4px 0 10px' }}>{t('pp.done.line', { downloaded: result.downloaded, cards: result.cards, summaries: result.summaries, events: result.events })}</p>
              {result.warnings.map((w, i) => <p key={i} className="muted selectable" style={{ fontSize: '0.8125rem' }}>{w}</p>)}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-dark" onClick={() => go({ name: 'home' })}>{t('nav.today')}</button>
                <button className="btn" onClick={() => go({ name: 'notebook' })}>{t('nav.notebook')}</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

/* ---------------- Synchronisation automatique ---------------- */

function AutoSync(): React.JSX.Element {
  const t = useT()
  const { settings, patchSettings, toast, bump } = useStore()
  const [checking, setChecking] = useState(false)
  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{t('pp.auto')}</div>
          <p className="muted" style={{ fontSize: '0.875rem', marginTop: 2 }}>{t('pp.autoDesc')}</p>
        </div>
        <Switch on={settings.prepaAuto} label={t('pp.auto')} onChange={(v) => void patchSettings({ prepaAuto: v })} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="row" style={{ cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" className="checkbox" checked={settings.prepaMakeCards} onChange={(e) => void patchSettings({ prepaMakeCards: e.target.checked })} />
          {t('pp.opt.cards')}
        </label>
        <label className="row" style={{ cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" className="checkbox" checked={settings.prepaMakeSummary} onChange={(e) => void patchSettings({ prepaMakeSummary: e.target.checked })} />
          {t('pp.opt.summary')}
        </label>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" className="checkbox" checked={settings.prepaNotebook} onChange={(e) => void patchSettings({ prepaNotebook: e.target.checked })} />
          {t('pp.opt.notebook')}
        </label>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn btn-sm"
          disabled={checking}
          onClick={async () => {
            setChecking(true)
            try {
              const r = await call('prepa.autoNow')
              if (r.state === 'error') toast(t('pp.autoOffline'), { kind: 'error' })
              else if (r.state === 'done' && r.result.downloaded + r.result.cards + r.result.events === 0) toast(r.needLogin ? t('pp.autoLogin') : t('pp.autoNothing'))
              await bump()
            } finally {
              setChecking(false)
            }
          }}
        >
          {checking ? <Loader2 size={14} className="spin" /> : <ScanSearch size={14} />}
          {checking ? t('pp.autoChecking') : t('pp.autoNow')}
        </button>
      </div>
    </div>
  )
}

export function Prepa(): React.JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<'import' | 'docs'>('import')
  return (
    <div className="page page-wide">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('pp.title')}</h1>
          <p className="page-sub">{t('pp.sub')}</p>
        </div>
      </div>
      <div className="segmented" style={{ marginBottom: 20 }}>
        <button className={tab === 'import' ? 'on' : ''} onClick={() => setTab('import')}>{t('pp.tab.import')}</button>
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>{t('pp.tab.docs')}</button>
      </div>
      {tab === 'import' && <AutoSync />}
      {tab === 'import' ? <Importer /> : <Documents />}
    </div>
  )
}
