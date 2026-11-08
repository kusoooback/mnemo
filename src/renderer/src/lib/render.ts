import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import katex from 'katex'
import { Marked } from 'marked'
import type { NoteKind } from '@shared/types'
import { transformCallouts } from './callouts'
import { splitMath, stashMath } from './math'
import { occlusionBack, occlusionFront } from './occlusion'
import 'katex/dist/katex.min.css'

const langs = { bash, c, cpp, css, java, javascript, json, python, rust, sql, typescript, xml }
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def)
hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' })
hljs.registerAliases(['js'], { languageName: 'javascript' })
hljs.registerAliases(['ts'], { languageName: 'typescript' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['html'], { languageName: 'xml' })
hljs.registerAliases(['rs'], { languageName: 'rust' })

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const l = (lang ?? '').split(/\s/)[0]
      const body =
        l && hljs.getLanguage(l)
          ? hljs.highlight(text, { language: l, ignoreIllegals: true }).value
          : escapeHtml(text)
      return `<pre><code class="hljs">${body}</code></pre>`
    }
  }
})

const URI_OK = /^(?:(?:https?|mailto|mnemo-media|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

const cache = new Map<string, string>()

/** KaTeX ne lève jamais d'erreur : une formule invalide s'affiche en rouge, jamais comme du code brut. */
function renderTex(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' })
}

/**
 * Version « une ligne » pour les listes (bibliothèque, doublons, recherche…) : texte nettoyé et VRAIES formules rendues,
 * jamais de « $x^2$ » brut. `max` limite la longueur du texte visible ; une formule n'est jamais coupée en deux.
 */
export function renderInline(src: string, max = 120): string {
  const key = `inline:${max}:${src}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const clean = src
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ‹code› ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼')
  let used = 0
  let out = ''
  let cut = false
  for (const seg of splitMath(clean)) {
    if (used >= max) {
      cut = true
      break
    }
    if (seg.math) {
      out += renderTex(seg.value, false)
      used += Math.max(4, Math.min(seg.value.length, 24))
    } else {
      const t = seg.value.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ')
      const room = max - used
      out += escapeHtml(t.length > room ? t.slice(0, room) : t)
      used += Math.min(t.length, room)
      if (t.length > room) cut = true
    }
  }
  const html = `${out.trim()}${cut ? '…' : ''}`
  if (cache.size > 400) cache.clear()
  cache.set(key, html)
  return html
}

/**
 * Markdown + LaTeX + code coloré. Les formules sont mises de côté avant le Markdown puis
 * réinsérées après le nettoyage : la sortie de KaTeX est de confiance, le reste est assaini.
 */
export function renderMarkdown(src: string): string {
  const hit = cache.get(src)
  if (hit !== undefined) return hit

  const { text, stash: maths } = stashMath(src, (tex, display) => renderTex(tex, display))

  const html = DOMPurify.sanitize(md.parse(text, { async: false }) as string, {
    ALLOWED_URI_REGEXP: URI_OK
  })
  const out = transformCallouts(html).replace(/@@MATH(\d+)@@/g, (_, i: string) => maths[Number(i)])
  if (cache.size > 400) cache.clear()
  cache.set(src, out)
  return out
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g

export function clozeFront(text: string, ord: number): string {
  return text.replace(CLOZE, (_, n: string, ans: string, hint?: string) =>
    Number(n) === ord ? `<span class="cloze hidden">[${hint ? escapeHtml(hint) : '…'}]</span>` : ans
  )
}

export function clozeBack(text: string, ord: number): string {
  return text.replace(CLOZE, (_, n: string, ans: string) =>
    Number(n) === ord ? `<span class="cloze">${ans}</span>` : ans
  )
}

export interface CardFaces {
  front: string
  answer: string
  /** Rappel de la question affiché plus discrètement au verso (cartes recto/verso). */
  questionDim: string | null
  extra: string
}

export function cardFaces(kind: NoteKind, fields: Record<string, string>, ord: number): CardFaces {
  if (kind === 'occlusion') {
    return { front: occlusionFront(fields, ord), answer: occlusionBack(fields, ord), questionDim: null, extra: fields.extra ? renderMarkdown(fields.extra) : '' }
  }
  if (kind === 'cloze') {
    const text = fields.text ?? ''
    return {
      front: renderMarkdown(clozeFront(text, ord)),
      answer: renderMarkdown(clozeBack(text, ord)),
      questionDim: null,
      extra: fields.extra ? renderMarkdown(fields.extra) : ''
    }
  }
  const reversed = kind === 'basic-reverse' && ord === 1
  const q = (reversed ? fields.back : fields.front) ?? ''
  const a = (reversed ? fields.front : fields.back) ?? ''
  return { front: renderMarkdown(q), answer: renderMarkdown(a), questionDim: renderMarkdown(q), extra: '' }
}
