import { createHash } from 'crypto'
import { dialog, type BrowserWindow } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'fs'
import { join, relative, sep, basename, extname } from 'path'
import type { DuplicateGroup, IntegrationInfo, MarkdownImportReport, NoteKind, NotionPage } from '../shared/types'
import { getDb } from './db'
import { hasSecret, getSecret, setSecret } from './secrets'
import { addNote, createDeck, deleteNotes, getNote, updateNote } from './repo'
import { getSettings } from './util'

/* ------------------------------------------------------------------ */
/* Registre des intégrations                                            */
/* ------------------------------------------------------------------ */

/*
 * Chaque intégration est un module séparé, désactivé par défaut, qui peut être retiré sans toucher au reste.
 * Pour en ajouter une : créer son module, l'enregistrer ici (statut + description), exposer ses actions dans handlers.ts.
 */
export function listIntegrations(): IntegrationInfo[] {
  const s = getSettings()
  const st = (on: boolean): 'active' | 'available' => (on ? 'active' : 'available')
  return [
    { id: 'anki', name: 'Anki (.apkg)', description: 'Importe et exporte des paquets : cartes, images, historique de révision.', status: 'active', priority: 'P0' },
    { id: 'csv', name: 'CSV et Markdown', description: 'Import CSV/TSV, export CSV et Markdown pour tableurs et éditeurs.', status: 'active', priority: 'P0' },
    { id: 'obsidian', name: 'Obsidian / dossier Markdown', description: 'Génère des cartes depuis un dossier de notes et se met à jour quand une note change.', status: st(!!s.obsidianFolder), priority: 'P1' },
    { id: 'ics', name: 'Calendrier (.ics)', description: 'Exporte examens et blocs de révision vers Outlook, Google Agenda, Apple Calendrier.', status: 'active', priority: 'P1' },
    { id: 'folder-sync', name: 'Synchronisation par dossier', description: 'OneDrive, Dropbox, Google Drive ou Syncthing, chiffrée de bout en bout.', status: st(s.syncMode === 'folder'), priority: 'P0' },
    { id: 'ai', name: 'IA (Ollama, OpenAI, Anthropic)', description: 'Génération et diagnostic de cartes. Local ou avec ta propre clé.', status: st(s.aiProvider !== 'none'), priority: 'P0' },
    { id: 'clipboard', name: 'Ajout rapide (raccourci global)', description: 'Crée une carte depuis du texte copié, depuis n’importe quelle application.', status: st(s.quickAdd), priority: 'P1' },
    { id: 'notion', name: 'Notion', description: 'Importe le texte de pages Notion comme source de cartes (jeton d’intégration).', status: st(hasSecret('notion.token')), priority: 'P1' },
    { id: 'gcal', name: 'Google Agenda (direct)', description: 'Publication automatique via OAuth. En attendant : export .ics.', status: 'planned', priority: 'P1' },
    { id: 'browser', name: 'Extension navigateur', description: 'Envoyer une sélection de page web vers l’app.', status: 'planned', priority: 'P2' },
    { id: 'relay', name: 'Serveur relais Mnémo / auto-hébergé', description: 'Synchronisation sans dossier partagé, avec compte optionnel.', status: 'planned', priority: 'P1' }
  ]
}

/* ------------------------------------------------------------------ */
/* Dossier Markdown (Obsidian)                                          */
/* ------------------------------------------------------------------ */

export interface ParsedCard {
  kind: NoteKind
  fields: Record<string, string>
  key: string
}

/**
 * Syntaxes reconnues :
 *   Question :: Réponse         → carte recto/verso
 *   Terme ::: Définition        → recto/verso + inverse
 *   Texte avec {{c1::trou}}     → carte à trous
 *   Question\n?\nRéponse        → recto/verso multi-lignes (séparateur « ? » seul sur sa ligne)
 */
