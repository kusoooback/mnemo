/*
 * Mise en page « cours » des fiches de révision : les conventions d'écriture d'un cours bien rédigé deviennent des
 * éléments visuels (en-tête avec pastille, titres numérotés, encadré « Argument », « Fil rouge », dates en pastilles,
 * vocabulaire en étiquettes, tableaux de définitions…).
 *
 * Conventions reconnues dans le Markdown (rien n'est obligatoire, chaque élément est repéré indépendamment) :
 *   # II.1.2 – Titre de la fiche            → en-tête avec pastille « II.1.2 » (couleur selon la partie)
 *   ## 1.21 Titre / ## 1.2 Titre / ## 1) Titre / ### a) Titre   → niveaux de titres numérotés
 *   **Argument : l'idée-force du paragraphe**   → encadré « Argument »
 *   Fil rouge : …                           → encadré de présentation
 *   *Dissert : « Sujet possible ? »*         → pastille « Dissert »
 *   ➕ (complément web), ⚠ (à vérifier)       → pastilles
 *   **1913**, **juin 1947**                  → dates en surbrillance
 *   ## Vocabulaire / ## Dates                → étiquettes
 *   | Notion | Définition | Plan |  /  | Date | Événement |   → tableaux dédiés
 *
 * Fonction pure appliquée sur le HTML déjà nettoyé (testable sans navigateur). Une fiche sans aucune de ces marques
 * est rendue telle quelle.
 */

/** Couleur d'accent selon la partie (le début du titre : « II.1.2 – … »). */
const ACCENTS: Array<[RegExp, string]> = [
  [/^III\.1/, '#6d28d9'],
  [/^III\.2/, '#15803d'],
  [/^III\.3/, '#c2410c'],
  [/^III/, '#6d28d9'],
  [/^II\.1/, '#1d4ed8'],
  [/^II\.2/, '#be123c'],
  [/^II\.3/, '#b45309'],
  [/^II/, '#1d4ed8'],
  [/^I(?![IVX])/, '#0f766e']
]

const PART_LABELS: Array<[RegExp, string]> = [
  [/^III\.1/, 'Partie III.1 · La guerre froide'],
  [/^III\.2/, "Partie III.2 · Émergence d'un 3e bloc ?"],
  [/^III\.3/, 'Partie III.3 · Moyen-Orient'],
  [/^II\.1/, "Partie II.1 · 1913 : l'Europe domine le monde"],
  [/^II\.2/, "Partie II.2 · 1939 : un monde d'incertitudes"],
  [/^II\.3/, 'Partie II.3 · 1945 : un monde renouvelé ?'],
  [/^I(?![IVX])/, 'Partie I · La géopolitique']
]

const TAG = /^((?:III|II|IV|VI{0,3}|IX|I|V|X)(?:\.\d+)*\s?[a-z]?)\s*[–—-]\s*([\s\S]+)$/
const DATE = /\b(1[0-9]{3}|20[0-9]{2})\b|\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i

export function courseAccent(tag: string): string | null {
  for (const [re, color] of ACCENTS) if (re.test(tag)) return color
  return null
}

const cap = (s: string): string => s.replace(/^(<[^>]+>)*([a-zà-ÿ])/, (m, _t, c: string) => m.slice(0, m.length - 1) + c.toUpperCase())
const strip = (s: string): string => s.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim()

/** Un titre est classé selon sa numérotation, comme dans le plan officiel d'un cours : « 1) », « 1.1 », « 1.11 », « a) ». */
function classify(text: string): { kind: 'A' | 'B' | 'C' | 'D' | 'N'; num: string; rest: string } {
  const t = text.trim()
  let m = /^(\d+\))\s*([\s\S]*)$/.exec(t)
  if (m) return { kind: 'A', num: m[1].slice(0, -1), rest: m[2] }
  m = /^(\d\.\d{2}(?:\s?[a-d])?(?:\s*(?:\/|,|-|à)\s*\d\.\d{2})*)\s+([\s\S]*)$/.exec(t)
  if (m) return { kind: 'C', num: m[1], rest: m[2] }
  m = /^(\d\.\d)\s+([\s\S]*)$/.exec(t)
  if (m) return { kind: 'B', num: m[1], rest: m[2] }
  m = /^([a-d]\))\s+([\s\S]*)$/.exec(t)
  if (m) return { kind: 'D', num: m[1].slice(0, -1), rest: m[2] }
  return { kind: 'N', num: '', rest: t }
}

