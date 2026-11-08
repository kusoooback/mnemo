import { dialog, type BrowserWindow } from 'electron'
import { readFileSync, statSync } from 'fs'
import { basename, extname } from 'path'
import type { AnkiProfileInfo, ImportRequest, ImportResult, ImportSource, NoteKind } from '../shared/types'
import { mapRow, parseText } from '../shared/textimport'
import { readDocument } from './ai'
import {
  findAnkiProfiles,
  htmlToMarkdown,
  importAnkiSource,
  openAnkiProfile,
  openApkg,
  summarizeAnki
} from './anki'
import { getDb } from './db'
import { parseMarkdownCards } from './integrations'
import { addNote, checkDuplicate, createDeck } from './repo'
import { mergeSnapshot, type Snapshot } from './sync'
import { getSettings } from './util'

/*
 * Import universel : on devine le format depuis le fichier, on montre ce qui va se passer, on importe.
 * Formats : Anki (.apkg/.colpkg et profil installé), texte/CSV/TSV (Anki « notes en texte », Quizlet,
 * Brainscape, tableurs), Markdown, sauvegarde Mnémo (JSON), documents (PDF/Word) à passer à l'IA.
 */

const MAX_TEXT = 40 * 1024 * 1024

export const ankiProfiles = (): AnkiProfileInfo[] => findAnkiProfiles()

export function inspectSource(path: string): ImportSource {
  const name = basename(path)
  let st
  try {
    st = statSync(path)
  } catch {
    return { kind: 'unsupported', name, reason: 'Fichier introuvable.' }
  }
  // Dossier de profil Anki
  if (st.isDirectory()) {
    try {
      const src = openAnkiProfile(path)
      return { kind: 'anki', name, path, local: true, summary: summarizeAnki(src), warnings: src.warnings }
    } catch (e) {
      return { kind: 'unsupported', name, reason: (e as Error).message }
    }
  }
  const ext = extname(path).toLowerCase()
  if (ext === '.apkg' || ext === '.colpkg') {
    try {
      const src = openApkg(readFileSync(path))
      return { kind: 'anki', name, path, local: false, summary: summarizeAnki(src), warnings: src.warnings }
    } catch (e) {
      return { kind: 'unsupported', name, reason: (e as Error).message }
    }
  }
  if (['.csv', '.tsv', '.txt', '.tab', '.text'].includes(ext)) {
    if (st.size > MAX_TEXT) return { kind: 'unsupported', name, reason: 'Fichier trop volumineux (40 Mo max).' }
    return { kind: 'text', name, path, text: readFileSync(path, 'utf8') }
  }
  if (['.md', '.markdown'].includes(ext)) {
    const text = readFileSync(path, 'utf8')
    const cards = parseMarkdownCards(text)
    return {
      kind: 'markdown',
      name,
      path,
      cards: cards.length,
      sample: cards.slice(0, 5).map((c) => ({ front: c.fields.front ?? c.fields.text ?? '', back: c.fields.back ?? c.fields.extra ?? '' }))
    }
  }
  if (ext === '.json') {
    try {
      const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      if (j.format === 'mnemo-export')
        return {
          kind: 'mnemo',
          name,
          path,
          decks: (j.decks as unknown[]).length,
          notes: (j.notes as unknown[]).length,
          reviews: (j.reviews as unknown[]).length
        }
    } catch {
      /* pas un JSON valide */
    }
    return { kind: 'unsupported', name, reason: 'Ce JSON n’est pas une sauvegarde Mnémo. Exporte plutôt en CSV ou en texte depuis l’autre application.' }
  }
  if (['.pdf', '.docx'].includes(ext)) return { kind: 'document', name, path, text: '' }
  if (['.xlsx', '.xls', '.ods'].includes(ext))
    return { kind: 'unsupported', name, reason: 'Enregistre d’abord ta feuille en CSV (Fichier → Enregistrer sous → CSV), puis importe-la.' }
  return { kind: 'unsupported', name, reason: `Le format « ${ext || 'inconnu'} » n’est pas reconnu. Essaie un export CSV, texte, Markdown ou .apkg.` }
}

