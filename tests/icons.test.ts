import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

/*
 * Une icône = une fonction. L'étincelle (Sparkles) est réservée à « Génération IA » : elle ne doit plus jamais
 * servir à autre chose (cartes d'un document, explication, vérification, état de l'IA, exemple…).
 */
const src = join(__dirname, '..', 'src', 'renderer', 'src')

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}

/** Les seuls écrans où l'étincelle est autorisée : ils mènent tous à la génération par l'IA. */
const ALLOWED = ['Sidebar.tsx', 'Palette.tsx', 'AiPage.tsx', 'Home.tsx', 'ImportWizard.tsx', 'Tour.tsx']

describe('Icônes', () => {
  it('l’étincelle est réservée à « Génération IA »', () => {
    const uses = files(src).flatMap((f) => {
      const text = readFileSync(f, 'utf8')
      return [...text.matchAll(/<Sparkles\b[^>]*>/g)].map((m) => ({ f: f.split(/[\\/]/).pop() as string, line: text.slice(0, m.index).split('\n').length, around: text.slice(m.index, (m.index ?? 0) + 160) }))
    })
    const bad = uses.filter((u) => !ALLOWED.includes(u.f))
    expect(bad, bad.map((b) => `${b.f}:${b.line}`).join(', ')).toEqual([])
    // Dans les écrans autorisés, elle n'apparaît que pour la génération.
    for (const u of uses.filter((x) => x.f === 'Home.tsx')) expect(u.around).toMatch(/nav\.ai|Sparkles size=\{15\} \/>\s*\{t\('nav\.ai'\)/)
  })

  it('les entrées de la barre latérale ont chacune leur icône', () => {
    const text = readFileSync(join(src, 'components', 'Sidebar.tsx'), 'utf8')
    const icons = [...text.matchAll(/icon: ([A-Z][A-Za-z0-9]+)/g), ...text.matchAll(/<([A-Z][A-Za-z0-9]+) size=\{18\} \/>/g)].map((m) => m[1]).filter((n) => !['PanelLeft'].includes(n))
    expect(new Set(icons).size).toBe(icons.length)
    expect(icons.length).toBeGreaterThanOrEqual(7)
  })

  it('les fonctions qui avaient l’étincelle ont leur propre icône', () => {
    const read = (f: string): string => readFileSync(join(src, f), 'utf8')
    expect(read('pages/DocViewer.tsx')).toMatch(/<Layers size=\{14\}/) // cartes d'un document
    expect(read('pages/Prepa.tsx')).toMatch(/<Layers size=\{14\}/)
    expect(read('pages/Review.tsx')).toMatch(/<Lightbulb/) // expliquer une carte
    expect(read('components/Editor.tsx')).toMatch(/<ShieldCheck/) // vérifier une carte
    expect(read('components/HomeDash.tsx')).toMatch(/<BrainCircuit/) // état de l'IA
    expect(read('pages/Home.tsx')).toMatch(/<Telescope/) // cartes sur un sujet
  })
})
