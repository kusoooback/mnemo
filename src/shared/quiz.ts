/**
 * Quiz : QCM, Vrai/Faux et texte à trous à choix, fabriqués à partir des cartes existantes.
 * Logique pure (aucun accès à l'application) : même graine = même quiz, ce qui la rend testable.
 * Les mauvaises réponses viennent des AUTRES cartes (même deck, longueur et forme proches), et l'IA peut en proposer de plus piégeuses.
 */

export type QuizMode = 'mcq' | 'tf' | 'mix'
export type QuizFocus = 'random' | 'weak'

/** Ce dont le quiz a besoin d'une carte (sous-ensemble de CardRow). */
export interface QuizCard {
  cardId: string
  noteId: string
  kind: string
  ord: number
  deckId: string
  deckName: string
  fields: Record<string, string>
  tags: string[]
  lapses?: number
}

export interface QuizChoice {
  text: string
  correct: boolean
}

export interface QuizQuestion {
  id: string
  cardId: string
  type: 'mcq' | 'cloze' | 'tf'
  /** Question (Markdown + LaTeX). */
  prompt: string
  /** Réponses possibles (vide pour tf : voir `statement`). */
  choices: QuizChoice[]
  /** Vrai/Faux : la réponse proposée, qui est juste ou fausse. */
  statement?: string
  isTrue?: boolean
  /** La bonne réponse, pour la correction. */
  answer: string
  extra: string
  deckName: string
}

