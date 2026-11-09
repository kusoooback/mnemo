import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { basename, extname, join, relative, resolve, sep } from 'path'
import { documentText } from './importer'

/*
 * Dossier permanent de l'assistant : l'utilisateur en choisit un (ses cours, un dossier Obsidian…) et l'assistant peut
 * le parcourir, chercher dedans et lire un fichier à tout moment. Lecture seule, strictement limitée à ce dossier :
 * aucun chemin hors du dossier n'est jamais ouvert, et rien n'est modifié ni envoyé ailleurs qu'au modèle d'IA choisi.
 */

/** Lus tels quels. */
const TEXT = new Set(['txt', 'md', 'markdown', 'tex', 'csv', 'tsv'])
/** Lus par les lecteurs de documents de l'application (PDF avec OCR si besoin, Word, PowerPoint…). */
const DOCS = new Set(['pdf', 'docx', 'pptx', 'odt', 'odp', 'rtf', 'epub', 'html', 'htm'])
const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'appdata'])
const MAX_FILES = 3000
const MAX_DEPTH = 6
const READ_CAP = 12_000

export interface FolderFile {
  rel: string
  size: number
  ext: string
}

const extOf = (p: string): string => extname(p).slice(1).toLowerCase()
const readable = (p: string): boolean => TEXT.has(extOf(p)) || DOCS.has(extOf(p))

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Fichiers lisibles du dossier (sous-dossiers compris, sans suivre les liens ni les dossiers cachés). */
export function listFolderFiles(root: string): FolderFile[] {
  const out: FolderFile[] = []
  const walk = (dir: string, depth: number): void => {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))) {
      if (out.length >= MAX_FILES) return
      if (name.startsWith('.') || name.startsWith('~$')) continue
      const full = join(dir, name)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name.toLowerCase())) walk(full, depth + 1)
      } else if (st.isFile() && readable(name)) out.push({ rel: relative(root, full).split(sep).join('/'), size: st.size, ext: extOf(name) })
    }
  }
  walk(root, 0)
  return out
}

/** Chemin demandé par le modèle -> chemin réel, uniquement s'il est bien DANS le dossier (jamais de « .. » ni de lien sortant). */
export function resolveInFolder(root: string, rel: string): string {
  const base = realpathSync(root)
  const full = realpathSync(resolve(base, rel))
  if (full !== base && !full.startsWith(base + sep)) throw new Error('Ce fichier est en dehors du dossier connecté.')
  return full
}

function findFile(root: string, query: string): string | null {
  const files = listFolderFiles(root)
  const q = query.trim().replace(/\\/g, '/')
  const exact = files.find((f) => f.rel.toLowerCase() === q.toLowerCase())
  if (exact) return exact.rel
  const nq = norm(q.replace(/\.[a-z0-9]{2,5}$/i, ''))
  if (!nq) return null
  const scored = files
    .map((f) => {
      const nf = norm(basename(f.rel).replace(/\.[^.]+$/, ''))
      const score = nf === nq ? 3 : nf.includes(nq) ? 2 : nq.includes(nf) && nf.length > 3 ? 1.5 : nq.split(' ').filter((w) => w.length > 3 && nf.includes(w)).length / 10
      return { f, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.f.rel ?? null
}

/** Aperçu glissé dans le contexte de l'assistant : il sait toujours qu'un dossier est connecté et ce qu'il contient. */
export function folderOverview(root: string): string {
  let files: FolderFile[]
  try {
    files = listFolderFiles(root)
  } catch {
    return `DOSSIER CONNECTÉ : « ${root} » (introuvable ou illisible pour le moment).`
  }
  const shown = files.slice(0, 40).map((f) => `- ${f.rel}`)
  return `DOSSIER CONNECTÉ (accès permanent, en lecture seule) : « ${basename(root) || root} », ${files.length} fichier(s) lisible(s)${files.length > 40 ? ', les 40 premiers :' : ' :'}\n${shown.join('\n') || '(vide)'}\nUtilise [[dossier: mots à chercher]] pour chercher dedans et [[lire_fichier: chemin du fichier]] pour lire un fichier.`
}

/** Cherche des mots dans les noms de fichiers et le contenu des fichiers texte. */
function searchFolder(root: string, query: string): string {
  const files = listFolderFiles(root)
  if (!query.trim()) {
    return `Fichiers du dossier (${files.length}) :\n${files.slice(0, 80).map((f) => `- ${f.rel}`).join('\n') || '(vide)'}`
  }
  const terms = norm(query).split(' ').filter((w) => w.length >= 3)
  if (!terms.length) return 'Précise des mots à chercher (3 lettres ou plus).'
  const hits: { rel: string; score: number; snippet: string }[] = []
  let scanned = 0
  for (const f of files) {
    const nameHits = terms.filter((t) => norm(f.rel).includes(t)).length
    let content = 0
    let snippet = ''
    if (TEXT.has(f.ext) && f.size <= 400_000 && scanned < 400) {
      scanned++
      try {
        const text = readFileSync(resolveInFolder(root, f.rel), 'utf8')
        const nt = norm(text)
        content = terms.filter((t) => nt.includes(t)).length
        if (content) {
          const line = text.split(/\r?\n/).find((l) => terms.some((t) => norm(l).includes(t)))
          snippet = (line ?? '').trim().slice(0, 200)
        }
      } catch {
        /* fichier illisible : on l'ignore */
      }
    }
    const score = nameHits * 3 + content
    if (score > 0) hits.push({ rel: f.rel, score, snippet })
  }
  hits.sort((a, b) => b.score - a.score)
  if (!hits.length) return `Aucun fichier du dossier ne correspond à « ${query} ».`
  return hits
    .slice(0, 8)
    .map((h) => `- ${h.rel}${h.snippet ? ` : « ${h.snippet} »` : ''}`)
    .join('\n')
}

async function readFolderFile(root: string, query: string): Promise<string> {
  const rel = findFile(root, query)
  if (!rel) return `Fichier « ${query} » introuvable dans le dossier. Utilise [[dossier: …]] pour chercher.`
  const full = resolveInFolder(root, rel)
  if (statSync(full).size > 60_000_000) return `Le fichier « ${rel} » est trop gros pour être lu.`
  const text = TEXT.has(extOf(full)) ? readFileSync(full, 'utf8') : await documentText(full)
  const body = text.trim()
  if (!body) return `Le fichier « ${rel} » ne contient aucun texte lisible.`
  return `[fichier ${rel}]\n${body.slice(0, READ_CAP)}${body.length > READ_CAP ? '\n[… fichier long : début seulement]' : ''}`
}

/** Outils de l'assistant sur le dossier : `dossier` (chercher / lister) et `lire_fichier`. */
export async function folderTool(root: string, tool: 'dossier' | 'lire_fichier', arg: string): Promise<{ text: string; label: string }> {
  if (tool === 'dossier') return { text: `[dossier « ${arg || 'liste'} »]\n${searchFolder(root, arg)}`, label: arg || basename(root) }
  const text = await readFolderFile(root, arg)
  return { text, label: arg }
}