export async function pickSource(win: BrowserWindow | null): Promise<ImportSource | null> {
  const opts = {
    title: 'Importer des cartes',
    properties: ['openFile' as const],
    filters: [
      { name: 'Tous les formats pris en charge', extensions: ['apkg', 'colpkg', 'csv', 'tsv', 'txt', 'md', 'markdown', 'json', 'pdf', 'docx'] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  return inspectSource(res.filePaths[0])
}

export async function documentText(path: string): Promise<string> {
  return readDocument(path)
}

function kindFromCell(cell: string): NoteKind | null {
  const c = cell.toLowerCase()
  if (!c) return null
  if (/cloze|trou/.test(c)) return 'cloze'
  if (/revers|invers/.test(c)) return 'basic-reverse'
  if (/type in|saisie|typed/.test(c)) return 'typed'
  return 'basic'
}

function runText(req: ImportRequest): ImportResult {
  const o = req.options
  if (!o || req.text === undefined) throw new Error('Options d’import manquantes.')
  const parsed = parseText(req.text, o)
  const result: ImportResult = { source: req.name, added: 0, existing: 0, invalid: 0, reviews: 0, decks: 0, media: 0, warnings: [], deckId: null }
  const roles = o.roles.length ? o.roles : parsed.roles
  const deckCache = new Map<string, string>()
  const deckFor = (name: string): string => {
    let id = deckCache.get(name)
    if (!id) {
      id = createDeck(name, null)
      deckCache.set(name, id)
    }
    return id
  }
  const fallbackName = o.deckName.trim() || req.name.replace(/\.[^.]+$/, '') || 'Importé'
  const conv = (s: string): string => (o.html ? htmlToMarkdown(s, new Map()) : s)
  const db = getDb()
  const findSource = db.prepare('SELECT 1 FROM note WHERE source = ? AND deleted_at IS NULL')

  db.transaction(() => {
    for (const row of parsed.rows) {
      const m = mapRow(row, roles)
      const front = conv(m.front)
      const back = conv(m.back)
      const extra = conv(m.extra)
      let kind: NoteKind = o.kind === 'auto' ? kindFromCell(m.kind) ?? (/\{\{c\d+::/.test(front) ? 'cloze' : 'basic') : o.kind
      if (o.kind === 'auto' && kind !== 'cloze' && /\{\{c\d+::/.test(front)) kind = 'cloze'
      const fields: Record<string, string> =
        kind === 'cloze' ? { text: front, extra: [back, extra].filter(Boolean).join('\n\n') } : { front, back: [back, extra].filter(Boolean).join('\n\n') }
      const valid = kind === 'cloze' ? /\{\{c\d+::/.test(fields.text) : !!(fields.front && fields.back)
      if (!valid) {
        result.invalid++
        continue
      }
      const source = m.guid ? `txt:${m.guid}` : null
      if (source && findSource.get(source)) {
        result.existing++
        continue
      }
      if (o.skipDuplicates && checkDuplicate(kind, kind === 'cloze' ? fields.text : fields.front)) {
        result.existing++
        continue
      }
      const deckId =
        o.deckMode === 'existing' && o.deckId ? o.deckId : o.deckMode === 'column' && m.deck ? deckFor(m.deck) : deckFor(fallbackName)
      addNote({ kind, deckId, fields, tags: m.tags, source })
      result.added++
      result.deckId = result.deckId ?? deckId
    }
  })()
  result.decks = o.deckMode === 'existing' ? 0 : deckCache.size
  if (o.deckMode === 'column' && deckCache.size === 1) result.deckId = [...deckCache.values()][0]
  return result
}

function runMarkdown(req: ImportRequest): ImportResult {
  const cards = parseMarkdownCards(readFileSync(req.path, 'utf8'))
  const result: ImportResult = { source: req.name, added: 0, existing: 0, invalid: 0, reviews: 0, decks: 0, media: 0, warnings: [], deckId: null }
  if (!cards.length) throw new Error('Aucune carte reconnue dans ce fichier (voir la syntaxe dans Intégrations → Markdown).')
  const db = getDb()
  db.transaction(() => {
    const deckId = createDeck(req.deckName?.trim() || req.name.replace(/\.[^.]+$/, ''), null)
    result.deckId = deckId
    result.decks = 1
    for (const c of cards) {
      if (checkDuplicate(c.kind, c.kind === 'cloze' ? c.fields.text : c.fields.front)) {
        result.existing++
        continue
      }
      addNote({ kind: c.kind, deckId, fields: c.fields, tags: ['markdown'] })
      result.added++
    }
  })()
  return result
}

function runMnemo(req: ImportRequest): ImportResult {
  const j = JSON.parse(readFileSync(req.path, 'utf8')) as Record<string, Record<string, unknown>[]> & { format: string }
  if (j.format !== 'mnemo-export') throw new Error('Sauvegarde Mnémo invalide.')
  const snap = {
    format: 1,
    deviceId: 'import',
    deviceName: 'import',
    exportedAt: Date.now(),
    deck: j.decks ?? [],
    note: j.notes ?? [],
    card: j.cards ?? [],
    review: j.reviews ?? [],
    subject: [],
    entry: [],
    entry_link: [],
    task: [],
    media: []
  } as unknown as Snapshot
  const st = mergeSnapshot(getDb(), snap, getSettings().retention)
  const warnings: string[] = []
  if ((j.media ?? []).length) warnings.push('Les images ne sont pas incluses dans l’export JSON : elles resteront vides.')
  return { source: req.name, added: st.newNotes, existing: 0, invalid: 0, reviews: st.newReviews, decks: 0, media: 0, warnings, deckId: null }
}

export function runImport(req: ImportRequest): ImportResult {
  if (req.kind === 'anki') {
    const st = statSync(req.path)
    const src = st.isDirectory() ? openAnkiProfile(req.path) : openApkg(readFileSync(req.path))
    const r = importAnkiSource(src)
    const deck = r.notes ? (getDb().prepare("SELECT deck_id FROM card c JOIN note n ON n.id = c.note_id WHERE n.source LIKE 'anki:%' ORDER BY n.created_at DESC LIMIT 1").get() as { deck_id: string } | undefined) : undefined
    return {
      source: req.name,
      added: r.notes,
      existing: r.existing,
      invalid: r.skipped,
      reviews: r.reviews,
      decks: r.decks,
      media: r.media,
      warnings: r.warnings,
      deckId: r.decks === 1 ? (deck?.deck_id ?? null) : null
    }
  }
  if (req.kind === 'text') return runText(req)
  if (req.kind === 'markdown') return runMarkdown(req)
  return runMnemo(req)
}
