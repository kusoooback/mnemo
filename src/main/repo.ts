import type {
  CardRow,
  DeckInfo,
  NoteCardInfo,
  NoteInput,
  NoteKind,
  NoteRecord,
  SearchQuery,
  SearchResult
} from '../shared/types'
import { getDb } from './db'
import { dayEnd, dayStart, deckScope, getSettings, newId } from './util'

/* ------------------------------------------------------------------ */
/* Notes : champs, cartes attendues, index plein texte                */
/* ------------------------------------------------------------------ */

const CLOZE_RE = /\{\{c(\d+)::/g

export function wantedOrds(kind: NoteKind, fields: Record<string, string>): number[] {
  if (kind === 'basic' || kind === 'typed') return [0]
  if (kind === 'basic-reverse') return [0, 1]
  if (kind === 'occlusion') {
    try {
      const boxes = JSON.parse(fields.boxes || '[]')
      return Array.isArray(boxes) ? boxes.map((_, i) => i + 1) : []
    } catch {
      return []
    }
  }
  const set = new Set<number>()
  for (const m of (fields.text ?? '').matchAll(CLOZE_RE)) set.add(Number(m[1]))
  return [...set].sort((a, b) => a - b)
}

function ftsContent(fields: Record<string, string>): string {
  if ('boxes' in fields) return fields.extra ?? '' // occlusion : ni l'adresse de l'image ni les coordonnées ne se cherchent
  return Object.values(fields)
    .join(' \n ')
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1')
}

const normTags = (tags: string[]): string[] =>
  [...new Set(tags.map((t) => t.trim().replace(/\s+/g, '_')).filter(Boolean))]
const tagsToDb = (tags: string[]): string => (tags.length ? ` ${normTags(tags).join(' ')} ` : '')
const tagsFromDb = (s: string): string[] => s.split(' ').filter(Boolean)

function ftsReplace(noteId: string, fields: Record<string, string>, tags: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(noteId)
  db.prepare('INSERT INTO note_fts(note_id, content, tags) VALUES (?, ?, ?)').run(
    noteId,
    ftsContent(fields),
    tags.join(' ')
  )
}

function insertCard(noteId: string, deckId: string, ord: number, now: number): void {
  getDb()
    .prepare(
      `INSERT INTO card(id, note_id, deck_id, ord, state, due, created_at, updated_at, meta_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
    )
    .run(newId(), noteId, deckId, ord, now + ord, now, now, now)
}

export function addNote(input: NoteInput): string {
  const db = getDb()
  const ords = wantedOrds(input.kind, input.fields)
  if (!ords.length) throw new Error(input.kind === 'occlusion' ? 'Dessine au moins une zone à masquer sur l’image.' : 'Une carte à trous doit contenir au moins un {{c1::trou}}.')
  const id = newId()
  const now = Date.now()
  const tags = normTags(input.tags)
  db.transaction(() => {
    db.prepare(
      'INSERT INTO note(id, kind, fields, tags, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, input.kind, JSON.stringify(input.fields), tagsToDb(tags), now, now, input.source ?? null)
    for (const ord of ords) insertCard(id, input.deckId, ord, now)
    ftsReplace(id, input.fields, tags)
  })()
  return id
}

export function updateNote(
  id: string,
  input: Omit<NoteInput, 'deckId'> & { deckId?: string }
): void {
  const db = getDb()
  const old = db.prepare('SELECT fields FROM note WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { fields: string }
    | undefined
  if (!old) throw new Error('Note introuvable')
  const ords = wantedOrds(input.kind, input.fields)
  if (!ords.length) throw new Error(input.kind === 'occlusion' ? 'Dessine au moins une zone à masquer sur l’image.' : 'Une carte à trous doit contenir au moins un {{c1::trou}}.')
  const now = Date.now()
  const tags = normTags(input.tags)
  db.transaction(() => {
    const newFields = JSON.stringify(input.fields)
    if (old.fields !== newFields) {
      db.prepare('INSERT INTO note_history(note_id, fields, changed_at) VALUES (?, ?, ?)').run(
        id,
        old.fields,
        now
      )
    }
    db.prepare('UPDATE note SET fields = ?, tags = ?, updated_at = ? WHERE id = ?').run(
      newFields,
      tagsToDb(tags),
      now,
      id
    )
    const cards = db
      .prepare('SELECT id, ord, reps, deck_id FROM card WHERE note_id = ? AND deleted_at IS NULL')
      .all(id) as { id: string; ord: number; reps: number; deck_id: string }[]
    const deckId = input.deckId ?? cards[0]?.deck_id
    const have = new Set(cards.map((c) => c.ord))
    for (const ord of ords) if (!have.has(ord) && deckId) insertCard(id, deckId, ord, now)
    // Un trou supprimé : on retire la carte si jamais révisée, sinon on la suspend (aucune perte d'historique).
    for (const c of cards) {
      if (ords.includes(c.ord)) continue
      if (c.reps === 0) {
        db.prepare('DELETE FROM card WHERE id = ?').run(c.id)
      } else {
        db.prepare('UPDATE card SET suspended = 1, updated_at = ?, meta_at = ? WHERE id = ?').run(now, now, c.id)
      }
    }
    if (input.deckId) {
      db.prepare('UPDATE card SET deck_id = ?, updated_at = ?, meta_at = ? WHERE note_id = ?').run(
        input.deckId,
        now,
        now,
        id
      )
    }
    ftsReplace(id, input.fields, tags)
  })()
}

export function deleteNotes(noteIds: string[]): void {
  const db = getDb()
  const now = Date.now()
  db.transaction(() => {
    for (const id of noteIds) {
      db.prepare('UPDATE note SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
      db.prepare('UPDATE card SET deleted_at = ?, updated_at = ?, meta_at = ? WHERE note_id = ?').run(now, now, now, id)
      db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(id)
    }
  })()
}

export function getNote(id: string): NoteRecord | null {
  const db = getDb()
  const n = db
    .prepare('SELECT * FROM note WHERE id = ? AND deleted_at IS NULL')
    .get(id) as Record<string, unknown> | undefined
  if (!n) return null
  const cards = db
    .prepare(
      `SELECT id, ord, state, due, suspended, deck_id FROM card
       WHERE note_id = ? AND deleted_at IS NULL ORDER BY ord`
    )
    .all(id) as {
    id: string
    ord: number
    state: number
    due: number
    suspended: number
    deck_id: string
  }[]
  return {
    id,
    kind: n.kind as NoteKind,
    fields: JSON.parse(n.fields as string),
    tags: tagsFromDb(n.tags as string),
    createdAt: n.created_at as number,
    updatedAt: n.updated_at as number,
    cards: cards.map(
      (c): NoteCardInfo => ({
        id: c.id,
        ord: c.ord,
        state: c.state as NoteCardInfo['state'],
        due: c.due,
        suspended: !!c.suspended,
        deckId: c.deck_id
      })
    )
  }
}

export function checkDuplicate(kind: NoteKind, firstField: string, excludeNoteId?: string): boolean {
  const key = kind === 'cloze' ? 'text' : 'front'
  const needle = firstField.trim().toLowerCase()
  if (!needle) return false
  const rows = getDb()
    .prepare(
      `SELECT id, fields FROM note
       WHERE deleted_at IS NULL AND kind ${kind === 'cloze' ? "= 'cloze'" : "!= 'cloze'"} AND id != ?`
    )
    .all(excludeNoteId ?? '') as { id: string; fields: string }[]
  return rows.some((r) => (JSON.parse(r.fields)[key] ?? '').trim().toLowerCase() === needle)
}

/* ------------------------------------------------------------------ */
/* Decks                                                               */
/* ------------------------------------------------------------------ */

export function createDeck(name: string, parentId: string | null): string {
  const db = getDb()
  const parts = name
    .split('::')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('Nom de deck vide')
  const now = Date.now()
  let parent = parentId
  return db.transaction(() => {
    for (const part of parts) {
      const existing = db
        .prepare(
          `SELECT id FROM deck WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE
           AND ${parent ? 'parent_id = ?' : 'parent_id IS NULL'}`
        )
        .get(...(parent ? [part, parent] : [part])) as { id: string } | undefined
      if (existing) {
        parent = existing.id
        continue
      }
      const id = newId()
      db.prepare(
        'INSERT INTO deck(id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, parent, part, now, now)
      parent = id
    }
    return parent as string
  })()
}

export function renameDeck(id: string, name: string): void {
  const clean = name.replace(/::/g, ' ').trim()
  if (!clean) return
  getDb().prepare('UPDATE deck SET name = ?, updated_at = ? WHERE id = ?').run(clean, Date.now(), id)
}

export function updateDeck(
  id: string,
  patch: { newPerDay?: number | null; color?: string | null }
): void {
  const db = getDb()
  const now = Date.now()
  if ('newPerDay' in patch)
    db.prepare('UPDATE deck SET new_per_day = ?, updated_at = ? WHERE id = ?').run(
      patch.newPerDay ?? null,
      now,
      id
    )
  if ('color' in patch)
    db.prepare('UPDATE deck SET color = ?, updated_at = ? WHERE id = ?').run(
      patch.color ?? null,
      now,
      id
    )
}

/** Suppression douce : decks, cartes et notes orphelines sont marqués, jamais effacés. */
export function deleteDeck(id: string): void {
  const db = getDb()
  const now = Date.now()
  const scope = deckScope('id', id)
  db.transaction(() => {
    const ids = (
      db.prepare(`SELECT id FROM deck WHERE ${scope.sql}`).all(scope.params) as { id: string }[]
    ).map((r) => r.id)
    for (const d of ids) {
      db.prepare('UPDATE deck SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, d)
      db.prepare('UPDATE card SET deleted_at = ?, updated_at = ?, meta_at = ? WHERE deck_id = ? AND deleted_at IS NULL').run(now, now, now, d)
    }
    const orphans = db
      .prepare(
        `SELECT id FROM note WHERE deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM card WHERE card.note_id = note.id AND card.deleted_at IS NULL)`
      )
      .all() as { id: string }[]
    for (const o of orphans) {
      db.prepare('UPDATE note SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, o.id)
      db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(o.id)
    }
  })()
}

interface DeckRow {
  id: string
  parent_id: string | null
  name: string
  color: string | null
  new_per_day: number | null
}

export function listDecks(): DeckInfo[] {
  const db = getDb()
  const now = Date.now()
  const rows = db
    .prepare('SELECT id, parent_id, name, color, new_per_day FROM deck WHERE deleted_at IS NULL')
    .all() as DeckRow[]

  const group = (sql: string, ...params: number[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const r of db.prepare(sql).all(...params) as { deck_id: string; n: number }[])
      m.set(r.deck_id, r.n)
    return m
  }
  const live = 'deleted_at IS NULL AND suspended = 0'
  const total = group(
    'SELECT deck_id, COUNT(*) n FROM card WHERE deleted_at IS NULL GROUP BY deck_id'
  )
  const newAvail = group(
    `SELECT deck_id, COUNT(*) n FROM card WHERE ${live} AND state = 0 AND buried_until <= ? GROUP BY deck_id`,
    now
  )
  const learn = group(
    `SELECT deck_id, COUNT(*) n FROM card WHERE ${live} AND state IN (1,3) AND due <= ? AND buried_until <= ? GROUP BY deck_id`,
    now + 20 * 60 * 1000,
    now
  )
  const due = group(
    `SELECT deck_id, COUNT(*) n FROM card WHERE ${live} AND state = 2 AND due <= ? AND buried_until <= ? GROUP BY deck_id`,
    dayEnd(now),
    now
  )
  const newToday = group(
    `SELECT c.deck_id, COUNT(*) n FROM review r JOIN card c ON c.id = r.card_id
     WHERE r.was_new = 1 AND r.reviewed_at >= ? GROUP BY c.deck_id`,
    dayStart(now)
  )

  const defaultLimit = getSettings().newPerDay
  const byParent = new Map<string | null, DeckRow[]>()
  for (const r of rows) {
    const k = r.parent_id && rows.some((x) => x.id === r.parent_id) ? r.parent_id : null
    byParent.set(k, [...(byParent.get(k) ?? []), r])
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  for (const list of byParent.values()) list.sort((a, b) => collator.compare(a.name, b.name))

  const out: DeckInfo[] = []
  type Sums = { total: number; avail: number; learn: number; due: number; today: number }
  const walk = (parent: string | null, depth: number, prefix: string): Sums => {
    const acc: Sums = { total: 0, avail: 0, learn: 0, due: 0, today: 0 }
    for (const r of byParent.get(parent) ?? []) {
      const full = prefix ? `${prefix}::${r.name}` : r.name
      const idx = out.length
      out.push({
        id: r.id,
        parentId: parent,
        name: r.name,
        fullName: full,
        depth,
        hasChildren: byParent.has(r.id),
        color: r.color,
        newPerDay: r.new_per_day,
        newCount: 0,
        learnCount: 0,
        dueCount: 0,
        totalCards: 0
      })
      const sub = walk(r.id, depth + 1, full)
      const own: Sums = {
        total: (total.get(r.id) ?? 0) + sub.total,
        avail: (newAvail.get(r.id) ?? 0) + sub.avail,
        learn: (learn.get(r.id) ?? 0) + sub.learn,
        due: (due.get(r.id) ?? 0) + sub.due,
        today: (newToday.get(r.id) ?? 0) + sub.today
      }
      const limit = r.new_per_day ?? defaultLimit
      out[idx].totalCards = own.total
      out[idx].newCount = Math.min(own.avail, Math.max(0, limit - own.today))
      out[idx].learnCount = own.learn
      out[idx].dueCount = own.due
      for (const k of Object.keys(acc) as (keyof Sums)[]) acc[k] += own[k]
    }
    return acc
  }
  walk(null, 0, '')
  return out
}

/* ------------------------------------------------------------------ */
/* Cartes : recherche et actions groupées                              */
/* ------------------------------------------------------------------ */

function ftsQuery(text: string): string | null {
  const tokens = text
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' ') : null
}

export function searchCards(q: SearchQuery): SearchResult {
  const db = getDb()
  const where: string[] = ['c.deleted_at IS NULL', 'n.deleted_at IS NULL']
  const params: Record<string, unknown> = {}

  const fts = ftsQuery(q.text)
  if (fts) {
    where.push('n.id IN (SELECT note_id FROM note_fts WHERE note_fts MATCH @fts)')
    params.fts = fts
  }
  const scope = deckScope('c.deck_id', q.deckId)
  where.push(scope.sql)
  Object.assign(params, scope.params)

  if (q.tag) {
    where.push('n.tags LIKE @tag')
    params.tag = `% ${q.tag} %`
  }
  switch (q.state) {
    case 'new':
      where.push('c.state = 0')
      break
    case 'learning':
      where.push('c.state IN (1,3)')
      break
    case 'review':
      where.push('c.state = 2')
      break
    case 'suspended':
      where.push('c.suspended = 1')
      break
    case 'due':
      where.push('c.state > 0 AND c.suspended = 0 AND c.due <= @dueBefore')
      params.dueBefore = dayEnd()
      break
  }
  const orderBy =
    {
      created: 'c.created_at DESC, c.ord',
      due: 'c.state = 0, c.due ASC',
      lapses: 'c.lapses DESC, c.reps DESC',
      alpha: "json_extract(n.fields, '$.front') COLLATE NOCASE, json_extract(n.fields, '$.text') COLLATE NOCASE"
    }[q.sort] ?? 'c.created_at DESC'

  const from = `FROM card c JOIN note n ON n.id = c.note_id JOIN deck d ON d.id = c.deck_id WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) n ${from}`).get(params) as { n: number }).n
  const rows = db
    .prepare(
      `SELECT c.id cardId, c.note_id noteId, n.kind, c.ord, c.deck_id deckId, d.name deckName,
              n.fields, n.tags, c.state, c.due, c.suspended, c.reps, c.lapses, c.stability,
              c.difficulty, c.created_at createdAt
       ${from} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: q.limit, offset: q.offset }) as (Omit<
    CardRow,
    'fields' | 'tags' | 'suspended'
  > & { fields: string; tags: string; suspended: number })[]

  return {
    total,
    rows: rows.map((r) => ({
      ...r,
      fields: JSON.parse(r.fields),
      tags: tagsFromDb(r.tags),
      suspended: !!r.suspended
    }))
  }
}

