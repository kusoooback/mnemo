import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { unzipSync, zipSync } from 'fflate'
import { marked } from 'marked'
import { zstdDecompressSync } from 'zlib'
import type { AnkiImportReport, AnkiSummary, NoteKind } from '../shared/types'
import { saveImage } from './data'
import { getDb, mediaDir } from './db'
import { addNote, createDeck } from './repo'
import { renderOcclusion } from './occlusion'
import { replayCard } from './replay'
import { getSettings, newId } from './util'

/* ------------------------------------------------------------------ */
/* Outils : protobuf minimal (format .apkg récent) et HTML ⇄ Markdown  */
/* ------------------------------------------------------------------ */

interface PbField {
  field: number
  wire: number
  num: number
  bytes: Buffer
}

function* pbFields(buf: Buffer): Generator<PbField> {
  let i = 0
  const varint = (): number => {
    let result = 0
    let mul = 1
    while (i < buf.length) {
      const b = buf[i++]
      result += (b & 0x7f) * mul
      if (!(b & 0x80)) break
      mul *= 128
    }
    return result
  }
  while (i < buf.length) {
    const tag = varint()
    const field = Math.floor(tag / 8)
    const wire = tag & 7
    if (wire === 0) yield { field, wire, num: varint(), bytes: Buffer.alloc(0) }
    else if (wire === 2) {
      const len = varint()
      yield { field, wire, num: 0, bytes: buf.subarray(i, i + len) }
      i += len
    } else if (wire === 1) {
      i += 8
    } else if (wire === 5) {
      i += 4
    } else return
  }
}

const isZstd = (b: Buffer): boolean => b.length > 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd
const maybeZstd = (b: Buffer): Buffer => (isZstd(b) ? zstdDecompressSync(b) : b)

const ENTITIES: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'" }

