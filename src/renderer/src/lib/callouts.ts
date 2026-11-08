/*
 * Encadrés des fiches de révision. Syntaxe (comme les « alertes » de GitHub) :
 *
 *   > [!DEFINITION] Application injective
 *   > Une application f est injective si …
 *
 * Types : KEY (à retenir), DEFINITION, THEOREM, PROPERTY, METHOD, WARNING (piège), EXAMPLE, NOTE.
 * Fonction pure, appliquée sur le HTML déjà nettoyé : testable sans navigateur.
 */

export const CALLOUT_LABELS: Record<string, string> = {
  key: 'À retenir',
  definition: 'Définition',
  theorem: 'Théorème',
  property: 'Propriété',
  method: 'Méthode',
  warning: 'Piège',
  example: 'Exemple',
  note: 'Remarque'
}

export function transformCallouts(html: string): string {
  return html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (whole, inner: string) => {
    const m = /^\s*<p>\[!([A-Za-z]+)\][ \t]*((?:(?!\n|<\/p>|<br)[\s\S])*)(?:\n|<br\s*\/?>)?([\s\S]*)$/.exec(inner)
    if (!m) return whole
    const type = m[1].toLowerCase()
    const label = CALLOUT_LABELS[type]
    if (!label) return whole
    const raw = m[2].trim()
    // « [!KEY] À retenir » : le titre répète le type, inutile de l'afficher deux fois.
    const plain = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const title = plain(raw) === plain(label) ? '' : raw
    const rest = m[3].replace(/^(?:<br\s*\/?>|\n)+/, '')
    const body = rest.startsWith('</p>') ? rest.slice(4).trim() : rest.trim() ? `<p>${rest.trim()}` : ''
    return (
      `<div class="callout callout-${type}"><div class="callout-head"><span class="callout-kind">${label}</span>` +
      `${title ? `<span class="callout-name">${title}</span>` : ''}</div>${body ? `<div class="callout-body">${body}</div>` : ''}</div>`
    )
  })
}
