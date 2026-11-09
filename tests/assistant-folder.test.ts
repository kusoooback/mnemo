import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

function makeFolder(): { root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), 'mnemo-afolder-'))
  const root = join(base, 'cours')
  mkdirSync(join(root, 'histoire'), { recursive: true })
  mkdirSync(join(root, '.cache'), { recursive: true })
  writeFileSync(join(root, 'histoire', 'guerre-froide.md'), '# La guerre froide\n\nLe blocus de Berlin commence en 1948.\n')
  writeFileSync(join(root, 'maths.txt'), 'Théorème des valeurs intermédiaires : toute fonction continue sur un intervalle prend toutes les valeurs.')
  writeFileSync(join(root, '.cache', 'secret.md'), 'ne doit jamais apparaître')
  writeFileSync(join(root, 'image.png'), 'pas du texte')
  const outside = join(base, 'secret.txt')
  writeFileSync(outside, 'mot de passe')
  return { root, outside }
}

describe('Dossier permanent de l’assistant', () => {
  it('liste seulement les fichiers lisibles, sans les dossiers cachés', async () => {
    const { listFolderFiles } = await import('../src/main/assistant-folder')
    const { root } = makeFolder()
    expect(listFolderFiles(root).map((f) => f.rel)).toEqual(['histoire/guerre-froide.md', 'maths.txt'])
  })

  it('cherche dans le contenu et lit un fichier par son nom', async () => {
    const { folderTool } = await import('../src/main/assistant-folder')
    const { root } = makeFolder()
    const found = await folderTool(root, 'dossier', 'blocus de Berlin')
    expect(found.text).toContain('histoire/guerre-froide.md')
    const read = await folderTool(root, 'lire_fichier', 'guerre froide')
    expect(read.text).toContain('Le blocus de Berlin commence en 1948')
    const missing = await folderTool(root, 'lire_fichier', 'inexistant')
    expect(missing.text).toMatch(/introuvable/)
  })

  it('ne sort jamais du dossier connecté', async () => {
    const { folderTool, resolveInFolder } = await import('../src/main/assistant-folder')
    const { root } = makeFolder()
    expect(() => resolveInFolder(root, '../secret.txt')).toThrow(/en dehors/)
    const r = await folderTool(root, 'lire_fichier', '../secret.txt')
    expect(r.text).not.toContain('mot de passe')
    const hidden = await folderTool(root, 'lire_fichier', '.cache/secret.md')
    expect(hidden.text).not.toContain('ne doit jamais')
  })

  it('l’assistant connaît les balises du dossier', async () => {
    const { parseTags } = await import('../src/main/assistant')
    const { tags } = parseTags('Je regarde.\n[[dossier: guerre froide]]\n[[lire_fichier: maths.txt]]')
    expect(tags.map((t) => t.name)).toEqual(['dossier', 'lire_fichier'])
  })
})
