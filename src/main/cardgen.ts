import { goodCard } from './cardquality'

/*
 * Finition des cartes et fiches produites par l'IA : mise en forme (LaTeX), vérification dans le texte source,
 * suppression des doublons et des déchets. Ce qui sort d'ici n'a pas à être retouché.
 */

export interface Draft {
  kind: 'basic' | 'cloze'
  front: string
  back: string
  text: string
  extra: string
  tags: string[]
}

/* ------------------------------------------------------------------ */
/* Formules : texte brut -> LaTeX                                       */
/* ------------------------------------------------------------------ */

const SYMBOLS: Record<string, string> = {
  '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq', '⊃': '\\supset', '∪': '\\cup', '∩': '\\cap', '→': '\\to', '↦': '\\mapsto',
  '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx', '∀': '\\forall', '∃': '\\exists',
  '∑': '\\sum', '∏': '\\prod', '√': '\\sqrt', '∞': '\\infty', 'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}',
  'ℂ': '\\mathbb{C}', '○': '\\circ', '∘': '\\circ', '×': '\\times', '·': '\\cdot', '−': '-', '⋆': '*', '∶': ':', '∅': '\\emptyset'
}
const MATH_SYMBOL = /[∈∉⊂⊆⊃∪∩→↦⇒⇔≤≥≠≈∀∃∑∏√∞ℝℕℤℚℂ○∘×∅]/
const MATH_CHARS = /^[A-Za-z0-9()[\]{}|,.+\-−=<>/\\^_*:'′∈∉⊂⊆⊃∪∩→↦⇒⇔≤≥≠≈∀∃∑∏√∞ℝℕℤℚℂ○∘×·∅⋆∶]+$/
const SHORT_MATH = new Set(['ln', 'Id', 'Im', 'rg', 'dx', 'dy', 'dt', 'dz', 'df', 'dn', 'xy', 'Sn', 'Tn', 'Un', 'Vn', 'un', 'vn'])
const FUNCTIONS = new Set(['exp', 'ln', 'log', 'sin', 'cos', 'tan', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'Id', 'Im', 'Var', 'card', 'rg'])

/** Un « mot » de maths : que des caractères de formule, et pas de vrai mot français ou anglais de trois lettres ou plus. */
function isMathToken(raw: string): boolean {
  const tok = raw.replace(/[.,;!?]+$/, '')
  if (!tok || !MATH_CHARS.test(tok)) return false
  // « si », « de », « et »… : des mots de deux lettres, pas des variables (sauf les notations usuelles).
  if (/^[A-Za-z]{2}$/.test(tok) && !SHORT_MATH.has(tok)) return false
  for (const run of tok.match(/[A-Za-z]{3,}/g) ?? []) if (!FUNCTIONS.has(run)) return false
  return true
}

function wrapSegment(seg: string): string {
  const parts = seg.split(/(\s+)/)
  let out = ''
  let i = 0
  while (i < parts.length) {
    if (!isMathToken(parts[i])) {
      out += parts[i++]
      continue
    }
    // Suite de « mots » de maths séparés par des espaces.
    let j = i
    let last = i
    while (j < parts.length) {
      if (isMathToken(parts[j])) last = j
      else if (!/^\s+$/.test(parts[j])) break
      j++
    }
    const span = parts.slice(i, last + 1)
    // « est : a_n = … » : les deux-points ou virgules isolés en tête ne font pas partie de la formule.
    let lead = ''
    while (span.length && /^[:;,]+$|^\s+$/.test(span[0])) lead += span.shift() as string
    if (span.length === 0) {
      out += lead
      i = last + 1
      continue
    }
    const lastTok = span[span.length - 1]
    const trailing = /[.,;!?]+$/.exec(lastTok)?.[0] ?? ''
    span[span.length - 1] = lastTok.slice(0, lastTok.length - trailing.length)
    const body = span.join('')
    if (MATH_SYMBOL.test(body) || /[\^_]\{|[\^_][A-Za-z0-9]|=/.test(body)) {
      const tex = body.replace(/./gu, (c) => SYMBOLS[c] ?? c).replace(/\s*\*\s*/g, ' \\cdot ')
      out += `${lead}$${tex}$${trailing}`
    } else out += lead + body + trailing
    i = last + 1
  }
  return out
}

/** Met les formules en LaTeX entre $…$ (sans toucher à celles qui y sont déjà, ni franchir une zone à trous {{c1::…}}). */
export function mathify(text: string): string {
  return text
    .split(/(\$[^$]*\$)/)
    .map((chunk, i) => (i % 2 === 1 ? chunk : chunk.split(/(\{\{c\d+::|\}\})/).map((s, k) => (k % 2 === 1 ? s : wrapSegment(s))).join('')))
    .join('')
}

/* ------------------------------------------------------------------ */
/* Nettoyage, vérification, doublons                                    */
/* ------------------------------------------------------------------ */

const clean = (s: string): string =>
  s
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()

const upper = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function normalizeDraft(c: Draft): Draft {
  const strip = (s: string, re: RegExp): string => clean(s).replace(re, '')
  if (c.kind === 'cloze') return { ...c, text: mathify(clean(c.text)), extra: mathify(clean(c.extra)), front: '', back: '' }
  const front = upper(mathify(strip(c.front, /^\s*(?:q(?:uestion)?\s*\d*\s*[:.)-]\s*|\d+\s*[.)]\s+)/i)))
  const back = upper(mathify(strip(c.back, /^\s*(?:r(?:[ée]ponse)?\s*[:.)-]\s*)/i)))
  return { ...c, front, back, text: '', extra: mathify(clean(c.extra)) }
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** La réponse figure-t-elle dans le texte source ? Écarte ce que le modèle a inventé. */
export function groundedIn(c: Draft, source: string): boolean {
  if (norm(source).length < 200) return true // trop peu de texte pour juger
  const src = ` ${norm(source)} `
  const check = (answer: string, ratio: number): boolean => {
    const words = norm(answer.replace(/\$[^$]*\$/g, ' ')).split(' ').filter((w) => w.length >= 4)
    if (words.length === 0) return true // réponse faite de formules : on ne peut pas juger sur les mots
    const found = words.filter((w) => src.includes(` ${w}`) || src.includes(w.slice(0, Math.max(4, w.length - 2)))).length
    return found / words.length >= ratio
  }
  if (c.kind === 'cloze') {
    const answers = [...c.text.matchAll(/\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g)].map((m) => m[1]).join(' ')
    return check(answers, 0.7) && check(c.text.replace(/\{\{c\d+::|\}\}/g, ' '), 0.5)
  }
  return check(c.back, 0.5)
}

