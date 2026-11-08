import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type {
  AiCardProposal,
  PrepaDoc,
  PrepaEvent,
  PrepaImportOptions,
  PrepaImportResult,
  PrepaProgress,
  PrepaScan,
  PrepaSubject
} from '../shared/types'
import { aiCardsFromText, aiStatus, aiSummarize, readDocumentBuffer } from './ai'
import { dataDir, getDb } from './db'
import { addNote, checkDuplicate, createDeck, deleteDeck, deleteNotes } from './repo'
import { goodCard } from './cardquality'
import { findDuplicate, sha1, textKey } from './dedupe'
import { CARD_CATEGORIES, triageDocument } from './triage'
import { saveEntry, saveSubject, listSubjects } from './notebook'
import { getSettings, newId } from './util'

/*
 * Connecteur « Cahier de Prépa » (logiciel libre utilisé par de nombreuses classes préparatoires).
 * - Sans compte : lit les contenus publics (nouveautés, agenda).
 * - Avec le compte de l'élève : parcourt les répertoires de chaque matière.
 * Les documents sont téléchargés une seule fois, rangés par matière, lus, puis transformés en cartes et en fiches.
 */

export interface HttpResponse {
  status: number
  text: string
  buffer: Buffer
  headers: { get(name: string): string | null }
}
export interface Http {
  get(url: string): Promise<HttpResponse>
  post(url: string, form: Record<string, string>): Promise<HttpResponse>
}

const UA = 'Mozilla/5.0 (compatible; Mnemo/1.0; +https://github.com/) '

/** Client HTTP basé sur n'importe quel fetch (celui d'Electron avec la session du site, ou celui de Node pour les tests). */
export function fetchHttp(fetchFn: (url: string, init?: RequestInit) => Promise<Response>): Http {
  const wrap = async (url: string, init?: RequestInit): Promise<HttpResponse> => {
    const r = await fetchFn(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } })
    const buffer = Buffer.from(await r.arrayBuffer())
    return { status: r.status, buffer, text: buffer.toString('utf8'), headers: r.headers }
  }
  return {
    get: (url) => wrap(url),
    post: (url, form) =>
      wrap(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString()
      })
  }
}

export function normalizeBase(input: string): string {
  let u = input.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  const url = new URL(u)
  // On garde le répertoire de la classe : https://cahier-de-prepa.fr/<classe>/
  const parts = url.pathname.split('/').filter(Boolean)
  const known = new Set(['docs', 'recent', 'agenda', 'progcolles', 'cdt', 'notes', 'download', 'index.php'])
  const dir = parts.filter((p, i) => !(i === parts.length - 1 && (known.has(p) || p.includes('.'))))
  return `${url.origin}/${dir.join('/')}${dir.length ? '/' : ''}`
}

const decode = (s: string): string =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()

export const isProtected = (html: string): boolean => /Ce contenu est protégé/i.test(html)

export function parseSiteName(html: string): string {
  const t = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? ''
  const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
  return decode(h ?? t) || 'Cahier de Prépa'
}

/** Matières : les options du filtre « par matière » de la page des nouveautés. */
export function parseSubjects(recentHtml: string): PrepaSubject[] {
  const sel = /<select id="matiere"[\s\S]*?<\/select>/i.exec(recentHtml)?.[0] ?? ''
  const out: PrepaSubject[] = []
  for (const m of sel.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/gi)) {
    if (['tout', 'general', ''].includes(m[1])) continue
    out.push({ slug: m[1], name: decode(m[2]) })
  }
  return out
}

function yearFor(day: number, month: number, now = new Date()): number {
  const candidate = new Date(now.getFullYear(), month - 1, day)
  // Une date très en avance sur aujourd'hui appartient à l'année passée (le site n'affiche pas l'année).
  return candidate.getTime() - now.getTime() > 45 * 86400000 ? now.getFullYear() - 1 : now.getFullYear()
}

