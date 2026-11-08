import type { DayLoad, Entry, EntryKind, PlanItem, Subject, Task } from '../shared/types'
import { getDb } from './db'
import { scheduler } from './scheduler'
import { DAY, dayEnd, dayKey, dayStart, deckScope, getSettings, newId } from './util'

/* ---------- Matières ---------- */

export function listSubjects(): Subject[] {
  return (
    getDb()
      .prepare('SELECT id, name, color, coefficient, deck_id FROM subject WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE')
      .all() as { id: string; name: string; color: string; coefficient: number; deck_id: string | null }[]
  ).map((r) => ({ id: r.id, name: r.name, color: r.color, coefficient: r.coefficient, deckId: r.deck_id }))
}

export function saveSubject(s: Partial<Subject> & { name: string }): string {
  const db = getDb()
  const now = Date.now()
  const id = s.id ?? newId()
  const existing = db.prepare('SELECT id FROM subject WHERE id = ?').get(id)
  if (existing) {
    db.prepare('UPDATE subject SET name = ?, color = ?, coefficient = ?, deck_id = ?, updated_at = ?, deleted_at = NULL WHERE id = ?').run(
      s.name.trim(),
      s.color ?? '#c96442',
      s.coefficient ?? 1,
      s.deckId ?? null,
      now,
      id
    )
  } else {
    db.prepare('INSERT INTO subject(id, name, color, coefficient, deck_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      s.name.trim(),
      s.color ?? '#c96442',
      s.coefficient ?? 1,
      s.deckId ?? null,
      now,
      now
    )
  }
  return id
}

export function deleteSubject(id: string): void {
  const now = Date.now()
  getDb().prepare('UPDATE subject SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

/* ---------- Entrées du cahier ---------- */

export function listEntries(): Entry[] {
  const db = getDb()
  const links = db.prepare('SELECT entry_id, deck_id FROM entry_link').all() as { entry_id: string; deck_id: string }[]
  const byEntry = new Map<string, string[]>()
  for (const l of links) byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) ?? []), l.deck_id])
  return (
    db
      .prepare('SELECT id, subject_id, kind, title, notes, due_at, status FROM entry WHERE deleted_at IS NULL ORDER BY due_at IS NULL, due_at')
      .all() as { id: string; subject_id: string | null; kind: EntryKind; title: string; notes: string; due_at: number | null; status: 'todo' | 'done' }[]
  ).map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    kind: r.kind,
    title: r.title,
    notes: r.notes,
    dueAt: r.due_at,
    status: r.status,
    deckIds: byEntry.get(r.id) ?? []
  }))
}

export function saveEntry(e: Partial<Entry> & { title: string; kind: EntryKind }): string {
  const db = getDb()
  const now = Date.now()
  const id = e.id ?? newId()
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM entry WHERE id = ?').get(id)
    if (existing) {
      db.prepare('UPDATE entry SET subject_id = ?, kind = ?, title = ?, notes = ?, due_at = ?, status = ?, updated_at = ?, deleted_at = NULL WHERE id = ?').run(
        e.subjectId ?? null,
        e.kind,
        e.title.trim(),
        e.notes ?? '',
        e.dueAt ?? null,
        e.status ?? 'todo',
        now,
        id
      )
    } else {
      db.prepare('INSERT INTO entry(id, subject_id, kind, title, notes, due_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id,
        e.subjectId ?? null,
        e.kind,
        e.title.trim(),
        e.notes ?? '',
        e.dueAt ?? null,
        e.status ?? 'todo',
        now,
        now
      )
    }
    if (e.deckIds) {
      db.prepare('DELETE FROM entry_link WHERE entry_id = ?').run(id)
      for (const d of e.deckIds) db.prepare('INSERT OR IGNORE INTO entry_link(entry_id, deck_id) VALUES (?, ?)').run(id, d)
    }
  })()
  return id
}

