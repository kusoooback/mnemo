import { aiCall, aiStatus, extractJson } from './ai'

/*
 * Tri des documents : est-ce un vrai cours à apprendre, ou un énoncé, un corrigé, une information pratique ?
 * Seuls les cours, méthodes et listes de vocabulaire donnent des cartes et des fiches.
 * Les règles sur le titre sont fiables et gratuites ; l'IA tranche les cas flous et nomme le chapitre.
 */

export type DocCategory = 'cours' | 'methode' | 'vocabulaire' | 'exercices' | 'corrige' | 'admin' | 'autre'
export const CATEGORIES: DocCategory[] = ['cours', 'methode', 'vocabulaire', 'exercices', 'corrige', 'admin', 'autre']
/** Catégories dont on tire des cartes et des fiches. */
export const CARD_CATEGORIES: ReadonlySet<string> = new Set(['cours', 'methode', 'vocabulaire'])

// La frontière de mot de JavaScript ignore les lettres accentuées en fin de mot (corrigé) : on borne avec les lettres Unicode.
const word = (src: string, flags = 'iu'): RegExp => new RegExp(`(?<!\\p{L})(?:${src})(?!\\p{L})`, flags)

const ADMIN = word(String.raw`colles? semaine \d+|charte|s[ée]ances? d.info|dates? des|groupes?|trin[ôo]mes?|colloscope|emploi du temps|planning|liens? utiles|contacts?|inscriptions?|r[èe]glement|rentr[ée]e|pr[ée]sentation|bibliographie|programmes? de colles?|ordre de passage|liste (des|de)|calendrier|informations?`)
const CORRIGE = word(String.raw`corrig[ée]s?|correction|solutions?|r[ée]ponses? aux`)
const EXERCICES = word(String.raw`exos?|exercices?|feuilles?( d.exercices?)?|td|dm|devoirs?|ds|dst|sujets?|annales?|colles?|qcm|quiz|tp|concours blanc|entra[iî]nement`)
const VOCABULAIRE = word(String.raw`vocabulaire|vocab|lexique|conjugaison|d[ée]clinaisons?|verbes?|grammaire|expressions?`)
const METHODE = word(String.raw`m[ée]thodo(logie)?|m[ée]thodes?|conseils|structurer|r[ée]diger|dissertation|comment (faire|r[ée]diger|r[ée]ussir)|r[ée]ussir`)
const COURS = word(String.raw`cours|chap(itre)?s?|r[ée]sum[ée]s?|synth[èe]se|fiches?|cm|polycop[ié]?|le[çc]ons?|notes? de cours|th[ée]or[èe]mes?|d[ée]finitions?`)

/** Dossiers génériques : ils ne disent rien du sujet traité. */
const GENERIC_FOLDER = /^(distanciel|dm|ds|td|colles?|g[ée]n[ée]ral|divers|documents?( annexes?| [àa] t[ée]l[ée]charger)?|ann[ée]e|documents? ann[ée]e|corrig[ée]s?|exercices?|feuilles? d.exercices?|programmes? de colles?|r[ée]ponses? aux exercices?|m[ée]thodologie|revues? de presse|presse actualit[ée]|liens? utiles|info|r[ée]visions?|ds et corrig[ée]s|r[ée]sum[ée]|synth[èe]se)$/i

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Catégorie évidente d'après un texte court (titre ou nom de dossier), ou null. */
export function categoryFromName(raw: string): DocCategory | null {
  const name = raw.normalize('NFC') // un nom de fichier venu d'un Mac peut être en forme décomposée (e + accent)
  if (ADMIN.test(name)) return 'admin'
  if (CORRIGE.test(name)) return 'corrige'
  if (EXERCICES.test(name)) return 'exercices'
  if (VOCABULAIRE.test(name)) return 'vocabulaire'
  if (METHODE.test(name)) return 'methode'
  if (COURS.test(name)) return 'cours'
  return null
}

const strong = (c: DocCategory | null): c is 'admin' | 'exercices' | 'corrige' => c === 'admin' || c === 'exercices' || c === 'corrige'

/** Catégorie évidente d'après le chemin du dossier (DS, DM, TD, colles, corrigés…) : seulement ce qui n'est pas à apprendre. */
export function categoryFromFolder(folder: string): DocCategory | null {
  for (const seg of folder.split(' / ').reverse()) {
    const c = categoryFromName(seg)
    if (strong(c)) return c
  }
  return null
}

/** Ce que dit le début du document : « Durée : 4 h », « Calculatrice interdite », « Corrigé »… (un sujet ou un corrigé, pas un cours). */
export function categoryFromText(text: string): DocCategory | null {
  const head = text.slice(0, 700).normalize('NFC')
  if (/corrig[ée]|proposition de corrig|bar[èe]me|[ée]l[ée]ments de correction/i.test(head.slice(0, 350))) return 'corrige'
  if (/(dur[ée]e|temps)\s*:?\s*\d+\s*h|calculatrice|aucun document|concours|\bsujet\b|^\s*(exercice|probl[èe]me)\s*(1|i|un)\b|^\s*(DS|DM|TD)\s*\d/im.test(head)) return 'exercices'
  return null
}

const NOISE = word(String.raw`fin du cours|cours|chapitre|chap|exercices?|corrig[ée]s?|correction|feuille|td|dm|ds|dst|s\d+|semaine \d+|partie \d+|doc|document|n°?\s?\d+`, 'giu')

