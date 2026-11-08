/*
 * Contrôle de qualité des cartes créées par l'IA : les petits modèles produisent parfois des cartes inutilisables
 * (phrase entière masquée, question sans réponse, contenu administratif). Tout ce qui ne passe pas est écarté.
 */

export interface CardLike {
  kind: 'basic' | 'cloze'
  front: string
  back: string
  text: string
}

// Informations pratiques qui ne se révisent pas : groupes de colle, horaires, salles…
const ADMIN_WORDS = /\b(groupes? de (colle|td)|trin[ôo]mes?|colloscope|emploi du temps|planning|horaires?|salle|semaine (du|\d)|rendez-vous|inscri(ption|re)|mail|adresse|t[ée]l[ée]phone|enseignants?|professeurs?)\b/i

const HIDDEN = /\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g

/** Début d'une vraie question ou d'une consigne de révision (« Quelle est… », « Définir… », « Énoncer… »). */
const QUESTION = /^\s*(quel(le)?s?|qu['’e]|quoi|qui|comment|pourquoi|quand|o[uù]|combien|[àa] quoi|en quoi|est-ce|d[ée]fini(r|s)|[ée]nonce(r|z)?|cite(r|z)?|donne(r|z)?|expliqu(e|er)|d[ée]cri(s|re)|rappel(le|er)|nomme(r|z)?|pr[ée]cise(r|z)?|calcule(r|z)?|que (dit|signifie|vaut)|what|which|how|why|when|where|define|state|explain|give|list|name)\b/i
// Étiquettes de paragraphe prises pour des questions : « Remarque », « Proposition », « Démonstration »…
const LABEL = /^(remarque|proposition|th[ée]or[èe]me|d[ée]finition|d[ée]monstration|exemple|propri[ée]t[ée]|corollaire|lemme|preuve|exercice|notation|rappel|application|conclusion|introduction)\s*\d*\s*[.:]?$/i

export function goodCard(c: CardLike, opts: { vocabulary?: boolean } = {}): boolean {
  if (c.kind === 'cloze') {
    const t = c.text.trim()
    const blanks = [...t.matchAll(HIDDEN)]
    if (t.length < 25 || t.length > 450) return false
    if (blanks.length < 1 || blanks.length > 3) return false
    const hidden = blanks.reduce((a, m) => a + m[1].length, 0)
    const visible = t.replace(HIDDEN, '').replace(/[\s.,;:!?()\-–—'’"«»]/g, '')
    if (visible.length < 12) return false // presque tout est masqué : on ne sait pas de quoi on parle
    if (hidden / t.length > 0.55) return false
    if (blanks.some((m) => m[1].trim().length < 2 || m[1].length > 70)) return false
    return !ADMIN_WORDS.test(t)
  }
  const f = c.front.trim()
  const b = c.back.trim()
  const minFront = opts.vocabulary ? 2 : 10
  if (f.length < minFront || f.length > 350 || b.length < 1 || b.length > 450) return false
  if (f.toLowerCase() === b.toLowerCase()) return false
  if (/^[\W\d_]+$/.test(f)) return false
  if (LABEL.test(f)) return false
  // Hors vocabulaire : le recto doit poser une vraie question (point d'interrogation ou formulation de consigne).
  if (!opts.vocabulary && !/\?\s*$/.test(f) && !QUESTION.test(f)) return false
  if (!opts.vocabulary && f.split(/\s+/).length < 3) return false
  return !ADMIN_WORDS.test(`${f} ${b}`)
}
