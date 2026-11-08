import type { NoteKind, Rating, StudyCard, StudyCounts } from '../shared/types'
import { getDb } from './db'
import { gradeCard, previewIntervals, scheduler, type CardDbRow } from './scheduler'
import { dayEnd, dayStart, deckScope, getSettings, newId } from './util'

const LEARN_AHEAD = 20 * 60 * 1000
const HOUR = 3600 * 1000

/**
 * « Garantie avant l'échéance » : si un examen lié au deck de la carte approche, la prochaine révision ne peut pas
 * tomber après lui. La carte garde son état FSRS ; seule la date de retour est rapprochée, la veille de l'épreuve.
 */
export function examCap(deckId: string, now = Date.now()): number | null {
  if (!getSettings().prepaGuarantee) return null
  const row = getDb()
    .prepare(
      `WITH RECURSIVE up(id) AS (
         SELECT id FROM deck WHERE id = @deck
         UNION ALL SELECT d.parent_id FROM deck d JOIN up ON d.id = up.id WHERE d.parent_id IS NOT NULL
       )
       SELECT MIN(e.due_at) due FROM entry e JOIN entry_link l ON l.entry_id = e.id
       WHERE e.deleted_at IS NULL AND e.status = 'todo' AND e.kind = 'examen' AND e.due_at > @now AND l.deck_id IN (SELECT id FROM up)`
    )
    .get({ deck: deckId, now }) as { due: number | null }
  if (!row.due) return null
  const cap = row.due - 18 * HOUR
  return cap > now + 6 * HOUR ? cap : null
}

interface StudyRow extends CardDbRow {
  note_id: string
  deck_id: string
  ord: number
  kind: NoteKind
  fields: string
  tags: string
  deck_name: string
}

const SELECT = `SELECT c.*, n.kind, n.fields, n.tags, d.name deck_name
  FROM card c JOIN note n ON n.id = c.note_id JOIN deck d ON d.id = c.deck_id`

function toStudyCard(row: StudyRow, now = new Date()): StudyCard {
  const f = scheduler(getSettings().retention)
  return {
    cardId: row.id,
    noteId: row.note_id,
    deckId: row.deck_id,
    deckName: row.deck_name,
    kind: row.kind,
    ord: row.ord,
    fields: JSON.parse(row.fields),
    tags: row.tags.split(' ').filter(Boolean),
    state: row.state as StudyCard['state'],
    intervals: previewIntervals(f, row, now)
  }
}

function newLimit(deckId: string | null): number {
  const s = getSettings()
  if (!deckId) return s.newPerDay
  const r = getDb().prepare('SELECT new_per_day FROM deck WHERE id = ?').get(deckId) as
    | { new_per_day: number | null }
    | undefined
  return r?.new_per_day ?? s.newPerDay
}

