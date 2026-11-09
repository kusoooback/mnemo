import { Activity, AlertCircle, CheckCircle2, Loader2, Square, Trash2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiStatus, Job, JobLink } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'

const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** Écran qu'ouvre la tâche terminée : celui de son résultat, sinon la page du type de tâche. */
function jobTarget(job: Job): JobLink {
  if (job.docId) return { name: 'doc', id: job.docId }
  if (job.link) return job.link
  if (job.kind === 'cards') return { name: 'library' }
  if (job.kind === 'summary') return { name: 'sheets' }
  if (job.kind === 'model') return { name: 'ai' }
  return { name: 'prepa' }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const h = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(h)
  }, [active])
  return now
}

/** Une tâche : titre, étape en cours, barre de progression, temps restant estimé, arrêt. */
export function JobRow({ job, compact = false }: { job: Job; compact?: boolean }): React.JSX.Element {
  const t = useT()
  const running = job.status === 'running'
  const now = useNow(running)
  const go = useStore((s) => s.go)
  const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : null
  const elapsed = (job.endedAt ?? now) - job.startedAt
  const eta = running && job.total > 0 && job.done >= 2 ? (elapsed / job.done) * (job.total - job.done) : null
  const Icon = running ? Loader2 : job.status === 'done' ? CheckCircle2 : job.status === 'cancelled' ? XCircle : AlertCircle
  const open = !running ? (): void => go(jobTarget(job)) : undefined
  return (
    <div
      className={`job s-${job.status} ${compact ? 'compact' : ''} ${open ? 'link' : ''}`}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={open}
      onKeyDown={open ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()) : undefined}
    >
      <Icon size={17} className={`job-ic ${running ? 'spin' : ''}`} />
      <div className="job-main">
        <div className="job-top">
          <span className="job-title">{job.title}</span>
          {running && pct !== null && <span className="num job-pct">{pct} %</span>}
        </div>
        {running ? (
          <>
            <div className={`bar ${pct === null ? 'indeterminate' : ''}`}>
              <i style={pct === null ? undefined : { width: `${pct}%` }} />
            </div>
            <div className="job-detail">
              {job.total > 0 && job.kind !== 'model' && <span className="num">{job.done}/{job.total} · </span>}
              {job.detail || t('act.working')}
              {eta !== null && <span> · {t('act.eta', { t: clock(eta) })}</span>}
              <span className="faint"> · {clock(elapsed)}</span>
            </div>
          </>
        ) : (
          <div className="job-detail">
            {job.result || (job.status === 'cancelled' ? t('act.cancelled') : '')} <span className="faint">· {clock(elapsed)}</span>
          </div>
        )}
      </div>
      {!running && job.docId && (
        <button className="btn btn-sm btn-dark" onClick={(e) => (e.stopPropagation(), go({ name: 'doc', id: job.docId as string }))}>
          {t('act.open')}
        </button>
      )}
      {running && job.cancellable && (
        <button className="btn btn-sm" disabled={job.cancelRequested} onClick={() => void call('jobs.cancel', job.id)}>
          <Square size={12} />
          {job.cancelRequested ? t('act.stopping') : t('act.stop')}
        </button>
      )}
    </div>
  )
}

/** Tout ce qui tourne en arrière-plan, puis l'historique récent, et l'usage de l'IA. */
export function ActivityPanel(): React.JSX.Element {
  const t = useT()
  const jobs = useStore((s) => s.jobs)
  const [ai, setAi] = useState<AiStatus | null>(null)
  useEffect(() => {
    void call('ai.status').then(setAi)
  }, [jobs.length])
  const running = jobs.filter((j) => j.status === 'running')
  const ended = jobs.filter((j) => j.status !== 'running')
  return (
    <div className="activity-panel">
      <div className="act-head">
        <b>{t('act.title')}</b>
        <span className="spacer" />
        {ended.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => void call('jobs.clear')}>
            <Trash2 size={13} />
            {t('act.clear')}
          </button>
        )}
      </div>
      {jobs.length === 0 && <p className="muted" style={{ padding: '6px 2px 10px' }}>{t('act.empty')}</p>}
      {running.map((j) => <JobRow key={j.id} job={j} />)}
      {ended.length > 0 && <div className="eyebrow" style={{ margin: '12px 0 6px' }}>{t('act.recent')}</div>}
      {ended.map((j) => <JobRow key={j.id} job={j} compact />)}
      {ai && (
        <div className="act-usage">
          <span>{t('act.ai')}</span>
          <span className="spacer" />
          <span className="num">{ai.ready ? t('act.aiReady') : t('act.aiOff')} · {t('act.aiCalls', { n: ai.monthCalls })}</span>
        </div>
      )}
    </div>
  )
}

/** Bouton « Activité » avec pastille : ouvre le panneau complet. */
export function ActivityButton({ onClick, open }: { onClick: () => void; open: boolean }): React.JSX.Element {
  const t = useT()
  const running = useStore((s) => s.jobs.filter((j) => j.status === 'running').length)
  return (
    <button className={`btn btn-sm activity-btn ${open ? 'on' : ''}`} onClick={onClick}>
      {running > 0 ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
      {t('act.title')}
      {running > 0 && <span className="act-badge">{running}</span>}
    </button>
  )
}
