import { describe, expect, it } from 'vitest'
import { cleanSummary, dedupeDrafts, finalizeDrafts, groundedIn, mathify, normalizeDraft, type Draft } from '../src/main/cardgen'

const basic = (front: string, back: string): Draft => ({ kind: 'basic', front, back, text: '', extra: '', tags: [] })
const cloze = (text: string): Draft => ({ kind: 'cloze', front: '', back: '', text, extra: '', tags: [] })

describe('Formules en LaTeX', () => {
  it('met les formules entre $…$ sans toucher au texte', () => {
    expect(mathify('Une application f : E → F est injective si f(x) = f(y) alors x = y.')).toBe(
      'Une application $f : E \\to F$ est injective si $f(x) = f(y)$ alors $x = y$.'
    )
    expect(mathify('Pour tout x ∈ ℝ, e^{x} > 0.')).toBe('Pour tout $x \\in \\mathbb{R}, e^{x} > 0$.')
    expect(mathify('La suite u_{n} converge vers 0.')).toBe('La suite $u_{n}$ converge vers 0.')
  })

  it('laisse intacts le texte ordinaire, les années et les formules déjà en LaTeX', () => {
    expect(mathify('Le traité de 1919 a été signé à Versailles.')).toBe('Le traité de 1919 a été signé à Versailles.')
    expect(mathify('La dérivée de $e^x$ est $e^x$.')).toBe('La dérivée de $e^x$ est $e^x$.')
    expect(mathify('Question n°3 : peut-être ?')).toBe('Question n°3 : peut-être ?')
  })

  it('ne franchit pas les trous des cartes à trous', () => {
    expect(mathify('Si f(E) = F alors f est {{c1::surjective}}.')).toBe('Si $f(E) = F$ alors f est {{c1::surjective}}.')
    expect(mathify('On a {{c1::x ∈ E}} pour tout x.')).toBe('On a {{c1::$x \\in E$}} pour tout x.')
  })
})

describe('Formules : ponctuation et produits', () => {
  it('laisse les deux-points hors de la formule et note les produits', () => {
    expect(mathify('La formule est : a_n = a_1 + (n - 1) * d, où d est la raison.')).toBe('La formule est : $a_n = a_1 + (n - 1) \\cdot d$, où d est la raison.')
  })
})

describe('Finition des cartes', () => {
  it('retire les préfixes « Question : » / « Réponse : » et met en forme', () => {
    const c = normalizeDraft(basic('Question : quelle est la dérivée de e^{x} ?', 'Réponse : e^{x}'))
    expect(c.front).toBe('Quelle est la dérivée de $e^{x}$ ?')
    expect(c.back).toBe('$e^{x}$')
  })

  it('écarte les réponses inventées (absentes du texte source)', () => {
    const source = 'La mitochondrie est l’organite qui produit l’ATP par phosphorylation oxydative dans la cellule eucaryote. '.repeat(4)
    expect(groundedIn(basic('Quel organite produit l’ATP ?', 'La mitochondrie.'), source)).toBe(true)
    expect(groundedIn(basic('Quel organite produit l’ATP ?', 'Le chloroplaste synthétise le glucose grâce à la lumière.'), source)).toBe(false)
  })

  it('retire les doublons presque identiques', () => {
    const list = dedupeDrafts([basic('Quelle est la définition d’une application injective ?', 'a'), basic('Quelle est la définition de l’application injective ?', 'b'), basic('Que dit le théorème de Bayes ?', 'c')])
    expect(list).toHaveLength(2)
  })

  it('enchaîne forme, qualité, ancrage et doublons', () => {
    const source = 'Une application est injective si deux éléments distincts ont des images distinctes. Elle est surjective si tout élément de l’arrivée a un antécédent. '.repeat(3)
    const out = finalizeDrafts(
      [
        basic('Remarque', 'Il s’agit de montrer que f est bijective'),
        basic('Quelle est la définition d’une application surjective ?', 'Tout élément de l’arrivée a un antécédent.'),
        basic('Quelle est la capitale de l’Australie ?', 'Canberra est la capitale de l’Australie.'),
        cloze('Une application est {{c1::injective}} si deux éléments distincts ont des images distinctes.')
      ],
      { source }
    )
    expect(out.map((c) => (c.kind === 'cloze' ? 'cloze' : c.front))).toEqual(['Quelle est la définition d’une application surjective ?', 'cloze'])
  })
})

describe('Fiches avec encadrés', () => {
  it('conserve intacts les encadrés, tableaux et la section finale', () => {
    const raw = '# Applications\n\n*Injections, surjections et bijections.*\n\n> [!KEY] À retenir\n> - Une bijection est injective et surjective.\n\n## 1. Définitions\n\n> [!DEFINITION] Injective\n> Deux éléments distincts ont des images distinctes.\n\n| Notion | Condition |\n| --- | --- |\n| Injective | $f(x)=f(y) \\Rightarrow x=y$ |\n\n## Pour réviser\n- Qu\'est-ce qu\'une bijection ?\n'
    const out = cleanSummary(raw, 'Applications')
    expect(out).toContain('> [!KEY] À retenir')
    expect(out).toContain('> [!DEFINITION] Injective')
    expect(out).toContain('| Notion | Condition |')
    expect(out).toContain('## Pour réviser')
  })
})

describe('Fiches de révision', () => {
  it('retire le préambule, ajoute un titre et supprime les sections vides', () => {
    const raw = 'Voici la fiche demandée :\n\n## À retenir\n- Une idée\n\n## Définitions\n\n## Méthodes\n- Étape 1\n'
    expect(cleanSummary(raw, 'Applications')).toBe('# Applications\n\n## À retenir\n- Une idée\n\n## Méthodes\n- Étape 1')
  })
})
