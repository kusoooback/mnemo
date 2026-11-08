import { describe, expect, it } from 'vitest'
import { transformCallouts } from '../src/renderer/src/lib/callouts'

describe('Encadrés des fiches', () => {
  it('transforme une alerte en encadré avec son type et son titre', () => {
    const html = '<blockquote>\n<p>[!DEFINITION] Application injective<br>Une application est <strong>injective</strong> si …</p>\n</blockquote>'
    const out = transformCallouts(html)
    expect(out).toContain('class="callout callout-definition"')
    expect(out).toContain('<span class="callout-kind">Définition</span>')
    expect(out).toContain('<span class="callout-name">Application injective</span>')
    expect(out).toContain('<strong>injective</strong>')
    expect(out).not.toContain('<blockquote>')
  })

  it('n’affiche pas deux fois « À retenir » quand le titre répète le type', () => {
    const out = transformCallouts('<blockquote><p>[!KEY] À retenir<br>Une idée.</p></blockquote>')
    expect(out).toContain('<span class="callout-kind">À retenir</span>')
    expect(out).not.toContain('callout-name')
  })

  it('garde les listes qui suivent la ligne de titre (méthodes, à retenir)', () => {
    const html = '<blockquote>\n<p>[!METHOD] Montrer une injection</p>\n<ol>\n<li>Prendre x et y</li>\n<li>Conclure</li>\n</ol>\n</blockquote>'
    const out = transformCallouts(html)
    expect(out).toContain('callout-method')
    expect(out).toContain('<ol>')
    expect(out).toContain('Prendre x et y')
  })

  it('accepte tous les types prévus et laisse les citations ordinaires intactes', () => {
    for (const t of ['KEY', 'DEFINITION', 'THEOREM', 'PROPERTY', 'METHOD', 'WARNING', 'EXAMPLE', 'NOTE']) {
      expect(transformCallouts(`<blockquote><p>[!${t}] Titre<br>Texte</p></blockquote>`)).toContain(`callout-${t.toLowerCase()}`)
    }
    const quote = '<blockquote><p>Une citation de Tocqueville.</p></blockquote>'
    expect(transformCallouts(quote)).toBe(quote)
    const unknown = '<blockquote><p>[!INCONNU] x</p></blockquote>'
    expect(transformCallouts(unknown)).toBe(unknown)
  })

  it('transforme plusieurs encadrés d’une même fiche', () => {
    const html = '<h2>1. Définitions</h2><blockquote><p>[!DEFINITION] A<br>a</p></blockquote><blockquote><p>[!WARNING] B<br>b</p></blockquote>'
    expect((transformCallouts(html).match(/class="callout /g) ?? []).length).toBe(2)
  })
})
