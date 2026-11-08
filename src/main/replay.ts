import type Database from 'better-sqlite3'
import { createEmptyCard, fsrs, generatorParameters, type FSRS, type Grade } from 'ts-fsrs'

let cached: { retention: number; f: FSRS } | null = null

/** Ordonnanceur sans aléa : rejouer le même historique donne toujours le même résultat, sur tous les PC. */
function deterministic(retention: number): FSRS {
  if (!cached || cached.retention !== retention) {
    cached = { retention, f: fsrs(generatorParameters({ request_retention: retention, enable_fuzz: false })) }
  }
  return cached.f
}

/**
 * Recalcule l'état d'ordonnancement d'une carte à partir de son historique de révisions.
 * C'est ce qui permet de fusionner deux PC sans conflit : les révisions s'additionnent.
 */
export function replayCard(db: Database.Database, cardId: string, retention: number): void {
  const card = db.prepare('SELECT created_at, reset_at FROM card WHERE id = ?').get(cardId) as
    | { created_at: number; reset_at: number }
    | undefined
  if (!card) return
  const reviews = db
    .prepare(
      'SELECT reviewed_at, rating FROM review WHERE card_id = ? AND reviewed_at >= ? ORDER BY reviewed_at, id'
    )
    .all(cardId, card.reset_at) as { reviewed_at: number; rating: number }[]

  const f = deterministic(retention)
  if (reviews.length === 0) {
    db.prepare(
      `UPDATE card SET state = 0, due = ?, stability = 0, difficulty = 0, elapsed_days = 0, scheduled_days = 0,
         learning_steps = 0, reps = 0, lapses = 0, last_review = NULL WHERE id = ?`
    ).run(card.created_at, cardId)
    return
  }
  let c = createEmptyCard(new Date(reviews[0].reviewed_at))
  for (const r of reviews) c = f.next(c, new Date(r.reviewed_at), r.rating as Grade).card
  db.prepare(
    `UPDATE card SET state = ?, due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
       learning_steps = ?, reps = ?, lapses = ?, last_review = ? WHERE id = ?`
  ).run(
    c.state,
    c.due.getTime(),
    c.stability,
    c.difficulty,
    c.elapsed_days,
    c.scheduled_days,
    c.learning_steps,
    c.reps,
    c.lapses,
    c.last_review ? c.last_review.getTime() : null,
    cardId
  )
}