/** Page « nouveautés » : documents récents avec leur répertoire (« Anglais/SEQUENCE 1 »), taille et date. */
export function parseRecent(html: string, subjects: PrepaSubject[], now = new Date()): PrepaDoc[] {
  const docs: PrepaDoc[] = []
  for (const m of html.matchAll(/<article class="recents">([\s\S]*?)<\/article>/gi)) {
    const body = m[1]
    const link = /<a href="download\?id=(\d+)"[^>]*>([\s\S]*?)<\/a>/i.exec(body)
    if (!link) continue
    const where = /dans\s*<a href="docs\?rep=\d+">([\s\S]*?)<\/a>/i.exec(body)?.[1]
    const path = where ? decode(where) : ''
    const [first, ...rest] = path.split('/')
    const size = /Document de ([\d\s .,]+(?:&nbsp;)?\s*[kmg]?o)/i.exec(body.replace(/&nbsp;/g, ' '))?.[1]?.trim() ?? ''
    const pub = /Publication le (\d{2})\/(\d{2})(?: à (\d{1,2})h(\d{2}))?/i.exec(body)
    let publishedAt: number | null = null
    if (pub) {
      const day = Number(pub[1])
      const month = Number(pub[2])
      publishedAt = new Date(yearFor(day, month, now), month - 1, day, Number(pub[3] ?? 12), Number(pub[4] ?? 0)).getTime()
    }
    const subject = first ? (subjects.find((s) => s.name.toLowerCase() === first.toLowerCase())?.name ?? first) : ''
    docs.push({
      remoteId: link[1],
      title: decode(link[2]),
      subject,
      folder: rest.join(' / '),
      size,
      publishedAt,
      kind: /colle/i.test(path) ? 'colle' : 'doc'
    })
  }
  return docs
}

/** Pages de répertoires (après connexion) : sous-répertoires et fichiers, sans dépendre d'une mise en page précise. */
export interface DocsPage {
  /** Fil d'Ariane de la page (« Mathématiques / Distanciel ») : la matière et le chemin réels, quel que soit le chemin suivi pour y arriver. */
  crumbs: { subject: string; path: string[] } | null
  /** Matières listées à la racine (`?maths`), avec leur nom. */
  roots: { slug: string; label: string }[]
  folders: { rep: string; label: string }[]
  files: { id: string; label: string; size: string; publishedAt: number | null; ext: string }[]
}

/** « (pdf, 03/10/2020, 1 Mo) » -> extension, date et taille. */
function parseDocData(raw: string): { ext: string; size: string; publishedAt: number | null } {
  const parts = decode(raw).replace(/^\(|\)$/g, '').split(',').map((p) => p.trim())
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(parts[1] ?? '')
  return {
    ext: (parts[0] ?? '').toLowerCase(),
    size: parts[2] ?? '',
    publishedAt: date ? new Date(Number(date[3]), Number(date[2]) - 1, Number(date[1]), 12).getTime() : null
  }
}

/**
 * Pages de répertoires (après connexion) : sous-répertoires et fichiers.
 * Le site écrit les liens de répertoire `?rep=12` (ou `?maths` à la racine) et liste en bas une section
 * « Documents récents » dont les titres contiennent tout le chemin : on ne s'en sert pas ici.
 */
