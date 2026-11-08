import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import type { NoteKind } from '../shared/types'
import type { PackPreview, PackResult } from '../shared/types-extra'
import { saveImage } from './data'
import { mediaDir } from './db'
import * as repo from './repo'
import { deckScope } from './util'
import { getDb } from './db'

/*
 * Paquets de cartes partageables (.mnemodeck) : un deck (ou toute la collection) dans un seul fichier, avec ses images.
 * On y met le CONTENU (cartes, étiquettes, images) et rien de personnel : ni historique de révision, ni réglages.
 * Format : « MNDK1\n » puis du JSON compressé (gzip). Un paquet reçu est traité comme non fiable : tout est validé.
 */

export const PACK_MAGIC = 'MNDK1\n'
export const PACK_EXT = 'mnemodeck'
const KINDS: NoteKind[] = ['basic', 'basic-reverse', 'cloze', 'typed', 'occlusion']
const MEDIA_RE = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/
const MEDIA_URL = /mnemo-media:\/\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))/g
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const MAX_NOTES = 20_000
const MAX_MEDIA = 600
const MAX_MEDIA_BYTES = 8 * 1024 * 1024
const MAX_PACK_BYTES = 80 * 1024 * 1024

export interface PackNote {
  kind: NoteKind
  fields: Record<string, string>
  tags: string[]
  /** Chemin du deck, relatif à la racine du paquet (« Chapitre 1::Dates »), vide = racine. */
  deck: string
}

export interface Pack {
  format: 1
  app: 'mnemo'
  name: string
  description: string
  author: string
  created: number
  notes: PackNote[]
  /** nom de fichier (empreinte + extension) → contenu en base64 */
  media: Record<string, string>
}

function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.toString('latin1', 0, 3) === 'GIF') return 'gif'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

export function encodePack(pack: Pack): Buffer {
  return Buffer.concat([Buffer.from(PACK_MAGIC), gzipSync(Buffer.from(JSON.stringify(pack), 'utf8'), { level: 9 })])
}

/** Construit un paquet à partir d'un deck (et de ses sous-decks) ou de toute la collection. */
export function buildPack(deckId: string | null, meta: { name?: string; description?: string; author?: string } = {}): { buf: Buffer; pack: Pack } {
  const decks = repo.listDecks()
  const root = deckId ? decks.find((d) => d.id === deckId) : null
  if (deckId && !root) throw new Error('Deck introuvable.')
  const pathOf = new Map(decks.map((d) => [d.id, d.fullName]))
  const scope = deckScope('c.deck_id', deckId)
  const rows = getDb()
    .prepare(
      `SELECT n.id, n.kind, n.fields, n.tags, MIN(c.deck_id) AS deck_id
         FROM note n JOIN card c ON c.note_id = n.id AND c.deleted_at IS NULL
        WHERE n.deleted_at IS NULL AND ${scope.sql}
        GROUP BY n.id ORDER BY n.created_at`
    )
    .all(scope.params) as { id: string; kind: NoteKind; fields: string; tags: string; deck_id: string }[]
  if (!rows.length) throw new Error('Ce deck ne contient aucune carte à partager.')
  const prefix = root ? `${root.fullName}::` : ''
  const notes: PackNote[] = rows.map((r) => {
    const full = pathOf.get(r.deck_id) ?? ''
    const rel = root ? (full === root.fullName ? '' : full.startsWith(prefix) ? full.slice(prefix.length) : full) : full
    return { kind: r.kind, fields: JSON.parse(r.fields) as Record<string, string>, tags: r.tags ? r.tags.split(/\s+/).filter(Boolean) : [], deck: rel }
  })
  const media: Record<string, string> = {}
  for (const n of notes)
    for (const v of Object.values(n.fields))
      for (const m of v.matchAll(MEDIA_URL)) {
        const file = m[1]
        const path = join(mediaDir(), file)
        if (!media[file] && existsSync(path)) media[file] = readFileSync(path).toString('base64')
      }
  const pack: Pack = {
    format: 1,
    app: 'mnemo',
    name: (meta.name ?? root?.name ?? 'Ma collection').slice(0, 80),
    description: (meta.description ?? '').slice(0, 500),
    author: (meta.author ?? '').slice(0, 60),
    created: Date.now(),
    notes,
    media
  }
  const buf = encodePack(pack)
  if (buf.length > MAX_PACK_BYTES) throw new Error('Ce paquet est trop volumineux (80 Mo maximum) : partage un sous-deck.')
  return { buf, pack }
}

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