function newStudiedToday(deckId: string | null): number {
  const scope = deckScope('c.deck_id', deckId)
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) n FROM review r JOIN card c ON c.id = r.card_id
         WHERE r.was_new = 1 AND r.reviewed_at >= @since AND ${scope.sql}`
      )
      .get({ since: dayStart(), ...scope.params }) as { n: number }
  ).n
}

export function counts(deckId: string | null): StudyCounts {
  const db = getDb()
  const now = Date.now()
  const scope = deckScope('c.deck_id', deckId)
  const base = `FROM card c WHERE c.deleted_at IS NULL AND c.suspended = 0 AND ${scope.sql}`
  const one = (extra: string, p: Record<string, unknown>): number =>
    (db.prepare(`SELECT COUNT(*) n ${base} AND ${extra}`).get({ ...scope.params, ...p }) as { n: number }).n
  const avail = one('c.state = 0 AND c.buried_until <= @now', { now })
  return {
    newCount: Math.min(avail, Math.max(0, newLimit(deckId) - newStudiedToday(deckId))),
    learnCount: one('c.state IN (1,3) AND c.due <= @la', { la: now + LEARN_AHEAD }),
    dueCount: one('c.state = 2 AND c.due <= @end AND c.buried_until <= @now', {
      end: dayEnd(now),
      now
    })
  }
}

export function next(deckId: string | null): StudyCard | null {
  const db = getDb()
  const now = Date.now()
  const scope = deckScope('c.deck_id', deckId)
  const base = `${SELECT} WHERE c.deleted_at IS NULL AND c.suspended = 0 AND n.deleted_at IS NULL AND ${scope.sql}`
  const get = (extra: string, p: Record<string, unknown>): StudyRow | undefined =>
    db.prepare(`${base} AND ${extra} LIMIT 1`).get({ ...scope.params, ...p }) as StudyRow | undefined

  // Ordre : apprentissage échu, révisions, nouvelles ; l'apprentissage « en avance » ne passe qu'en dernier.
  let row = get('c.state IN (1,3) AND c.due <= @now ORDER BY c.due', { now })
  if (!row)
    row = get('c.state = 2 AND c.due <= @end AND c.buried_until <= @now ORDER BY c.due', {
      end: dayEnd(now),
      now
    })
  if (!row && newStudiedToday(deckId) < newLimit(deckId))
    row = get('c.state = 0 AND c.buried_until <= @now ORDER BY c.created_at, c.ord', { now })
  if (!row) row = get('c.state IN (1,3) AND c.due <= @la ORDER BY c.due', { la: now + LEARN_AHEAD })
  return row ? toStudyCard(row, new Date(now)) : null
}

const STATE_COLS = [
  'state',
  'due',
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'learning_steps',
  'reps',
  'lapses',
  'last_review'
] as const

export function answer(cardId: string, rating: Rating, durationMs: number): void {
  const db = getDb()
  const row = db.prepare('SELECT * FROM card WHERE id = ?').get(cardId) as
    | (CardDbRow & { note_id: string })
    | undefined
  if (!row) throw new Error('Carte introuvable')
  const now = new Date()
  const f = scheduler(getSettings().retention)
  const updated = gradeCard(f, row, rating, now)
  const cap = examCap((row as unknown as { deck_id: string }).deck_id, now.getTime())
  if (cap !== null && updated.due.getTime() > cap) updated.due = new Date(cap)
  const before: Record<string, unknown> = {}
  for (const k of STATE_COLS) before[k] = (row as unknown as Record<string, unknown>)[k]

  db.transaction(() => {
    db.prepare(
      `UPDATE card SET state = ?, due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
         scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, last_review = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      updated.state,
      updated.due.getTime(),
      updated.stability,
      updated.difficulty,
      updated.elapsed_days,
      updated.scheduled_days,
      updated.learning_steps,
      updated.reps,
      updated.lapses,
      now.getTime(),
      now.getTime(),
      cardId
    )
    db.prepare(
      `INSERT INTO review(id, card_id, reviewed_at, rating, duration_ms, state_before, was_new, prev_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId(),
      cardId,
      now.getTime(),
      rating,
      Math.min(Math.max(0, Math.round(durationMs)), 10 * 60 * 1000),
      JSON.stringify(before),
      row.state === 0 ? 1 : 0,
      row.state
    )
    // Les nouvelles cartes sœurs (autre trou, sens inverse) attendent demain.
    db.prepare(
      'UPDATE card SET buried_until = ? WHERE note_id = ? AND id != ? AND state = 0'
    ).run(dayEnd(now.getTime()), row.note_id, cardId)
  })()
}

export function undo(): StudyCard | null {
  const db = getDb()
  const last = db
    .prepare("SELECT id, card_id, state_before FROM review WHERE state_before != '{}' ORDER BY reviewed_at DESC, rowid DESC LIMIT 1")
    .get() as { id: string; card_id: string; state_before: string } | undefined
  if (!last) return null
  const before = JSON.parse(last.state_before) as Record<string, unknown>
  db.transaction(() => {
    db.prepare(
      `UPDATE card SET state = @state, due = @due, stability = @stability, difficulty = @difficulty,
         elapsed_days = @elapsed_days, scheduled_days = @scheduled_days, learning_steps = @learning_steps,
         reps = @reps, lapses = @lapses, last_review = @last_review, updated_at = @now WHERE id = @id`
    ).run({ ...before, now: Date.now(), id: last.card_id })
    db.prepare('DELETE FROM review WHERE id = ?').run(last.id)
    db.prepare(
      `UPDATE card SET buried_until = 0 WHERE state = 0 AND note_id = (SELECT note_id FROM card WHERE id = ?)`
    ).run(last.card_id)
  })()
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(last.card_id) as StudyRow
  return toStudyCard(row)
}

export function bury(cardId: string): void {
  getDb().prepare('UPDATE card SET buried_until = ? WHERE id = ?').run(dayEnd(), cardId)
}