/** Nom de chapitre déduit du titre ou du dossier quand l'IA n'est pas disponible. */
export function fallbackChapter(title0: string, folder: string): string {
  const title = title0.normalize('NFC')
  const fromTitle = title
    .replace(/(?<=\p{L})\d{1,2}(?!\d)/gu, ' ')
    .replace(NOISE, ' ')
    .replace(/(?<!\p{N})\d{1,3}(?!\p{N})/gu, ' ') // petits numéros d'ordre, mais pas les années
    .replace(/[_\-–—.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (fromTitle.length >= 4) return capitalize(fromTitle).slice(0, 60)
  const first = folder.split(' / ')[0]?.trim() ?? ''
  if (first && !GENERIC_FOLDER.test(first)) return capitalize(first).slice(0, 60)
  return 'Divers'
}

const capitalize = (s: string): string => {
  // Titre tout en majuscules : on le remet en minuscules pour que les noms de chapitre restent lisibles.
  const t = s === s.toUpperCase() && s.replace(/[^A-ZÀ-Ý]/g, '').length > 4 ? s.toLowerCase() : s
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

function cleanChapter(raw: string): string {
  const c = raw
    .replace(/^(chapitre|chap\.?|partie|le|la|les)\s*\d*\s*[:\-–.]?\s*/i, '')
    .replace(/["«»“”]/g, '')
    .replace(/[.\s]+$/g, '')
    .trim()
  if (c.length < 3 || c.length > 70) return ''
  if (/^(document|cours|g[ée]n[ée]ral|autre|divers|chapitre|sans titre)$/i.test(c)) return ''
  return capitalize(c)
}

/** Réutilise l'orthographe d'un chapitre déjà connu s'il s'agit du même (majuscules et accents près). */
function matchKnown(chapter: string, known: string[]): string {
  const k = normalize(chapter)
  return known.find((x) => normalize(x) === k) ?? chapter
}

const SCHEMA = {
  type: 'object',
  properties: { category: { enum: CATEGORIES }, chapter: { type: 'string' } },
  required: ['category', 'chapter']
}

export interface Triage {
  category: DocCategory
  chapter: string
  by: 'titre' | 'dossier' | 'contenu' | 'ia' | 'regles'
}

export async function triageDocument(
  d: { title: string; subject: string; folder: string; text: string },
  knownChapters: string[]
): Promise<Triage> {
  const byTitle = categoryFromName(d.title)
  const chapterGuess = matchKnown(fallbackChapter(d.title, d.folder), knownChapters)
  // Le titre est fiable pour écarter ce qui n'est pas à apprendre.
  if (byTitle === 'admin' || byTitle === 'exercices' || byTitle === 'corrige') return { category: byTitle, chapter: chapterGuess, by: 'titre' }
  if (d.text.trim().length < 200) return { category: 'autre', chapter: chapterGuess, by: 'regles' }
  // Sans mot-clé de cours dans le titre, le dossier (DS, DM, colles, corrigés…) puis le contenu du document tranchent.
  if (!byTitle) {
    const byFolder = categoryFromFolder(d.folder)
    if (byFolder) return { category: byFolder, chapter: chapterGuess, by: 'dossier' }
    const byText = categoryFromText(d.text)
    if (byText) return { category: byText, chapter: chapterGuess, by: 'contenu' }
  }

  if (aiStatus().ready) {
    try {
      const system = `Tu tries les documents d'une classe préparatoire pour un étudiant qui veut réviser.
Catégories : "cours" (notions à apprendre : définitions, théorèmes, concepts, dates), "methode" (méthodologie : rédiger, structurer, conseils), "vocabulaire" (vocabulaire, conjugaison, grammaire), "exercices" (énoncés, TD, DM, DS, concours blancs, sujets de colle : rien à apprendre par cœur), "corrige" (corrigés, solutions, corrections de DS ou de DM : rien à apprendre par cœur), "admin" (informations pratiques : groupes, planning, programmes, liens), "autre" (peu de contenu ou sans intérêt pour réviser).
"chapter" : le nom court (2 à 5 mots) du chapitre ou de la notion principale, par exemple "Ensembles et applications" ou "Le Brexit". Ce n'est ni le nom du fichier ni "Chapitre 1".
Réponds uniquement avec du JSON : {"category":"...","chapter":"..."}.`
      const user = `Matière : ${d.subject}\nTitre du fichier : ${d.title}\nDossier : ${d.folder || '(racine)'}\n${knownChapters.length ? `Chapitres déjà connus dans cette matière : ${knownChapters.slice(0, 40).join(' ; ')}. Reprends exactement l'un d'eux si le document traite du même sujet.\n` : ''}\nDébut du document :\n---\n${d.text.slice(0, 1800)}\n---`
      const reply = await aiCall('tri de document', system, user, 120, true, SCHEMA)
      const j = extractJson(reply) as { category?: string; chapter?: string }
      const category = (CATEGORIES as string[]).includes(j.category ?? '') ? (j.category as DocCategory) : (byTitle ?? 'cours')
      const chapter = matchKnown(cleanChapter(j.chapter ?? '') || chapterGuess, knownChapters)
      return { category, chapter, by: 'ia' }
    } catch {
      /* IA indisponible ou réponse illisible : on retombe sur les règles */
    }
  }
  const byFolder = categoryFromName(d.folder.split(' / ')[0] ?? '')
  return { category: byTitle ?? (byFolder === 'admin' ? 'admin' : (byFolder ?? 'cours')), chapter: chapterGuess, by: 'regles' }
}
