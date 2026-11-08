/**
 * Repérage des formules LaTeX dans un texte de carte (sans dépendre de KaTeX ni du DOM, donc testable).
 * Délimiteurs reconnus : $$…$$, \[…\], \(…\), $…$ et les environnements \begin{…}…\end{…}.
 * L'utilisateur ne doit jamais voir de LaTeX brut : tout ce qui ressemble à une formule est rendu.
 */

export interface MathSeg {
  /** true = formule (tex), false = texte ordinaire. */
  math: boolean
  value: string
  display?: boolean
}

const ENV = 'equation\\*?|align\\*?|aligned|gather\\*?|multline\\*?|eqnarray\\*?|cases|[pbBvV]?matrix|array|split'

/** Un « $…$ » est une formule s'il est collé au texte (pas « 5 $ et 6 $ »), ou s'il contient visiblement du LaTeX. */
function inlineOk(tex: string): boolean {
  if (!tex.trim()) return false
  if (!/^\s|\s$/.test(tex)) return true
  return /[\\^_{}]/.test(tex)
}

export function splitMath(src: string): MathSeg[] {
  const segs: MathSeg[] = []
  // Une seule passe, de gauche à droite : le premier délimiteur rencontré gagne.
  const re = new RegExp(
    [
      String.raw`\$\$([\s\S]+?)\$\$`, // 1
      String.raw`\\\[([\s\S]+?)\\\]`, // 2
      String.raw`\\\(([\s\S]+?)\\\)`, // 3
      String.raw`\\begin\{(${ENV})\}[\s\S]+?\\end\{\4\}`, // 4 (nom) + corps entier
      String.raw`\$([^$\n]+?)\$(?!\d)` // 5
    ].join('|'),
    'g'
  )
  let last = 0
  let m: RegExpExecArray | null
  const pushText = (s: string): void => {
    if (s) segs.push({ math: false, value: s })
  }
  while ((m = re.exec(src))) {
    if (m[5] !== undefined && !inlineOk(m[5])) {
      // « $ » isolé (prix, etc.) : on avance d'un caractère et on le garde comme texte.
      re.lastIndex = m.index + 1
      continue
    }
    pushText(src.slice(last, m.index))
    if (m[1] !== undefined) segs.push({ math: true, value: m[1].trim(), display: true })
    else if (m[2] !== undefined) segs.push({ math: true, value: m[2].trim(), display: true })
    else if (m[3] !== undefined) segs.push({ math: true, value: m[3].trim(), display: false })
    else if (m[4] !== undefined) segs.push({ math: true, value: m[0], display: true })
    else segs.push({ math: true, value: (m[5] as string).trim(), display: false })
    last = m.index + m[0].length
  }
  pushText(src.slice(last))
  return segs
}

/**
 * Remplace chaque formule par un jeton, via `render`, en laissant le reste intact (pour le Markdown).
 * Les blocs de code (``` et `…`) ne sont pas touchés.
 */
export function stashMath(src: string, render: (tex: string, display: boolean) => string): { text: string; stash: string[] } {
  const stash: string[] = []
  const codes: string[] = []
  const protectedSrc = src.replace(/```[\s\S]*?```|`[^`\n]+`/g, (c) => {
    codes.push(c)
    return `@@CODE${codes.length - 1}@@`
  })
  const text = splitMath(protectedSrc)
    .map((s) => {
      if (!s.math) return s.value
      stash.push(render(s.value, !!s.display))
      return `@@MATH${stash.length - 1}@@`
    })
    .join('')
    .replace(/@@CODE(\d+)@@/g, (_m, i: string) => codes[Number(i)])
  return { text, stash }
}