export function htmlToMarkdown(html: string, media: Map<string, string>): string {
  let s = html.replace(/\r/g, '')
  s = s.replace(/<img[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi, (_m, src: string) => {
    let name = src
    try {
      name = decodeURIComponent(src)
    } catch {
      /* nom brut */
    }
    const url = media.get(name) ?? media.get(src)
    return url ? `\n\n![](${url})\n\n` : ''
  })
  s = s.replace(/\[sound:[^\]]+\]/g, '')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|tr|h[1-6]|ul|ol)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isNaN(code) ? m : String.fromCodePoint(code)
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
  s = s
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => `$$${t.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => `$${t.trim()}$`)
    .replace(/\[\$\$\]([\s\S]+?)\[\/\$\$\]/g, (_m, t: string) => `$$${t.trim()}$$`)
    .replace(/\[\$\]([\s\S]+?)\[\/\$\]/g, (_m, t: string) => `$${t.trim()}$`)
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function markdownToHtml(md: string, media: Map<string, string>): string {
  // Les formules sont mises à l'abri : Markdown mangerait les antislashs de \( \) et \[ \].
  const maths: string[] = []
  const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const stash = (open: string, close: string, t: string): string => {
    maths.push(`${open}${esc(t)}${close}`)
    return `@@MATH${maths.length - 1}@@`
  }
  const withMath = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => stash('\\[', '\\]', t))
    .replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_m, t: string) => stash('\\(', '\\)', t))
    .replace(/mnemo-media:\/\/([a-f0-9]{64}\.\w+)/g, (_m, f: string) => {
      media.set(f, f)
      return f
    })
  const html = (marked.parse(withMath, { async: false, breaks: true }) as string).trim()
  return html.replace(/@@MATH(\d+)@@/g, (_m, i: string) => maths[Number(i)])
}

/* ------------------------------------------------------------------ */
/* Lecture d'un paquet Anki                                            */
/* ------------------------------------------------------------------ */

interface AnkiModel {
  id: number
  name: string
  cloze: boolean
  fields: string[]
  qfmts: string[]
}
interface AnkiNote {
  id: number
  guid: string
  mid: number
  tags: string
  flds: string
}
interface AnkiCard {
  id: number
  nid: number
  did: number
  ord: number
  type: number
  queue: number
  due: number
  ivl: number
  reps: number
  lapses: number
}
interface AnkiRev {
  id: number
  cid: number
  ease: number
  time: number
  type: number
}
export interface AnkiCollection {
  crt: number
  models: Map<number, AnkiModel>
  decks: Map<number, string>
  notes: AnkiNote[]
  cards: AnkiCard[]
  revlog: AnkiRev[]
}

function readLegacy(db: Database.Database): AnkiCollection {
  const col = db.prepare('SELECT crt, models, decks FROM col').get() as { crt: number; models: string; decks: string }
  const models = new Map<number, AnkiModel>()
  for (const m of Object.values(JSON.parse(col.models) as Record<string, any>)) {
    models.set(Number(m.id), {
      id: Number(m.id),
      name: m.name,
      cloze: m.type === 1,
      fields: (m.flds as { name: string; ord: number }[]).sort((a, b) => a.ord - b.ord).map((f) => f.name),
      qfmts: (m.tmpls as { qfmt: string; ord: number }[]).sort((a, b) => a.ord - b.ord).map((t) => t.qfmt)
    })
  }
  const decks = new Map<number, string>()
  for (const d of Object.values(JSON.parse(col.decks) as Record<string, any>)) decks.set(Number(d.id), String(d.name))
  return {
    crt: col.crt,
    models,
    decks,
    notes: db.prepare('SELECT id, guid, mid, tags, flds FROM notes').all() as AnkiNote[],
    cards: db.prepare('SELECT id, nid, did, ord, type, queue, due, ivl, reps, lapses FROM cards').all() as AnkiCard[],
    revlog: db.prepare('SELECT id, cid, ease, time, type FROM revlog').all() as AnkiRev[]
  }
}

function readModern(db: Database.Database): AnkiCollection {
  const col = db.prepare('SELECT crt FROM col').get() as { crt: number }
  const models = new Map<number, AnkiModel>()
  // Les index d'Anki utilisent une collation maison (« unicase ») : on lit les tables entières, config comprise, pour ne jamais les emprunter.
  const fieldRows = new Map<number, { ord: number; name: string }[]>()
  for (const r of db.prepare('SELECT ntid, ord, name, config FROM fields').all() as { ntid: number; ord: number; name: string }[])
    fieldRows.set(Number(r.ntid), [...(fieldRows.get(Number(r.ntid)) ?? []), { ord: r.ord, name: r.name }])
  const tmplRows = new Map<number, { ord: number; config: Buffer }[]>()
  for (const r of db.prepare('SELECT ntid, ord, name, config FROM templates').all() as { ntid: number; ord: number; config: Buffer }[])
    tmplRows.set(Number(r.ntid), [...(tmplRows.get(Number(r.ntid)) ?? []), { ord: r.ord, config: r.config }])
  for (const nt of db.prepare('SELECT id, name, config FROM notetypes').all() as { id: number; name: string; config: Buffer }[]) {
    let kind = 0
    for (const f of pbFields(nt.config)) if (f.field === 1 && f.wire === 0) kind = f.num
    const fields = (fieldRows.get(Number(nt.id)) ?? []).sort((a, b) => a.ord - b.ord).map((x) => x.name)
    const qfmts = (tmplRows.get(Number(nt.id)) ?? []).sort((a, b) => a.ord - b.ord).map((t) => {
      for (const f of pbFields(t.config)) if (f.field === 1 && f.wire === 2) return f.bytes.toString('utf8')
      return ''
    })
    models.set(Number(nt.id), { id: Number(nt.id), name: nt.name, cloze: kind === 1, fields, qfmts })
  }
  const decks = new Map<number, string>()
  for (const d of db.prepare('SELECT id, name FROM decks').all() as { id: number; name: string }[])
    decks.set(Number(d.id), d.name.replace(/\x1f/g, '::'))
  return {
    crt: col.crt,
    models,
    decks,
    notes: db.prepare('SELECT id, guid, mid, tags, flds FROM notes').all() as AnkiNote[],
    cards: db.prepare('SELECT id, nid, did, ord, type, queue, due, ivl, reps, lapses FROM cards').all() as AnkiCard[],
    revlog: db.prepare('SELECT id, cid, ease, time, type FROM revlog').all() as AnkiRev[]
  }
}


/**
 * Les collections Anki récentes déclarent une collation maison (« unicase ») que SQLite ne connaît pas :
 * toute requête sur ces tables échoue. On ne travaille jamais que sur une copie, dont on retire la déclaration.
 */
function openAnkiDb(src: Buffer | string): Database.Database {
  let db = new Database(src as string)
  const needs = (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE sql LIKE '%unicase%'").get() as { n: number }).n > 0
  if (!needs) return db
  db.unsafeMode(true)
  db.pragma('writable_schema = ON')
  db.exec("UPDATE sqlite_master SET sql = replace(sql, 'COLLATE unicase', '') WHERE sql LIKE '%unicase%'")
  db.pragma('writable_schema = OFF')
  if (typeof src === 'string') {
    db.close()
    db = new Database(src)
  } else {
    const buf = db.serialize()
    db.close()
    db = new Database(buf)
  }
  return db
}

const IMG_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

function chooseKind(m: AnkiModel | undefined): { kind: NoteKind; extraTemplates: number } {
  if (!m) return { kind: 'basic', extraTemplates: 0 }
  if (m.cloze) return { kind: 'cloze', extraTemplates: 0 }
  if (/type in the answer|saisie/i.test(m.name) || /\{\{type:/i.test(m.qfmts[0] ?? '')) return { kind: 'typed', extraTemplates: Math.max(0, m.qfmts.length - 1) }
  if (m.qfmts.length >= 2 && m.fields.length >= 2) {
    const [a, b] = m.fields
    const q2 = m.qfmts[1]
    if (q2.includes(`{{${b}}}`) && !q2.includes(`{{${a}}}`)) return { kind: 'basic-reverse', extraTemplates: m.qfmts.length - 2 }
  }
  return { kind: 'basic', extraTemplates: Math.max(0, m.qfmts.length - 1) }
}

/* ------------------------------------------------------------------ */
/* Sources Anki : paquet .apkg ou profil Anki installé sur ce PC        */
/* ------------------------------------------------------------------ */

export interface AnkiSource {
  label: string
  coll: AnkiCollection
  /** Fichiers médias disponibles (nom Anki -> lecteur paresseux). */
  media: Map<string, () => Buffer | null>
  warnings: string[]
}

export function openApkg(file: Buffer): AnkiSource {
  const warnings: string[] = []
  let zip: Record<string, Uint8Array>
  try {
    zip = unzipSync(new Uint8Array(file))
  } catch {
    throw new Error('Ce fichier n’est pas un paquet Anki valide (.apkg).')
  }
  const names = Object.keys(zip)
  const dbName = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => names.includes(n))
  if (!dbName) throw new Error('Aucune collection trouvée dans ce paquet.')
  const modern = dbName === 'collection.anki21b'
  const raw = Buffer.from(zip[dbName])
  const sql = openAnkiDb(modern ? maybeZstd(raw) : raw)
  let coll: AnkiCollection
  try {
    coll = modern ? readModern(sql) : readLegacy(sql)
  } finally {
    sql.close()
  }
  const media = new Map<string, () => Buffer | null>()
  if (zip.media) {
    const rawMedia = Buffer.from(zip.media)
    try {
      const index = new Map<string, string>()
      if (modern) {
        let idx = 0
        for (const f of pbFields(maybeZstd(rawMedia))) {
          if (f.field !== 1 || f.wire !== 2) continue
          for (const g of pbFields(f.bytes)) if (g.field === 1 && g.wire === 2) index.set(String(idx), g.bytes.toString('utf8'))
          idx++
        }
      } else {
        for (const [k, v] of Object.entries(JSON.parse(rawMedia.toString('utf8')) as Record<string, string>)) index.set(k, v)
      }
      for (const [entry, fname] of index) {
        media.set(fname, () => {
          const data = zip[entry]
          return data ? maybeZstd(Buffer.from(data)) : null
        })
      }
    } catch {
      warnings.push('Liste des médias illisible : images ignorées.')
    }
  }
  return { label: 'paquet', coll, media, warnings }
}

/** Dossiers de profils Anki trouvés sur ce PC (Anki doit être fermé pour lire la collection). */
export function findAnkiProfiles(): { name: string; dir: string; size: number; modified: number }[] {
  const base =
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? '', 'Anki2')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'Anki2')
        : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'Anki2')
  if (!existsSync(base)) return []
  const out: { name: string; dir: string; size: number; modified: number }[] = []
  for (const name of readdirSync(base)) {
    const dir = join(base, name)
    const file = join(dir, 'collection.anki2')
    try {
      if (statSync(dir).isDirectory() && existsSync(file)) {
        const st = statSync(file)
        out.push({ name, dir, size: st.size, modified: st.mtimeMs })
      }
    } catch {
      /* dossier illisible */
    }
  }
  return out
}

export function openAnkiProfile(dir: string): AnkiSource {
  const file = join(dir, 'collection.anki2')
  if (!existsSync(file)) throw new Error('Collection Anki introuvable.')
  // On travaille sur une copie : la base d'Anki n'est jamais touchée.
  const work = mkdtempSync(join(tmpdir(), 'mnemo-anki-'))
  const tmp = join(work, 'collection.anki2')
  let coll: AnkiCollection
  try {
    try {
      copyFileSync(file, tmp)
      if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${tmp}-wal`)
    } catch {
      throw new Error('Impossible de lire la collection : ferme Anki (y compris dans la barre des tâches) puis réessaie.')
    }
    const sql = openAnkiDb(tmp)
    try {
      const hasNotetypes = !!sql.prepare("SELECT 1 FROM sqlite_master WHERE name = 'notetypes'").get()
      coll = hasNotetypes ? readModern(sql) : readLegacy(sql)
    } finally {
      sql.close()
    }
  } finally {
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {
      /* copie temporaire : le système la nettoiera */
    }
  }
  const mediaDir = join(dir, 'collection.media')
  const media = new Map<string, () => Buffer | null>()
  if (existsSync(mediaDir)) {
    for (const f of readdirSync(mediaDir)) {
      if (f.startsWith('_')) continue
      media.set(f, () => {
        try {
          return readFileSync(join(mediaDir, f))
        } catch {
          return null
        }
      })
    }
  }
  return { label: 'profil Anki', coll, media, warnings: [] }
}

