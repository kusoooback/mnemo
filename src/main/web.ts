/*
 * Recherche sur le web pour l'assistant — uniquement quand l'utilisateur l'a activée dans la conversation.
 *
 * - Wikipédia (français puis anglais) via son API officielle : stable, gratuite, sans clé ni compte.
 * - Lecture d'une page web dont l'utilisateur (ou l'assistant, à sa demande) donne l'adresse.
 *
 * Ce qui sort de l'ordinateur : les mots de la recherche (ou l'adresse de la page), rien d'autre.
 * L'agent d'utilisateur annonce honnêtement que c'est Mnémo.
 */

const UA = 'Mnemo/1.0 (application locale de cartes mémoire; https://github.com/kusoooback/mnemo)'

export interface WebHit {
  title: string
  url: string
  text: string
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Wikipédia : erreur ${res.status}`)
  return res.json()
}

async function wikiSearch(query: string, lang: 'fr' | 'en', limit: number): Promise<WebHit[]> {
  const q = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: 'extracts|info',
    explaintext: '1',
    exchars: '2600',
    exlimit: 'max',
    inprop: 'url',
    format: 'json',
    formatversion: '2'
  })
  const data = await getJson(`https://${lang}.wikipedia.org/w/api.php?${q}`)
  const pages = (data?.query?.pages ?? []) as { title: string; fullurl: string; extract?: string; index?: number }[]
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .filter((p) => p.extract && p.extract.length > 80)
    .map((p) => ({ title: p.title, url: p.fullurl, text: p.extract!.replace(/\n{3,}/g, '\n\n').trim() }))
}

/** Résultats utiles pour un cours : Wikipédia en français, complété par l'anglais si rien n'est trouvé. */
export async function webSearch(query: string, limit = 3): Promise<WebHit[]> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!q) return []
  let hits = await wikiSearch(q, 'fr', limit).catch(() => [])
  if (hits.length < 2) hits = [...hits, ...(await wikiSearch(q, 'en', limit).catch(() => []))].slice(0, limit)
  return hits
}

/** Texte lisible d'une page HTML : sans scripts, styles ni balises. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Adresse autorisée : https uniquement, jamais l'ordinateur lui-même ni le réseau local. */
export function safeUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':') || h.startsWith('[')) return null
  return u
}

export async function webPage(raw: string, maxChars = 9000): Promise<WebHit> {
  const u = safeUrl(raw)
  if (!u) throw new Error('Adresse refusée : seules les pages https publiques sont lues.')
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Page inaccessible (erreur ${res.status}).`)
  if (!safeUrl(res.url)) throw new Error('Redirection refusée.')
  const type = res.headers.get('content-type') ?? ''
  if (!/text\/(html|plain)|xhtml/.test(type)) throw new Error('Cette adresse n’est pas une page de texte.')
  const body = (await res.text()).slice(0, 1_500_000)
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() ?? u.hostname
  return { title: htmlToPlain(title), url: res.url, text: htmlToPlain(body).slice(0, maxChars) }
}
