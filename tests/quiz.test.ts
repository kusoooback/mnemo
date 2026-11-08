import { describe, expect, it } from 'vitest'
import { buildQuiz, facetOf, isCorrect, norm, ratingFor, summarize, usableCards, type QuizCard } from '../src/shared/quiz'

let n = 0
const card = (front: string, back: string, extra: Partial<QuizCard> = {}): QuizCard => ({
  cardId: `c${++n}`,
  noteId: `n${n}`,
  kind: 'basic',
  ord: 0,
  deckId: 'd1',
  deckName: 'Histoire',
  fields: { front, back },
  tags: [],
  ...extra
})
const cloze = (text: string, ord = 1): QuizCard => ({ cardId: `c${++n}`, noteId: `n${n}`, kind: 'cloze', ord, deckId: 'd1', deckName: 'Histoire', fields: { text, extra: 'Précision' }, tags: [] })

const HIST: QuizCard[] = [
  card('Année du traité de Versailles ?', '1919'),
  card('Année de la crise de Wall Street ?', '1929'),
  card('Année de la chute du mur de Berlin ?', '1989'),
  card('Année de la révolution russe ?', '1917'),
  card('Capitale de la France ?', 'Paris'),
  card('Premier président de la Ve République ?', 'Charles de Gaulle')
]