export function moveCards(cardIds: string[], deckId: string): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE card SET deck_id = ?, updated_at = ?, meta_at = ? WHERE id = ?')
  const now = Date.now()
  db.transaction(() => cardIds.forEach((id) => stmt.run(deckId, now, now, id)))()
}

export function suspendCards(cardIds: string[], suspended: boolean): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE card SET suspended = ?, updated_at = ?, meta_at = ? WHERE id = ?')
  const now = Date.now()
  db.transaction(() => cardIds.forEach((id) => stmt.run(suspended ? 1 : 0, now, now, id)))()
}

/** Remet des cartes à zéro (nouvelles). L'historique des révisions est conservé. */
export function resetCards(cardIds: string[]): void {
  const db = getDb()
  const stmt = db.prepare(
    `UPDATE card SET state = 0, due = ?, stability = 0, difficulty = 0, elapsed_days = 0,
       scheduled_days = 0, learning_steps = 0, reps = 0, lapses = 0, last_review = NULL, updated_at = ?,
       reset_at = ?, meta_at = ?
     WHERE id = ?`
  )
  const now = Date.now()
  db.transaction(() => cardIds.forEach((id) => stmt.run(now, now, now, now, id)))()
}

export function listTags(): string[] {
  const rows = getDb()
    .prepare("SELECT tags FROM note WHERE deleted_at IS NULL AND tags != ''")
    .all() as { tags: string }[]
  const set = new Set<string>()
  for (const r of rows) tagsFromDb(r.tags).forEach((t) => set.add(t))
  return [...set].sort((a, b) => a.localeCompare(b))
}
