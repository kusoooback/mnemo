import type { BrowserWindow } from 'electron'
import { Notification } from 'electron'
import { aiStatus } from './ai'
import { getDb } from './db'
import { getSettings, setSettings } from './util'
import { startJob, type JobHandle } from './jobs'
import { autoLogin, electronHttp } from './prepa-electron'
import { importPrepa, normalizeBase, scanSite } from './prepa'
import type { PrepaAutoEvent, PrepaImportOptions, PrepaImportResult, PrepaProgress } from '../shared/types'

type Emit = (win: BrowserWindow | null, type: string, payload?: unknown) => void

let running = false
let timer: ReturnType<typeof setInterval> | null = null

const REFRESH_MS = 2 * 60 * 60 * 1000

const empty = (): PrepaImportResult => ({ downloaded: 0, skipped: 0, failed: 0, decks: 0, cards: 0, summaries: 0, events: 0, warnings: [] })

const PHASE: Record<PrepaProgress['phase'], string> = {
  download: 'Téléchargement',
  read: 'Lecture du texte',
  triage: 'Tri du document',
  cards: 'Création des cartes',
  summary: 'Fiche de révision',
  done: 'Terminé',
  error: 'Erreur'
}

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`

/** Phrase de bilan d'un import, pour la tâche terminée et les notifications. */
export function summaryOf(r: PrepaImportResult): string {
  const parts: string[] = []
  if (r.downloaded) parts.push(plural(r.downloaded, 'nouveau document', 'nouveaux documents'))
  if (r.cards) parts.push(plural(r.cards, 'carte créée', 'cartes créées'))
  if (r.summaries) parts.push(plural(r.summaries, 'fiche', 'fiches'))
  if (r.duplicates) parts.push(plural(r.duplicates, 'doublon écarté', 'doublons écartés'))
  if (r.ignored) parts.push(`${r.ignored} sans cartes (énoncés, corrigés, infos pratiques)`)
  if (r.purged) parts.push(plural(r.purged, 'ancienne carte supprimée', 'anciennes cartes supprimées'))
  if (r.events) parts.push(plural(r.events, 'échéance', 'échéances'))
  if (r.failed) parts.push(plural(r.failed, 'échec', 'échecs'))
  return parts.length ? parts.join(' · ') : 'Rien de nouveau.'
}

/** Lance un import comme tâche de fond : avancement visible, arrêt possible entre deux documents. */
export async function runImportJob(
  title: string,
  opts: PrepaImportOptions,
  getWindow: () => BrowserWindow | null,
  emit: Emit,
  existing?: JobHandle
): Promise<PrepaImportResult> {
  const job = existing ?? startJob('prepa', title, { cancellable: true, detail: 'Préparation…' })
  const signal = {
    get cancelled() {
      return job.cancelled
    }
  }
  try {
    const r = await importPrepa(
      electronHttp(),
      opts,
      (p) => {
        job.set(p.index, p.total, p.phase === 'done' ? '' : `${PHASE[p.phase]} · ${p.title}`)
        emit(getWindow(), 'prepa-progress', p)
      },
      signal
    )
    job.finish(summaryOf(r))
    if (!job.cancelled) setSettings({ prepaLastSync: Date.now() })
    return r
  } catch (e) {
    job.fail((e as Error).message)
    throw e
  }
}

/**
 * Synchronisation automatique avec le Cahier de Prépa : se reconnecte (identifiants enregistrés ou session
 * conservée), repère les nouveaux documents, les télécharge, les trie, crée cartes / fiches / échéances.
 * Silencieuse hors ligne ; ne fait rien tant que l'élève n'a pas fait un premier import à la main.
 */
export async function runPrepaAuto(getWindow: () => BrowserWindow | null, emit: Emit, force = false): Promise<PrepaAutoEvent> {
  const s = getSettings()
  if (running) return { state: 'busy' }
  if (!force && !s.prepaAuto) return { state: 'off' }
  if (!s.prepaUrl.trim()) return { state: 'off' }
  running = true
  const send = (e: PrepaAutoEvent): PrepaAutoEvent => {
    emit(getWindow(), 'prepa-auto', e)
    return e
  }
  const job = startJob('prepa', 'Cahier de Prépa', { cancellable: true, detail: 'Recherche de nouveautés…' })
  try {
    const base = normalizeBase(s.prepaUrl)
    send({ state: 'start' })
    await autoLogin(base)
    const scan = await scanSite(electronHttp(), base)

    const db = getDb()
    const source = `cdp:${new URL(base).host}${new URL(base).pathname}`
    const onSite = new Set(scan.docs.map((d) => d.remoteId))
    const rows = db.prepare('SELECT remote_id, subject, folder, category, text, cards, cards_tried, summary FROM document WHERE source = ? AND deleted_at IS NULL').all(source) as {
      remote_id: string
      subject: string
      folder: string
      category: string
      text: string
      cards: number
      cards_tried: number
      summary: string
    }[]
    const known = new Set(rows.map((r) => r.remote_id))
    const fresh = scan.docs.filter((d) => !known.has(d.remoteId)).map((d) => d.remoteId)

    const ai = aiStatus()
    const bySite = new Map(scan.docs.map((d) => [d.remoteId, d]))
    const todo = new Set<string>(fresh)
    for (const r of rows) {
      if (!onSite.has(r.remote_id)) continue
      const d = bySite.get(r.remote_id)!
      const learn = ['cours', 'methode', 'vocabulaire'].includes(r.category)
      if (!r.category) todo.add(r.remote_id) // pas encore trié (ou ancienne version)
      else if (r.subject !== (d.subject || 'Général') || r.folder !== d.folder) todo.add(r.remote_id) // mal rangé
      else if (!r.text.trim()) todo.add(r.remote_id) // texte jamais extrait
      else if (ai.ready && learn && r.text.length > 250 && ((s.prepaMakeCards && r.cards === 0 && !r.cards_tried) || (s.prepaMakeSummary && !r.summary))) todo.add(r.remote_id)
    }

    let result = empty()
    if (todo.size > 0 || s.prepaNotebook) {
      result = await runImportJob(
        'Cahier de Prépa',
        { baseUrl: base, remoteIds: [...todo], deckRoot: s.prepaDeckRoot, addToNotebook: s.prepaNotebook, generateCards: s.prepaMakeCards, makeSummary: s.prepaMakeSummary, cardsPerDoc: s.prepaCardsPerDoc },
        getWindow,
        emit,
        job
      )
    } else job.discard()
    const quiet = result.downloaded + result.events + result.cards + result.summaries + (result.duplicates ?? 0) + (result.moved ?? 0) === 0
    if (quiet) job.discard()
    const needLogin = scan.protectedPages > 0 && !scan.loggedIn
    const e = send({ state: 'done', fresh: fresh.length, result, needLogin })
    if (!quiet) {
      emit(getWindow(), 'data-changed')
      const win = getWindow()
      if ((!win || !win.isFocused()) && Notification.isSupported()) new Notification({ title: 'Mnémo · Cahier de Prépa', body: summaryOf(result) }).show()
    }
    return e
  } catch (err) {
    // Hors ligne ou site indisponible : on réessaiera au prochain passage, sans déranger.
    job.discard()
    return send({ state: 'error', message: (err as Error).message })
  } finally {
    running = false
  }
}

/** Premier passage peu après le démarrage, puis toutes les deux heures tant que l'application reste ouverte. */
export function startPrepaAuto(getWindow: () => BrowserWindow | null, emit: Emit): void {
  if (process.env.MNEMO_QA_DIR) return
  setTimeout(() => void runPrepaAuto(getWindow, emit), 4000)
  timer = setInterval(() => void runPrepaAuto(getWindow, emit), REFRESH_MS)
}

export function stopPrepaAuto(): void {
  if (timer) clearInterval(timer)
  timer = null
}
