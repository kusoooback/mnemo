import type { Language } from '@shared/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Durée courte pour les boutons de réponse : « 10 min », « 3 j », « 2,4 mois ». */
export function formatInterval(ms: number, lang: Language): string {
  const fr = lang === 'fr'
  const num = (n: number): string =>
    (n < 10 ? Math.round(n * 10) / 10 : Math.round(n)).toString().replace('.', fr ? ',' : '.')
  if (ms < MIN) return '< 1 min'
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)} ${fr ? 'j' : 'd'}`
  if (days < 365) return `${num(days / 30)} ${fr ? 'mois' : 'mo'}`
  return `${num(days / 365)} ${fr ? 'an' : 'y'}${fr && days / 365 >= 2 ? 's' : ''}`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(m % 60).padStart(2, '0')}`
}

export function formatDue(ts: number, state: number, lang: Language): string {
  const fr = lang === 'fr'
  if (state === 0) return fr ? 'Nouvelle' : 'New'
  const days = Math.round((ts - Date.now()) / DAY)
  if (days <= 0) return fr ? 'Aujourd’hui' : 'Today'
  if (days === 1) return fr ? 'Demain' : 'Tomorrow'
  return new Date(ts).toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`
  return `${(n / 1024 ** 2).toFixed(1)} Mo`
}

const SYM: Record<string, string> = {
  to: '→', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩', Rightarrow: '⇒', Leftrightarrow: '⇔', Leftarrow: '⇐', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  neq: '≠', ne: '≠', approx: '≈', forall: '∀', exists: '∃', sum: '∑', prod: '∏', infty: '∞', circ: '∘', cdot: '·', times: '×', mapsto: '↦', emptyset: '∅', ldots: '…', dots: '…',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', theta: 'θ', varepsilon: 'ε', epsilon: 'ε', omega: 'ω', Delta: 'Δ', Omega: 'Ω', colon: ':'
}
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', n: 'ₙ', i: 'ᵢ', k: 'ₖ' }
const script = (map: Record<string, string>, x: string, mark: string): string => (x && [...x].every((c) => map[c]) ? [...x].map((c) => map[c]).join('') : `${mark}${x.length > 1 ? `(${x})` : x}`)

/** LaTeX -> texte lisible (pour les listes et aperçus, où l'on n'affiche pas les formules mises en page). */
export function latexToPlain(s: string): string {
  return s
    .replace(/\\mathbb\{([A-Z])\}/g, (_m, c: string) => ({ R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' })[c] ?? c)
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^}]*)\}/g, '$1')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^}]*)\}/g, '√($1)')
    .replace(/\\([A-Za-z]+)/g, (_m, name: string) => SYM[name] ?? name)
    .replace(/\^\{([^}]*)\}/g, (_m, x: string) => script(SUP, x, '^'))
    .replace(/_\{([^}]*)\}/g, (_m, x: string) => script(SUB, x, '_'))
    .replace(/\^([0-9a-zA-Z])/g, (_m, x: string) => script(SUP, x, '^'))
    .replace(/_([0-9a-zA-Z])/g, (_m, x: string) => script(SUB, x, '_'))
    .replace(/[{}]/g, '')
}

/** Texte brut d'une carte pour les listes (sans balisage). */
export function plainText(src: string): string {
  return src
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ‹code› ')
    .replace(/\$\$?([^$]+)\$\$?/g, (_m, tex: string) => latexToPlain(tex))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