export function parseMarkdownCards(text: string): ParsedCard[] {
  const out: ParsedCard[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let inCode = false
  let block: string[] = []
  const flush = (): void => {
    const q = block.findIndex((l) => l.trim() === '?')
    if (q > 0 && q < block.length - 1) {
      const front = block.slice(0, q).join('\n').trim()
      const back = block.slice(q + 1).join('\n').trim()
      if (front && back) out.push({ kind: 'basic', fields: { front, back }, key: front })
    }
    block = []
  }
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) inCode = !inCode
    if (inCode) {
      block.push(raw)
      continue
    }
    if (!raw.trim()) {
      flush()
      continue
    }
    const line = raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    if (/\{\{c\d+::/.test(line)) {
      out.push({ kind: 'cloze', fields: { text: line.trim(), extra: '' }, key: line.trim() })
      continue
    }
    const rev = /^(.+?)\s:::\s(.+)$/.exec(line)
    if (rev) {
      out.push({ kind: 'basic-reverse', fields: { front: rev[1].trim(), back: rev[2].trim() }, key: rev[1].trim() })
      continue
    }
    const one = /^(.+?)\s::\s(.+)$/.exec(line)
    if (one && !line.includes('{{')) {
      out.push({ kind: 'basic', fields: { front: one[1].trim(), back: one[2].trim() }, key: one[1].trim() })
      continue
    }
    block.push(raw)
  }
  flush()
  return out
}

function walkMarkdown(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkMarkdown(p, acc)
    else if (['.md', '.markdown'].includes(extname(name).toLowerCase())) acc.push(p)
  }
  return acc
}

const shortHash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12)

/** Crée / met à jour les cartes d'un dossier. Ne supprime jamais rien : une ligne retirée de la note laisse la carte en place. */
export function scanMarkdownFolder(folder: string): MarkdownImportReport {
  if (!folder || !existsSync(folder)) throw new Error('Dossier introuvable.')
  const report: MarkdownImportReport = { files: 0, added: 0, updated: 0, unchanged: 0 }
  const db = getDb()
  const root = basename(folder)
  db.transaction(() => {
    for (const file of walkMarkdown(folder)) {
      const cards = parseMarkdownCards(readFileSync(file, 'utf8'))
      if (!cards.length) continue
      report.files++
      const rel = relative(folder, file)
      const parts = rel.split(sep)
      parts[parts.length - 1] = parts[parts.length - 1].replace(/\.(md|markdown)$/i, '')
      const deckId = createDeck(['Notes', root, ...parts].join('::'), null)
      for (const c of cards) {
        const source = `md:${rel.replace(/\\/g, '/')}:${shortHash(c.key)}`
        const existing = db.prepare('SELECT id FROM note WHERE source = ? AND deleted_at IS NULL').get(source) as { id: string } | undefined
        if (existing) {
          const note = getNote(existing.id)
          if (note && JSON.stringify(note.fields) !== JSON.stringify(c.fields)) {
            updateNote(existing.id, { kind: c.kind, fields: c.fields, tags: note.tags })
            report.updated++
          } else report.unchanged++
        } else {
          addNote({ kind: c.kind, deckId, fields: c.fields, tags: ['markdown'], source })
          report.added++
        }
      }
    }
  })()
  return report
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

export function startMarkdownWatch(onChange: (r: MarkdownImportReport) => void): void {
  stopMarkdownWatch()
  const s = getSettings()
  if (!s.obsidianWatch || !s.obsidianFolder || !existsSync(s.obsidianFolder)) return
  try {
    watcher = watch(s.obsidianFolder, { recursive: true }, (_e, name) => {
      if (name && !/\.(md|markdown)$/i.test(name)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          const r = scanMarkdownFolder(s.obsidianFolder)
          if (r.added || r.updated) onChange(r)
        } catch {
          /* dossier momentanément indisponible */
        }
      }, 1500)
    })
  } catch {
    /* surveillance non disponible sur cette plateforme */
  }
}

export function stopMarkdownWatch(): void {
  watcher?.close()
  watcher = null
}

