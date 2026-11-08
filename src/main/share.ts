import { BrowserWindow, dialog } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { readFileSync, statSync, writeFileSync } from 'fs'
import type { CommunityPack, PackMeta, PackOpened, PackResult } from '../shared/types-extra'
import { PACK_EXT, buildPack, installPack, previewPack, readPack, type Pack } from './deckpack'

/*
 * Partage de paquets : export / import d'un fichier .mnemodeck, et catalogue communautaire (facultatif).
 * Le catalogue n'est contacté que si l'utilisateur clique sur « Parcourir le catalogue » : jamais en arrière-plan.
 * Seul le dépôt public de Mnémo est interrogé (GitHub, fichiers statiques), sans identifiant ni cookie.
 */

export const COMMUNITY_BASE = 'https://raw.githubusercontent.com/kusoooback/mnemo/main/community'
const MAX_CATALOG_PACK = 30 * 1024 * 1024
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

const pending = new Map<string, Pack>()

function hold(pack: Pack): PackOpened {
  const token = randomBytes(8).toString('hex')
  pending.set(token, pack)
  while (pending.size > 3) pending.delete(pending.keys().next().value as string)
  return { token, preview: previewPack(pack) }
}

export async function sharePick(win: BrowserWindow | null): Promise<PackOpened | null> {
  const opts = {
    title: 'Ouvrir un paquet Mnémo',
    properties: ['openFile' as const],
    filters: [{ name: 'Paquet Mnémo', extensions: [PACK_EXT] }]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  return shareOpenFile(res.filePaths[0])
}

export function shareOpenFile(path: string): PackOpened {
  if (statSync(path).size > 80 * 1024 * 1024) throw new Error('Fichier trop volumineux (80 Mo maximum).')
  return hold(readPack(readFileSync(path)))
}

export async function shareExport(win: BrowserWindow | null, deckId: string | null, meta: PackMeta): Promise<{ path: string; notes: number; images: number; bytes: number } | null> {
  const { buf, pack } = buildPack(deckId, meta)
  const safe = pack.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'paquet'
  const opts = {
    title: 'Partager ce deck',
    defaultPath: `${safe}.${PACK_EXT}`,
    filters: [{ name: 'Paquet Mnémo', extensions: [PACK_EXT] }]
  }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, buf)
  return { path: res.filePath, notes: pack.notes.length, images: Object.keys(pack.media).length, bytes: buf.length }
}

export function shareInstall(token: string, root: string): PackResult {
  const pack = pending.get(token)
  if (!pack) throw new Error('Ce paquet n’est plus en mémoire : ouvre-le de nouveau.')
  const r = installPack(pack, root)
  pending.delete(token)
  return r
}

export function shareCancel(token: string): void {
  pending.delete(token)
}

/* ---------- Catalogue communautaire ---------- */

export function parseCatalog(raw: unknown): CommunityPack[] {
  const list = (raw as { packs?: unknown })?.packs
  if (!Array.isArray(list)) return []
  const out: CommunityPack[] = []
  const seen = new Set<string>()
  for (const e of list.slice(0, 300) as Record<string, unknown>[]) {
    const id = typeof e?.id === 'string' ? e.id : ''
    const sha = typeof e?.sha256 === 'string' ? e.sha256.toLowerCase() : ''
    if (!ID_RE.test(id) || seen.has(id) || !/^[a-f0-9]{64}$/.test(sha)) continue
    const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
    seen.add(id)
    out.push({
      id,
      title: s(e.title, 80) || id,
      description: s(e.description, 400),
      author: s(e.author, 60),
      lang: e.lang === 'en' ? 'en' : 'fr',
      tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string').slice(0, 8).map((t) => t.slice(0, 30)) : [],
      notes: typeof e.notes === 'number' ? Math.max(0, Math.floor(e.notes)) : 0,
      sha256: sha
    })
  }
  return out
}

let catalogCache: CommunityPack[] = []

export async function shareCatalog(): Promise<CommunityPack[]> {
  const res = await fetch(`${COMMUNITY_BASE}/index.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(res.status === 404 ? 'Le catalogue n’est pas encore publié.' : `Catalogue indisponible (${res.status}).`)
  catalogCache = parseCatalog(await res.json())
  return catalogCache
}

export async function shareFetch(id: string): Promise<PackOpened> {
  const entry = catalogCache.find((p) => p.id === id)
  if (!entry) throw new Error('Paquet inconnu : recharge le catalogue.')
  const res = await fetch(`${COMMUNITY_BASE}/packs/${entry.id}.${PACK_EXT}`, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}).`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_CATALOG_PACK) throw new Error('Paquet trop volumineux.')
  if (createHash('sha256').update(buf).digest('hex') !== entry.sha256) throw new Error('Le paquet téléchargé ne correspond pas à son empreinte : il a été refusé.')
  return hold(readPack(buf))
}