function chips(inner: string, sep: RegExp): string {
  return inner
    .split(sep)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<span class="chipv">${p}</span>`)
    .join('')
}

export function transformCourse(html: string): string {
  let used = false
  let accent: string | null = null
  const mark = (s: string): string => {
    used = true
    return s
  }

  // En-tête : « # II.1.2 – Titre » → pastille + titre ; sinon simple titre souligné.
  let out = html.replace(/<h1>([\s\S]*?)<\/h1>/, (_whole, inner: string) => {
    const plain = strip(inner)
    const m = TAG.exec(plain)
    if (!m) return `<h1 class="course-title">${inner}</h1>`
    const tag = m[1].replace(/\s+/g, '')
    accent = courseAccent(tag)
    const label = PART_LABELS.find(([re]) => re.test(tag))?.[1] ?? ''
    const title = inner.replace(/^[\s\S]*?[–—-]\s*/, '')
    return mark(
      `<div class="fh"><div class="cbadge${tag.length > 6 ? ' long' : ''}">${tag}</div><div class="meta">${label ? `<div class="part">${label}</div>` : ''}<h1>${title}</h1></div></div>`
    )
  })

  // Titres numérotés (h2, h3 ou h4 : seule la numérotation compte).
  out = out.replace(/<h([2-4])>([\s\S]*?)<\/h\1>/g, (_whole, _lvl: string, inner: string) => {
    const plainStart = inner.replace(/^(?:<[^>]+>)+/, '')
    const c = classify(plainStart)
    const lead = inner.length - plainStart.length
    const body = c.kind === 'N' ? inner : inner.slice(0, lead) + c.rest
    if (c.kind === 'A') return mark(`<h2 class="A"><span class="n">${c.num}</span><span>${body}</span></h2>`)
    if (c.kind === 'B') return mark(`<h3 class="B"><span class="n">${c.num}</span><span>${body}</span></h3>`)
    if (c.kind === 'C') return mark(`<h4 class="C"><span class="pill">${c.num}</span><span>${body}</span></h4>`)
    if (c.kind === 'D') return mark(`<h5 class="D"><span class="cchip">${c.num}</span><span>${body}</span></h5>`)
    const t = strip(inner)
    if (/^(Vocabulaire|Dates?)$/i.test(t)) return `<h3 class="N small">${inner}</h3>`
    return `<h3 class="N">${inner}</h3>`
  })

  // Encadré « Argument » (paragraphe entièrement en gras) et « Fil rouge ».
  out = out.replace(/<p><strong>Argument\s*:\s*([\s\S]*?)<\/strong><\/p>/g, (_w, inner: string) =>
    mark(`<div class="arg"><div class="lab">Argument</div><div class="tx">${cap(inner)}</div></div>`)
  )
  out = out.replace(/<p>Fil rouge\s*:\s*([\s\S]*?)<\/p>/, (_w, inner: string) =>
    mark(`<div class="lead"><span class="lab">Fil rouge</span>${inner}</div>`)
  )
  // Paragraphe de complément web : « ➕ Tout ce chapitre… »
  out = out.replace(/<p>(➕\s*<strong>[\s\S]*?)<\/p>/g, (_w, inner: string) => mark(`<div class="notebox">${inner}</div>`))
  // Sujets de dissertation.
  out = out.replace(/(?:<br\s*\/?>\s*)?<em>Dissert\s*:\s*([\s\S]*?)<\/em>/g, (_w, inner: string) =>
    mark(`<span class="diss"><span class="lab">Dissert</span>${inner}</span>`)
  )

  // Dates en gras → pastille.
  out = out.replace(/<strong>([^<]{1,24})<\/strong>/g, (whole, inner: string) =>
    DATE.test(inner) && !/[a-zé]{11,}/.test(inner) ? mark(`<strong class="d">${inner}</strong>`) : whole
  )

  // Pastilles « + web » et « ⚠ ».
  if (out.includes('➕') || out.includes('⚠')) {
    out = out.replace(/➕/g, '<span class="web">+ web</span>').replace(/⚠/g, '<span class="cwarn">⚠</span>')
    used = true
  }

  // Vocabulaire et dates en étiquettes (liste sur une ligne séparée par « – » ou « · »).
  out = out.replace(/(<h3 class="N small">\s*Vocabulaire\s*<\/h3>\s*)<p>([\s\S]*?)<\/p>/i, (_w, h: string, p: string) =>
    mark(`${h}<div class="cchips">${chips(p, /\s[–—]\s/)}</div>`)
  )
  out = out.replace(/(<h3 class="N small">\s*Dates?\s*<\/h3>\s*)<p>([\s\S]*?)<\/p>/i, (_w, h: string, p: string) =>
    mark(`${h}<div class="cchips dates">${chips(p, /\s·\s/)}</div>`)
  )

  // Tableaux : définitions (« Notion »), repères (dernière colonne « Plan » / « Fiche »), dates (« Date »).
  out = out.replace(/<table>([\s\S]*?)<\/table>/g, (whole, inner: string) => {
    const heads = Array.from(inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)).map((m) => strip(m[1]).toLowerCase())
    const cls: string[] = []
    if (heads[0] === 'notion') cls.push('def')
    else if (heads[0] === 'date') cls.push('dates')
    if (heads.length > 2 && /^(fiche|plan)$/.test(heads[heads.length - 1])) cls.push('ref')
    return cls.length ? mark(`<table class="${cls.join(' ')}">${inner}</table>`) : whole
  })

  if (!used) return html
  const style = accent ? ` style="--ac:${accent}"` : ''
  return `<div class="course"${style}>${out}</div>`
}