export async function pickFolder(win: BrowserWindow | null, title: string): Promise<string | null> {
  const opts = { title, properties: ['openDirectory' as const, 'createDirectory' as const] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
}

/* ------------------------------------------------------------------ */
/* Doublons (F10)                                                       */
/* ------------------------------------------------------------------ */

const norm = (s: string): string => s.toLowerCase().replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function findDuplicates(): DuplicateGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT n.id, n.kind, n.fields,
         (SELECT d.name FROM card c JOIN deck d ON d.id = c.deck_id WHERE c.note_id = n.id AND c.deleted_at IS NULL LIMIT 1) deckName,
         (SELECT COUNT(*) FROM review r JOIN card c ON c.id = r.card_id WHERE c.note_id = n.id) reviews
       FROM note n WHERE n.deleted_at IS NULL`
    )
    .all() as { id: string; kind: string; fields: string; deckName: string | null; reviews: number }[]
  const groups = new Map<string, DuplicateGroup['notes']>()
  for (const r of rows) {
    const f = JSON.parse(r.fields) as Record<string, string>
    const first = r.kind === 'cloze' ? f.text : f.front
    const key = `${r.kind === 'cloze' ? 'c' : 'b'}:${norm(first ?? '')}`
    if (key.length < 4) continue
    groups.set(key, [
      ...(groups.get(key) ?? []),
      { id: r.id, front: (first ?? '').slice(0, 140), back: (f.back ?? f.extra ?? '').slice(0, 140), deckName: r.deckName ?? '', reviews: r.reviews }
    ])
  }
  return [...groups.entries()].filter(([, v]) => v.length > 1).map(([key, notes]) => ({ key, notes }))
}

/** Fusion assistée : on garde une note, on y ajoute les étiquettes des autres, qui sont mises de côté (suppression douce). */
export function mergeDuplicates(keepId: string, removeIds: string[]): void {
  const keep = getNote(keepId)
  if (!keep) throw new Error('Note à conserver introuvable')
  const tags = new Set(keep.tags)
  for (const id of removeIds) getNote(id)?.tags.forEach((t) => tags.add(t))
  updateNote(keepId, { kind: keep.kind, fields: keep.fields, tags: [...tags] })
  deleteNotes(removeIds.filter((id) => id !== keepId))
}

/* ------------------------------------------------------------------ */
/* Notion                                                               */
/* ------------------------------------------------------------------ */

const NOTION = 'https://api.notion.com/v1'

async function notion(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${NOTION}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }
  })
  const body = await res.text()
  if (!res.ok) throw new Error(res.status === 401 ? 'Jeton Notion refusé.' : `Notion : ${res.status} ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

export async function notionConnect(token: string): Promise<NotionPage[]> {
  const t = token.trim() || getSecret('notion.token') || ''
  if (!t) throw new Error('Jeton Notion manquant.')
  const r = await notion('/search', t, { method: 'POST', body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 50 }) })
  setSecret('notion.token', t)
  return (r.results as any[]).map((p) => {
    const titleProp = Object.values(p.properties ?? {}).find((x: any) => x.type === 'title') as any
    return { id: p.id as string, title: (titleProp?.title ?? []).map((x: any) => x.plain_text).join('') || 'Sans titre' }
  })
}

export function notionForget(): void {
  setSecret('notion.token', null)
}

export const notionStatus = (): boolean => hasSecret('notion.token')

export async function notionPageText(pageId: string): Promise<string> {
  const token = getSecret('notion.token')
  if (!token) throw new Error('Notion n’est pas connecté.')
  const lines: string[] = []
  let count = 0
  const walk = async (id: string, depth: number): Promise<void> => {
    let cursor: string | undefined
    do {
      const r = await notion(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, token)
      for (const b of r.results as any[]) {
        if (++count > 500) return
        const data = b[b.type]
        const text = ((data?.rich_text ?? []) as any[]).map((x) => x.plain_text).join('')
        const pad = '  '.repeat(depth)
        switch (b.type) {
          case 'heading_1': lines.push(`\n# ${text}`); break
          case 'heading_2': lines.push(`\n## ${text}`); break
          case 'heading_3': lines.push(`\n### ${text}`); break
          case 'bulleted_list_item': lines.push(`${pad}- ${text}`); break
          case 'numbered_list_item': lines.push(`${pad}1. ${text}`); break
          case 'to_do': lines.push(`${pad}- ${text}`); break
          case 'quote': lines.push(`> ${text}`); break
          case 'code': lines.push('```' + (data.language ?? ''), text, '```'); break
          default: if (text) lines.push(text)
        }
        if (b.has_children && depth < 3 && b.type !== 'child_page') await walk(b.id, depth + 1)
      }
      cursor = r.has_more ? r.next_cursor : undefined
    } while (cursor && count <= 500)
  }
  await walk(pageId, 0)
  return lines.join('\n').trim()
}
