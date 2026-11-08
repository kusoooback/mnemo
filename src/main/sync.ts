import type Database from 'better-sqlite3'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import type { SyncResult } from '../shared/types'
import { replayCard } from './replay'

/*
 * Synchronisation par dossier partagé (OneDrive, Dropbox, Drive, Syncthing…).
 *
 * Chaque PC écrit UN SEUL fichier chiffré (`<appareil>.mnemo`) et lit ceux des autres : il n'y a donc jamais
 * deux écritures sur le même fichier. La fusion suit les règles du cahier des charges :
 *  - révisions : toutes conservées (union par identifiant), l'état de la carte est recalculé depuis l'historique ;
 *  - champs d'une note : dernier changement gagne, l'ancienne version reste dans l'historique ;
 *  - suppressions : douces (restaurables), le plus récent gagne ;
 *  - médias : nommés par empreinte, donc jamais en conflit.
 */

const MAGIC = Buffer.from('MNS1')
const SYNC_DIR = 'mnemo-sync'
const CHECK_TEXT = 'mnemo-ok'

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
}

export function encrypt(key: Buffer, data: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(gzipSync(data)), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

export function decrypt(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < 4 + 12 + 16 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('Fichier de synchro invalide')
  const iv = blob.subarray(4, 16)
  const tag = blob.subarray(16, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return gunzipSync(Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]))
}

export interface SyncMeta {
  format: 1
  salt: string
  check: string
}

export function syncPath(folder: string): string {
  return join(folder, SYNC_DIR)
}

/** Prépare (ou rejoint) un dossier de synchro. Renvoie la clé dérivée. */
export function setupFolder(folder: string, passphrase: string): Buffer {
  const dir = syncPath(folder)
  mkdirSync(join(dir, 'media'), { recursive: true })
  const metaFile = join(dir, 'meta.json')
  if (existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as SyncMeta
    const key = deriveKey(passphrase, Buffer.from(meta.salt, 'base64'))
    try {
      const ok = decrypt(key, Buffer.from(meta.check, 'base64')).toString('utf8')
      if (ok !== CHECK_TEXT) throw new Error('bad')
    } catch {
      throw new Error('Phrase de récupération incorrecte pour ce dossier.')
    }
    return key
  }
  const salt = randomBytes(16)
  const key = deriveKey(passphrase, salt)
  const meta: SyncMeta = {
    format: 1,
    salt: salt.toString('base64'),
    check: encrypt(key, Buffer.from(CHECK_TEXT)).toString('base64')
  }
  writeFileSync(metaFile, JSON.stringify(meta, null, 2))
  return key
}

type Row = Record<string, unknown>

export interface Snapshot {
  format: 1
  deviceId: string
  deviceName: string
  exportedAt: number
  deck: Row[]
  note: Row[]
  card: Row[]
  review: Row[]
  subject: Row[]
  entry: Row[]
  entry_link: Row[]
  task: Row[]
  media: string[]
}

export function buildSnapshot(db: Database.Database, deviceId: string, deviceName: string, media: string[]): Snapshot {
  const all = (sql: string): Row[] => db.prepare(sql).all() as Row[]
  return {
    format: 1,
    deviceId,
    deviceName,
    exportedAt: Date.now(),
    deck: all('SELECT * FROM deck'),
    note: all('SELECT * FROM note'),
    card: all(
      `SELECT id, note_id, deck_id, ord, suspended, created_at, updated_at, meta_at, reset_at, deleted_at FROM card`
    ),
    review: all("SELECT id, card_id, reviewed_at, rating, duration_ms, was_new, prev_state FROM review"),
    subject: all('SELECT * FROM subject'),
    entry: all('SELECT * FROM entry'),
    entry_link: all('SELECT * FROM entry_link'),
    task: all('SELECT * FROM task'),
    media
  }
}

export interface MergeStats {
  newNotes: number
  newReviews: number
  updated: number
  recomputed: number
}

function ftsContent(fields: Record<string, string>): string {
  return Object.values(fields)
    .join(' \n ')
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1')
}

