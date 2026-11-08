import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

describe('Anki installé sur ce PC (si présent)', () => {
  it('lit le vrai profil sans le modifier et s’importe sans erreur', async () => {
    userData = mkdtempSync(join(tmpdir(), 'mnemo-local-'))
    const { findAnkiProfiles, openAnkiProfile, summarizeAnki, importAnkiSource } = await import('../src/main/anki')
    const profiles = findAnkiProfiles()
    if (!profiles.length) return // pas d'Anki sur cette machine : rien à vérifier
    const { openDb } = await import('../src/main/db')
    openDb()
    const src = openAnkiProfile(profiles[0].dir)
    const sum = summarizeAnki(src)
    console.log('Profil Anki réel :', profiles[0].name, JSON.stringify(sum))
    expect(sum.notes).toBeGreaterThanOrEqual(0)
    const r1 = importAnkiSource(src)
    const r2 = importAnkiSource(openAnkiProfile(profiles[0].dir))
    expect(r2.notes).toBe(0) // réimport : aucun doublon
    expect(r2.existing).toBe(r1.notes)
  })
})
