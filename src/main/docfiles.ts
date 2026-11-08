import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { dialog, type BrowserWindow } from 'electron'
import { docKind } from '../shared/docs'
import type { DocInfo } from '../shared/types'
import { aiStatus, readDocumentBuffer } from './ai'
import { CATEGORIES, fallbackChapter, triageDocument } from './triage'
import { getDb } from './db'
import { findDuplicate, sha1, textKey } from './dedupe'
import { documentsDir } from './prepa'
import { newId } from './util'

/** Lecteur intégré : informations, notes, modification des fichiers texte, ajout de n'importe quel fichier. */

interface Row {
  id: string
  title: string
  subject: string
  folder: string
  ext: string
  size: number
  path: string
  text: string
  notes: string
  summary: string
  cards: number
  deck_id: string | null
  category: string
  chapter: string
}

function row(id: string): Row {
  const r = getDb().prepare('SELECT id, title, subject, folder, ext, size, path, text, notes, summary, cards, deck_id, category, chapter FROM document WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new Error('Document introuvable')
  return r
}

export function documentInfo(id: string): DocInfo {
  const r = row(id)
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    folder: r.folder,
    ext: r.ext,
    kind: docKind(r.ext),
    size: r.size,
    text: r.text,
    notes: r.notes,
    summary: r.summary,
    cards: r.cards,
    deckId: r.deck_id,
    category: r.category,
    chapter: r.chapter
  }
}

export function documentSource(id: string): string {
  const r = row(id)
  if (!existsSync(r.path)) throw new Error('Le fichier a été déplacé ou supprimé.')
  return readFileSync(r.path, 'utf8').replace(/^﻿/, '')
}

/** Enregistre le fichier modifié dans l'application et remet à jour le texte utilisé pour les cartes. */
export function saveDocumentSource(id: string, content: string): void {
  const r = row(id)
  if (docKind(r.ext) !== 'text') throw new Error('Ce format ne se modifie pas ici.')
  writeFileSync(r.path, content, 'utf8')
  getDb().prepare('UPDATE document SET text = ?, size = ? WHERE id = ?').run(content.slice(0, 400_000), Buffer.byteLength(content), id)
}

export function saveDocumentNotes(id: string, notes: string): void {
  getDb().prepare('UPDATE document SET notes = ? WHERE id = ? AND deleted_at IS NULL').run(notes, id)
}

/** Relit le fichier (y compris par OCR) : utile après une mise à jour du lecteur ou pour un scan. */
export async function rereadDocument(id: string): Promise<number> {
  const r = row(id)
  if (!existsSync(r.path)) throw new Error('Le fichier a été déplacé ou supprimé.')
  const text = await readDocumentBuffer(readFileSync(r.path), r.ext)
  getDb().prepare('UPDATE document SET text = ? WHERE id = ?').run(text.slice(0, 400_000), id)
  return text.length
}

export function documentFilePath(id: string): string | null {
  const r = getDb().prepare('SELECT path FROM document WHERE id = ? AND deleted_at IS NULL').get(id) as { path: string } | undefined
  return r && existsSync(r.path) ? r.path : null
}

function collect(paths: string[]): string[] {
  const out: string[] = []
  const walk = (p: string): void => {
    if (out.length >= 500) return
    try {
      if (statSync(p).isDirectory()) for (const n of readdirSync(p)) walk(join(p, n))
      else out.push(p)
    } catch {
      /* illisible */
    }
  }
  paths.forEach(walk)
  return out
}

