/**
 * Feuille de style minimale pour composer une fiche hors de l'application : polices (texte, titres, formules) et styles
 * des formules KaTeX, avec des adresses absolues pour qu'une page ouverte à part retrouve ses fichiers.
 */
export function buildPdfCss(): string {
  const out: string[] = []
  const absolute = (css: string, base: string): string =>
    css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/g, (m, q: string, u: string) => {
      if (/^(data:|https?:|file:)/i.test(u)) return m
      try {
        return `url(${q}${new URL(u, base).href}${q})`
      } catch {
        return m
      }
    })
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    const base = sheet.href ?? location.href
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        const family = rule.style.getPropertyValue('font-family')
        if (/KaTeX|Inter|Newsreader/i.test(family)) out.push(absolute(rule.cssText, base))
      } else if (rule instanceof CSSStyleRule && /\.katex/.test(rule.selectorText)) {
        out.push(rule.cssText)
      }
    }
  }
  return out.join('\n')
}
