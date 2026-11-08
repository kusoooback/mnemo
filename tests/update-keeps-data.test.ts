import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

describe('une mise à jour ne perd jamais les cartes', () => {
  it("l'installateur n'efface pas les données utilisateur", () => {
    const yml = read('electron-builder.yml')
    expect(yml).toMatch(/deleteAppDataOnUninstall:\s*false/)
    expect(yml).not.toMatch(/deleteAppDataOnUninstall:\s*true/)
  })

  it("les données sont hors du dossier d'installation", () => {
    const idx = read('src/main/index.ts')
    expect(idx).toMatch(/setPath\('userData',[^\n]*join\(app\.getPath\('appData'\), 'Mnemo'\)/)
  })

  it('une migration de base sauvegarde la base avant de la modifier', () => {
    const db = read('src/main/db.ts')
    expect(db).toContain('avant-migration-v')
    expect(db.indexOf('copyFileSync(dbPath()')).toBeLessThan(db.indexOf('MIGRATIONS[v](d)'))
  })
})
