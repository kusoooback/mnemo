import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

/*
 * Garde-fous du thème : la barre latérale a toujours la couleur du reste de l'application (jamais de teinte bleutée).
 * Le bug d'origine : la feuille de style de PDF.js, importée en entier, définissait sa propre classe « .sidebar »
 * (#23222b) qui écrasait celle de l'application en mode sombre.
 */
const root = join(__dirname, '..', 'src', 'renderer')

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) files(p, out)
    else out.push(p)
  }
  return out
}

describe('Couleurs de l’interface', () => {
  const tokens = readFileSync(join(root, 'src', 'styles', 'tokens.css'), 'utf8')

  it('la barre latérale reprend la couleur de fond, en clair et en sombre', () => {
    const light = /:root\[data-theme='light'\][\s\S]*?\n\}/.exec(tokens)?.[0] ?? ''
    const dark = /:root\[data-theme='dark'\][\s\S]*?\n\}/.exec(tokens)?.[0] ?? ''
    expect(light).toMatch(/--sidebar:\s*var\(--bg\)/)
    expect(dark).toMatch(/--sidebar:\s*var\(--bg\)/)
  })

  it('aucun style tiers global ne peut recolorer l’application (feuille complète de PDF.js interdite)', () => {
    const sources = files(join(root, 'src')).filter((f) => /\.(tsx?|css)$/.test(f))
    for (const f of sources) expect(readFileSync(f, 'utf8'), f).not.toMatch(/pdf_viewer\.css/)
  })

  it('le fond sombre est neutre : pas de dominante bleue dans les gris de fond', () => {
    const dark = /:root\[data-theme='dark'\][\s\S]*?\n\}/.exec(tokens)?.[0] ?? ''
    for (const name of ['--bg', '--surface', '--surface-2', '--surface-3']) {
      const hex = new RegExp(`${name}:\\s*#([0-9a-f]{6})`, 'i').exec(dark)?.[1]
      expect(hex, name).toBeTruthy()
      const [r, g, b] = [0, 2, 4].map((i) => parseInt((hex as string).slice(i, i + 2), 16))
      expect(b - r, `${name} ne doit pas tirer vers le bleu`).toBeLessThanOrEqual(3)
      expect(b - g, `${name} ne doit pas tirer vers le bleu`).toBeLessThanOrEqual(3)
    }
  })
})
