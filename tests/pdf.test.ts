import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, BrowserWindow: class {}, dialog: {}, shell: {} }))

describe('Export PDF des fiches', () => {
  it('compose une vraie page A4 : marges, en-tête Mnémo, encadrés qui ne se coupent pas', async () => {
    const { paperHtml } = await import('../src/main/exportpdf')
    const html = paperHtml({ title: 'Applications <1>', subtitle: 'Mathématiques · Ensembles', html: '<h1>Applications</h1><div class="callout callout-key"><div class="callout-body">x</div></div>', css: '.katex{font-size:1.1em}' })
    expect(html).toContain('@page { size: A4; margin: 17mm 19mm 21mm 19mm; }')
    expect(html).toContain('<b>Mnémo</b><span>Mathématiques · Ensembles</span>')
    expect(html).toContain('<title>Applications &lt;1&gt;</title>') // titre échappé
    expect(html).toContain('.katex{font-size:1.1em}') // styles des formules repris de l'application
    expect(html).toMatch(/\.callout \{[^}]*break-inside: avoid/)
    expect(html).toMatch(/table \{[^}]*break-inside: avoid/)
    expect(html).toContain('<article class="sheet md"><h1>Applications</h1>')
    // Couleurs explicites : le PDF ne dépend ni du thème sombre ni des variables de l'application.
    expect(html).not.toContain('var(--bg)')
  })

  it('chaque type d’encadré a sa couleur sur papier', async () => {
    const { paperHtml } = await import('../src/main/exportpdf')
    const html = paperHtml({ title: 't', subtitle: '', html: '', css: '' })
    for (const type of ['key', 'definition', 'theorem', 'property', 'method', 'warning', 'example', 'note']) expect(html).toContain(`.callout-${type}`)
  })
})
