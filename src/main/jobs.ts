import { newId } from './util'
import type { Job, JobLink } from '../shared/types'

/*
 * Tâches de fond (import du Cahier de Prépa, création de cartes, téléchargement du modèle IA…) :
 * un seul endroit pour voir ce qui tourne, où ça en est, et l'arrêter.
 */

interface Entry {
  job: Job
  onCancel?: () => void
}

const jobs = new Map<string, Entry>()
let sink: (list: Job[]) => void = () => undefined
let timer: ReturnType<typeof setTimeout> | null = null

export const setJobsSink = (s: (list: Job[]) => void): void => {
  sink = s
}

function notify(immediate = false): void {
  if (immediate) {
    if (timer) clearTimeout(timer)
    timer = null
    sink(listJobs())
    return
  }
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    sink(listJobs())
  }, 120)
}

/** En cours d'abord, puis les dernières tâches terminées. */
export function listJobs(): Job[] {
  const all = [...jobs.values()].map((e) => ({ ...e.job }))
  const running = all.filter((j) => j.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
  const ended = all.filter((j) => j.status !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 12)
  return [...running, ...ended]
}

export interface JobHandle {
  id: string
  /** Avancement : `done` sur `total` (0 = durée inconnue) et une ligne de détail. */
  set(done: number, total?: number, detail?: string): void
  finish(result: string): void
  fail(message: string): void
  /** Retire la tâche sans laisser de trace (rien à signaler). */
  discard(): void
  /** Lie la tâche à un document (une fiche créée) : un bouton « Ouvrir » apparaît dans l'activité. */
  attach(docId: string): void
  /** Écran qui s'ouvre quand on clique sur la tâche une fois terminée (le deck créé, la page de l'IA…). */
  link(target: JobLink): void
  /** Vrai dès que l'utilisateur a demandé l'arrêt. */
  readonly cancelled: boolean
}

export function startJob(kind: Job['kind'], title: string, opts: { cancellable?: boolean; onCancel?: () => void; detail?: string } = {}): JobHandle {
  const id = newId()
  const entry: Entry = {
    onCancel: opts.onCancel,
    job: { id, kind, title, status: 'running', done: 0, total: 0, detail: opts.detail ?? '', startedAt: Date.now(), endedAt: null, result: '', cancellable: opts.cancellable ?? false, cancelRequested: false }
  }
  jobs.set(id, entry)
  notify(true)
  const end = (status: Job['status'], result: string): void => {
    entry.job.status = status
    entry.job.endedAt = Date.now()
    entry.job.result = result
    entry.job.detail = ''
    notify(true)
  }
  return {
    id,
    set(done, total, detail) {
      entry.job.done = done
      if (total !== undefined) entry.job.total = total
      if (detail !== undefined) entry.job.detail = detail
      notify()
    },
    finish(result) {
      end(entry.job.cancelRequested ? 'cancelled' : 'done', result)
    },
    fail(message) {
      end('error', message)
    },
    discard() {
      jobs.delete(id)
      notify(true)
    },
    attach(docId) {
      entry.job.docId = docId
      notify()
    },
    link(target) {
      entry.job.link = target
      notify()
    },
    get cancelled() {
      return entry.job.cancelRequested
    }
  }
}

export function cancelJob(id: string): void {
  const e = jobs.get(id)
  if (!e || e.job.status !== 'running' || !e.job.cancellable) return
  e.job.cancelRequested = true
  e.job.detail = 'Arrêt en cours…'
  e.onCancel?.()
  notify(true)
}

export function cancelKind(kind: Job['kind']): void {
  for (const [id, e] of jobs) if (e.job.kind === kind && e.job.status === 'running') cancelJob(id)
}

export function clearEndedJobs(): void {
  for (const [id, e] of jobs) if (e.job.status !== 'running') jobs.delete(id)
  notify(true)
}
