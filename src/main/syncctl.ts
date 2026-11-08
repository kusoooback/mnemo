import { hostname } from 'os'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { SyncResult, SyncStatus } from '../shared/types'
import { backupDir, getDb, mediaDir } from './db'
import { getSecret, setSecret } from './secrets'
import { runSync, setupFolder, syncPath } from './sync'
import { getSettings, newId, setSettings } from './util'

let running = false
let last: SyncResult | null = null
let timer: NodeJS.Timeout | null = null

function meta(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}
function setMeta(key: string, value: string): void {
  getDb().prepare('INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function deviceId(): string {
  let id = meta('deviceId')
  if (!id) {
    id = newId()
    setMeta('deviceId', id)
  }
  return id
}

export function syncStatus(): SyncStatus {
  const s = getSettings()
  const id = deviceId()
  const rows = getDb().prepare('SELECT id, name, last_sync, is_self FROM device ORDER BY is_self DESC, name').all() as {
    id: string
    name: string
    last_sync: number | null
    is_self: number
  }[]
  const self = rows.find((r) => r.id === id)
  return {
    mode: s.syncMode,
    folder: s.syncFolder,
    configured: s.syncMode === 'folder' && !!getSecret('sync.key'),
    lastSync: self?.last_sync ?? null,
    deviceId: id,
    devices: rows.map((r) => ({ id: r.id, name: r.name, lastSync: r.last_sync, isSelf: !!r.is_self })),
    running,
    lastResult: last
  }
}

export function syncSetup(folder: string, passphrase: string): SyncStatus {
  if (!folder) throw new Error('Choisis d’abord un dossier.')
  if (passphrase.length < 8) throw new Error('La phrase de récupération doit faire au moins 8 caractères.')
  const key = setupFolder(folder, passphrase)
  setSecret('sync.key', key.toString('hex'))
  setSettings({ syncMode: 'folder', syncFolder: folder, deviceName: getSettings().deviceName || hostname() })
  syncNow()
  return syncStatus()
}

export function syncDisable(): SyncStatus {
  setSettings({ syncMode: 'off' })
  setSecret('sync.key', null)
  return syncStatus()
}

function pruneSafety(): void {
  const files = readdirSync(backupDir())
    .filter((f) => f.startsWith('avant-synchro-'))
    .map((f) => ({ f, t: statSync(join(backupDir(), f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const old of files.slice(5)) {
    try {
      unlinkSync(join(backupDir(), old.f))
    } catch {
      /* ignoré */
    }
  }
}

export function syncNow(): SyncResult {
  const s = getSettings()
  const keyHex = getSecret('sync.key')
  if (s.syncMode !== 'folder' || !keyHex || !s.syncFolder) throw new Error('La synchronisation n’est pas configurée.')
  if (!existsSync(syncPath(s.syncFolder))) throw new Error('Le dossier de synchronisation est introuvable (disque ou cloud déconnecté ?).')
  if (running) return last ?? { at: Date.now(), ok: true, devices: 0, newNotes: 0, newReviews: 0, updated: 0, recomputed: 0 }
  running = true
  try {
    last = runSync({
      db: getDb(),
      folder: s.syncFolder,
      key: Buffer.from(keyHex, 'hex'),
      deviceId: deviceId(),
      deviceName: s.deviceName || hostname(),
      mediaDir: mediaDir(),
      retention: s.retention,
      beforeMerge: () => {
        // Copie de sécurité avant toute fusion : on peut toujours revenir en arrière.
        const target = join(backupDir(), `avant-synchro-${Date.now()}.db`)
        getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
        pruneSafety()
      }
    })
    return last
  } catch (e) {
    last = { at: Date.now(), ok: false, error: (e as Error).message, devices: 0, newNotes: 0, newReviews: 0, updated: 0, recomputed: 0 }
    return last
  } finally {
    running = false
  }
}

/** Synchronise au démarrage, toutes les 5 minutes et à la fermeture. */
export function startAutoSync(onDone: (r: SyncResult) => void): void {
  stopAutoSync()
  const tick = (): void => {
    if (getSettings().syncMode !== 'folder') return
    const r = syncNow()
    if (r.ok && (r.newNotes || r.newReviews || r.updated)) onDone(r)
  }
  setTimeout(tick, 4000)
  timer = setInterval(tick, 5 * 60 * 1000)
}

export function stopAutoSync(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function syncOnQuit(): void {
  if (getSettings().syncMode === 'folder') syncNow()
}
