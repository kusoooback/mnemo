import { dialog, BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb, mediaDir } from './db'
import { addNote, checkDuplicate, createDeck } from './repo'
import { deckScope } from './util'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

/** Les médias sont rangés par empreinte : le même fichier n'existe qu'une fois et ne peut pas être en conflit. */
export function saveImage(bytes: ArrayBuffer, mime: string): string {
  const ext = EXT[mime]
  if (!ext) throw new Error('Format d’image non pris en charge')
  const buf = Buffer.from(bytes)
  if (buf.length > 25 * 1024 * 1024) throw new Error('Image trop lourde (25 Mo max)')
  const hash = createHash('sha256').update(buf).digest('hex')
  const file = `${hash}.${ext}`
  const target = join(mediaDir(), file)
  if (!existsSync(target)) writeFileSync(target, buf)
  getDb()
    .prepare('INSERT OR IGNORE INTO media(hash, mime, size, created_at) VALUES (?, ?, ?, ?)')
    .run(hash, mime, buf.length, Date.now())
  return `mnemo-media://${file}`
}

export async function exportJson(win: BrowserWindow | null): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 10)
  const opts = {
    title: 'Exporter toutes les données',
    defaultPath: `mnemo-export-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  const db = getDb()
  const dump = {
    format: 'mnemo-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    decks: db.prepare('SELECT * FROM deck').all(),
    notes: db.prepare('SELECT * FROM note').all(),
    cards: db.prepare('SELECT * FROM card').all(),
    reviews: db.prepare('SELECT * FROM review').all(),
    noteHistory: db.prepare('SELECT * FROM note_history').all(),
    media: db.prepare('SELECT * FROM media').all(),
    settings: db.prepare('SELECT * FROM setting').all()
  }
  writeFileSync(res.filePath, JSON.stringify(dump, null, 2), 'utf8')
  return res.filePath
}

/** Analyse CSV/TSV minimale (guillemets, retours à la ligne dans les champs). */
function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].sort(
    (a, b) => first.split(b).length - first.split(a).length
  )[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

export async function importCsv(
  win: BrowserWindow | null,
  deckId: string
): Promise<{ added: number; skipped: number } | null> {
  const opts = {
    title: 'Importer un fichier CSV / TSV',
    properties: ['openFile' as const],
    filters: [{ name: 'Tableur / texte', extensions: ['csv', 'tsv', 'txt'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  const text = readFileSync(res.filePaths[0], 'utf8').replace(/^﻿/, '')
  let rows = parseDelimited(text)
  if (rows.length && /^(front|recto|question|text|texte)$/i.test(rows[0][0].trim())) rows = rows.slice(1)
  let added = 0
  let skipped = 0
  getDb().transaction(() => {
    for (const r of rows) {
      const a = (r[0] ?? '').trim()
      const b = (r[1] ?? '').trim()
      if (!a) continue
      const isCloze = /\{\{c\d+::/.test(a)
      if (!isCloze && !b) {
        skipped++
        continue
      }
      const kind = isCloze ? 'cloze' : 'basic'
      if (checkDuplicate(kind, a)) {
        skipped++
        continue
      }
      addNote({
        kind,
        deckId,
        fields: isCloze ? { text: a, extra: b } : { front: a, back: b },
        tags: (r[2] ?? '').split(/[\s,;]+/).filter(Boolean)
      })
      added++
    }
  })()
  return { added, skipped }
}

export function createSample(): string {
  const deck = createDeck('Découverte de Mnémo', null)
  const cards: Parameters<typeof addNote>[0][] = [
    {
      kind: 'basic',
      deckId: deck,
      fields: {
        front: 'Quelle est la capitale de l’Australie ?',
        back: '**Canberra** — et non Sydney, la plus grande ville.'
      },
      tags: ['géographie']
    },
    {
      kind: 'cloze',
      deckId: deck,
      fields: {
        text: 'La mitochondrie produit l’{{c1::ATP}} grâce à la {{c2::phosphorylation oxydative::processus}}.',
        extra: 'Centrale énergétique de la cellule.'
      },
      tags: ['biologie']
    },
    {
      kind: 'basic',
      deckId: deck,
      fields: {
        front: 'Formule de la dérivée d’un produit $(uv)\'$ ?',
        back: '$$(uv)\' = u\'v + uv\'$$'
      },
      tags: ['maths']
    },
    {
      kind: 'basic-reverse',
      deckId: deck,
      fields: { front: 'Hello', back: 'Bonjour' },
      tags: ['langues']
    },
    {
      kind: 'basic',
      deckId: deck,
      fields: {
        front: 'En Python, comment inverser une liste `xs` sans la modifier ?',
        back: '```python\nreversed_xs = xs[::-1]\n```'
      },
      tags: ['code']
    },
    {
      kind: 'basic',
      deckId: deck,
      fields: {
        front: 'Que signifie « FSRS » ?',
        back: 'Free Spaced Repetition Scheduler — un algorithme qui estime la mémoire de chaque carte pour viser une rétention choisie.'
      },
      tags: ['mnémo']
    }
  ]
  getDb().transaction(() => cards.forEach((c) => addNote(c)))()
  return deck
}

/* ---------- Export CSV / Markdown (INT09) ---------- */

interface ExportRow {
  deck: string
  kind: string
  fields: Record<string, string>
  tags: string[]
}

function exportRows(deckId: string | null): ExportRow[] {
  const scope = deckScope('c.deck_id', deckId)
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT n.id, n.kind, n.fields, n.tags,
         (SELECT d.name FROM card c2 JOIN deck d ON d.id = c2.deck_id WHERE c2.note_id = n.id AND c2.deleted_at IS NULL LIMIT 1) deck
       FROM note n JOIN card c ON c.note_id = n.id
       WHERE n.deleted_at IS NULL AND n.kind != 'occlusion' AND c.deleted_at IS NULL AND ${scope.sql} ORDER BY n.created_at`
    )
    .all(scope.params) as { kind: string; fields: string; tags: string; deck: string }[]
  return rows.map((r) => ({ deck: r.deck, kind: r.kind, fields: JSON.parse(r.fields), tags: r.tags.split(' ').filter(Boolean) }))
}

