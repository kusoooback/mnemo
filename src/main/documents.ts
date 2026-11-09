import { createHash } from 'crypto'
import { existsSync, unlinkSync } from 'fs'
import { shell } from 'electron'
import type { DocumentRow } from '../shared/types'
import { aiCardsFromText, aiStatus, aiSummarize } from './ai'
import { goodCard } from './cardquality'
import { getDb } from './db'
import { startJob } from './jobs'
import { addNote, checkDuplicate, createDeck } from './repo'
import { getSettings } from './util'

/** Bibliothèque de cours : tout ce qui a été téléchargé, rangé par matière, avec texte, fiche et cartes associées. */

interface Row {
  id: string
  title: string
  subject: string
  folder: string
  ext: string
  size: number
  added_at: number
  published_at: number | null
  deck_id: string | null
  cards: number
  has_text: number
  has_summary: number
  category: string
  chapter: string
  dup_title: string | null
  is_sheet: number
}

export function listDocuments(): DocumentRow[] {
  return (
    getDb()
      .prepare(
        `SELECT d.id, d.title, d.subject, d.folder, d.ext, d.size, d.added_at, d.published_at, d.deck_id, d.cards,
                length(d.text) > 0 has_text, length(d.summary) > 0 has_summary, d.category, d.chapter,
                (SELECT o.title FROM document o WHERE o.id = d.dup_of) dup_title, d.source = 'fiche' is_sheet
         FROM document d WHERE d.deleted_at IS NULL ORDER BY d.subject COLLATE NOCASE, d.chapter COLLATE NOCASE, d.folder COLLATE NOCASE, d.title COLLATE NOCASE`
      )
      .all() as Row[]
  ).map((r) => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    folder: r.folder,
    ext: r.ext,
    size: r.size,
    addedAt: r.added_at,
    publishedAt: r.published_at,
    deckId: r.deck_id,
    cards: r.cards,
    hasText: !!r.has_text,
    hasSummary: !!r.has_summary,
    category: r.category,
    chapter: r.chapter,
    dupTitle: r.dup_title ?? '',
    isSheet: !!r.is_sheet
  }))
}

const get = (id: string): { title: string; subject: string; path: string; text: string; summary: string; deck_id: string | null; cards: number } => {
  const r = getDb().prepare('SELECT title, subject, path, text, summary, deck_id, cards FROM document WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { title: string; subject: string; path: string; text: string; summary: string; deck_id: string | null; cards: number }
    | undefined
  if (!r) throw new Error('Document introuvable')
  return r
}

export async function openDocument(id: string): Promise<void> {
  const d = get(id)
  if (!existsSync(d.path)) throw new Error('Le fichier a été déplacé ou supprimé.')
  const err = await shell.openPath(d.path)
  if (err) throw new Error(err)
}

export const documentSummary = (id: string): string => get(id).summary
export const documentText = (id: string): string => get(id).text

export async function makeSummary(id: string): Promise<string> {
  const d = get(id)
  if (!aiStatus().ready) throw new Error('L’IA n’est pas prête : active-la dans Intégrations.')
  const job = startJob('summary', `Fiche : ${d.title}`, { detail: 'Rédaction…' })
  try {
    const s = await aiSummarize(d.title, d.text.slice(0, 20000))
    getDb().prepare('UPDATE document SET summary = ? WHERE id = ?').run(s, id)
    job.attach(id)
    job.finish('Fiche prête.')
    return s
  } catch (e) {
    job.fail((e as Error).message)
    throw e
  }
}

export async function makeCards(id: string, count: number): Promise<number> {
  const d = get(id)
  if (!aiStatus().ready) throw new Error('L’IA n’est pas prête : active-la dans Intégrations.')
  // Quand la fiche existe, elle est plus dense et mieux structurée que le texte brut : les cartes en sortent.
  const source = d.summary.trim().length > 300 ? d.summary : d.text
  if (source.trim().length < 150) throw new Error('Pas assez de texte dans ce document (scan ou image ?).')
  const deckId = d.deck_id ?? createDeck(`Documents::${d.subject || 'Divers'}`, null)
  const job = startJob('cards', `Cartes : ${d.title}`, { detail: 'Création des cartes…' })
  job.link({ name: 'deck', id: deckId })
  let cards: Awaited<ReturnType<typeof aiCardsFromText>>
  try {
    cards = await aiCardsFromText(source.slice(0, 14000), Math.max(3, Math.min(40, count)), getSettings().language, `Document « ${d.title} » (${d.subject}).`)
  } catch (e) {
    job.fail((e as Error).message)
    throw e
  }
  let added = 0
  for (const c of cards) {
    if (!goodCard(c, { vocabulary: true })) continue
    if (checkDuplicate(c.kind, c.kind === 'cloze' ? c.text : c.front)) continue
    addNote({
      kind: c.kind,
      deckId,
      fields: c.kind === 'cloze' ? { text: c.text, extra: c.extra } : { front: c.front, back: c.back },
      tags: ['ia-auto', (d.subject || 'divers').replace(/\s+/g, '_').toLowerCase()],
      source: `doc:${id}:${createHash('sha1').update(c.kind === 'cloze' ? c.text : c.front).digest('hex').slice(0, 10)}`
    })
    added++
  }
  getDb().prepare('UPDATE document SET cards = cards + ?, deck_id = ?, cards_tried = 1 WHERE id = ?').run(added, deckId, id)
  job.finish(`${added} carte${added > 1 ? 's' : ''} créée${added > 1 ? 's' : ''}.`)
  return added
}

export function deleteDocument(id: string, removeFile: boolean): void {
  const d = get(id)
  if (removeFile && existsSync(d.path)) {
    try {
      unlinkSync(d.path)
    } catch {
      /* fichier ouvert ailleurs */
    }
  }
  getDb().prepare('UPDATE document SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
}
