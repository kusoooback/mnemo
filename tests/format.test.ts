import { describe, expect, it } from 'vitest'
import { latexToPlain, plainText } from '../src/renderer/src/lib/format'

describe('Aperçus de cartes avec formules', () => {
  it('affichent les formules lisiblement dans les listes (pas de LaTeX brut)', () => {
    expect(plainText('Quelle est la définition d’une application $f : E \\to F$ injective ?')).toBe('Quelle est la définition d’une application f : E → F injective ?')
    expect(plainText('Pour tous $x, y \\in E$, $f(x) = f(y) \\Rightarrow x = y$.')).toBe('Pour tous x, y ∈ E, f(x) = f(y) ⇒ x = y.')
    expect(plainText('La suite $u_{n}$ vaut $e^{2}$ et $\\mathbb{R}$')).toBe('La suite uₙ vaut e² et ℝ')
    expect(plainText('Cloze : {{c1::$x \\in E$}}')).toBe('Cloze : x ∈ E')
  })

  it('traite fractions, racines, exposants longs et commandes inconnues sans planter', () => {
    expect(latexToPlain('\\frac{a}{b} + \\sqrt{x}')).toBe('(a)/(b) + √(x)')
    expect(latexToPlain('x^{ab}')).toBe('x^(ab)')
    expect(latexToPlain('\\truc{x}')).toBe('trucx')
  })
})