/** Aperçu sans rien écrire : combien de notes, et combien sont déjà dans Mnémo. */
export function summarizeAnki(src: AnkiSource): AnkiSummary {
  const db = getDb()
  const known = new Set(
    (db.prepare("SELECT source FROM note WHERE source LIKE 'anki:%' AND deleted_at IS NULL").all() as { source: string }[]).map((r) => r.source)
  )
  const withCards = new Set(src.coll.cards.map((c) => c.nid))
  const notes = src.coll.notes.filter((n) => withCards.has(n.id))
  const decks = new Set<string>()
  for (const c of src.coll.cards) {
    const d = src.coll.decks.get(c.did)
    if (d && !/^(Default|Par défaut)$/.test(d)) decks.add(d)
  }
  return {
    notes: notes.length,
    cards: src.coll.cards.length,
    decks: [...decks].sort(),
    reviews: src.coll.revlog.length,
    newNotes: notes.filter((n) => !known.has(`anki:${n.guid}`)).length,
    known: notes.filter((n) => known.has(`anki:${n.guid}`)).length
  }
}

/**
 * Importe une collection Anki. Sans risque de doublon : chaque note garde l'identifiant Anki (guid),
 * donc réimporter plus tard n'ajoute que les nouvelles notes et les nouvelles révisions faites entre-temps.
 */