export function deleteEntry(id: string): void {
  const now = Date.now()
  getDb().prepare('UPDATE entry SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

/* ---------- Tâches ---------- */

export function listTasks(): Task[] {
  return (
    getDb()
      .prepare('SELECT id, subject_id, title, due_at, done, recurrence FROM task WHERE deleted_at IS NULL ORDER BY done, due_at IS NULL, due_at')
      .all() as { id: string; subject_id: string | null; title: string; due_at: number | null; done: number; recurrence: Task['recurrence'] }[]
  ).map((r) => ({ id: r.id, subjectId: r.subject_id, title: r.title, dueAt: r.due_at, done: !!r.done, recurrence: r.recurrence }))
}

export function saveTask(t: Partial<Task> & { title: string }): string {
  const db = getDb()
  const now = Date.now()
  const id = t.id ?? newId()
  if (db.prepare('SELECT id FROM task WHERE id = ?').get(id)) {
    db.prepare('UPDATE task SET subject_id = ?, title = ?, due_at = ?, recurrence = ?, updated_at = ? WHERE id = ?').run(
      t.subjectId ?? null,
      t.title.trim(),
      t.dueAt ?? null,
      t.recurrence ?? 'none',
      now,
      id
    )
  } else {
    db.prepare('INSERT INTO task(id, subject_id, title, due_at, done, recurrence, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)').run(
      id,
      t.subjectId ?? null,
      t.title.trim(),
      t.dueAt ?? null,
      t.recurrence ?? 'none',
      now,
      now
    )
  }
  return id
}

/** Cocher une tâche récurrente la décale à la prochaine occurrence au lieu de la fermer. */
export function toggleTask(id: string, done: boolean): void {
  const db = getDb()
  const now = Date.now()
  const t = db.prepare('SELECT due_at, recurrence FROM task WHERE id = ?').get(id) as { due_at: number | null; recurrence: string } | undefined
  if (!t) return
  if (done && t.recurrence !== 'none') {
    const step = t.recurrence === 'daily' ? DAY : 7 * DAY
    let next = (t.due_at ?? now) + step
    while (next < now) next += step
    db.prepare('UPDATE task SET due_at = ?, updated_at = ? WHERE id = ?').run(next, now, id)
    return
  }
  db.prepare('UPDATE task SET done = ?, updated_at = ? WHERE id = ?').run(done ? 1 : 0, now, id)
}

export function deleteTask(id: string): void {
  const now = Date.now()
  getDb().prepare('UPDATE task SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

/* ---------- Planning ---------- */

/**
 * Pour chaque examen/devoir à venir lié à des decks : combien de cartes reste-t-il à apprendre et à quel rythme ?
 * Le planning ne touche jamais à l'ordre FSRS : il propose une limite de nouvelles cartes par jour,
 * que l'utilisateur accepte (ou non) depuis l'interface.
 */
export function planningItems(): PlanItem[] {
  const db = getDb()
  const now = Date.now()
  const subjects = new Map(listSubjects().map((s) => [s.id, s]))
  const out: PlanItem[] = []
  const deckName = db.prepare('SELECT name, new_per_day FROM deck WHERE id = ? AND deleted_at IS NULL')
  for (const e of listEntries()) {
    if (e.status === 'done' || !e.dueAt || e.dueAt < dayStart(now) || !e.deckIds.length) continue
    if (e.kind === 'cours') continue
    let total = 0
    let fresh = 0
    let dueNow = 0
    const names: string[] = []
    const limits: (number | null)[] = []
    for (const d of e.deckIds) {
      const row = deckName.get(d) as { name: string; new_per_day: number | null } | undefined
      if (!row) continue
      names.push(row.name)
      limits.push(row.new_per_day)
      const sc = deckScope('c.deck_id', d)
      const base = `FROM card c WHERE c.deleted_at IS NULL AND c.suspended = 0 AND ${sc.sql}`
      const one = (extra: string): number =>
        (db.prepare(`SELECT COUNT(*) n ${base} ${extra}`).get({ ...sc.params, end: dayEnd(now) }) as { n: number }).n
      total += one('')
      fresh += one('AND c.state = 0')
      dueNow += one('AND c.state > 0 AND c.due <= @end')
    }
    // Préparation estimée : part du programme encore en mémoire le jour J si l'élève ne révisait plus rien,
    // et nombre de cartes que le planning fera revoir avant l'épreuve.
    const f = scheduler(getSettings().retention)
    let retained = 0
    let counted = 0
    let revisitBefore = 0
    for (const d of e.deckIds) {
      const sc = deckScope('c.deck_id', d)
      const rows = db
        .prepare(`SELECT c.state, c.stability, c.last_review, c.due FROM card c WHERE c.deleted_at IS NULL AND c.suspended = 0 AND ${sc.sql}`)
        .all(sc.params) as { state: number; stability: number; last_review: number | null; due: number }[]
      for (const c of rows) {
        counted++
        if (c.state === 0) continue
        const elapsed = Math.max(0, (e.dueAt - (c.last_review ?? now)) / DAY)
        retained += f.forgetting_curve(elapsed, Math.max(0.1, c.stability))
        if (c.due <= e.dueAt) revisitBefore++
      }
    }
    const readiness = counted ? retained / counted : 0
    const daysLeft = Math.max(1, Math.ceil((e.dueAt - dayStart(now)) / DAY))
    const runway = Math.max(1, daysLeft - 2)
    const suggested = fresh > 0 ? Math.ceil(fresh / runway) : 0
    const learned = total - fresh
    // Hypothèse simple : chaque carte vue revient ~4 fois avant l'échéance.
    const avg = Math.round((fresh * 4 + dueNow) / Math.max(1, daysLeft))
    const subj = e.subjectId ? subjects.get(e.subjectId) : undefined
    out.push({
      entryId: e.id,
      title: e.title,
      subjectName: subj?.name ?? null,
      color: subj?.color ?? '#c96442',
      dueAt: e.dueAt,
      daysLeft,
      totalCards: total,
      newCards: fresh,
      learnedCards: learned,
      dueNow,
      suggestedNewPerDay: suggested,
      avgPerDay: avg,
      deckIds: e.deckIds,
      deckNames: names,
      currentLimits: limits,
      readiness,
      revisitBefore,
      kind: e.kind
    })
  }
  return out.sort((a, b) => a.dueAt - b.dueAt)
}

/** Charge par jour : cartes attendues (réelles) + nouvelles prévues par le planning, échéances et tâches. */
export function planningLoad(fromDay: string, days: number): DayLoad[] {
  const db = getDb()
  const [y, m, d] = fromDay.split('-').map(Number)
  const start = new Date(y, m - 1, d, 4, 0, 0, 0).getTime()
  const end = start + days * DAY
  const out: DayLoad[] = []
  const dueRows = db
    .prepare(
      `SELECT due FROM card WHERE deleted_at IS NULL AND suspended = 0 AND state IN (1,2,3) AND due >= @a AND due < @b`
    )
    .all({ a: start, b: end }) as { due: number }[]
  const overdue = (
    db
      .prepare(`SELECT COUNT(*) n FROM card WHERE deleted_at IS NULL AND suspended = 0 AND state IN (1,2,3) AND due < @a`)
      .get({ a: start }) as { n: number }
  ).n
  const subjects = new Map(listSubjects().map((s) => [s.id, s]))
  const entries = listEntries().filter((e) => e.dueAt && e.dueAt >= start && e.dueAt < end && e.status !== 'done')
  const tasks = listTasks().filter((t) => !t.done && t.dueAt && t.dueAt >= start && t.dueAt < end)
  const plan = planningItems()
  for (let i = 0; i < days; i++) {
    const t0 = start + i * DAY
    const key = dayKey(t0 + 5 * 3600 * 1000)
    let planned = 0
    for (const p of plan) if (t0 + DAY <= p.dueAt && p.suggestedNewPerDay) planned += p.suggestedNewPerDay
    out.push({
      day: key,
      due: dueRows.filter((r) => r.due >= t0 && r.due < t0 + DAY).length + (i === 0 ? overdue : 0),
      planned,
      entries: entries
        .filter((e) => (e.dueAt as number) >= t0 && (e.dueAt as number) < t0 + DAY)
        .map((e) => ({ id: e.id, title: e.title, kind: e.kind, color: (e.subjectId && subjects.get(e.subjectId)?.color) || '#c96442' })),
      tasks: tasks.filter((t) => (t.dueAt as number) >= t0 && (t.dueAt as number) < t0 + DAY).length
    })
  }
  return out
}

/* ---------- Fichier calendrier (.ics) ---------- */

const icsEscape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsDate = (ts: number): string => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Examens, devoirs et blocs de révision quotidiens, lisibles par Outlook, Google Agenda, Apple Calendrier… */
export function buildIcs(): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mnemo//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Mnémo']
  const stamp = icsDate(Date.now())
  const subjects = new Map(listSubjects().map((s) => [s.id, s.name]))
  const emit = (uid: string, start: number, endTs: number, summary: string, desc: string, allDay = false): void => {
    lines.push('BEGIN:VEVENT', `UID:${uid}@mnemo`, `DTSTAMP:${stamp}`)
    if (allDay) {
      const d = new Date(start)
      const p = (n: number): string => String(n).padStart(2, '0')
      lines.push(`DTSTART;VALUE=DATE:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`)
    } else lines.push(`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(endTs)}`)
    lines.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(desc)}`, 'END:VEVENT')
  }
  for (const e of listEntries()) {
    if (!e.dueAt || e.status === 'done') continue
    const subj = e.subjectId ? subjects.get(e.subjectId) : null
    const label = { cours: 'Cours', devoir: 'Devoir', examen: 'Examen', projet: 'Projet' }[e.kind]
    emit(`entry-${e.id}`, e.dueAt, e.dueAt + 3600_000, `${label} · ${e.title}${subj ? ` (${subj})` : ''}`, e.notes)
  }
  const now = Date.now()
  for (const p of planningItems()) {
    const days = Math.min(p.daysLeft, 60)
    for (let i = 0; i < days; i++) {
      const t0 = dayStart(now) + i * DAY + 16 * 3600_000
      const n = p.avgPerDay
      if (n > 0) emit(`rev-${p.entryId}-${i}`, t0, t0 + 20 * 60_000, `Réviser · ${p.title} (~${n} cartes)`, `Planning Mnémo pour ${p.title}`)
    }
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export function dueSummary(): { due: number; learning: number; fresh: number } {
  const db = getDb()
  const end = dayEnd()
  const one = (sql: string, p: unknown[] = []): number => (db.prepare(sql).get(...p) as { n: number }).n
  return {
    due: one("SELECT COUNT(*) n FROM card WHERE deleted_at IS NULL AND suspended = 0 AND state = 2 AND due <= ?", [end]),
    learning: one("SELECT COUNT(*) n FROM card WHERE deleted_at IS NULL AND suspended = 0 AND state IN (1,3) AND due <= ?", [Date.now() + 20 * 60000]),
    fresh: one('SELECT COUNT(*) n FROM card WHERE deleted_at IS NULL AND suspended = 0 AND state = 0')
  }
}
