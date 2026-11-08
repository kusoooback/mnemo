import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

const dir = mkdtempSync(join(tmpdir(), 'mnemo-fmt-'))
const file = (name: string, content = 'x'): string => {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

describe('Import : tous les formats lisibles', () => {
  it('les photos PNG et JPEG partent en lecture de texte', async () => {
    const { inspectSource } = await import('../src/main/importer')
    for (const n of ['cahier.png', 'cahier.jpg', 'cahier.JPEG', 'scan.webp']) {
      const s = inspectSource(file(n))
      expect(s.kind, n).toBe('document')
      expect(s.kind === 'document' && s.image, n).toBe(true)
    }
  })

  it('documents et présentations sont acceptés, pas les images', async () => {
    const { inspectSource } = await import('../src/main/importer')
    for (const n of ['cours.pdf', 'cours.docx', 'slides.pptx', 'cours.odt', 'cours.rtf', 'page.html', 'livre.epub', 'cours.tex', 'nb.ipynb']) {
      const s = inspectSource(file(n))
      expect(s.kind, n).toBe('document')
      expect(s.kind === 'document' && !!s.image, n).toBe(false)
    }
  })

  it('les formats de cartes gardent leur propre chemin', async () => {
    const { inspectSource } = await import('../src/main/importer')
    expect(inspectSource(file('a.csv', 'q;r')).kind).toBe('text')
    expect(inspectSource(file('a.md', '# T')).kind).toBe('markdown')
  })

  it('vidéos et sons : refus expliqué', async () => {
    const { inspectSource } = await import('../src/main/importer')
    const s = inspectSource(file('cours.mp4'))
    expect(s.kind).toBe('unsupported')
    expect(s.kind === 'unsupported' && s.reason).toMatch(/vidéos/)
    expect(inspectSource(file('cours.mp3')).kind).toBe('unsupported')
  })

  it('plusieurs photos à la fois = un seul import', async () => {
    const { inspectSources } = await import('../src/main/importer')
    const s = inspectSources([file('p1.png'), file('p2.jpg'), file('p3.jpeg')])
    expect(s.kind).toBe('document')
    expect(s.kind === 'document' && s.paths?.length).toBe(3)
    expect(s.kind === 'document' && s.image).toBe(true)
    expect(inspectSources([file('p1.png'), file('x.csv', 'a;b')]).kind).toBe('unsupported')
  })
})
