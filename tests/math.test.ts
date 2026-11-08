import { describe, expect, it } from 'vitest'
import { splitMath, stashMath } from '../src/renderer/src/lib/math'

const maths = (s: string): string[] => splitMath(s).filter((x) => x.math).map((x) => x.value)

describe('repérage des formules LaTeX', () => {
  it('reconnaît $…$ et $$…$$', () => {
    expect(maths('Soit $x^2$ et $$\\int_0^1 f$$.')).toEqual(['x^2', '\\int_0^1 f'])
    expect(splitMath('$$a$$')[0].display).toBe(true)
    expect(splitMath('$a$')[0].display).toBe(false)
  })
  it('reconnaît \\(…\\) et \\[…\\] (format Anki et IA)', () => {
    expect(maths('La dérivée de \\(x^2\\) est \\(2x\\).')).toEqual(['x^2', '2x'])
    expect(splitMath('\\[\\sum_{k=0}^n k\\]')).toEqual([{ math: true, value: '\\sum_{k=0}^n k', display: true }])
  })
  it('reconnaît les environnements \\begin…\\end', () => {
    const t = '\\begin{align} a &= b \\\\ c &= d \\end{align}'
    expect(maths(`Voici : ${t}`)).toEqual([t])
    expect(maths('\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}')).toHaveLength(1)
  })
  it("accepte « $ x^2 $ » avec espaces quand c'est visiblement du LaTeX", () => {
    expect(maths('Soit $ x^2 $ ici')).toEqual(['x^2'])
    expect(maths('Soit $ \\alpha $ ici')).toEqual(['\\alpha'])
  })
  it('ne prend pas deux prix pour une formule', () => {
    expect(maths('Ça coûte 5 $ et ça 6 $ aussi')).toEqual([])
    expect(maths('Il a 5$ puis 7$')).toEqual([])
  })
  it("rend plusieurs formules d'une même ligne", () => {
    expect(maths('$a$, $b$ et $c$')).toEqual(['a', 'b', 'c'])
  })
  it('laisse le code intact', () => {
    const { text, stash } = stashMath('`$x$` et $y$\n```\n$z$\n```', (t) => `<${t}>`)
    expect(stash).toEqual(['<y>'])
    expect(text).toContain('`$x$`')
    expect(text).toContain('$z$')
  })
  it('ne laisse aucun délimiteur dans le texte restant', () => {
    const { text } = stashMath('\\(a\\) \\[b\\] $c$ $$d$$', (t) => t)
    expect(text.includes('$')).toBe(false)
    expect(text.includes('\\(')).toBe(false)
    expect(text.includes('\\[')).toBe(false)
  })
})