describe('quiz : fabrication des questions', () => {
  it('QCM : une seule bonne réponse parmi 4 choix distincts', () => {
    const qs = buildQuiz(HIST, { mode: 'mcq', count: 6, focus: 'random', seed: 1 })
    expect(qs).toHaveLength(6)
    for (const q of qs) {
      expect(q.type).toBe('mcq')
      expect(q.choices.length).toBeGreaterThanOrEqual(2)
      expect(q.choices.length).toBeLessThanOrEqual(4)
      expect(q.choices.filter((c) => c.correct)).toHaveLength(1)
      expect(new Set(q.choices.map((c) => norm(c.text))).size).toBe(q.choices.length)
      expect(q.choices.find((c) => c.correct)?.text).toBe(q.answer)
    }
  })

  it('les mauvaises réponses ressemblent à la bonne (des années pour une année)', () => {
    const q = buildQuiz(HIST, { mode: 'mcq', count: 6, focus: 'random', seed: 3 }).find((x) => x.answer === '1919')
    expect(q).toBeTruthy()
    const wrong = (q?.choices ?? []).filter((c) => !c.correct).map((c) => c.text)
    expect(wrong.length).toBe(3)
    expect(wrong.every((w) => /^\d{4}$/.test(w))).toBe(true)
  })

  it('est déterministe pour une même graine, différent sinon', () => {
    const a = buildQuiz(HIST, { mode: 'mix', count: 5, focus: 'random', seed: 42 })
    const b = buildQuiz(HIST, { mode: 'mix', count: 5, focus: 'random', seed: 42 })
    const c = buildQuiz(HIST, { mode: 'mix', count: 5, focus: 'random', seed: 43 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
  })

  it('Vrai/Faux : la proposition est juste ou fausse selon la correction', () => {
    const qs = buildQuiz(HIST, { mode: 'tf', count: 6, focus: 'random', seed: 7 })
    expect(qs).toHaveLength(6)
    for (const q of qs) {
      expect(q.type).toBe('tf')
      expect(q.choices.map((c) => c.text)).toEqual(['Vrai', 'Faux'])
      if (q.isTrue) expect(q.statement).toBe(q.answer)
      else expect(norm(q.statement ?? '')).not.toBe(norm(q.answer))
      expect(q.choices[0].correct).toBe(!!q.isTrue)
      expect(isCorrect(q, q.isTrue ? 0 : 1)).toBe(true)
      expect(isCorrect(q, q.isTrue ? 1 : 0)).toBe(false)
    }
    expect(qs.some((q) => q.isTrue)).toBe(true)
    expect(qs.some((q) => !q.isTrue)).toBe(true)
  })

  it('texte à trous : la phrase cache le bon mot et propose les mots des autres cartes', () => {
    const cards = [
      cloze('La bataille de {{c1::Verdun}} a eu lieu en 1916.'),
      cloze('La bataille de {{c1::la Marne}} a eu lieu en 1914.'),
      cloze('Le traité de {{c1::Versailles}} date de 1919.'),
      cloze('La paix est signée à {{c1::Brest-Litovsk}} en 1918.')
    ]
    const qs = buildQuiz(cards, { mode: 'mcq', count: 4, focus: 'random', seed: 5 })
    expect(qs).toHaveLength(4)
    for (const q of qs) {
      expect(q.type).toBe('cloze')
      expect(q.prompt).toContain('[ … ]')
      expect(q.prompt).not.toContain(q.answer)
      expect(q.choices.find((c) => c.correct)?.text).toBe(q.answer)
      expect(q.extra).toBe('Précision')
    }
  })

  it('un trou en cache un seul à la fois et garde les autres visibles', () => {
    const f = facetOf(cloze('{{c1::Paris}} est la capitale de la {{c2::France}}.', 2))
    expect(f?.answer).toBe('France')
    expect(f?.prompt).toContain('Paris')
    expect(f?.prompt).toContain('[ … ]')
  })

  it('cartes recto/verso inversées : la question est le verso', () => {
    const f = facetOf({ ...card('Paris', 'Capitale de la France'), kind: 'basic-reverse', ord: 1 })
    expect(f?.prompt).toBe('Capitale de la France')
    expect(f?.answer).toBe('Paris')
  })

  it('écarte les occlusions, les images et les cartes vides ; limite les réponses trop longues en QCM', () => {
    const imgs = [
      { ...card('x', 'y'), kind: 'occlusion' },
      card('Schéma ?', '![](mnemo-media://abc.png)'),
      card('Vide ?', '   '),
      card('Long ?', 'a'.repeat(300)),
      card('Ok 1 ?', 'Réponse 1'),
      card('Ok 2 ?', 'Réponse 2')
    ]
    expect(usableCards(imgs, 'mcq')).toHaveLength(2)
    expect(usableCards(imgs, 'tf')).toHaveLength(3) // la réponse de 300 caractères reste possible en Vrai/Faux
  })

  it('refuse le QCM quand toutes les réponses sont identiques, mais accepte le Vrai/Faux', () => {
    const same = [card('A ?', 'Oui'), card('B ?', 'Oui'), card('C ?', 'oui')]
    expect(usableCards(same, 'mcq')).toHaveLength(0)
    expect(usableCards(same, 'tf').length).toBe(3)
  })

  it('un deck de 2 cartes donne quand même des QCM à 2 choix', () => {
    const qs = buildQuiz([card('1+1 ?', '2'), card('2+2 ?', '4')], { mode: 'mcq', count: 5, focus: 'random', seed: 1 })
    expect(qs).toHaveLength(2)
    expect(qs.every((q) => q.choices.length === 2)).toBe(true)
  })

  it('priorité aux cartes difficiles', () => {
    const cards = HIST.map((c, i) => ({ ...c, lapses: i === 4 ? 9 : 0 }))
    const qs = buildQuiz(cards, { mode: 'mcq', count: 1, focus: 'weak', seed: 11 })
    expect(qs[0].cardId).toBe(cards[4].cardId)
  })

  it('utilise en priorité les mauvaises réponses de l’IA, sans doublon ni la bonne réponse', () => {
    const target = HIST[4] // Paris
    const qs = buildQuiz(HIST, { mode: 'mcq', count: 6, focus: 'random', seed: 2, ai: { [target.cardId]: ['Lyon', 'Marseille', 'Paris', 'lyon'] } })
    const q = qs.find((x) => x.cardId === target.cardId)
    const texts = (q?.choices ?? []).map((c) => c.text)
    expect(texts).toContain('Lyon')
    expect(texts).toContain('Marseille')
    expect(texts.filter((t) => norm(t) === 'paris')).toHaveLength(1)
    expect(texts.filter((t) => norm(t) === 'lyon')).toHaveLength(1)
  })

  it('les formules LaTeX passent telles quelles dans les choix', () => {
    const maths = [card('Dérivée de $x^2$ ?', '$2x$'), card('Dérivée de $x^3$ ?', '$3x^2$'), card('Dérivée de $\\ln x$ ?', '$\\frac{1}{x}$'), card('Dérivée de $e^x$ ?', '$e^x$')]
    const qs = buildQuiz(maths, { mode: 'mcq', count: 4, focus: 'random', seed: 9 })
    for (const q of qs) expect(q.choices.every((c) => c.text.includes('$'))).toBe(true)
  })

  it('résultat et note de révision', () => {
    const s = summarize([
      { questionId: 'a', cardId: '1', correct: true, ms: 10 },
      { questionId: 'b', cardId: '2', correct: false, ms: 10 },
      { questionId: 'c', cardId: '2', correct: false, ms: 10 },
      { questionId: 'd', cardId: '3', correct: true, ms: 10 }
    ])
    expect(s).toEqual({ total: 4, good: 2, pct: 50, wrongCardIds: ['2'] })
    expect(summarize([]).pct).toBe(0)
    expect(ratingFor(true)).toBe(3)
    expect(ratingFor(false)).toBe(1)
  })
})
