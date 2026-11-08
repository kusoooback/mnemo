import { v7 as uuidv7 } from 'uuid'
import type { Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { getDb } from './db'

export const newId = (): string => uuidv7()

const HOUR = 3600 * 1000
export const DAY = 24 * HOUR
/** Le "jour d'étude" commence à 4 h, comme dans la plupart des logiciels de répétition espacée. */
const ROLLOVER_HOURS = 4

export function dayStart(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(ROLLOVER_HOURS, 0, 0, 0)
  if (d.getTime() > now) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export function dayEnd(now = Date.now()): number {
  const d = new Date(dayStart(now))
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function dayKey(ts: number): string {
  const d = new Date(ts - ROLLOVER_HOURS * HOUR)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM setting').all() as {
    key: string
    value: string
  }[]
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) {
      try {
        out[r.key] = JSON.parse(r.value)
      } catch {
        /* valeur corrompue : on garde le défaut */
      }
    }
  }
  return out as unknown as Settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v))
    }
  })()
  return getSettings()
}

/** Fragment SQL : la carte appartient au deck (ou à un de ses sous-decks). */
export function deckScope(
  column: string,
  deckId: string | null
): { sql: string; params: Record<string, string> } {
  if (!deckId) return { sql: '1=1', params: {} }
  return {
    sql: `${column} IN (WITH RECURSIVE sub(id) AS (
      SELECT id FROM deck WHERE id = @scopeDeck AND deleted_at IS NULL
      UNION ALL
      SELECT d.id FROM deck d JOIN sub s ON d.parent_id = s.id WHERE d.deleted_at IS NULL
    ) SELECT id FROM sub)`,
    params: { scopeDeck: deckId }
  }
}
