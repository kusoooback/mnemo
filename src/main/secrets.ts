import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dataDir } from './db'

/**
 * Coffre à secrets (clés d'API, jetons Notion, clé de synchro).
 * Les valeurs sont chiffrées par le système (DPAPI sous Windows, Trousseau sous macOS) et jamais écrites dans la base.
 */
const file = (): string => join(dataDir(), 'secrets.json')

function load(): Record<string, string> {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function setSecret(name: string, value: string | null): void {
  const all = load()
  if (value === null || value === '') delete all[name]
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Le coffre du système n’est pas disponible sur ce PC.')
    all[name] = safeStorage.encryptString(value).toString('base64')
  }
  writeFileSync(file(), JSON.stringify(all), { mode: 0o600 })
}

export function getSecret(name: string): string | null {
  const v = load()[name]
  if (!v) return null
  try {
    return safeStorage.decryptString(Buffer.from(v, 'base64'))
  } catch {
    return null
  }
}

export const hasSecret = (name: string): boolean => !!load()[name]