/** Fusionne l'instantané d'un autre appareil dans la base locale. */
export function mergeSnapshot(db: Database.Database, snap: Snapshot, retention: number): MergeStats {
  const stats: MergeStats = { newNotes: 0, newReviews: 0, updated: 0, recomputed: 0 }
  const affected = new Set<string>()
  const ftsTouched = new Set<string>()

  const tx = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON')

    // --- decks (les parents d'abord n'est pas nécessaire : contraintes différées)
    for (const r of snap.deck) {
      const local = db.prepare('SELECT updated_at FROM deck WHERE id = ?').get(r.id) as { updated_at: number } | undefined
      if (!local) {
        db.prepare(
          'INSERT INTO deck(id, parent_id, name, color, new_per_day, created_at, updated_at, deleted_at) VALUES (@id, @parent_id, @name, @color, @new_per_day, @created_at, @updated_at, @deleted_at)'
        ).run(r)
        stats.updated++
      } else if ((r.updated_at as number) > local.updated_at) {
        db.prepare(
          'UPDATE deck SET parent_id=@parent_id, name=@name, color=@color, new_per_day=@new_per_day, updated_at=@updated_at, deleted_at=@deleted_at WHERE id=@id'
        ).run(r)
        stats.updated++
      }
    }

    // --- notes
    for (const r of snap.note) {
      const local = db.prepare('SELECT fields, updated_at FROM note WHERE id = ?').get(r.id) as
        | { fields: string; updated_at: number }
        | undefined
      if (!local) {
        db.prepare(
          'INSERT INTO note(id, kind, fields, tags, created_at, updated_at, deleted_at, source) VALUES (@id, @kind, @fields, @tags, @created_at, @updated_at, @deleted_at, @source)'
        ).run(r)
        stats.newNotes++
        ftsTouched.add(r.id as string)
      } else if ((r.updated_at as number) > local.updated_at) {
        if (local.fields !== r.fields) {
          // L'ancienne version reste consultable dans l'historique de la note.
          db.prepare('INSERT INTO note_history(note_id, fields, changed_at) VALUES (?, ?, ?)').run(
            r.id,
            local.fields,
            r.updated_at
          )
        }
        db.prepare(
          'UPDATE note SET kind=@kind, fields=@fields, tags=@tags, updated_at=@updated_at, deleted_at=@deleted_at, source=@source WHERE id=@id'
        ).run(r)
        stats.updated++
        ftsTouched.add(r.id as string)
      }
    }

    // --- cartes (structure uniquement : l'ordonnancement vient des révisions)
    for (const r of snap.card) {
      const local = db.prepare('SELECT meta_at, reset_at FROM card WHERE id = ?').get(r.id) as
        | { meta_at: number; reset_at: number }
        | undefined
      if (!local) {
        db.prepare(
          `INSERT INTO card(id, note_id, deck_id, ord, state, due, suspended, created_at, updated_at, meta_at, reset_at, deleted_at)
           VALUES (@id, @note_id, @deck_id, @ord, 0, @created_at, @suspended, @created_at, @updated_at, @meta_at, @reset_at, @deleted_at)`
        ).run(r)
        affected.add(r.id as string)
      } else {
        if ((r.meta_at as number) > local.meta_at) {
          db.prepare(
            'UPDATE card SET deck_id=@deck_id, suspended=@suspended, deleted_at=@deleted_at, meta_at=@meta_at, updated_at=@updated_at WHERE id=@id'
          ).run(r)
          stats.updated++
        }
        if ((r.reset_at as number) > local.reset_at) {
          db.prepare('UPDATE card SET reset_at = ? WHERE id = ?').run(r.reset_at, r.id)
          affected.add(r.id as string)
        }
      }
    }

    // --- révisions : union par identifiant
    const ins = db.prepare(
      `INSERT OR IGNORE INTO review(id, card_id, reviewed_at, rating, duration_ms, state_before, was_new, prev_state)
       VALUES (@id, @card_id, @reviewed_at, @rating, @duration_ms, '{}', @was_new, @prev_state)`
    )
    for (const r of snap.review) {
      if (ins.run(r).changes > 0) {
        stats.newReviews++
        affected.add(r.card_id as string)
      }
    }

    // --- cahier de texte
    const lww = (table: string, rows: Row[], cols: string[]): void => {
      for (const r of rows) {
        const local = db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(r.id) as
          | { updated_at: number }
          | undefined
        const names = cols.join(', ')
        const params = cols.map((c) => `@${c}`).join(', ')
        if (!local) db.prepare(`INSERT INTO ${table}(${names}) VALUES (${params})`).run(r)
        else if ((r.updated_at as number) > local.updated_at)
          db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=@${c}`).join(', ')} WHERE id=@id`).run(r)
        else continue
        stats.updated++
      }
    }
    lww('subject', snap.subject, ['id', 'name', 'color', 'coefficient', 'deck_id', 'created_at', 'updated_at', 'deleted_at'])
    lww('entry', snap.entry, ['id', 'subject_id', 'kind', 'title', 'notes', 'due_at', 'status', 'created_at', 'updated_at', 'deleted_at'])
    lww('task', snap.task, ['id', 'subject_id', 'title', 'due_at', 'done', 'recurrence', 'created_at', 'updated_at', 'deleted_at'])
    const linksByEntry = new Map<string, Row[]>()
    for (const l of snap.entry_link) linksByEntry.set(l.entry_id as string, [...(linksByEntry.get(l.entry_id as string) ?? []), l])
    for (const e of snap.entry) {
      const local = db.prepare('SELECT updated_at FROM entry WHERE id = ?').get(e.id) as { updated_at: number }
      if (local.updated_at === e.updated_at) {
        db.prepare('DELETE FROM entry_link WHERE entry_id = ?').run(e.id)
        for (const l of linksByEntry.get(e.id as string) ?? [])
          db.prepare('INSERT OR IGNORE INTO entry_link(entry_id, deck_id) VALUES (?, ?)').run(l.entry_id, l.deck_id)
      }
    }

    // --- index plein texte
    for (const id of ftsTouched) {
      db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(id)
      const n = db.prepare('SELECT fields, tags, deleted_at FROM note WHERE id = ?').get(id) as
        | { fields: string; tags: string; deleted_at: number | null }
        | undefined
      if (n && !n.deleted_at)
        db.prepare('INSERT INTO note_fts(note_id, content, tags) VALUES (?, ?, ?)').run(
          id,
          ftsContent(JSON.parse(n.fields)),
          n.tags.trim()
        )
    }

    // --- l'état d'ordonnancement se recalcule depuis l'historique
    for (const id of affected) {
      replayCard(db, id, retention)
      stats.recomputed++
    }
  })
  tx()
  return stats
}