const words = (s: string): Set<string> => new Set(norm(s).split(' ').filter((w) => w.length > 2))

/** Cartes qui posent la même question presque mot pour mot : on n'en garde qu'une. */
export function dedupeDrafts(cards: Draft[]): Draft[] {
  const kept: { c: Draft; w: Set<string> }[] = []
  for (const c of cards) {
    const w = words(c.kind === 'cloze' ? c.text : c.front)
    const dup = kept.some((k) => {
      if (k.w.size === 0 || w.size === 0) return false
      let common = 0
      for (const x of w) if (k.w.has(x)) common++
      return common / (k.w.size + w.size - common) >= 0.75
    })
    if (!dup) kept.push({ c, w })
  }
  return kept.map((k) => k.c)
}

/** Chaîne complète sans IA : forme, qualité, ancrage dans le texte, doublons. */
export function finalizeDrafts(cards: Draft[], opts: { source?: string; vocabulary?: boolean }): Draft[] {
  const out = cards
    .map(normalizeDraft)
    .filter((c) => goodCard({ kind: c.kind, front: c.front, back: c.back, text: c.text }, { vocabulary: opts.vocabulary }))
    .filter((c) => (opts.source ? groundedIn(c, opts.source) : true))
  return dedupeDrafts(out)
}

/* ------------------------------------------------------------------ */
/* Fiches de révision                                                   */
/* ------------------------------------------------------------------ */

/** Fiche propre : titre, pas de préambule du modèle, pas de section vide. */
export function cleanSummary(markdown: string, title: string): string {
  let s = markdown.replace(/\r/g, '').trim()
  s = s.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '')
  const firstHeading = s.search(/^#{1,3}\s/m)
  if (firstHeading > 0) s = s.slice(firstHeading) // « Voici la fiche demandée : » et autres préambules
  if (!/^#\s/.test(s)) s = `# ${title}\n\n${s.replace(/^#{2,3}\s/, (m) => m)}`
  const lines = s.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      if (j >= lines.length || /^#{1,3}\s/.test(lines[j])) continue // section vide
    }
    out.push(lines[i])
  }
  // Réponse coupée par la limite de longueur : on retire la dernière ligne si elle est manifestement incomplète.
  const last = out[out.length - 1] ?? ''
  if (out.length > 3 && (((last.match(/\$/g) ?? []).length % 2 === 1) || (last.length > 80 && !/[.!?)$\]»*]\s*$/.test(last)))) out.pop()
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
