import Database from 'better-sqlite3'
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { BackupInfo } from '../shared/types'
import { MIGRATIONS } from './schema'

export const dataDir = (): string => app.getPath('userData')
export const dbPath = (): string => join(dataDir(), 'mnemo.db')
export const backupDir = (): string => join(dataDir(), 'backups')
export const mediaDir = (): string => join(dataDir(), 'media')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Base de données non ouverte')
  return db
}

export function openDb(): Database.Database {
  mkdirSync(dataDir(), { recursive: true })
  mkdirSync(backupDir(), { recursive: true })
  mkdirSync(mediaDir(), { recursive: true })

  const existed = existsSync(dbPath())
  const d = new Database(dbPath())
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  d.pragma('synchronous = NORMAL')

  const current = d.pragma('user_version', { simple: true }) as number
  if (current < MIGRATIONS.length) {
    if (existed && current > 0) {
      try {
        copyFileSync(dbPath(), join(backupDir(), `avant-migration-v${current}-${Date.now()}.db`))
      } catch {
        /* la sauvegarde de sécurité ne doit pas bloquer l'ouverture */
      }
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      d.transaction(() => {
        MIGRATIONS[v](d)
        d.pragma(`user_version = ${v + 1}`)
      })()
    }
  }
  db = d
  return d
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

function dayStamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function listBackups(): BackupInfo[] {
  if (!existsSync(backupDir())) return []
  return readdirSync(backupDir())
    .filter((f) => f.endsWith('.db'))
    .map((name) => {
      const s = statSync(join(backupDir(), name))
      return { name, size: s.size, createdAt: s.mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function createBackup(label?: string): Promise<BackupInfo> {
  const name = `mnemo-${label ?? dayStamp()}.db`
  const target = join(backupDir(), name)
  await getDb().backup(target)
  const s = statSync(target)
  pruneBackups()
  return { name, size: s.size, createdAt: s.mtimeMs }
}

/** Une copie par jour, 30 conservées (les copies "avant migration" sont gardées à part). */
function pruneBackups(): void {
  const daily = listBackups().filter((b) => /^mnemo-\d{4}-\d{2}-\d{2}\.db$/.test(b.name))
  for (const old of daily.slice(30)) {
    try {
      unlinkSync(join(backupDir(), old.name))
    } catch {
      /* ignoré */
    }
  }
}

export async function ensureDailyBackup(): Promise<void> {
  const name = `mnemo-${dayStamp()}.db`
  if (!existsSync(join(backupDir(), name))) await createBackup()
}

export function restoreBackup(name: string): void {
  if (!/^[\w.-]+\.db$/.test(name)) throw new Error('Nom de sauvegarde invalide')
  const src = join(backupDir(), name)
  if (!existsSync(src)) throw new Error('Sauvegarde introuvable')
  // Garde l'état actuel au cas où.
  copyFileSync(dbPath(), join(backupDir(), `avant-restauration-${Date.now()}.db`))
  closeDb()
  for (const ext of ['-wal', '-shm']) {
    try {
      unlinkSync(dbPath() + ext)
    } catch {
      /* absent */
    }
  }
  copyFileSync(src, dbPath())
}
