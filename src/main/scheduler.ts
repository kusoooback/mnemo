import { fsrs, generatorParameters, type Card, type FSRS, type Grade } from 'ts-fsrs'
import type { Rating } from '../shared/types'

export interface CardDbRow {
  id: string
  state: number
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  last_review: number | null
}

let cached: { retention: number; f: FSRS } | null = null

/** Un ordonnanceur FSRS par objectif de rétention (recréé seulement si le réglage change). */
export function scheduler(retention: number): FSRS {
  if (!cached || cached.retention !== retention) {
    cached = {
      retention,
      f: fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true }))
    }
  }
  return cached.f
}

export function rowToCard(r: CardDbRow): Card {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    last_review: r.last_review ? new Date(r.last_review) : undefined
  }
}

export function previewIntervals(
  f: FSRS,
  row: CardDbRow,
  now: Date
): Record<Rating, number> {
  const p = f.repeat(rowToCard(row), now)
  const delta = (g: Grade): number => p[g].card.due.getTime() - now.getTime()
  return { 1: delta(1), 2: delta(2), 3: delta(3), 4: delta(4) }
}

export function gradeCard(f: FSRS, row: CardDbRow, rating: Rating, now: Date): Card {
  return f.next(rowToCard(row), now, rating as Grade).card
}
