import { app } from 'electron'
import { randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { join } from 'path'
import type { NoteKind } from '../shared/types'
import { addMarkdownDocument } from './docfiles'
import { startJob } from './jobs'
import * as repo from './repo'

/*
 * Passerelle locale pour les assistants (Claude via MCP, scripts…).
 *
 * Désactivée par défaut. Quand l'utilisateur l'active, Mnémo écoute UNIQUEMENT sur 127.0.0.1 (jamais sur le réseau),
 * exige un jeton aléatoire régénéré à chaque lancement, refuse toute requête venant d'une page web (en-tête Origin)
 * et n'accepte que les noms d'hôte locaux (protection contre le « DNS rebinding »). Aucune donnée ne sort de
 * l'ordinateur : c'est un simple tuyau entre Mnémo et un programme qui tourne sur la même machine.
 *
 * Le port et le jeton sont écrits dans `bridge.json` (dossier de données, lisible par l'utilisateur seul) pour que le
 * serveur MCP les retrouve sans rien configurer ; le fichier est supprimé quand la passerelle s'arrête.
 */

export const BRIDGE_FILE = 'bridge.json'
const FIRST_PORT = 47615
const MAX_BODY = 8 * 1024 * 1024
const MAX_CARDS = 500
const KINDS: NoteKind[] = ['basic', 'basic-reverse', 'cloze']

let server: Server | null = null
let token = ''
let port = 0
let onChange: () => void = () => undefined

export interface BridgeState {
  running: boolean
  port: number
}

export const bridgeState = (): BridgeState => ({ running: !!server, port })

const bridgeFile = (): string => join(app.getPath('userData'), BRIDGE_FILE)

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Requête trop volumineuse (8 Mo maximum) : envoie en plusieurs fois.'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'JSON invalide.'))
      }
    })
    req.on('error', reject)
  })
}

function authorized(req: IncomingMessage): boolean {
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(token)
  return given.length === want.length && timingSafeEqual(given, want)
}

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*::\s*/g, '::')
    .trim()

