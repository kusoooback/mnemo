/*
 * Lecture « universelle » des fichiers texte de cartes : CSV, TSV, export texte d'Anki (avec ses lignes #directives),
 * export Quizlet, Brainscape, Memrise, tableurs enregistrés en CSV…
 * Code partagé : l'interface s'en sert pour l'aperçu en direct, le processus principal pour l'import.
 */

export type Role = 'front' | 'back' | 'extra' | 'tags' | 'deck' | 'kind' | 'guid' | 'skip'
export type DelimiterChoice = 'auto' | 'tab' | 'semicolon' | 'comma' | 'pipe' | 'custom'

export interface TextOptions {
  delimiter: DelimiterChoice
  /** Séparateur personnalisé entre recto et verso (ex. « :: » ou « - »). */
  custom: string
  /** Séparateur personnalisé entre deux cartes (Quizlet permet par exemple « ;; »). Vide = retour à la ligne. */
  rowSeparator: string
  header: 'auto' | 'yes' | 'no'
}

export const DEFAULT_TEXT_OPTIONS: TextOptions = { delimiter: 'auto', custom: '', rowSeparator: '', header: 'auto' }

export interface TextParse {
  delimiter: Exclude<DelimiterChoice, 'auto'>
  delimiterText: string
  hasHeader: boolean
  headers: string[]
  columns: number
  /** Toutes les lignes de données (sans l'en-tête). */
  rows: string[][]
  roles: Role[]
  html: boolean
  directives: Record<string, string>
}

const DELIMS: Record<Exclude<DelimiterChoice, 'auto' | 'custom'>, string> = { tab: '\t', semicolon: ';', comma: ',', pipe: '|' }
const NAMED: Record<string, Exclude<DelimiterChoice, 'auto' | 'custom'>> = { tab: 'tab', semicolon: 'semicolon', comma: 'comma', pipe: 'pipe' }

