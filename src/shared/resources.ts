/*
 * Catalogue de ressources pour la prépa et le supérieur. Intégré à l'application : le parcourir ne contacte aucun serveur.
 * Un lien ne s'ouvre (dans le navigateur) ou ne se lit (pour en faire des cartes) que quand l'utilisateur le demande.
 * Les adresses ont été testées en ligne, sauf celles marquées `unchecked` (site cité par un utilisateur, non joignable
 * depuis l'ordinateur de test, ou protégé contre les robots).
 */

export const RESOURCE_CATEGORIES = [
  { id: 'python', fr: 'Python & informatique', en: 'Python & computing' },
  { id: 'maths', fr: 'Mathématiques', en: 'Mathematics' },
  { id: 'physique', fr: 'Physique-chimie', en: 'Physics & chemistry' },
  { id: 'hgg', fr: 'Histoire-géo & géopolitique', en: 'History, geography & geopolitics' },
  { id: 'eco', fr: 'Économie & données', en: 'Economics & data' },
  { id: 'lettres', fr: 'Lettres & philosophie', en: 'Literature & philosophy' },
  { id: 'langues', fr: 'Langues & dictionnaires', en: 'Languages & dictionaries' },
  { id: 'concours', fr: 'Concours & annales', en: 'Exams & past papers' }
] as const

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number]['id']

export interface Resource {
  id: string
  title: string
  url: string
  cat: ResourceCategory
  desc: string
  /** Mots qui aident la recherche (matière, niveau, filière). */
  tags: string[]
  /** Adresse non vérifiée depuis notre environnement de test. */
  unchecked?: boolean
}

const r = (id: string, title: string, url: string, cat: ResourceCategory, desc: string, tags: string[], unchecked = false): Resource => ({ id, title, url, cat, desc, tags, ...(unchecked ? { unchecked } : {}) })