export function parseDocsPage(html: string): DocsPage {
  // Le menu de gauche liste lui aussi des dossiers (`?rep=…`) de toutes les matières : on ne lit que le contenu de la page.
  const start = html.search(/<section[\s>]/i)
  const main = start >= 0 ? html.slice(start) : html
  const cut = main.search(/<h3[^>]*>\s*Documents récents/i)
  const body = cut >= 0 ? main.slice(0, cut) : main
  let crumbs: DocsPage['crumbs'] = null
  const barMatch = /<p id="parentsdoc"[^>]*>([\s\S]*?)<\/p>/i.exec(body)
  const bar = barMatch?.[1]
  if (bar) {
    let subject = ''
    const path: string[] = []
    for (const m of bar.matchAll(/<a\b[^>]*href="docs\?(rep=\d+|[a-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = decode(m[2])
      if (!label) continue
      if (m[1].startsWith('rep=')) path.push(label)
      else if (!subject) subject = label
    }
    if (subject || path.length) crumbs = { subject, path }
  }
  // Le fil d'Ariane contient le dossier courant : il ne compte pas parmi les sous-dossiers.
  const content = barMatch ? body.replace(barMatch[0], '') : body
  const roots: DocsPage['roots'] = []
  const folders: DocsPage['folders'] = []
  const files: DocsPage['files'] = []
  const seenRep = new Set<string>()
  const seenRoot = new Set<string>()
  for (const m of content.matchAll(/<a\b[^>]*href="(?:docs)?\?(rep=(\d+)|([a-z0-9_-]+))"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decode(m[4])
    if (!label) continue
    if (m[2]) {
      if (seenRep.has(m[2])) continue
      seenRep.add(m[2])
      folders.push({ rep: m[2], label })
    } else if (m[3] && !seenRoot.has(m[3]) && /<p class="rep"/i.test(content.slice(Math.max(0, (m.index ?? 0) - 160), m.index))) {
      seenRoot.add(m[3])
      roots.push({ slug: m[3], label })
    }
  }
  const seenId = new Set<string>()
  for (const m of content.matchAll(/<p class="doc"[^>]*>([\s\S]*?)<\/p>/gi)) {
    const link = /<a\b[^>]*href="download\?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(m[1])
    if (!link || seenId.has(link[1])) continue
    seenId.add(link[1])
    const data = parseDocData(/<span class="docdonnees">([\s\S]*?)<\/span>/i.exec(m[1])?.[1] ?? '')
    const nom = /<span class="nom">([\s\S]*?)<\/span>/i.exec(link[2])?.[1] ?? link[2]
    files.push({ id: link[1], label: decode(nom) || `Document ${link[1]}`, ...data })
  }
  // Mise en page inconnue : on garde au moins les liens de téléchargement.
  for (const m of content.matchAll(/<a\b[^>]*href="download\?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (seenId.has(m[1])) continue
    seenId.add(m[1])
    files.push({ id: m[1], label: decode(m[2]) || `Document ${m[1]}`, size: '', publishedAt: null, ext: '' })
  }
  return { crumbs, roots, folders, files }
}

/** Agenda mensuel : colonnes = jours de la semaine, lignes = semaines ; les événements multi-jours ne sont comptés qu'une fois. */
export function parseAgenda(html: string, year: number, month: number): PrepaEvent[] {
  const out: PrepaEvent[] = []
  const weeks = [...html.matchAll(/<table class="evenements">([\s\S]*?)<\/table>/gi)]
  weeks.forEach((w, wi) => {
    const head = [...(/<thead>([\s\S]*?)<\/thead>/i.exec(w[1])?.[1] ?? '').matchAll(/<th([^>]*)>(\d+)<\/th>/gi)]
    const days = head.map((h) => ({ n: Number(h[2]), other: /autremois/.test(h[1]) }))
    if (days.length !== 7) return
    const resolve = (col: number): Date => {
      const d = days[col]
      let mo = month
      if (d.other) mo += wi === 0 ? -1 : 1
      return new Date(year, mo - 1, d.n, 8, 0)
    }
    for (const row of (/<tbody>([\s\S]*?)<\/tbody>/i.exec(w[1])?.[1] ?? '').matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
      let col = 0
      for (const cell of row[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)) {
        const p = /<p class="([^"]*evnmt[^"]*)"[^>]*>([\s\S]*?)<\/p>/i.exec(cell[2])
        if (p && !/evnmt_suite/.test(p[1]) && col < 7) {
          out.push({ title: decode(p[2]), date: resolve(col).getTime(), subject: '', type: /evnmt(\d+)/.exec(p[1])?.[1] ?? '' })
        }
        const span = Number(/colspan="(\d+)"/.exec(cell[1])?.[1] ?? 1)
        col += span
      }
    }
  })
  return out
}

/** Tout événement dont le titre évoque une évaluation devient une échéance du cahier de texte. */
export function eventKind(title: string): 'examen' | 'devoir' | null {
  if (/vacances|férié|jour férié|pont\b|fermeture/i.test(title)) return null
  if (/\bDS\b|\bDST\b|concours|partiel|épreuve|contr[ôo]le|devoir surveill|examen|bac blanc/i.test(title)) return 'examen'
  if (/colle|oral|dm\b|devoir maison|rendre|à rendre/i.test(title)) return 'devoir'
  return null
}

export async function login(http: Http, base: string, id: string, password: string): Promise<{ ok: boolean; message: string }> {
  const r = await http.post(`${base}ajax.php`, { login: id, motdepasse: password, connexion: '1', permconn: '1' })
  try {
    const j = JSON.parse(r.text) as { etat?: string; message?: string }
    const ok = j.etat === 'ok'
    return { ok, message: decode(j.message ?? (ok ? 'Connecté.' : 'Identifiants refusés.')) }
  } catch {
    return { ok: r.status === 200 && !/nok/i.test(r.text), message: r.status === 200 ? 'Réponse inattendue du site.' : `Erreur ${r.status}` }
  }
}

function monthKeys(count: number, now = new Date()): { key: string; y: number; m: number }[] {
  const out: { key: string; y: number; m: number }[] = []
  for (let i = -1; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    out.push({ key: `${String(d.getFullYear() % 100).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}`, y: d.getFullYear(), m: d.getMonth() + 1 })
  }
  return out
}

const lastScans = new Map<string, PrepaScan>()
export const cachedScan = (base: string): PrepaScan | undefined => lastScans.get(base)

export async function scanSite(http: Http, baseInput: string, now = new Date()): Promise<PrepaScan> {
  const base = normalizeBase(baseInput)
  const warnings: string[] = []
  const home = await http.get(base)
  if (home.status >= 400) throw new Error(`Le site ne répond pas (${home.status}). Vérifie l’adresse.`)
  if (!/Cahier de pr[ée]pa/i.test(home.text)) throw new Error('Cette adresse ne ressemble pas à un Cahier de Prépa.')
  const recent = await http.get(`${base}recent`)
  const subjects = parseSubjects(recent.text)
  const loggedIn = /icon-deconnexion/.test(home.text)
  const docs = new Map<string, PrepaDoc>()
  let protectedPages = 0

  for (const d of parseRecent(recent.text, subjects, now)) docs.set(d.remoteId, d)
  // Un filtre par matière : le site limite chaque page, on en profite pour avoir plus de contenus.
  for (const s of subjects) {
    const r = await http.get(`${base}recent?type=docs&matiere=${encodeURIComponent(s.slug)}`)
    for (const d of parseRecent(r.text, subjects, now)) if (!docs.has(d.remoteId)) docs.set(d.remoteId, d)
  }

  // Parcours des répertoires de chaque matière (visibles surtout une fois connecté).
  const visited = new Set<string>()
  const queue: { url: string; subject: string; path: string[] }[] = [{ url: `${base}docs`, subject: '', path: [] }]
  for (const s of subjects) queue.push({ url: `${base}docs?${encodeURIComponent(s.slug)}`, subject: s.name, path: [] })
  let pages = 0
  while (queue.length && pages < 250) {
    const cur = queue.shift() as (typeof queue)[number]
    if (visited.has(cur.url)) continue
    visited.add(cur.url)
    pages++
    const r = await http.get(cur.url)
    if (r.status >= 400) continue
    if (isProtected(r.text)) {
      protectedPages++
      continue
    }
    const parsed = parseDocsPage(r.text)
    // Matière et chemin : ceux du fil d'Ariane de la page s'il existe, sinon ceux du parcours.
    const subjectName = parsed.crumbs?.subject || cur.subject || 'Général'
    const pathNames = parsed.crumbs ? parsed.crumbs.path : cur.path
    for (const f of parsed.files) {
      const known = docs.get(f.id)
      const doc: PrepaDoc = {
        remoteId: f.id,
        title: f.label,
        subject: subjectName,
        folder: pathNames.join(' / '),
        size: f.size,
        publishedAt: f.publishedAt,
        kind: /colle/i.test(pathNames.join('/')) ? 'colle' : 'doc'
      }
      // Le parcours des répertoires donne le vrai titre et le vrai chemin : il prime sur la page des nouveautés.
      docs.set(f.id, known ? { ...doc, publishedAt: doc.publishedAt ?? known.publishedAt, size: doc.size || known.size } : doc)
    }
    // Les matières affichées à la racine (y compris celles sans filtre sur la page des nouveautés, comme « Général »).
    for (const root of parsed.roots) queue.push({ url: `${base}docs?${root.slug}`, subject: root.label, path: [] })
    for (const sub of parsed.folders) queue.push({ url: `${base}docs?rep=${sub.rep}`, subject: subjectName === 'Général' && !parsed.crumbs ? cur.subject : subjectName, path: [...pathNames, sub.label] })
  }
  if (protectedPages > 0 && !loggedIn)
    warnings.push(`${protectedPages} répertoire(s) protégé(s) : connecte-toi avec ton compte du Cahier de Prépa pour tout voir.`)

  // Agenda
  const events: PrepaEvent[] = []
  for (const mk of monthKeys(6, now)) {
    try {
      const r = await http.get(`${base}agenda?mois=${mk.key}`)
      if (r.status < 400) events.push(...parseAgenda(r.text, mk.y, mk.m))
    } catch {
      /* mois indisponible */
    }
  }

  const scan: PrepaScan = {
    baseUrl: base,
    siteName: parseSiteName(home.text),
    loggedIn,
    subjects,
    docs: [...docs.values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title)),
    events,
    protectedPages,
    warnings
  }
  lastScans.set(base, scan)
  return scan
}

/* ------------------------------------------------------------------ */
/* Import : téléchargement, rangement, lecture, cartes, fiches          */
/* ------------------------------------------------------------------ */

export const documentsDir = (): string => join(dataDir(), 'documents')

const safe = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sans-nom'

function filenameFrom(headers: HttpResponse['headers'], fallback: string): string {
  const cd = headers.get('content-disposition') ?? ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(cd)?.[1]
  try {
    return decodeURIComponent(star ?? plain ?? fallback)
  } catch {
    return plain ?? fallback
  }
}

const PALETTE = ['#c6613f', '#6b8450', '#5f8fbf', '#b8873f', '#a35d8a', '#4f8f8b', '#8a6f4e', '#7a7a74']

interface ExistingDoc {
  id: string
  text: string
  cards: number
  summary: string
  path: string
  ext: string
  subject: string
  folder: string
  deck_id: string | null
  category: string
  chapter: string
  hash: string
  dup_of: string | null
  added_at: number
  cards_tried: number
}

const slug = (s: string): string => safe(s).replace(/\s+/g, '_').toLowerCase()

/** Supprime les cartes automatiques d'un document (il n'est finalement pas un cours, ou c'est un doublon). */
function purgeDocCards(docId: string): number {
  const db = getDb()
  const ids = (db.prepare("SELECT id FROM note WHERE deleted_at IS NULL AND source LIKE ?").all(`doc:${docId}:%`) as { id: string }[]).map((r) => r.id)
  if (ids.length) deleteNotes(ids)
  db.prepare("UPDATE document SET cards = 0, summary = '' WHERE id = ?").run(docId)
  return ids.length
}

/** Anciennes cartes automatiques qui ne passent pas le contrôle de qualité (trous partout, question vide, contenu pratique). */
export function purgeBadAutoCards(): number {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT n.id, n.kind, n.fields, d.category FROM note n
       LEFT JOIN document d ON n.source LIKE 'doc:' || d.id || ':%'
       WHERE n.deleted_at IS NULL AND n.source LIKE 'doc:%'`
    )
    .all() as { id: string; kind: string; fields: string; category: string | null }[]
  const bad: string[] = []
  for (const r of rows) {
    try {
      const f = JSON.parse(r.fields) as { front?: string; back?: string; text?: string }
      const cloze = r.kind === 'cloze'
      if (!goodCard({ kind: cloze ? 'cloze' : 'basic', front: f.front ?? '', back: f.back ?? '', text: f.text ?? '' }, { vocabulary: r.category === 'vocabulaire' })) bad.push(r.id)
    } catch {
      bad.push(r.id)
    }
  }
  if (bad.length) deleteNotes(bad)
  return bad.length
}

export async function importPrepa(
  http: Http,
  opts: PrepaImportOptions,
  progress: (p: PrepaProgress) => void,
  signal?: { cancelled: boolean }
): Promise<PrepaImportResult> {
  const base = normalizeBase(opts.baseUrl)
  const scan = lastScans.get(base)
  if (!scan) throw new Error('Analyse le site avant d’importer.')
  const db = getDb()
  const result: PrepaImportResult = { downloaded: 0, skipped: 0, failed: 0, decks: 0, cards: 0, summaries: 0, events: 0, duplicates: 0, ignored: 0, warnings: [] }
  const wanted = scan.docs.filter((d) => opts.remoteIds.includes(d.remoteId))
  const source = `cdp:${new URL(base).host}${new URL(base).pathname}`
  const ai = aiStatus()
  const lang = getSettings().language
  const rootName = opts.deckRoot.trim() || 'Prépa'
  mkdirSync(documentsDir(), { recursive: true })
  const deckBySubject = new Map<string, string>()
  result.purged = purgeBadAutoCards()

  const chaptersOf = (subject: string): string[] =>
    (db.prepare("SELECT DISTINCT chapter FROM document WHERE subject = ? AND chapter <> '' AND deleted_at IS NULL AND dup_of IS NULL").all(subject) as { chapter: string }[]).map((r) => r.chapter)

  const total = wanted.length
  for (const [i, d] of wanted.entries()) {
    if (signal?.cancelled) break
    const subject = d.subject || 'Général'
    if (!deckBySubject.has(subject)) deckBySubject.set(subject, createDeck([rootName, subject].join('::'), null))
    const at = { index: i + 1, total, title: d.title }

    const existing = db
      .prepare('SELECT id, text, cards, summary, path, ext, subject, folder, deck_id, category, chapter, hash, dup_of, added_at, cards_tried FROM document WHERE source = ? AND remote_id = ? AND deleted_at IS NULL')
      .get(source, d.remoteId) as ExistingDoc | undefined
    let docId = existing?.id ?? ''
    let text = existing?.text ?? ''
    let category = existing?.category ?? ''
    let chapter = existing?.chapter ?? ''
    let deckId = existing?.deck_id ?? null
    let dupOf = existing?.dup_of ?? null
    let hash = existing?.hash ?? ''
    let addedAt = existing?.added_at ?? Date.now()
    try {
      if (!existing) {
        progress({ phase: 'download', ...at })
        const r = await http.get(`${base}download?id=${d.remoteId}`)
        if (r.status >= 400 || r.buffer.length === 0) throw new Error(`Téléchargement refusé (${r.status})`)
        if (/^\s*<!doctype html|^\s*<html/i.test(r.buffer.subarray(0, 200).toString('utf8')) && isProtected(r.text)) throw new Error('Document protégé : connexion nécessaire.')
        const name = filenameFrom(r.headers, `${d.title}`)
        const ext = (extname(name).replace('.', '') || 'bin').toLowerCase()
        hash = sha1(r.buffer)
        addedAt = Date.now()
        docId = newId()
        const sameFile = findDuplicate(db, { id: null, subject, hash, text: '' })
        if (sameFile) {
          // Exactement le même fichier qu'un document déjà là : on le note, sans le copier ni en tirer de cartes.
          db.prepare(
            `INSERT INTO document(id, source, remote_id, subject, folder, title, filename, ext, size, path, text, published_at, added_at, deck_id, category, hash, dup_of)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, NULL, 'doublon', ?, ?)`
          ).run(docId, source, d.remoteId, subject, d.folder, d.title, name, ext, r.buffer.length, sameFile.path, d.publishedAt, addedAt, hash, sameFile.id)
          result.downloaded++
          result.duplicates = (result.duplicates ?? 0) + 1
          continue
        }
        const dir = join(documentsDir(), safe(subject))
        mkdirSync(dir, { recursive: true })
        let file = join(dir, safe(name.endsWith(`.${ext}`) ? name : `${name}.${ext}`))
        if (existsSync(file)) file = join(dir, `${d.remoteId}-${safe(name)}`)
        writeFileSync(file, r.buffer)
        progress({ phase: 'read', ...at })
        try {
          text = await readDocumentBuffer(r.buffer, ext)
        } catch {
          text = ''
        }
        db.prepare(
          `INSERT INTO document(id, source, remote_id, subject, folder, title, filename, ext, size, path, text, published_at, added_at, deck_id, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        ).run(docId, source, d.remoteId, subject, d.folder, d.title, name, ext, r.buffer.length, file, text.slice(0, 400_000), d.publishedAt, addedAt, hash)
        result.downloaded++
        await new Promise((res) => setTimeout(res, 120))
      } else {
        result.skipped++
        let path = existing.path
        // Rangement corrigé depuis l'import (matière, dossier) : on remet le document au bon endroit.
        if (existing.subject !== subject || existing.folder !== d.folder) {
          try {
            const dir = join(documentsDir(), safe(subject))
            if (path && existsSync(path) && dirname(path) !== dir && !dupOf) {
              mkdirSync(dir, { recursive: true })
              const target = join(dir, existsSync(join(dir, basename(path))) ? `${d.remoteId}-${basename(path)}` : basename(path))
              renameSync(path, target)
              path = target
            }
          } catch {
            path = existing.path
          }
          db.prepare('UPDATE document SET subject = ?, folder = ?, path = ? WHERE id = ?').run(subject, d.folder, path, existing.id)
          result.moved = (result.moved ?? 0) + 1
        }
        if (!dupOf && path && existsSync(path)) {
          // Texte jamais extrait (lecteur de PDF indisponible à l'époque, scan…) : on relit le fichier déjà sur le disque.
          if (!text.trim()) {
            progress({ phase: 'read', ...at })
            try {
              text = await readDocumentBuffer(readFileSync(path), existing.ext)
              if (text.trim()) {
                db.prepare('UPDATE document SET text = ? WHERE id = ?').run(text.slice(0, 400_000), existing.id)
                result.reread = (result.reread ?? 0) + 1
              }
            } catch {
              /* illisible : on le laisse tel quel */
            }
          }
          if (!hash) {
            hash = sha1(readFileSync(path))
            db.prepare('UPDATE document SET hash = ? WHERE id = ?').run(hash, existing.id)
          }
        }
      }

      // Tri : doublon ? cours à apprendre ? quel chapitre ?
      if (!category && docId) {
        if (!dupOf) {
          const dup = findDuplicate(db, { id: docId, subject, hash, text, before: addedAt })
          if (dup) {
            dupOf = dup.id
            category = 'doublon'
            deckId = null
            db.prepare("UPDATE document SET dup_of = ?, category = 'doublon', deck_id = NULL, text_hash = ? WHERE id = ?").run(dup.id, text.trim().length > 250 ? textKey(text) : '', docId)
            if ((existing?.cards ?? 0) > 0) purgeDocCards(docId)
            result.duplicates = (result.duplicates ?? 0) + 1
          }
        }
        if (!category) {
          progress({ phase: 'triage', ...at })
          const tr = await triageDocument({ title: d.title, subject, folder: d.folder, text }, chaptersOf(subject))
          // Sans IA, un classement « par défaut » n'est pas définitif : on le refera quand le modèle sera prêt.
          if (tr.by !== 'regles' || ai.ready) {
            category = tr.category
            chapter = tr.chapter
            const learn = CARD_CATEGORIES.has(category)
            deckId = learn ? createDeck([rootName, subject, chapter].join('::'), null) : null
            if (!learn) {
              result.ignored = (result.ignored ?? 0) + 1
              if ((existing?.cards ?? 0) > 0) purgeDocCards(docId)
            }
            db.prepare('UPDATE document SET category = ?, chapter = ?, deck_id = ?, text_hash = ? WHERE id = ?').run(category, chapter, deckId, text.trim().length > 250 ? textKey(text) : '', docId)
          }
        }
      }

      const learnable = !!docId && !dupOf && CARD_CATEGORIES.has(category) && !!deckId
      if (learnable && opts.generateCards && ai.ready && text.trim().length > 250 && !((existing?.cards ?? 0) > 0) && !existing?.cards_tried) {
        progress({ phase: 'cards', ...at })
        const count = Math.max(3, Math.min(40, opts.cardsPerDoc))
        const cards: AiCardProposal[] = await aiCardsFromText(text.slice(0, 14000), count, lang, `Document « ${d.title} » (${subject}, chapitre « ${chapter} »). Cartes pour réviser un cours de classe préparatoire.`, { vocabulary: category === 'vocabulaire' })
        let added = 0
        for (const c of cards) {
          if (!goodCard(c, { vocabulary: category === 'vocabulaire' })) continue
          if (checkDuplicate(c.kind, c.kind === 'cloze' ? c.text : c.front)) continue
          addNote({
            kind: c.kind,
            deckId: deckId as string,
            fields: c.kind === 'cloze' ? { text: c.text, extra: c.extra } : { front: c.front, back: c.back },
            tags: ['ia-auto', slug(subject), slug(chapter)],
            source: `doc:${docId}:${createHash('sha1').update(c.kind === 'cloze' ? c.text : c.front).digest('hex').slice(0, 10)}`
          })
          added++
        }
        db.prepare('UPDATE document SET cards = ?, cards_tried = 1 WHERE id = ?').run(added, docId)
        result.cards += added
      }
      if (learnable && opts.makeSummary && ai.ready && text.trim().length > 250 && !(existing && existing.summary)) {
        progress({ phase: 'summary', ...at })
        const s = await aiSummarize(d.title, text.slice(0, 20000))
        db.prepare('UPDATE document SET summary = ? WHERE id = ?').run(s, docId)
        result.summaries++
      }
    } catch (e) {
      result.failed++
      result.warnings.push(`${d.title} : ${(e as Error).message}`)
      progress({ phase: 'error', ...at, detail: (e as Error).message })
    }
  }

  // Cahier de texte d'abord : les matières liées à un deck le protègent du nettoyage des decks vides.
  if (opts.addToNotebook) result.events = addEventsToNotebook(scan, deckBySubject)
  pruneEmptyDecks(rootName)
  if (opts.generateCards && !ai.ready) result.warnings.push('L’IA n’est pas prête : les documents ont été rangés, mais aucune carte n’a été créée.')
  progress({ phase: 'done', index: total, total, title: '' })
  return result
}