/** Retrouve un deck par identifiant ou par nom complet (« HGG::Chapitre 1 »), sans tenir compte des accents ni de la casse. */
function findDeck(ref: string): string | null {
  const decks = repo.listDecks()
  const byId = decks.find((d) => d.id === ref)
  if (byId) return byId.id
  const want = norm(ref)
  return decks.find((d) => norm(d.fullName) === want)?.id ?? null
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

interface CardInput {
  type?: string
  front?: string
  back?: string
  text?: string
  extra?: string
  tags?: unknown
}

export interface AddResult {
  ok: boolean
  duplicate?: boolean
  id?: string
  error?: string
}

function addCards(body: Record<string, unknown>): { deck: string; deckId: string; created: boolean; added: number; duplicates: number; errors: number; results: AddResult[] } {
  const deckRef = str(body.deck)
  if (!deckRef) throw new HttpError(400, 'Indique le deck (« deck »), par exemple « HGG::Chapitre 1 ».')
  const cards = body.cards
  if (!Array.isArray(cards) || !cards.length) throw new HttpError(400, 'Aucune carte à ajouter (« cards » est vide).')
  if (cards.length > MAX_CARDS) throw new HttpError(400, `Trop de cartes d'un coup (${MAX_CARDS} maximum) : envoie-les en plusieurs fois.`)
  const skipDup = body.skip_duplicates !== false

  let deckId = findDeck(deckRef)
  let created = false
  if (!deckId) {
    if (body.create_deck === false) throw new HttpError(404, `Deck introuvable : « ${deckRef} ».`)
    deckId = repo.createDeck(deckRef, null)
    created = true
  }
  const job = startJob('cards', 'Claude : ajout de cartes', { detail: `${cards.length} carte(s) → ${deckRef}` })
  job.link({ name: 'deck', id: deckId })
  const results: AddResult[] = []
  let added = 0
  let duplicates = 0
  try {
    for (const raw of cards as CardInput[]) {
      try {
        const type = (str(raw?.type) || (raw?.text !== undefined ? 'cloze' : 'basic')) as NoteKind
        if (!KINDS.includes(type)) throw new Error(`Type inconnu : « ${type} » (basic, basic-reverse ou cloze).`)
        const tags = Array.isArray(raw?.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : []
        let fields: Record<string, string>
        let first: string
        if (type === 'cloze') {
          const text = str(raw?.text)
          if (!/\{\{c\d+::/.test(text)) throw new Error('Une carte à trous doit contenir au moins un {{c1::trou}}.')
          fields = { text, extra: str(raw?.extra) }
          first = text
        } else {
          const front = str(raw?.front)
          const back = str(raw?.back)
          if (!front || !back) throw new Error('Une carte a besoin d’un « front » (question) et d’un « back » (réponse).')
          fields = { front, back, extra: str(raw?.extra) }
          first = front
        }
        if (skipDup && repo.checkDuplicate(type, first)) {
          duplicates++
          results.push({ ok: false, duplicate: true, error: 'Doublon : une carte identique existe déjà.' })
          continue
        }
        const id = repo.addNote({ kind: type, deckId, fields, tags })
        added++
        results.push({ ok: true, id })
      } catch (e) {
        results.push({ ok: false, error: (e as Error).message })
      }
    }
    job.finish(`${added} carte${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} dans « ${deckRef} »${duplicates ? ` (${duplicates} doublon${duplicates > 1 ? 's' : ''} ignoré${duplicates > 1 ? 's' : ''})` : ''}.`)
  } catch (e) {
    job.fail((e as Error).message)
    throw e
  }
  if (added || created) onChange()
  return { deck: deckRef, deckId, created, added, duplicates, errors: results.filter((r) => !r.ok && !r.duplicate).length, results }
}

function createSheet(body: Record<string, unknown>): { id: string; title: string } {
  const title = str(body.title).slice(0, 90)
  const markdown = typeof body.markdown === 'string' ? body.markdown.trim() : ''
  if (!title) throw new HttpError(400, 'Indique le titre de la fiche (« title »).')
  if (markdown.length < 20) throw new HttpError(400, 'La fiche est vide (« markdown »).')
  const subject = str(body.subject).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60) || 'Fiches'
  const text = /^#\s/m.test(markdown) ? markdown : `# ${title}\n\n${markdown}`
  const id = addMarkdownDocument(title, text, subject)
  const job = startJob('summary', `Claude : fiche « ${title} »`)
  job.attach(id)
  job.finish('Fiche prête : ouvre-la dans « Fiches ».')
  onChange()
  return { id, title }
}

function route(method: string, url: URL, body: Record<string, unknown>): unknown {
  const p = url.pathname.replace(/\/+$/, '')
  if (method === 'GET' && p === '/v1/status') {
    const decks = repo.listDecks()
    return { app: 'mnemo', version: app.getVersion(), decks: decks.length, cards: decks.filter((d) => !d.parentId).reduce((n, d) => n + d.totalCards, 0) }
  }
  if (method === 'GET' && p === '/v1/decks')
    return repo.listDecks().map((d) => ({ id: d.id, name: d.fullName, cards: d.totalCards, due: d.dueCount, new: d.newCount }))
  if (method === 'POST' && p === '/v1/decks') {
    const name = str(body.name)
    if (!name) throw new HttpError(400, 'Indique le nom du deck (« name »).')
    const before = findDeck(name)
    const id = before ?? repo.createDeck(name, null)
    if (!before) onChange()
    return { id, name, created: !before }
  }
  if (method === 'POST' && p === '/v1/cards') return addCards(body)
  if (method === 'POST' && p === '/v1/sheets') return createSheet(body)
  if (method === 'GET' && p === '/v1/search') {
    const deckRef = url.searchParams.get('deck')
    const deckId = deckRef ? findDeck(deckRef) : null
    if (deckRef && !deckId) throw new HttpError(404, `Deck introuvable : « ${deckRef} ».`)
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20))
    const r = repo.searchCards({ text: url.searchParams.get('q') ?? '', deckId, state: 'all', tag: null, sort: 'created', limit, offset: 0 })
    return {
      total: r.total,
      cards: r.rows.map((c) => ({ deck: c.deckName, type: c.kind, ...c.fields, tags: c.tags }))
    }
  }
  throw new HttpError(404, 'Route inconnue.')
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  void (async () => {
    try {
      // Une page web ne doit jamais pouvoir parler à la passerelle : les navigateurs ajoutent toujours « Origin ».
      if (req.headers.origin) throw new HttpError(403, 'Origine refusée.')
      const host = (req.headers.host ?? '').toLowerCase()
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, 'Hôte refusé.')
      if (!authorized(req)) throw new HttpError(401, 'Jeton invalide : relance la connexion depuis Mnémo (Réglages → Intégrations → Claude).')
      const url = new URL(req.url ?? '/', `http://${host}`)
      const body = req.method === 'POST' ? ((await readBody(req)) as Record<string, unknown>) : {}
      send(res, 200, route(req.method ?? 'GET', url, body ?? {}))
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      send(res, status, { error: (e as Error).message })
    }
  })()
}

function listen(srv: Server, from: number, tries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (p: number, left: number): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        srv.off('listening', onListening)
        if (err.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1)
        else reject(err)
      }
      const onListening = (): void => {
        srv.off('error', onError)
        resolve(p)
      }
      srv.once('error', onError)
      srv.once('listening', onListening)
      srv.listen(p, '127.0.0.1')
    }
    attempt(from, tries)
  })
}

export async function startBridge(changed: () => void, firstPort = FIRST_PORT): Promise<BridgeState> {
  if (server) return bridgeState()
  onChange = changed
  token = randomBytes(32).toString('hex')
  const srv = createServer(handle)
  srv.headersTimeout = 10_000
  srv.requestTimeout = 60_000
  port = await listen(srv, firstPort)
  server = srv
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(bridgeFile(), JSON.stringify({ app: 'mnemo', port, token, pid: process.pid }), { mode: 0o600 })
  return bridgeState()
}

export async function stopBridge(): Promise<void> {
  const srv = server
  server = null
  port = 0
  token = ''
  try {
    if (existsSync(bridgeFile())) rmSync(bridgeFile())
  } catch {
    /* rien à nettoyer */
  }
  if (srv) {
    srv.closeAllConnections()
    await new Promise<void>((r) => srv.close(() => r()))
  }
}
