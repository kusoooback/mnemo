import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Les formules ne doivent JAMAIS s'afficher en LaTeX brut : MNEMO_QA_MATH=1, MNEMO_QA_DIR=<sortie>.
 * Crée des cartes avec tous les délimiteurs et vérifie bibliothèque, recherche, doublons, statistiques et révision.
 */
export async function runMath(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  try {
    await inner(win, outDir, log)
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'math.txt'), log.join(String.fromCharCode(10)))
  }
}

async function inner(win: BrowserWindow, outDir: string, log: string[]): Promise<void> {
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const shot = async (name: string): Promise<void> => writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  const check = (ok: boolean, what: string): void => {
    log.push(`${ok ? 'ok     ' : 'ECHEC  '} ${what}`)
  }
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(900)
  }
  /** Texte visible de la page SANS le contenu caché de KaTeX (MathML d'accessibilité) : c'est ce que l'œil voit. */
  const visible = (): Promise<string> =>
    js<string>(`(() => { const c = document.body.cloneNode(true); c.querySelectorAll('.katex-mathml, script, style, textarea, input').forEach(n => n.remove()); return c.innerText })()`)
  const katexCount = (): Promise<number> => js<number>(`document.querySelectorAll('.katex-html').length`)
  const RAW = /\$|\\\(|\\\[|\\begin|\\frac|\\int|\\sum|\\alpha|\\sqrt/

  await wait(1500)
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('sans rien configurer')); if (b) b.click() })()`)
  await wait(400)
  const deckId = await invoke<string>('deck.create', 'QA Formules', null)
  const cards: [string, string][] = [
    ['Dérivée de $x^2$ ?', 'C’est $2x$.'],
    ['Primitive avec \\(\\frac{1}{x}\\) ?', '\\(\\ln|x|\\)'],
    ['Somme : \\[\\sum_{k=1}^n k\\]', '$$\\frac{n(n+1)}{2}$$'],
    ['Valeur de $ \\alpha^2 $ avec espaces ?', 'Matrice : \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}'],
    ['Intégrale $\\int_0^1 x\\,dx$ et $\\sqrt{2}$ ?', '$1/2$ puis $\\sqrt{2}$ ≈ 1,41'],
    ['Un prix : 5 $ et 6 $ restent du texte ?', 'Oui : 5 $ et 6 $.']
  ]
  for (const [front, back] of cards) await invoke('note.add', { kind: 'basic', deckId, fields: { front, back }, tags: [] })
  await invoke('note.add', { kind: 'cloze', deckId, fields: { text: 'On a $e^{i\\pi}=${{c1::$-1$}}.', extra: 'Voir \\(e^{i\\pi}+1=0\\)' }, tags: [] })
  // Cas piège : une carte longue dont la coupe tomberait au milieu d'une formule.
  await invoke('note.add', {
    kind: 'basic',
    deckId,
    fields: { front: `${'Texte introductif assez long pour forcer la coupe de la liste. '.repeat(2)} $\\sum_{k=0}^{n} \\binom{n}{k} x^k y^{n-k}$ fin`, back: 'x' },
    tags: []
  })
  await wait(500)

  // 1. Bibliothèque
  await go({ name: 'library' })
  await wait(600)
  let txt = await visible()
  const noPrice = txt.replace(/5 \$ et 6 \$/g, '')
  check(!RAW.test(noPrice), 'bibliothèque : aucun LaTeX brut visible')
  check((await katexCount()) >= 8, `bibliothèque : formules rendues (${await katexCount()})`)
  check(txt.includes('5 $ et 6 $'), 'bibliothèque : les « $ » de prix restent du texte')
  await shot('math-library')

  // 2. Palette (Ctrl+K)
  await js(`window.__mnemo.getState().setPalette(true)`)
  await wait(500)
  await js(`(() => { const i = document.querySelector('.palette input'); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Dérivée'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await wait(900)
  txt = await js<string>(`(() => { const c = document.querySelector('.palette').cloneNode(true); c.querySelectorAll('.katex-mathml, input').forEach(n => n.remove()); return c.innerText })()`)
  check(!RAW.test(txt) && txt.includes('Dérivée'), 'palette : carte trouvée sans LaTeX brut')
  check((await js<number>(`document.querySelectorAll('.palette .katex-html').length`)) >= 1, 'palette : formule rendue')
  await shot('math-palette')
  await js(`window.__mnemo.getState().setPalette(false)`)
  await wait(300)

  // 3. Doublons
  await invoke('note.add', { kind: 'basic', deckId, fields: { front: 'Dérivée de $x^2$ ?', back: 'Encore $2x$' }, tags: [] })
  await go({ name: 'library' })
  const opened = await js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /doublon|duplicate/i.test(x.textContent)); if (!b) return false; b.click(); return true })()`)
  if (opened) {
    await wait(1200)
    const d = await js<string>(`(() => { const m = document.querySelector('.modal') || document.body; const c = m.cloneNode(true); c.querySelectorAll('.katex-mathml').forEach(n => n.remove()); return c.innerText })()`)
    check(!RAW.test(d), 'doublons : aucun LaTeX brut')
    await shot('math-dups')
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(300)
  } else check(false, 'doublons : bouton introuvable')

  // 4. Révision : question puis réponse
  await go({ name: 'review', deckId })
  await wait(1200)
  txt = await visible()
  check(!RAW.test(txt), 'révision (question) : aucun LaTeX brut')
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))`)
  await wait(700)
  txt = await visible()
  check(!RAW.test(txt), 'révision (réponse) : aucun LaTeX brut')
  await shot('math-review')

  // 5. Statistiques (cartes difficiles)
  await go({ name: 'stats' })
  txt = await visible()
  check(!RAW.test(txt), 'statistiques : aucun LaTeX brut')

  // 6. Toutes les cartes une par une en révision : on parcourt le paquet entier
  await go({ name: 'review', deckId })
  let bad = 0
  let seen = 0
  for (let i = 0; i < 9; i++) {
    await wait(500)
    const q = await visible()
    if (!/Afficher|Show|Réponse|Answer|Espace|Space/i.test(q) && !q.trim()) break
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))`)
    await wait(500)
    const a = await visible()
    seen++
    if (RAW.test(a) && !/5 \$ et 6 \$/.test(a)) bad++
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true }))`)
  }
  check(seen > 0 && bad === 0, `révision : ${seen} cartes parcourues, ${bad} avec du LaTeX brut`)
}
