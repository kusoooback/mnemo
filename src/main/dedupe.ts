import { createHash } from 'crypto'
import type Database from 'better-sqlite3'

/** Détection des doublons : même fichier, même texte, ou textes quasi identiques (corrigé republié, nouvelle version). */

export const sha1 = (data: Buffer | string): string => createHash('sha1').update(data).digest('hex')

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

export const textKey = (text: string): string => sha1(words(text).join(' '))

function shingles(text: string, size = 5): Set<string> {
  const w = words(text.slice(0, 8000))
  const out = new Set<string>()
  for (let i = 0; i + size <= w.length; i++) out.add(w.slice(i, i + size).join(' '))
  return out
}

/** Ressemblance de deux textes entre 0 (rien de commun) et 1 (identiques). */
export function similarity(a: string, b: string): number {
  const x = shingles(a)
  const y = shingles(b)
  if (x.size < 8 || y.size < 8) return 0
  let common = 0
  for (const s of x) if (y.has(s)) common++
  return common / (x.size + y.size - common)
}

interface Candidate {
  id: string
  title: string
  path: string
  text: string
  hash: string
  text_hash: string
  subject: string
}

/**
 * Cherche parmi les documents déjà rangés un original dont celui-ci est la copie.
 * `before` : on ne compare qu'aux documents plus anciens, pour que deux copies ne se déclarent pas doublons l'une de l'autre.
 */
export function findDuplicate(
  db: Database.Database,
  doc: { id: string | null; subject: string; hash: string; text: string; before?: number }
): { id: string; title: string; path: string; reason: 'fichier' | 'texte' | 'contenu' } | null {
  const rows = db
    .prepare(
      `SELECT id, title, path, text, hash, text_hash, subject FROM document
       WHERE deleted_at IS NULL AND dup_of IS NULL AND id != ? AND added_at <= ?`
    )
    .all(doc.id ?? '', doc.before ?? Date.now()) as Candidate[]
  if (doc.hash) {
    const same = rows.find((r) => r.hash === doc.hash)
    if (same) return { id: same.id, title: same.title, path: same.path, reason: 'fichier' }
  }
  if (doc.text.trim().length > 250) {
    const key = textKey(doc.text)
    const same = rows.find((r) => r.text_hash === key)
    if (same) return { id: same.id, title: same.title, path: same.path, reason: 'texte' }
    for (const r of rows) {
      if (r.subject !== doc.subject || r.text.trim().length < 250) continue
      const ratio = Math.min(r.text.length, doc.text.length) / Math.max(r.text.length, doc.text.length)
      if (ratio > 0.6 && similarity(r.text, doc.text) >= 0.8) return { id: r.id, title: r.title, path: r.path, reason: 'contenu' }
    }
  }
  return null
}