/** Lit et valide un paquet reçu. Lève une erreur claire si le fichier n'est pas un paquet Mnémo valable. */
export function readPack(buf: Buffer): Pack {
  if (buf.length > MAX_PACK_BYTES) throw new Error('Fichier trop volumineux.')
  if (buf.subarray(0, PACK_MAGIC.length).toString('latin1') !== PACK_MAGIC) throw new Error('Ce fichier n’est pas un paquet Mnémo (.mnemodeck).')
  let raw: unknown
  try {
    raw = JSON.parse(gunzipSync(buf.subarray(PACK_MAGIC.length), { maxOutputLength: 400 * 1024 * 1024 }).toString('utf8'))
  } catch {
    throw new Error('Paquet illisible ou corrompu.')
  }
  const p = raw as Partial<Pack>
  if (!p || p.format !== 1 || p.app !== 'mnemo' || !Array.isArray(p.notes)) throw new Error('Paquet d’une version non reconnue.')
  if (p.notes.length === 0 || p.notes.length > MAX_NOTES) throw new Error('Paquet vide ou trop grand.')
  const notes: PackNote[] = []
  for (const n of p.notes as PackNote[]) {
    if (!n || !KINDS.includes(n.kind) || typeof n.fields !== 'object' || n.fields === null) continue
    const fields: Record<string, string> = {}
    let ok = true
    for (const [k, v] of Object.entries(n.fields)) {
      if (!/^[a-z]{1,20}$/.test(k) || !isStr(v, 60_000)) ok = false
      else fields[k] = v
    }
    if (!ok) continue
    const tags = Array.isArray(n.tags) ? n.tags.filter((t): t is string => isStr(t, 40)).slice(0, 20) : []
    const deck = isStr(n.deck, 200) ? n.deck.replace(/^(::)+|(::)+$/g, '') : ''
    notes.push({ kind: n.kind, fields, tags, deck })
  }
  if (!notes.length) throw new Error('Aucune carte valable dans ce paquet.')
  const media: Record<string, string> = {}
  const entries = Object.entries(p.media && typeof p.media === 'object' ? p.media : {})
  if (entries.length > MAX_MEDIA) throw new Error('Trop d’images dans ce paquet.')
  for (const [name, b64] of entries) {
    if (!MEDIA_RE.test(name) || typeof b64 !== 'string') continue
    const bytes = Buffer.from(b64, 'base64')
    if (bytes.length > MAX_MEDIA_BYTES) continue
    const ext = sniff(bytes)
    // L'image doit être ce qu'elle prétend être, et son nom est son empreinte : un paquet ne peut pas écraser un autre fichier.
    if (!ext || `${createHash('sha256').update(bytes).digest('hex')}.${ext}` !== name) continue
    media[name] = b64
  }
  return {
    format: 1,
    app: 'mnemo',
    name: isStr(p.name, 80) && p.name.trim() ? p.name.trim() : 'Paquet partagé',
    description: isStr(p.description, 500) ? p.description : '',
    author: isStr(p.author, 60) ? p.author : '',
    created: typeof p.created === 'number' ? p.created : 0,
    notes,
    media
  }
}

const firstOf = (n: PackNote): string => (n.kind === 'cloze' ? n.fields.text : n.fields.front) ?? ''
const dupKey = (kind: NoteKind, text: string): string => `${kind === 'cloze' ? 'c' : 'b'}|${text.trim().toLowerCase()}`

/** Les cartes déjà présentes, lues une seule fois (même règle que repo.checkDuplicate, sans relire la base à chaque carte). */
function existingKeys(): Set<string> {
  const keys = new Set<string>()
  const rows = getDb().prepare("SELECT kind, fields FROM note WHERE deleted_at IS NULL AND kind != 'occlusion'").all() as { kind: NoteKind; fields: string }[]
  for (const r of rows) {
    const f = JSON.parse(r.fields) as Record<string, string>
    keys.add(dupKey(r.kind, (r.kind === 'cloze' ? f.text : f.front) ?? ''))
  }
  return keys
}

export function previewPack(pack: Pack): PackPreview {
  const decks = new Set(pack.notes.map((n) => n.deck).filter(Boolean))
  const have = existingKeys()
  return {
    name: pack.name,
    description: pack.description,
    author: pack.author,
    notes: pack.notes.length,
    decks: decks.size,
    images: Object.keys(pack.media).length,
    duplicates: pack.notes.filter((n) => n.kind !== 'occlusion' && firstOf(n).trim() && have.has(dupKey(n.kind, firstOf(n)))).length,
    sample: pack.notes.slice(0, 3).map((n) => firstOf(n).replace(/\s+/g, ' ').slice(0, 120))
  }
}

export function installPack(pack: Pack, root: string): PackResult {
  const rootName = root.trim() || pack.name
  for (const [name, b64] of Object.entries(pack.media)) {
    const b = Buffer.from(b64, 'base64')
    saveImage(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, MIME[name.split('.')[1]])
  }
  const have = existingKeys()
  const cache = new Map<string, string>()
  const deckFor = (path: string): string => {
    const full = path ? `${rootName}::${path}` : rootName
    let id = cache.get(full)
    if (!id) {
      id = repo.createDeck(full, null)
      cache.set(full, id)
    }
    return id
  }
  let added = 0
  let duplicates = 0
  let skipped = 0
  for (const n of pack.notes) {
    try {
      const key = dupKey(n.kind, firstOf(n))
      if (n.kind !== 'occlusion' && firstOf(n).trim() && have.has(key)) {
        duplicates++
        continue
      }
      repo.addNote({ kind: n.kind, deckId: deckFor(n.deck), fields: n.fields, tags: n.tags })
      have.add(key)
      added++
    } catch {
      skipped++
    }
  }
  return { added, duplicates, skipped, deck: rootName }
}