export function importAnkiSource(src: AnkiSource): AnkiImportReport {
  const coll = src.coll
  const report: AnkiImportReport = { decks: 0, notes: 0, existing: 0, cards: 0, reviews: 0, media: 0, skipped: 0, warnings: [...src.warnings] }

  // --- médias : seules les images réellement utilisées par les cartes sont reprises
  const mediaMap = new Map<string, string>()
  const used = new Set<string>()
  let audio = 0
  for (const n of coll.notes) {
    for (const m of n.flds.matchAll(/<img[^>]*?src\s*=\s*["']([^"']+)["']/gi)) {
      used.add(m[1])
      try {
        used.add(decodeURIComponent(m[1]))
      } catch {
        /* nom brut seulement */
      }
    }
    audio += (n.flds.match(/\[sound:/g) ?? []).length
  }
  let missing = 0
  for (const fname of used) {
    if (mediaMap.has(fname)) continue
    const ext = fname.split('.').pop()?.toLowerCase() ?? ''
    const reader = src.media.get(fname)
    if (!reader) {
      if (!used.has(encodeURIComponent(fname)) && !fname.includes('%')) missing++
      continue
    }
    if (!IMG_MIME[ext]) continue
    try {
      const buf = reader()
      if (!buf) continue
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      mediaMap.set(fname, saveImage(ab, IMG_MIME[ext]))
      report.media++
    } catch {
      missing++
    }
  }
  if (audio) report.warnings.push(`${audio} son(s) non repris : l’audio n’est pas encore géré.`)
  if (missing) report.warnings.push(`${missing} image(s) introuvable(s) dans le paquet.`)

  const db = getDb()
  const deckIds = new Map<number, string>()
  const noteToCards = new Map<number, AnkiCard[]>()
  for (const c of coll.cards) noteToCards.set(c.nid, [...(noteToCards.get(c.nid) ?? []), c])
  const cardMap = new Map<number, string>() // carte Anki -> carte Mnémo
  const extraWarn = new Set<string>()
  const retention = getSettings().retention
  const findBySource = db.prepare('SELECT id, kind FROM note WHERE source = ? AND deleted_at IS NULL')

  const deckFor = (did: number): string => {
    let id = deckIds.get(did)
    if (!id) {
      const name = coll.decks.get(did) ?? 'Importé'
      id = createDeck(name === 'Default' || name === 'Par défaut' ? 'Importé depuis Anki' : name, null)
      deckIds.set(did, id)
      report.decks++
    }
    return id
  }

  db.transaction(() => {
    for (const n of coll.notes) {
      const cards = noteToCards.get(n.id) ?? []
      if (!cards.length) continue
      const source = `anki:${n.guid}`
      const known = findBySource.get(source) as { id: string; kind: NoteKind } | undefined
      const model = coll.models.get(n.mid)
      const chosen = known ? { kind: known.kind, extraTemplates: 0 } : chooseKind(model)
      const kind = chosen.kind
      if (chosen.extraTemplates > 0) extraWarn.add(model?.name ?? '?')

      let noteId: string
      if (known) {
        noteId = known.id
        report.existing++
      } else {
        const flds = n.flds.split('\x1f').map((f) => htmlToMarkdown(f, mediaMap))
        const fields: Record<string, string> =
          kind === 'cloze'
            ? { text: flds[0] ?? '', extra: flds.slice(1).filter(Boolean).join('\n\n') }
            : { front: flds[0] ?? '', back: flds.slice(1).filter(Boolean).join('\n\n') }
        if (!(kind === 'cloze' ? fields.text : fields.front) || (kind !== 'cloze' && !fields.back)) {
          report.skipped++
          continue
        }
        if (kind === 'cloze' && !/\{\{c\d+::/.test(fields.text)) {
          report.skipped++
          continue
        }
        const first = [...cards].sort((a, b) => a.ord - b.ord)[0]
        noteId = addNote({ kind, deckId: deckFor(first.did), fields, tags: n.tags.split(/\s+/).filter(Boolean), source })
        report.notes++
      }
      const ours = db.prepare('SELECT id, ord FROM card WHERE note_id = ?').all(noteId) as { id: string; ord: number }[]
      for (const c of cards) {
        const ord = kind === 'cloze' ? c.ord + 1 : c.ord
        const mine = ours.find((o) => o.ord === ord)
        if (!mine) {
          if (!known) report.skipped++
          continue
        }
        cardMap.set(c.id, mine.id)
        if (!known) {
          db.prepare('UPDATE card SET deck_id = ?, suspended = ? WHERE id = ?').run(deckFor(c.did), c.queue === -1 ? 1 : 0, mine.id)
          report.cards++
        }
      }
    }

    // --- historique de révision (seulement ce qui manque), puis recalcul de l'état des cartes concernées
    const revCards = new Set<string>()
    const hasAny = db.prepare('SELECT 1 FROM review WHERE card_id = ? LIMIT 1')
    const exists = db.prepare('SELECT 1 FROM review WHERE card_id = ? AND reviewed_at = ?')
    const firstSeen = new Map<string, boolean>()
    const insRev = db.prepare(
      `INSERT INTO review(id, card_id, reviewed_at, rating, duration_ms, state_before, was_new, prev_state)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
    )
    for (const r of [...coll.revlog].sort((a, b) => a.id - b.id)) {
      const cid = cardMap.get(r.cid)
      if (!cid || r.ease < 1 || r.ease > 4) continue
      if (exists.get(cid, r.id)) continue
      if (!firstSeen.has(cid)) firstSeen.set(cid, !hasAny.get(cid))
      const isFirst = firstSeen.get(cid) === true
      firstSeen.set(cid, false)
      insRev.run(newId(), cid, r.id, r.ease, Math.min(r.time, 600000), isFirst ? 1 : 0, r.type === 0 ? 1 : r.type === 2 ? 3 : 2)
      revCards.add(cid)
      report.reviews++
    }
    for (const cid of revCards) replayCard(db, cid, retention)

    // Cartes en révision sans historique : on reprend l'intervalle d'Anki.
    for (const c of coll.cards) {
      const cid = cardMap.get(c.id)
      if (!cid || revCards.has(cid) || c.type !== 2) continue
      if (hasAny.get(cid)) continue
      const ivl = Math.max(1, c.ivl)
      db.prepare(
        `UPDATE card SET state = 2, due = ?, stability = ?, difficulty = 5, scheduled_days = ?, reps = ?, lapses = ?, last_review = ? WHERE id = ?`
      ).run((coll.crt + c.due * 86400) * 1000, ivl, ivl, c.reps, c.lapses, (coll.crt + (c.due - ivl) * 86400) * 1000, cid)
    }
  })()

  if (extraWarn.size)
    report.warnings.push(`Types de notes avec plusieurs modèles de cartes (seul le premier sens est conservé) : ${[...extraWarn].join(', ')}.`)
  return report
}

/** Importe un fichier .apkg / .colpkg. */
export function importApkg(file: Buffer): AnkiImportReport {
  return importAnkiSource(openApkg(file))
}

/* ------------------------------------------------------------------ */
/* Export .apkg (format historique, compatible avec toutes les versions) */
/* ------------------------------------------------------------------ */

const MODEL_IDS = { basic: 1700000000001, reverse: 1700000000002, cloze: 1700000000003, typed: 1700000000004 }
const CSS = `.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }
.cloze { font-weight: bold; color: blue; }`

function model(id: number, name: string, type: 0 | 1, fields: string[], tmpls: { name: string; q: string; a: string }[]): Record<string, unknown> {
  return {
    id,
    name,
    type,
    mod: 0,
    usn: -1,
    sortf: 0,
    did: 1,
    tmpls: tmpls.map((t, ord) => ({ name: t.name, ord, qfmt: t.q, afmt: t.a, bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0 })),
    flds: fields.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
    css: CSS,
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: type === 1 ? [[0, 'any', [0]]] : tmpls.map((_t, i) => [i, 'any', [i === 1 ? 1 : 0]]),
    tags: [],
    vers: []
  }
}

export function buildApkg(deckId: string | null): { data: Buffer; notes: number; cards: number } {
  const src = getDb()
  const mem = new Database(':memory:')
  mem.exec(`
    CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
    CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
    CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
    CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
    CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_revlog_cid on revlog (cid);
    CREATE INDEX ix_notes_csum on notes (csum);
  `)

  const nowS = Math.floor(Date.now() / 1000)
  const crt = Math.floor(new Date(new Date().setHours(4, 0, 0, 0)).getTime() / 1000) - 365 * 86400
  let seq = Date.now()
  const nextId = (): number => ++seq

  // decks
  const where = deckId
    ? `AND d.id IN (WITH RECURSIVE sub(id) AS (SELECT id FROM deck WHERE id = @d UNION ALL SELECT k.id FROM deck k JOIN sub s ON k.parent_id = s.id WHERE k.deleted_at IS NULL) SELECT id FROM sub)`
    : ''
  const params = deckId ? { d: deckId } : {}
  const deckRows = src
    .prepare(`SELECT d.id, d.parent_id, d.name FROM deck d WHERE d.deleted_at IS NULL ${where}`)
    .all(params) as { id: string; parent_id: string | null; name: string }[]
  const byId = new Map(deckRows.map((d) => [d.id, d]))
  const fullName = (d: { parent_id: string | null; name: string }): string => {
    const parent = d.parent_id ? byId.get(d.parent_id) : undefined
    return parent ? `${fullName(parent)}::${d.name}` : d.name
  }
  const ankiDeckId = new Map<string, number>()
  const decksJson: Record<string, unknown> = {
    '1': { id: 1, name: 'Default', mod: nowS, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 }
  }
  for (const d of deckRows) {
    const id = nextId()
    ankiDeckId.set(d.id, id)
    decksJson[String(id)] = { id, name: fullName(d), mod: nowS, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 }
  }

  const models: Record<string, unknown> = {
    [MODEL_IDS.basic]: model(MODEL_IDS.basic, 'Basique (Mnémo)', 0, ['Front', 'Back'], [{ name: 'Carte 1', q: '{{Front}}', a: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' }]),
    [MODEL_IDS.reverse]: model(MODEL_IDS.reverse, 'Basique avec inverse (Mnémo)', 0, ['Front', 'Back'], [
      { name: 'Carte 1', q: '{{Front}}', a: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' },
      { name: 'Carte 2', q: '{{Back}}', a: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' }
    ]),
    [MODEL_IDS.typed]: model(MODEL_IDS.typed, 'Basique avec saisie (Mnémo)', 0, ['Front', 'Back'], [{ name: 'Carte 1', q: '{{Front}}\n\n{{type:Back}}', a: '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}' }]),
    [MODEL_IDS.cloze]: model(MODEL_IDS.cloze, 'Texte à trous (Mnémo)', 1, ['Text', 'Back Extra'], [{ name: 'Cloze', q: '{{cloze:Text}}', a: '{{cloze:Text}}<br>\n{{Back Extra}}' }])
  }
  const dconf = {
    '1': {
      id: 1, mod: 0, name: 'Default', usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
      new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
      lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
      rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 }
    }
  }
  const conf = { nextPos: 1, estTimes: true, activeDecks: [1], sortType: 'noteFld', timeLim: 0, sortBackwards: false, addToCur: true, curDeck: 1, newBury: true, newSpread: 0, dueCounts: true, curModel: String(MODEL_IDS.basic), collapseTime: 1200 }
  mem
    .prepare('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)')
    .run(crt, nowS * 1000, nowS * 1000, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decksJson), JSON.stringify(dconf), '{}')

  // notes et cartes
  const media = new Map<string, string>()
  const noteRows = src
    .prepare(
      `SELECT n.id, n.kind, n.fields, n.tags FROM note n WHERE n.deleted_at IS NULL AND EXISTS
         (SELECT 1 FROM card c JOIN deck d ON d.id = c.deck_id WHERE c.note_id = n.id AND c.deleted_at IS NULL ${where})`
    )
    .all(params) as { id: string; kind: NoteKind; fields: string; tags: string }[]
  const insNote = mem.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, \'\')')
  const insCard = mem.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, 2500, ?, ?, 0, 0, 0, 0, \'\')')
  const insRev = mem.prepare('INSERT INTO revlog VALUES (?, ?, -1, ?, ?, ?, 2500, ?, ?)')
  let nNotes = 0
  let nCards = 0
  const strip = (h: string): string => h.replace(/<[^>]+>/g, '').trim()
  // L'occlusion d'image n'existe pas dans Anki : chaque zone devient une note recto/verso dont les images ont les zones peintes.
  interface Unit {
    n: { id: string; kind: NoteKind; tags: string }
    f: Record<string, string>
    only?: number
    guid: string
  }
  const units: Unit[] = []
  for (const n of noteRows) {
    const f = JSON.parse(n.fields) as Record<string, string>
    if (n.kind !== 'occlusion') {
      units.push({ n, f, guid: n.id })
      continue
    }
    const ords = (src.prepare('SELECT ord FROM card WHERE note_id = ? AND deleted_at IS NULL ORDER BY ord').all(n.id) as { ord: number }[]).map((r) => r.ord)
    for (const ord of ords) {
      const front = renderOcclusion(f, ord, false)
      const back = renderOcclusion(f, ord, true)
      if (!front || !back) continue
      units.push({ n: { ...n, kind: 'basic' }, f: { front: `![](${front})`, back: `![](${back})${f.extra ? `\n\n${f.extra}` : ''}` }, only: ord, guid: `${n.id}-${ord}` })
    }
  }
  mem.transaction(() => {
    for (const { n, f, only, guid } of units) {
      const nid = nextId()
      const cloze = n.kind === 'cloze'
      const html = (s: string | undefined): string => markdownToHtml(s ?? '', media).replace(/\x1f/g, ' ')
      const flds = cloze ? [html(f.text), html(f.extra)] : [html(f.front), html(f.back)]
      const mid = cloze ? MODEL_IDS.cloze : n.kind === 'basic-reverse' ? MODEL_IDS.reverse : n.kind === 'typed' ? MODEL_IDS.typed : MODEL_IDS.basic
      const sfld = strip(flds[0])
      const csum = parseInt(createHash('sha1').update(sfld).digest('hex').slice(0, 8), 16)
      insNote.run(nid, guid.replace(/-/g, ''), mid, nowS, n.tags.trim() ? ` ${n.tags.trim()} ` : '', flds.join('\x1f'), sfld, csum)
      nNotes++
      const cards = (src
        .prepare('SELECT * FROM card WHERE note_id = ? AND deleted_at IS NULL')
        .all(n.id) as Record<string, number | string | null>[]).filter((c) => only === undefined || c.ord === only)
      for (const c of cards) {
        const did = ankiDeckId.get(c.deck_id as string) ?? 1
        const state = c.state as number
        const ord = only !== undefined ? 0 : cloze ? Math.max(0, (c.ord as number) - 1) : (c.ord as number)
        const type = state
        const queue = c.suspended ? -1 : state === 0 ? 0 : state === 2 ? 2 : 1
        const due =
          state === 0 ? nCards + 1 : state === 2 ? Math.max(0, Math.round(((c.due as number) / 1000 - crt) / 86400)) : Math.round((c.due as number) / 1000)
        const cid = nextId()
        insCard.run(cid, nid, did, ord, nowS, type, queue, due, Math.round(c.scheduled_days as number), c.reps, c.lapses)
        nCards++
        const revs = src
          .prepare('SELECT reviewed_at, rating, duration_ms, prev_state FROM review WHERE card_id = ? ORDER BY reviewed_at')
          .all(c.id) as { reviewed_at: number; rating: number; duration_ms: number; prev_state: number }[]
        let last = 0
        for (const r of revs) {
          insRev.run(r.reviewed_at, cid, r.rating, last, last, r.duration_ms, r.prev_state === 1 ? 0 : r.prev_state === 3 ? 2 : 1)
          last = Math.round(c.scheduled_days as number)
        }
      }
    }
  })()

  const files: Record<string, Uint8Array> = {}
  const mediaJson: Record<string, string> = {}
  let i = 0
  for (const fname of media.keys()) {
    const p = `${mediaDir()}/${fname}`
    if (!existsSync(p)) continue
    files[String(i)] = new Uint8Array(readFileSync(p))
    mediaJson[String(i)] = fname
    i++
  }
  files['collection.anki2'] = new Uint8Array(mem.serialize())
  files.media = new TextEncoder().encode(JSON.stringify(mediaJson))
  mem.close()
  return { data: Buffer.from(zipSync(files, { level: 6 })), notes: nNotes, cards: nCards }
}