/**
 * Supprime les decks vides (sans carte, sans sous-deck, sans document ni échéance) sous le deck racine de l'import :
 * ce qu'a laissé un ancien rangement erroné, ou un dossier du site qui ne contient finalement rien.
 */
export function pruneEmptyDecks(rootName: string): number {
  const db = getDb()
  const root = db.prepare('SELECT id FROM deck WHERE deleted_at IS NULL AND parent_id IS NULL AND name = ? COLLATE NOCASE').get(rootName) as { id: string } | undefined
  if (!root) return 0
  let removed = 0
  for (let pass = 0; pass < 10; pass++) {
    const rows = db
      .prepare(
        `WITH RECURSIVE sub(id) AS (SELECT id FROM deck WHERE parent_id = ? AND deleted_at IS NULL
           UNION ALL SELECT d.id FROM deck d JOIN sub ON d.parent_id = sub.id WHERE d.deleted_at IS NULL)
         SELECT id FROM sub
         WHERE NOT EXISTS (SELECT 1 FROM card WHERE card.deck_id = sub.id AND card.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM deck c WHERE c.parent_id = sub.id AND c.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM document WHERE document.deck_id = sub.id AND document.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM entry_link WHERE entry_link.deck_id = sub.id)
           AND NOT EXISTS (SELECT 1 FROM subject WHERE subject.deck_id = sub.id AND subject.deleted_at IS NULL)`
      )
      .all(root.id) as { id: string }[]
    if (rows.length === 0) break
    for (const r of rows) deleteDeck(r.id)
    removed += rows.length
  }
  return removed
}

