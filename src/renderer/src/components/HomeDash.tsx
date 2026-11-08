import { BookOpenCheck, BrainCircuit, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiStatus, DocumentRow } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'
import { JobRow } from './Activity'

const LEARN = new Set(['cours', 'methode', 'vocabulaire'])

function ago(ms: number, t: (k: 'dash.ago', v: { t: string }) => string): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000))
  const label = m < 1 ? '< 1 min' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} j`
  return t('dash.ago', { t: label })
}

/** Accueil : ce qui tourne en ce moment, l'état du Cahier de Prépa et de l'IA, et les actions pour les gérer. */
export function HomeDash(): React.JSX.Element | null {
  const t = useT()
  const { jobs, settings, go, rev, bump, toast } = useStore()
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void call('docs.list').then(setDocs)
  }, [rev])
  useEffect(() => {
    void call('ai.status').then(setAi)
  }, [jobs])

  const running = jobs.filter((j) => j.status === 'running')
  const prepaBusy = running.some((j) => j.kind === 'prepa' || j.kind === 'scan')
  const real = docs.filter((d) => d.category !== 'doublon')
  const learn = real.filter((d) => LEARN.has(d.category)).length
  const toSort = real.filter((d) => !d.category).length
  const ignored = real.filter((d) => d.category && !LEARN.has(d.category)).length
  const dups = docs.length - real.length
  const cards = docs.reduce((a, d) => a + d.cards, 0)
  const showPrepa = docs.length > 0 || settings.prepaAuto
  const showAi = !!ai && (docs.length > 0 || !ai.ready)
  if (running.length === 0 && !showPrepa && !showAi) return null

  return (
    <div className="dash">
      {running.length > 0 && (
        <div className="card dash-running">
          {running.map((j) => <JobRow key={j.id} job={j} />)}
        </div>
      )}
      {(showPrepa || showAi) && (
        <div className="dash-grid">
          {showPrepa && (
            <div className="card dash-card">
              <div className="dash-title">
                <BookOpenCheck size={16} />
                {t('dash.prepa')}
                <span className="spacer" />
                <span className={`dash-dot ${settings.prepaAuto ? 'on' : ''}`} title={settings.prepaAuto ? t('dash.autoOn') : t('dash.autoOff')} />
              </div>
              <div className="dash-line num">{t('dash.docs', { n: docs.length })} · {t('dash.learn', { n: learn })} · {t('dash.cards', { n: cards })}</div>
              <div className="dash-sub">
                {[toSort > 0 && t('dash.toSort', { n: toSort }), ignored > 0 && t('dash.ignored', { n: ignored }), dups > 0 && t('dash.dups', { n: dups })].filter(Boolean).join(' · ') || ' '}
              </div>
              <div className="dash-sub">{settings.prepaLastSync ? t('dash.last', { t: ago(settings.prepaLastSync, t) }) : t('dash.never')}</div>
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-sm"
                  disabled={checking || prepaBusy}
                  onClick={async () => {
                    setChecking(true)
                    try {
                      const r = await call('prepa.autoNow')
                      if (r.state === 'error') toast(t('pp.autoOffline'), { kind: 'error' })
                      else if (r.state === 'done' && r.needLogin) toast(t('pp.autoLogin'))
                      else if (r.state === 'done' && r.result.downloaded + r.result.cards + r.result.events === 0) toast(t('pp.autoNothing'))
                      await bump()
                    } finally {
                      setChecking(false)
                    }
                  }}
                >
                  {checking || prepaBusy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  {t('dash.sync')}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => go({ name: 'prepa' })}>{t('dash.open')}</button>
              </div>
            </div>
          )}
          {showAi && ai && (
            <div className="card dash-card">
              <div className="dash-title">
                <BrainCircuit size={16} />
                {t('dash.ai')}
                <span className="spacer" />
                <span className={`dash-dot ${ai.ready ? 'on' : ''}`} />
              </div>
              <div className="dash-line">{ai.ready ? t('act.aiReady') : t('act.aiOff')} · {ai.provider === 'builtin' ? t('dash.local') : ai.provider}</div>
              <div className="dash-sub">{ai.model || ' '}</div>
              <div className="dash-sub num">{t('act.aiCalls', { n: ai.monthCalls })}</div>
              {ai.provider === 'builtin' && ai.model === 'light' && <div className="dash-sub" style={{ color: 'var(--hard)' }}>{t('dash.lightWarn')}</div>}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-sm" onClick={() => go({ name: 'ai' })}>{ai.provider === 'openrouter' && ai.hasKey ? t('dash.aiManage') : t('dash.aiKey')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
