import { describe, expect, it } from 'vitest'
import { courseAccent, transformCourse } from '../src/renderer/src/lib/course'

describe('Mise en page « cours » des fiches', () => {
  it('laisse intacte une fiche ordinaire', () => {
    const html = '<h1>Dérivation</h1><h2>1. Définitions</h2><p>Une fonction est dérivable si …</p>'
    expect(transformCourse(html)).toBe(html)
  })

  it('fait un en-tête avec pastille et la couleur de la partie', () => {
    const out = transformCourse('<h1>II.1.2 – Une première mondialisation</h1><p>Texte</p>')
    expect(out).toContain('<div class="cbadge">II.1.2</div>')
    expect(out).toContain('<h1>Une première mondialisation</h1>')
    expect(out).toContain('Partie II.1')
    expect(out).toContain('--ac:#1d4ed8')
    expect(courseAccent('III.3')).toBe('#c2410c')
    expect(courseAccent('I')).toBe('#0f766e')
    expect(courseAccent('II.3')).toBe('#b45309')
  })

  it('classe les titres selon la numérotation du plan officiel', () => {
    const out = transformCourse(
      '<h2>3) Un monde renouvelé</h2><h2>3.1 Le choc de la guerre</h2><h2>3.11 La mort en masse</h2><h3>a) À l’échelle internationale</h3><h2>Vocabulaire</h2>'
    )
    expect(out).toContain('<h2 class="A"><span class="n">3</span>')
    expect(out).toContain('<h3 class="B"><span class="n">3.1</span><span>Le choc de la guerre')
    expect(out).toContain('<h4 class="C"><span class="pill">3.11</span>')
    expect(out).toContain('<h5 class="D"><span class="cchip">a</span>')
    expect(out).toContain('<h3 class="N small">Vocabulaire</h3>')
  })

  it('transforme l’argument, le fil rouge, la dissert, les pastilles et les dates', () => {
    const out = transformCourse(
      '<p>Fil rouge : un monde en ruines.</p><p><strong>Argument : une ponction sans précédent.</strong></p>' +
        '<ul><li>Fin : <strong>8 mai 1945</strong> ➕<br><em>Dissert : « Quels chocs ? »</em></li></ul><p>⚠ à vérifier, <strong>Nuremberg</strong></p>'
    )
    expect(out).toContain('<div class="lead"><span class="lab">Fil rouge</span>un monde en ruines.</div>')
    expect(out).toContain('<div class="arg"><div class="lab">Argument</div><div class="tx">Une ponction sans précédent.</div></div>')
    expect(out).toContain('<strong class="d">8 mai 1945</strong>')
    expect(out).toContain('<strong>Nuremberg</strong>')
    expect(out).toContain('<span class="web">+ web</span>')
    expect(out).toContain('<span class="cwarn">⚠</span>')
    expect(out).toContain('<span class="diss"><span class="lab">Dissert</span>« Quels chocs ? »</span>')
    expect(out.startsWith('<div class="course"')).toBe(true)
  })

  it('met le vocabulaire et les dates en étiquettes', () => {
    const out = transformCourse('<h2>Vocabulaire</h2><p>guerre de terreur – génocide – baby-boom</p><h2>Dates</h2><p>1941 Charte · 1942 Beveridge</p>')
    expect(out).toContain('<div class="cchips"><span class="chipv">guerre de terreur</span><span class="chipv">génocide</span><span class="chipv">baby-boom</span></div>')
    expect(out).toContain('<div class="cchips dates"><span class="chipv">1941 Charte</span><span class="chipv">1942 Beveridge</span></div>')
  })

  it('reconnaît les tableaux de définitions, de repères et de dates', () => {
    const t = (h: string): string => `<table><thead><tr>${h}</tr></thead><tbody><tr><td>a</td></tr></tbody></table>`
    expect(transformCourse(t('<th>Notion</th><th>Définition</th><th>Plan</th>'))).toContain('<table class="def ref">')
    expect(transformCourse(t('<th>Date</th><th>Événement</th><th>Fiche</th>'))).toContain('<table class="dates ref">')
    expect(transformCourse(t('<th>Pays</th><th>Total</th>'))).not.toContain('class="course"')
  })
})