/** Ajoute des fichiers (ou des dossiers entiers) à la bibliothèque : copie, lecture du texte, rangement dans « Divers ». */
export async function addDocumentPaths(paths: string[], subject = 'Divers'): Promise<{ added: number; ids: string[]; failed: string[] }> {
  const db = getDb()
  const dir = join(documentsDir(), subject)
  mkdirSync(dir, { recursive: true })
  const ids: string[] = []
  const failed: string[] = []
  for (const src of collect(paths)) {
    try {
      const ext = extname(src).replace('.', '').toLowerCase()
      const base = basename(src, extname(src)).normalize('NFC')
      let target = join(dir, basename(src))
      if (existsSync(target)) target = join(dir, `${newId().slice(-8)}-${basename(src)}`)
      copyFileSync(src, target)
      let text = ''
      try {
        text = await readDocumentBuffer(readFileSync(target), ext)
      } catch {
        text = ''
      }
      const id = newId()
      const hash = sha1(readFileSync(target))
      const now = Date.now()
      const dup = findDuplicate(db, { id: null, subject, hash, text, before: now })
      db.prepare(
        `INSERT INTO document(id, source, remote_id, subject, folder, title, filename, ext, size, path, text, published_at, added_at, deck_id, hash, text_hash, category, dup_of)
         VALUES (?, 'local', NULL, ?, '', ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)`
      ).run(id, subject, base, basename(src), ext, statSync(target).size, target, text.slice(0, 400_000), now, hash, text.trim().length > 250 ? textKey(text) : '', dup ? 'doublon' : '', dup?.id ?? null)
      ids.push(id)
      // Tri tout de suite (règles + IA si prête) : un fichier ajouté à la main n'attend pas « à trier ».
      if (!dup) {
        try {
          const known = (db.prepare("SELECT DISTINCT chapter FROM document WHERE subject = ? AND chapter <> '' AND deleted_at IS NULL").all(subject) as { chapter: string }[]).map((r) => r.chapter)
          const tr = await triageDocument({ title: base, subject, folder: '', text }, known)
          if (tr.by !== 'regles' || aiStatus().ready) db.prepare('UPDATE document SET category = ?, chapter = ? WHERE id = ?').run(tr.category, tr.chapter, id)
        } catch {
          /* le tri se refera plus tard */
        }
      }
    } catch (e) {
      failed.push(`${basename(src)} : ${(e as Error).message}`)
    }
  }
  return { added: ids.length, ids, failed }
}

export async function addDocumentsDialog(win: BrowserWindow | null): Promise<{ added: number; ids: string[]; failed: string[] }> {
  const opts = { title: 'Ajouter des documents', properties: ['openFile' as const, 'multiSelections' as const] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || res.filePaths.length === 0) return { added: 0, ids: [], failed: [] }
  return addDocumentPaths(res.filePaths)
}

/** Enregistre une fiche de révision (Markdown) dans « Mes documents » : lisible, modifiable, avec notes. */
export function addMarkdownDocument(title: string, markdown: string, subject = 'Fiches'): string {
  const db = getDb()
  const dir = join(documentsDir(), subject)
  mkdirSync(dir, { recursive: true })
  const safeName = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Fiche'
  let target = join(dir, `${safeName}.md`)
  if (existsSync(target)) target = join(dir, `${safeName} ${newId().slice(-6)}.md`)
  writeFileSync(target, markdown, 'utf8')
  const id = newId()
  db.prepare(
    `INSERT INTO document(id, source, remote_id, subject, folder, title, filename, ext, size, path, text, published_at, added_at, deck_id, category, chapter, text_hash, hash)
     VALUES (?, 'fiche', NULL, ?, '', ?, ?, 'md', ?, ?, ?, NULL, ?, NULL, 'cours', ?, ?, ?)`
  ).run(id, subject, title, basename(target), Buffer.byteLength(markdown), target, markdown.slice(0, 400_000), Date.now(), title, textKey(markdown), sha1(markdown))
  return id
}

/** L'utilisateur reclasse un document (le tri automatique peut se tromper) : cours, exercices, corrigé, infos… */
export function setDocumentCategory(id: string, category: string): void {
  if (category !== '' && !(CATEGORIES as string[]).includes(category)) throw new Error('Catégorie inconnue')
  const r = row(id)
  const learn = ['cours', 'methode', 'vocabulaire'].includes(category)
  const chapter = learn && !r.chapter ? fallbackChapter(r.title, r.folder) : r.chapter
  getDb().prepare('UPDATE document SET category = ?, chapter = ?, dup_of = NULL WHERE id = ?').run(category, chapter, id)
}