export interface QuizOptions {
  mode: QuizMode
  count: number
  focus: QuizFocus
  seed: number
  /** Mauvaises réponses fournies par l'IA, par carte (prioritaires sur celles tirées des autres cartes). */
  ai?: Record<string, string[]>
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g
export const MAX_CHOICE_LEN = 240

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Comparaison « bête » : sans casse, accents, ponctuation ni balisage. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*_`#>$\\{}]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const hasImage = (s: string): boolean => /!\[[^\]]*\]\([^)]*\)|<img\b/i.test(s)

interface Facet {
  cardId: string
  noteId: string
  deckId: string
  tags: string[]
  /** Question (type basic) ou phrase à trous (type cloze). */
  prompt: string
  answer: string
  extra: string
  type: 'mcq' | 'cloze'
  lapses: number
  deckName: string
}

/** Une carte -> sa question et sa réponse, ou null si elle ne se prête pas à un quiz (image, occlusion, vide). */
export function facetOf(c: QuizCard): Facet | null {
  const f = c.fields
  if (c.kind === 'occlusion') return null
  let prompt = ''
  let answer = ''
  let type: Facet['type'] = 'mcq'
  if (c.kind === 'cloze') {
    const text = f.text ?? ''
    const answers: string[] = []
    prompt = text.replace(CLOZE, (_m, n: string, ans: string) => {
      if (Number(n) === c.ord) {
        answers.push(ans.trim())
        return '**[ … ]**'
      }
      return ans
    })
    answer = answers.join(' ; ')
    type = 'cloze'
  } else {
    const rev = c.kind === 'basic-reverse' && c.ord === 1
    prompt = ((rev ? f.back : f.front) ?? '').trim()
    answer = ((rev ? f.front : f.back) ?? '').trim()
  }
  if (!prompt.trim() || !answer.trim()) return null
  if (hasImage(prompt) || hasImage(answer)) return null
  return {
    cardId: c.cardId,
    noteId: c.noteId,
    deckId: c.deckId,
    tags: c.tags,
    prompt,
    answer,
    extra: c.kind === 'cloze' ? (f.extra ?? '') : '',
    type,
    lapses: c.lapses ?? 0,
    deckName: c.deckName
  }
}

type Shape = 'num' | 'math' | 'short' | 'long'
function shapeOf(s: string): Shape {
  const t = s.trim()
  if (/^[\d\s.,:%€$+\-−/^]+$/.test(t)) return 'num'
  if (/\$|\\[a-z]+/i.test(t)) return 'math'
  return t.split(/\s+/).length <= 3 ? 'short' : 'long'
}

/** Plus c'est haut, plus la réponse de `other` est un bon « piège » pour `f`. */
function similarity(f: Facet, other: Facet): number {
  let s = 0
  if (other.deckId === f.deckId) s += 3
  const common = other.tags.filter((t) => f.tags.includes(t)).length
  s += Math.min(3, common)
  const a = f.answer.length
  const b = other.answer.length
  s += Math.max(0, 2 - Math.abs(Math.log((b + 1) / (a + 1))))
  if (shapeOf(f.answer) === shapeOf(other.answer)) s += 2
  return s
}

/** Les mauvaises réponses les plus crédibles pour une carte (jusqu'à `n`), tirées des autres cartes. */
export function distractorsFor(f: Facet, pool: Facet[], n: number, rand: () => number, ai: string[] = []): string[] {
  const out: string[] = []
  const seen = new Set<string>([norm(f.answer)])
  const add = (txt: string): void => {
    const k = norm(txt)
    if (!k || seen.has(k) || txt.length > MAX_CHOICE_LEN || hasImage(txt)) return
    seen.add(k)
    out.push(txt.trim())
  }
  for (const t of ai) {
    if (out.length >= n) break
    add(t)
  }
  const ranked = pool
    .filter((o) => o.noteId !== f.noteId)
    .map((o) => ({ o, s: similarity(f, o) + rand() * 1.5 }))
    .sort((x, y) => y.s - x.s)
  for (const { o } of ranked) {
    if (out.length >= n) break
    add(o.answer)
  }
  return out
}

/** Les cartes utilisables pour un quiz de ce mode (une réponse courte et sans image). */
export function usableCards(cards: QuizCard[], mode: QuizMode = 'mix'): QuizCard[] {
  const facets = cards.map((c) => ({ c, f: facetOf(c) })).filter((x): x is { c: QuizCard; f: Facet } => !!x.f)
  const ok = facets.filter(({ f }) => (mode === 'tf' ? f.answer.length <= 400 : f.answer.length <= MAX_CHOICE_LEN))
  if (mode === 'tf') return ok.map((x) => x.c)
  // QCM : il faut au moins une autre réponse différente pour fabriquer un choix.
  const distinct = new Set(ok.map((x) => norm(x.f.answer)))
  return distinct.size >= 2 ? ok.map((x) => x.c) : []
}

export function buildQuiz(cards: QuizCard[], opts: QuizOptions): QuizQuestion[] {
  const rand = rng(opts.seed)
  const facets = cards.map(facetOf).filter((f): f is Facet => !!f)
  const pool = facets.filter((f) => f.answer.length <= MAX_CHOICE_LEN)
  const eligible = facets.filter((f) => (opts.mode === 'tf' ? f.answer.length <= 400 : f.answer.length <= MAX_CHOICE_LEN))
  const ordered =
    opts.focus === 'weak'
      ? eligible
          .map((f) => ({ f, k: f.lapses + rand() * 0.9 }))
          .sort((a, b) => b.k - a.k)
          .map((x) => x.f)
      : shuffle(eligible, rand)

  const questions: QuizQuestion[] = []
  for (const f of ordered) {
    if (questions.length >= Math.max(1, opts.count)) break
    const wantTf = opts.mode === 'tf' || (opts.mode === 'mix' && rand() < 0.35)
    const aiWrong = opts.ai?.[f.cardId] ?? []
    if (!wantTf) {
      const wrong = distractorsFor(f, pool, 3, rand, aiWrong)
      if (wrong.length >= 1) {
        const choices = shuffle<QuizChoice>([{ text: f.answer, correct: true }, ...wrong.map((t) => ({ text: t, correct: false }))], rand)
        questions.push({ id: `${f.cardId}:${questions.length}`, cardId: f.cardId, type: f.type, prompt: f.prompt, choices, answer: f.answer, extra: f.extra, deckName: f.deckName })
        continue
      }
      if (opts.mode === 'mcq') continue
    }
    // Vrai/Faux : on propose la bonne réponse, ou une mauvaise bien choisie.
    const wrong = distractorsFor(f, pool, 1, rand, aiWrong)[0]
    const isTrue = wrong === undefined ? true : rand() < 0.5
    questions.push({
      id: `${f.cardId}:${questions.length}`,
      cardId: f.cardId,
      type: 'tf',
      prompt: f.prompt,
      choices: [
        { text: 'Vrai', correct: isTrue },
        { text: 'Faux', correct: !isTrue }
      ],
      statement: isTrue ? f.answer : (wrong as string),
      isTrue,
      answer: f.answer,
      extra: f.extra,
      deckName: f.deckName
    })
  }
  return questions
}

export const isCorrect = (q: QuizQuestion, choiceIndex: number): boolean => !!q.choices[choiceIndex]?.correct

export interface QuizResult {
  questionId: string
  cardId: string
  correct: boolean
  ms: number
}

export function summarize(results: QuizResult[]): { total: number; good: number; pct: number; wrongCardIds: string[] } {
  const good = results.filter((r) => r.correct).length
  return {
    total: results.length,
    good,
    pct: results.length ? Math.round((good * 100) / results.length) : 0,
    wrongCardIds: [...new Set(results.filter((r) => !r.correct).map((r) => r.cardId))]
  }
}

/** Note donnée au planificateur si l'élève choisit de compter le quiz dans sa révision : juste = Bien, faux = À revoir. */
export const ratingFor = (correct: boolean): 1 | 3 => (correct ? 3 : 1)