/** Découpe en enregistrements en respectant les guillemets (champs multi-lignes, guillemets doublés). */
export function splitRecords(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const n = text.length
  for (let i = 0; i < n; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (text.startsWith(delim, i)) {
      row.push(cell)
      cell = ''
      i += delim.length - 1
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

function detectDelimiter(lines: string[]): Exclude<DelimiterChoice, 'auto' | 'custom'> {
  const sample = lines.filter((l) => l.trim()).slice(0, 25)
  let best: Exclude<DelimiterChoice, 'auto' | 'custom'> = 'tab'
  let bestScore = -1
  for (const [name, ch] of Object.entries(DELIMS) as [Exclude<DelimiterChoice, 'auto' | 'custom'>, string][]) {
    const counts = sample.map((l) => l.split(ch).length - 1)
    const withIt = counts.filter((c) => c > 0).length
    if (!withIt) continue
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)]
    const consistent = counts.filter((c) => c === mode).length
    // On préfère le séparateur présent partout, de façon régulière ; la tabulation gagne à égalité.
    const score = (withIt / sample.length) * 2 + consistent / sample.length + (name === 'tab' ? 0.25 : 0)
    if (score > bestScore) {
      best = name
      bestScore = score
    }
  }
  return best
}

const LABEL = /^(front|back|recto|verso|question|answer|r[ée]ponse|term|terme|definition|d[ée]finition|tags?|[ée]tiquettes?|deck|paquet|cat[ée]gorie|type|note ?type|text|texte|extra|guid|id|note|hint|indice|mot|word|translation|traduction|meaning|sens|prompt|reverse|inverse|image)\b/i

function guessRoles(columns: number, headers: string[], directives: Record<string, string>): Role[] {
  const roles: Role[] = Array(columns).fill('skip')
  const taken = new Set<number>()
  const setCol = (col: number, role: Role): void => {
    if (col >= 0 && col < columns) {
      roles[col] = role
      taken.add(col)
    }
  }
  // Directives d'un export texte d'Anki : « #notetype column:2 », « #deck column:3 »…
  for (const [k, v] of Object.entries(directives)) {
    const m = /^(guid|notetype|deck|tags) column$/.exec(k)
    if (m) setCol(Number(v) - 1, m[1] === 'notetype' ? 'kind' : (m[1] as Role))
  }
  // En-têtes reconnus
  headers.forEach((h, i) => {
    if (taken.has(i)) return
    const x = h.trim().toLowerCase()
    if (/^(tags?|[ée]tiquettes?)$/.test(x)) setCol(i, 'tags')
    else if (/^(deck|paquet|cat[ée]gorie)$/.test(x)) setCol(i, 'deck')
    else if (/^(note ?type|type)$/.test(x)) setCol(i, 'kind')
    else if (/^(guid|id)$/.test(x)) setCol(i, 'guid')
    else if (/^(front|recto|question|term|terme|text|texte|mot|word|prompt)$/.test(x)) setCol(i, 'front')
    else if (/^(back|verso|answer|r[ée]ponse|definition|d[ée]finition|translation|traduction|meaning|sens)$/.test(x)) setCol(i, 'back')
    else if (/^(extra|hint|indice|note)$/.test(x)) setCol(i, 'extra')
  })
  // Le reste, dans l'ordre : recto, verso, puis compléments.
  const order: Role[] = ['front', 'back']
  const used = new Set(roles)
  const needed = order.filter((r) => !used.has(r))
  let ni = 0
  for (let i = 0; i < columns; i++) {
    if (taken.has(i)) continue
    if (ni < needed.length) {
      roles[i] = needed[ni++]
      taken.add(i)
    } else {
      roles[i] = 'extra'
    }
  }
  // Si l'export Anki place les étiquettes en dernier sans directive, elles sont déjà « extra » : on laisse l'utilisateur ajuster.
  return roles
}

export function parseText(text: string, opts: TextOptions = DEFAULT_TEXT_OPTIONS): TextParse {
  let body = text.replace(/^﻿/, '')
  // Directives Anki : lignes « #clé:valeur » en tête de fichier.
  const directives: Record<string, string> = {}
  const lines = body.split(/\r?\n/)
  let start = 0
  while (start < lines.length && lines[start].startsWith('#')) {
    const m = /^#([^:]+):(.*)$/.exec(lines[start])
    if (m) directives[m[1].trim().toLowerCase()] = m[2].trim()
    start++
  }
  if (start > 0) body = lines.slice(start).join('\n')

  let delimiter: Exclude<DelimiterChoice, 'auto'>
  let delimText: string
  if (opts.delimiter === 'custom' && opts.custom) {
    delimiter = 'custom'
    delimText = opts.custom
  } else if (opts.delimiter !== 'auto' && opts.delimiter !== 'custom') {
    delimiter = opts.delimiter
    delimText = DELIMS[opts.delimiter]
  } else if (directives.separator && NAMED[directives.separator.toLowerCase()]) {
    delimiter = NAMED[directives.separator.toLowerCase()]
    delimText = DELIMS[delimiter]
  } else {
    delimiter = detectDelimiter(body.split(/\r?\n/))
    delimText = DELIMS[delimiter as keyof typeof DELIMS]
  }

  let rows: string[][]
  if (opts.rowSeparator && opts.rowSeparator !== '\n') {
    rows = body
      .split(opts.rowSeparator)
      .map((r) => r.replace(/^\s+|\s+$/g, ''))
      .filter(Boolean)
      .map((r) => r.split(delimText))
  } else {
    rows = splitRecords(body, delimText)
  }

  const columns = rows.reduce((m, r) => Math.max(m, r.length), 0)
  let headers: string[] = []
  const colsDirective = directives.columns
  if (colsDirective) headers = colsDirective.split(delimText)
  let hasHeader = false
  if (opts.header === 'yes') hasHeader = true
  else if (opts.header === 'auto' && !colsDirective && rows.length > 1) {
    const first = rows[0]
    hasHeader = first.length >= 2 && first.every((c) => c.length < 40) && first.filter((c) => LABEL.test(c.trim())).length >= Math.min(2, first.length)
  }
  if (hasHeader) headers = rows.shift() ?? []

  const html = directives.html === 'true' || rows.slice(0, 50).some((r) => r.some((c) => /<(br|div|b|i|span|img|p|ul|li)\b/i.test(c)))
  return {
    delimiter,
    delimiterText: delimText,
    hasHeader,
    headers,
    columns,
    rows,
    roles: guessRoles(columns, headers, directives),
    html,
    directives
  }
}

export interface MappedRow {
  front: string
  back: string
  extra: string
  tags: string[]
  deck: string
  kind: string
  guid: string
}

/** Applique l'affectation des colonnes à une ligne. */
export function mapRow(row: string[], roles: Role[]): MappedRow {
  const out: MappedRow = { front: '', back: '', extra: '', tags: [], deck: '', kind: '', guid: '' }
  const extras: string[] = []
  roles.forEach((role, i) => {
    const v = (row[i] ?? '').trim()
    if (!v) return
    if (role === 'front') out.front = out.front ? `${out.front}\n\n${v}` : v
    else if (role === 'back') out.back = out.back ? `${out.back}\n\n${v}` : v
    else if (role === 'extra') extras.push(v)
    else if (role === 'tags') out.tags.push(...v.split(/[\s,;]+/).filter(Boolean))
    else if (role === 'deck') out.deck = v
    else if (role === 'kind') out.kind = v
    else if (role === 'guid') out.guid = v
  })
  out.extra = extras.join('\n\n')
  return out
}