export const RESOURCES: Resource[] = [
  // — Python & informatique —
  r('psim', 'psim.fr', 'https://psim.fr', 'python', 'Ressources de Python pour les classes préparatoires (adresse indiquée par un utilisateur de Mnémo).', ['python', 'prépa', 'mp', 'pcsi', 'mpsi', 'info', 'cpge'], true),
  r('pydoc', 'Documentation officielle de Python', 'https://docs.python.org/fr/3/', 'python', 'La référence du langage et de la bibliothèque standard, traduite en français.', ['python', 'doc', 'référence']),
  r('pytutor', 'Python Tutor', 'https://pythontutor.com', 'python', 'Visualise l’exécution d’un programme pas à pas (variables, pile d’appels, listes) : idéal pour comprendre la récursivité et les structures.', ['python', 'visualisation', 'débutant', 'récursivité']),
  r('franceioi', 'France-IOI', 'https://www.france-ioi.org', 'python', 'Cours et exercices d’algorithmique corrigés automatiquement, du niveau débutant aux olympiades.', ['algorithmique', 'python', 'exercices', 'concours']),
  r('euler', 'Project Euler', 'https://projecteuler.net', 'python', 'Problèmes mathématico-informatiques à résoudre par programme, de plus en plus difficiles.', ['python', 'maths', 'algorithmique', 'exercices']),
  r('numpy', 'NumPy : documentation', 'https://numpy.org/doc/', 'python', 'Calcul numérique avec les tableaux : tout ce qu’il faut pour le programme d’informatique en prépa.', ['numpy', 'python', 'calcul']),
  r('mpl', 'Matplotlib : documentation', 'https://matplotlib.org', 'python', 'Tracer des courbes, nuages de points et histogrammes avec Python.', ['matplotlib', 'python', 'graphiques']),
  // — Mathématiques —
  r('exo7', 'Exo7', 'https://exo7.emath.fr', 'maths', 'Cours, exercices corrigés et vidéos de mathématiques du supérieur (algèbre, analyse, probabilités).', ['maths', 'cours', 'exercices', 'sup', 'algèbre', 'analyse']),
  r('bibmath', 'BibM@th', 'https://bibmath.net', 'maths', 'Bibliothèque de maths : cours, fiches, exercices et biographies de mathématiciens.', ['maths', 'fiches', 'cours', 'exercices']),
  r('mathcurve', 'MathCurve', 'https://www.mathcurve.com', 'maths', 'Encyclopédie des courbes et surfaces : équations, propriétés, constructions.', ['maths', 'courbes', 'géométrie']),
  r('culturemath', 'Culturemath (ENS)', 'https://culturemath.ens.fr', 'maths', 'Articles de culture mathématique et ressources pour enseigner et approfondir.', ['maths', 'culture', 'ens']),
  r('imagesmaths', 'Images des Mathématiques (CNRS)', 'https://images.math.cnrs.fr', 'maths', 'Mathématiques de recherche expliquées au grand public : pour s’ouvrir et nourrir sa culture.', ['maths', 'culture', 'cnrs']),
  r('khanmaths', 'Khan Academy (français)', 'https://fr.khanacademy.org', 'maths', 'Cours et exercices progressifs en vidéo : bases, analyse, probabilités, statistiques.', ['maths', 'vidéo', 'débutant', 'stats']),
  r('desmos', 'Desmos', 'https://www.desmos.com/calculator', 'maths', 'Calculatrice graphique en ligne, rapide et simple pour visualiser des fonctions.', ['maths', 'graphique', 'fonctions']),
  r('geogebra', 'GeoGebra', 'https://www.geogebra.org', 'maths', 'Géométrie dynamique, fonctions et calcul : pour explorer et vérifier ses intuitions.', ['maths', 'géométrie', 'fonctions']),
  r('wolfram', 'Wolfram Alpha', 'https://www.wolframalpha.com', 'maths', 'Calcul formel en ligne : dérivées, intégrales, limites, équations (à utiliser pour vérifier, pas pour copier).', ['maths', 'calcul', 'vérifier']),
  // — Physique-chimie —
  r('femto', 'femto-physique', 'https://femto-physique.fr', 'physique', 'Cours de physique du supérieur très soignés, avec animations et exercices.', ['physique', 'cours', 'prépa', 'sup']),
  r('culturesciences', 'Culture Sciences Physique (ENS Lyon)', 'https://culturesciencesphysique.ens-lyon.fr', 'physique', 'Ressources et articles de physique pour approfondir et enseigner.', ['physique', 'ens', 'culture']),
  // — Histoire-géographie & géopolitique —
  r('geoconf', 'Géoconfluences (ENS Lyon)', 'https://geoconfluences.ens-lyon.fr', 'hgg', 'La référence en géographie : dossiers, glossaire, études de cas, cartes. Très utile pour la géopolitique et les mondes contemporains.', ['géographie', 'géopolitique', 'hgg', 'ecg', 'dossiers', 'glossaire']),
  r('gallica', 'Gallica (BnF)', 'https://gallica.bnf.fr', 'hgg', 'Bibliothèque numérique de la BnF : livres anciens, presse, cartes, archives pour les sources historiques.', ['histoire', 'sources', 'archives', 'presse'], true),
  r('herodote', 'Hérodote.net', 'https://www.herodote.net', 'hgg', 'Histoire du monde en articles clairs, avec chronologies et cartes.', ['histoire', 'chronologie', 'hgg']),
  r('diploweb', 'Diploweb', 'https://www.diploweb.com', 'hgg', 'Revue de géopolitique : analyses, cartes et dossiers pour comprendre les rapports de force.', ['géopolitique', 'hgg', 'ecg', 'analyses', 'cartes']),
  r('clesmo', 'Les clés du Moyen-Orient', 'https://www.lesclesdumoyenorient.com', 'hgg', 'Dossiers et fiches sur le Moyen-Orient et l’Afrique du Nord.', ['géopolitique', 'moyen-orient', 'hgg']),
  r('mondediplo', 'Le Monde diplomatique : cartes', 'https://www.monde-diplomatique.fr/cartes', 'hgg', 'Cartes commentées sur les enjeux mondiaux (à citer comme source).', ['cartes', 'géopolitique', 'hgg']),
  r('toute-europe', 'Toute l’Europe', 'https://www.touteleurope.eu', 'hgg', 'Fiches sur l’Union européenne : institutions, politiques, pays, chiffres.', ['europe', 'ue', 'hgg', 'fiches']),
  r('vie-publique', 'Vie publique', 'https://www.vie-publique.fr', 'hgg', 'Fonctionnement des institutions françaises, débats et politiques publiques expliqués.', ['institutions', 'droit', 'politique', 'france']),
  r('persee', 'Persée', 'https://www.persee.fr', 'hgg', 'Articles de revues scientifiques en libre accès (histoire, géographie, sciences humaines).', ['recherche', 'articles', 'histoire', 'géographie']),
  r('cairn', 'Cairn.info', 'https://www.cairn.info', 'hgg', 'Revues et ouvrages de sciences humaines et sociales (une partie en accès libre).', ['recherche', 'articles', 'sciences humaines'], true),
  r('lumni', 'Lumni', 'https://www.lumni.fr', 'hgg', 'Vidéos et ressources pédagogiques de l’audiovisuel public, toutes matières.', ['vidéo', 'cours', 'histoire']),
  // — Économie & données —
  r('insee', 'Insee', 'https://www.insee.fr', 'eco', 'Statistiques officielles françaises : emploi, prix, croissance, démographie. Source de chiffres fiables.', ['économie', 'statistiques', 'données', 'ecg']),
  r('worldbank', 'Banque mondiale : données', 'https://data.worldbank.org', 'eco', 'Indicateurs de développement par pays, téléchargeables (PIB, population, éducation…).', ['économie', 'données', 'monde', 'ecg']),
  r('owid', 'Our World in Data', 'https://ourworldindata.org', 'eco', 'Graphiques et données sur les grands sujets mondiaux (santé, énergie, pauvreté, climat).', ['données', 'monde', 'graphiques', 'hgg', 'ecg']),
  r('datagouv', 'data.gouv.fr', 'https://data.gouv.fr', 'eco', 'Données publiques ouvertes de l’État français.', ['données', 'france', 'open data']),
  // — Lettres & philosophie —
  r('wikisource', 'Wikisource', 'https://fr.wikisource.org', 'lettres', 'Textes littéraires et philosophiques du domaine public, lisibles en ligne.', ['textes', 'littérature', 'philosophie', 'œuvres']),
  r('gutenberg', 'Projet Gutenberg', 'https://www.gutenberg.org', 'lettres', 'Livres du domaine public (en plusieurs langues) à lire ou à télécharger.', ['livres', 'littérature', 'anglais']),
  // — Langues & dictionnaires —
  r('cnrtl', 'CNRTL', 'https://www.cnrtl.fr', 'langues', 'Définitions détaillées, étymologies et synonymes du français.', ['français', 'dictionnaire', 'étymologie', 'synonymes']),
  r('larousse', 'Larousse', 'https://www.larousse.fr', 'langues', 'Dictionnaires et encyclopédie en ligne.', ['dictionnaire', 'français', 'encyclopédie']),
  r('linguee', 'Linguee', 'https://www.linguee.fr', 'langues', 'Traductions avec des exemples réels en contexte (anglais, allemand, espagnol…).', ['traduction', 'anglais', 'langues']),
  // — Concours & annales —
  r('ccinp', 'Concours Commun INP', 'https://www.concours-commun-inp.fr', 'concours', 'Concours des filières scientifiques : programmes, sujets et rapports.', ['concours', 'annales', 'ccinp', 'mp', 'pc', 'psi']),
  r('bce', 'Banque BCE', 'https://www.concours-bce.com', 'concours', 'Concours des écoles de commerce : programmes, annales, rapports de jury.', ['concours', 'annales', 'ecg', 'bce']),
  r('ecricome', 'Ecricome', 'https://www.ecricome.org', 'concours', 'Concours d’écoles de commerce : épreuves, sujets et corrigés.', ['concours', 'annales', 'ecg']),
  r('scei', 'SCEI', 'https://www.scei-concours.fr', 'concours', 'Inscriptions et résultats des concours des grandes écoles d’ingénieurs.', ['concours', 'inscription', 'ingénieur']),
  r('e3a', 'e3a-Polytech', 'https://www.e3a-polytech.fr', 'concours', 'Concours Polytech : programmes, annales et rapports.', ['concours', 'annales', 'pt', 'mp', 'pc']),
  r('banquept', 'Banque PT', 'https://www.banquept.fr', 'concours', 'Concours de la filière PT : sujets, rapports, informations.', ['concours', 'annales', 'pt']),
  r('cahierprepa', 'Cahier de Prépa', 'https://cahier-de-prepa.fr', 'concours', 'Le site des cours et devoirs de nombreuses classes préparatoires (Mnémo sait s’y connecter : menu « Cahier de Prépa »).', ['prépa', 'cours', 'devoirs', 'classe']),
  r('labolycee', 'labolycée', 'https://www.labolycee.org', 'concours', 'Annales corrigées de physique-chimie du bac, utiles pour réviser les bases.', ['annales', 'physique', 'bac'])
]

/** Mots-clés → ressources, avec les accents ignorés. */
const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function searchResources(list: Resource[], query: string, cat: string): Resource[] {
  const words = plain(query).split(/\s+/).filter(Boolean)
  return list.filter((x) => {
    if (cat && x.cat !== cat) return false
    const hay = plain(`${x.title} ${x.desc} ${x.tags.join(' ')} ${new URL(x.url).hostname}`)
    return words.every((w) => hay.includes(w))
  })
}

/** Adresse acceptée pour une source ajoutée à la main : https seulement (« exemple.fr » devient https://exemple.fr). */
export function cleanUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}
