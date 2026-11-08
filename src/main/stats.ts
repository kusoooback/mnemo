import type { DayStat, StatsData } from '../shared/types'
import { getDb } from './db'
import { DAY, dayEnd, dayKey, dayStart, deckScope } from './util'

const HISTORY_DAYS = 119 // 17 semaines

function firstLine(fields: string): string {
  const f = JSON.parse(fields) as Record<string, string>
  return (f.front ?? f.text ?? '')
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function getStats(deckId: string | null): StatsData {
  const db = getDb()
  const now = Date.now()
  const start = dayStart(now)
  const scope = deckScope('c.deck_id', deckId)
  const rv = `FROM review r JOIN card c ON c.id = r.card_id WHERE ${scope.sql}`
  const p = scope.params

  const today = db
    .prepare(
      `SELECT COUNT(*) reviews, COALESCE(SUM(r.was_new),0) newCards,
              COALESCE(SUM(r.duration_ms),0) timeMs, COALESCE(SUM(r.rating > 1),0) correct
       ${rv} AND r.reviewed_at >= @start`
    )
    .get({ ...p, start }) as StatsData['today']

  const histSince = start - HISTORY_DAYS * DAY
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', (r.reviewed_at - 14400000) / 1000, 'unixepoch', 'localtime') day,
              COUNT(*) count, SUM(r.rating > 1) correct
       ${rv} AND r.reviewed_at >= @since GROUP BY day`
    )
    .all({ ...p, since: histSince - DAY }) as DayStat[]
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const history: DayStat[] = []
  for (let i = HISTORY_DAYS; i >= 0; i--) {
    const d = new Date(start)
    d.setDate(d.getDate() - i)
    const key = dayKey(d.getTime() + 5 * 3600 * 1000)
    history.push(byDay.get(key) ?? { day: key, count: 0, correct: 0 })
  }

  // Série : jours consécutifs avec au moins une révision (aujourd'hui compris s'il y en a).
  let streak = 0
  const all = db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m-%d', (r.reviewed_at - 14400000) / 1000, 'unixepoch', 'localtime') day
       ${rv}`
    )
    .all(p) as { day: string }[]
  const days = new Set(all.map((r) => r.day))
  const cursor = new Date(start)
  if (!days.has(dayKey(cursor.getTime() + 5 * 3600 * 1000))) cursor.setDate(cursor.getDate() - 1)
  while (days.has(dayKey(cursor.getTime() + 5 * 3600 * 1000))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  // Rétention réelle : parmi les cartes déjà apprises, part des réponses autres que « À revoir ».
  const ret = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(r.rating > 1),0) ok
       ${rv} AND r.prev_state = 2 AND r.reviewed_at >= @since`
    )
    .get({ ...p, since: start - 30 * DAY }) as { n: number; ok: number }

  const end = dayEnd(now)
  const fc = db
    .prepare(
      `SELECT CASE WHEN c.due <= @end THEN 0 ELSE CAST((c.due - @end) / 86400000 AS INTEGER) + 1 END d, COUNT(*) n
       FROM card c WHERE c.deleted_at IS NULL AND c.suspended = 0 AND c.state IN (1,2,3) AND ${scope.sql}
       AND c.due < @horizon GROUP BY d`
    )
    .all({ ...p, end, horizon: end + 14 * DAY }) as { d: number; n: number }[]
  const forecast = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return { day: dayKey(d.getTime() + 5 * 3600 * 1000), count: fc.find((x) => x.d === i)?.n ?? 0 }
  })

  const st = db
    .prepare(
      `SELECT
         COALESCE(SUM(c.state = 0 AND c.suspended = 0),0) new,
         COALESCE(SUM(c.state IN (1,3) AND c.suspended = 0),0) learning,
         COALESCE(SUM(c.state = 2 AND c.suspended = 0 AND c.scheduled_days < 21),0) young,
         COALESCE(SUM(c.state = 2 AND c.suspended = 0 AND c.scheduled_days >= 21),0) mature,
         COALESCE(SUM(c.suspended = 1),0) suspended,
         COUNT(*) total
       FROM card c WHERE c.deleted_at IS NULL AND ${scope.sql}`
    )
    .get(p) as StatsData['states'] & { total: number }

  const totals = db
    .prepare(`SELECT COUNT(*) n, COALESCE(SUM(r.duration_ms),0) t ${rv}`)
    .get(p) as { n: number; t: number }

  const hardest = (
    db
      .prepare(
        `SELECT c.id cardId, n.fields, c.lapses, d.name deckName
         FROM card c JOIN note n ON n.id = c.note_id JOIN deck d ON d.id = c.deck_id
         WHERE c.deleted_at IS NULL AND c.lapses > 0 AND ${scope.sql}
         ORDER BY c.lapses DESC, c.difficulty DESC LIMIT 8`
      )
      .all(p) as { cardId: string; fields: string; lapses: number; deckName: string }[]
  ).map((r) => ({ cardId: r.cardId, front: firstLine(r.fields), lapses: r.lapses, deckName: r.deckName }))

  const { total, ...states } = st
  return {
    today,
    streak,
    retention: ret.n >= 5 ? ret.ok / ret.n : null,
    history,
    forecast,
    states,
    totalCards: total,
    totalReviews: totals.n,
    totalTimeMs: totals.t,
    hardest
  }
}