async function saveText(win: BrowserWindow | null, title: string, name: string, ext: string, text: string, bom = false): Promise<string | null> {
  const opts = { title, defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, (bom ? '﻿' : '') + text, 'utf8')
  return res.filePath
}

export async function exportCsv(win: BrowserWindow | null, deckId: string | null): Promise<string | null> {
  const q = (s: string): string => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = ['front;back;tags;deck;type']
  for (const r of exportRows(deckId)) {
    const [a, b] = r.kind === 'cloze' ? [r.fields.text ?? '', r.fields.extra ?? ''] : [r.fields.front ?? '', r.fields.back ?? '']
    lines.push([a, b, r.tags.join(' '), r.deck, r.kind].map(q).join(';'))
  }
  return saveText(win, 'Exporter en CSV', 'mnemo-cartes.csv', 'csv', lines.join('\r\n'), true)
}

/** Markdown relisible par l'intégration Obsidian : « Question :: Réponse », « Terme ::: Définition », trous {{c1::…}}. */
export async function exportMarkdown(win: BrowserWindow | null, deckId: string | null): Promise<string | null> {
  const byDeck = new Map<string, string[]>()
  for (const r of exportRows(deckId)) {
    const one = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()
    let line: string
    if (r.kind === 'cloze') line = one(r.fields.text ?? '')
    else if (r.kind === 'basic-reverse') line = `${one(r.fields.front ?? '')} ::: ${one(r.fields.back ?? '')}`
    else line = `${one(r.fields.front ?? '')} :: ${one(r.fields.back ?? '')}`
    byDeck.set(r.deck, [...(byDeck.get(r.deck) ?? []), `- ${line}`])
  }
  const text = [...byDeck.entries()].map(([d, l]) => `## ${d}\n\n${l.join('\n')}\n`).join('\n')
  return saveText(win, 'Exporter en Markdown', 'mnemo-cartes.md', 'md', `# Cartes Mnémo\n\n${text}`)
}