function atomicWrite(file: string, data: Buffer): void {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

export interface SyncContext {
  db: Database.Database
  folder: string
  key: Buffer
  deviceId: string
  deviceName: string
  mediaDir: string
  retention: number
  /** Appelé avant de modifier la base (sauvegarde de sécurité). */
  beforeMerge?: () => void
}

/** Un cycle complet : lire les autres appareils, fusionner, écrire notre instantané, échanger les médias. */
export function runSync(ctx: SyncContext): SyncResult {
  const dir = syncPath(ctx.folder)
  const mediaShared = join(dir, 'media')
  mkdirSync(mediaShared, { recursive: true })
  const result: SyncResult = {
    at: Date.now(),
    ok: true,
    devices: 0,
    newNotes: 0,
    newReviews: 0,
    updated: 0,
    recomputed: 0
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.mnemo') && f !== `${ctx.deviceId}.mnemo`)
  const snaps: Snapshot[] = []
  for (const f of files) {
    try {
      snaps.push(JSON.parse(decrypt(ctx.key, readFileSync(join(dir, f))).toString('utf8')) as Snapshot)
    } catch (e) {
      throw new Error(`Impossible de lire ${f} : ${(e as Error).message}`)
    }
  }
  if (snaps.length) ctx.beforeMerge?.()

  // Médias distants -> locaux (avant les notes, pour que les images s'affichent tout de suite).
  for (const f of existsSync(mediaShared) ? readdirSync(mediaShared) : []) {
    const target = join(ctx.mediaDir, f)
    if (/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/.test(f) && !existsSync(target)) copyFileSync(join(mediaShared, f), target)
  }

  const upsertDevice = ctx.db.prepare(
    'INSERT INTO device(id, name, last_sync, is_self) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_sync = excluded.last_sync'
  )
  for (const s of snaps) {
    const st = mergeSnapshot(ctx.db, s, ctx.retention)
    result.newNotes += st.newNotes
    result.newReviews += st.newReviews
    result.updated += st.updated
    result.recomputed += st.recomputed
    upsertDevice.run(s.deviceId, s.deviceName, s.exportedAt)
  }
  result.devices = snaps.length

  // Médias locaux -> partagés.
  const localMedia = existsSync(ctx.mediaDir) ? readdirSync(ctx.mediaDir) : []
  for (const f of localMedia) {
    if (/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/.test(f) && !existsSync(join(mediaShared, f)))
      copyFileSync(join(ctx.mediaDir, f), join(mediaShared, f))
  }

  const own = buildSnapshot(ctx.db, ctx.deviceId, ctx.deviceName, localMedia)
  atomicWrite(join(dir, `${ctx.deviceId}.mnemo`), encrypt(ctx.key, Buffer.from(JSON.stringify(own), 'utf8')))
  ctx.db
    .prepare(
      'INSERT INTO device(id, name, last_sync, is_self) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_sync = excluded.last_sync, is_self = 1'
    )
    .run(ctx.deviceId, ctx.deviceName, result.at)
  return result
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
