/**
 * Aperçu LaTeX rapide : convertit un document .tex courant en Markdown (que l'application sait déjà afficher, formules
 * comprises). Ce n'est pas un compilateur : les commandes inconnues sont simplement retirées.
 */
export function texToMarkdown(src: string): string {
  let s = src.replace(/(^|[^\\])%.*$/gm, '$1')
  const begin = s.indexOf('\\begin{document}')
  if (begin >= 0) s = s.slice(begin + '\\begin{document}'.length)
  s = s.replace(/\\end\{document\}/, '')
  const stash: string[] = []
  const keep = (m: string): string => {
    stash.push(m)
    return `\u0000${stash.length - 1}\u0000`
  }
  // Les formules sont mises de côté pour ne pas être abîmées par les remplacements suivants.
  s = s
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_m, _e, body: string) => keep(`$$${body.trim()}$$`))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, body: string) => keep(`$$${body.trim()}$$`))
    .replace(/\$\$([\s\S]*?)\$\$/g, (m) => keep(m))
    .replace(/\$([^$\n]+?)\$/g, (m) => keep(m))
  s = s
    .replace(/\\(?:title|author|date)\{([^}]*)\}/g, (_m, t: string) => `\n# ${t}\n`)
    .replace(/\\maketitle/g, '')
    .replace(/\\chapter\*?\{([^}]*)\}/g, '\n# $1\n')
    .replace(/\\section\*?\{([^}]*)\}/g, '\n## $1\n')
    .replace(/\\subsection\*?\{([^}]*)\}/g, '\n### $1\n')
    .replace(/\\(?:sub)?paragraph\*?\{([^}]*)\}/g, '\n**$1** ')
    .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
    .replace(/\\(?:emph|textit)\{([^}]*)\}/g, '*$1*')
    .replace(/\\underline\{([^}]*)\}/g, '$1')
    .replace(/\\texttt\{([^}]*)\}/g, '`$1`')
    .replace(/\\begin\{(?:itemize|enumerate|description)\}/g, '\n')
    .replace(/\\end\{(?:itemize|enumerate|description)\}/g, '\n')
    .replace(/\\item\s*(?:\[([^\]]*)\])?/g, (_m, label: string | undefined) => `\n- ${label ? `**${label}** ` : ''}`)
    .replace(/\\begin\{(theorem|definition|proposition|lemma|lemme|corollary|corollaire|remark|remarque|example|exemple|proof|preuve)\}(?:\[([^\]]*)\])?/gi, (_m, k: string, t: string | undefined) => `\n> **${k[0].toUpperCase()}${k.slice(1)}**${t ? ` (${t})` : ''}. `)
    .replace(/\\end\{(?:theorem|definition|proposition|lemma|lemme|corollary|corollaire|remark|remarque|example|exemple|proof|preuve)\}/gi, '\n')
    .replace(/\\\\(\[[^\]]*\])?/g, '  \n')
    .replace(/\\(?:label|ref|cite|index|newpage|clearpage|noindent|centering|hline)(?:\{[^}]*\})?/g, '')
    .replace(/\\(?:begin|end)\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^}]*)\}/g, '$1')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/~/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)]).trim()
}