/** Échéances de l'agenda -> cahier de texte, avec une matière et les decks de la matière quand on la reconnaît. */
function addEventsToNotebook(scan: PrepaScan, deckBySubject: Map<string, string>): number {
  const db = getDb()
  const subjects = new Map(listSubjects().map((s) => [s.name.toLowerCase(), s.id]))
  let n = 0
  const now = Date.now() - 86400000
  for (const [i, s] of scan.subjects.entries()) {
    if (!subjects.has(s.name.toLowerCase())) subjects.set(s.name.toLowerCase(), saveSubject({ name: s.name, color: PALETTE[i % PALETTE.length], coefficient: 1, deckId: deckBySubject.get(s.name) ?? null }))
    else if (deckBySubject.has(s.name)) db.prepare('UPDATE subject SET deck_id = ? WHERE id = ? AND deck_id IS NULL').run(deckBySubject.get(s.name), subjects.get(s.name.toLowerCase()))
  }
  for (const ev of scan.events) {
    const kind = eventKind(ev.title)
    if (!kind || ev.date < now) continue
    // Matière : le nom d'une matière dans le titre de l'événement (« DS Maths », « Colle d'anglais »).
    const match = scan.subjects.find((s) => ev.title.toLowerCase().includes(s.name.toLowerCase().split(/[ -]/)[0]))
    const exists = db.prepare('SELECT 1 FROM entry WHERE title = ? AND due_at = ? AND deleted_at IS NULL').get(ev.title, ev.date)
    if (exists) continue
    const subjectId = match ? subjects.get(match.name.toLowerCase()) : undefined
    const deckId = match ? deckBySubject.get(match.name) : undefined
    saveEntry({ kind, title: ev.title, subjectId: subjectId ?? null, dueAt: ev.date, deckIds: deckId ? [deckId] : [], notes: 'Importé du Cahier de Prépa' })
    n++
  }
  return n
}
