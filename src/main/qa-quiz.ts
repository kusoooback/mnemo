import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Page Quiz dans la vraie application : MNEMO_QA_QUIZ=1, MNEMO_QA_DIR=<sortie>. */
export async function runQuiz(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  try {
    await inner(win, outDir, log)
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'quiz.txt'), log.join(String.fromCharCode(10)))
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
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const count = (sel: string): Promise<number> => js<number>(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
  const click = (sel: string): Promise<boolean> => js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)
  const key = (k: string): Promise<void> => js<void>(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)
  const text = (sel: string): Promise<string> => js<string>(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`)
  const visible = (): Promise<string> =>
    js<string>(`(() => { const c = document.body.cloneNode(true); c.querySelectorAll('.katex-mathml, script, style, textarea, input, select').forEach(n => n.remove()); return c.innerText })()`)
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(900)
  }
  const RAW = /\$|\\\(|\\\[|\\frac|\\int|\\sum/

  await wait(1500)
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('sans rien configurer')); if (b) b.click() })()`)
  await wait(400)

  // Cartes : 12 questions d'histoire (QCM), 4 à trous, 4 de maths (LaTeX).
  const deckId = await invoke<string>('deck.create', 'QA Quiz', null)
  const years: [string, string][] = [
    ['Traité de Versailles ?', '1919'],
    ['Crise de Wall Street ?', '1929'],
    ['Chute du mur de Berlin ?', '1989'],
    ['Révolution russe ?', '1917'],
    ['Début de la Première Guerre mondiale ?', '1914'],
    ['Fin de la Seconde Guerre mondiale ?', '1945'],
    ['Traité de Rome ?', '1957'],
    ['Crise de Suez ?', '1956'],
    ['Conférence de Bandung ?', '1955'],
    ['Indépendance de l’Inde ?', '1947'],
    ['Révolution chinoise ?', '1949'],
    ['Guerre des Six Jours ?', '1967']
  ]
  for (const [front, back] of years) await invoke('note.add', { kind: 'basic', deckId, fields: { front, back }, tags: ['hgg'] })
  for (const t of ['La bataille de {{c1::Verdun}} a eu lieu en 1916.', 'La bataille de {{c1::la Marne}} a eu lieu en 1914.', 'Le traité de {{c1::Versailles}} date de 1919.', 'Le mur de {{c1::Berlin}} tombe en 1989.'])
    await invoke('note.add', { kind: 'cloze', deckId, fields: { text: t, extra: '' }, tags: ['hgg'] })
  for (const [f, b] of [['Dérivée de $x^2$ ?', '$2x$'], ['Dérivée de $x^3$ ?', '$3x^2$'], ['Dérivée de $\\ln x$ ?', '\\(\\frac{1}{x}\\)'], ['Dérivée de $e^x$ ?', '$e^x$']])
    await invoke('note.add', { kind: 'basic', deckId, fields: { front: f, back: b }, tags: ['maths'] })
  await wait(500)

  await go({ name: 'quiz' })
  check(await has('[data-testid="qz-start"]'), 'page Quiz affichée')
  await js(`(() => { const s = document.querySelector('[data-testid="qz-deck"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(deckId)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await wait(900)
  const avail = await text('[data-testid="qz-available"]')
  check(/20/.test(avail), `cartes utilisables comptées (« ${avail} »)`)
  check(await js<boolean>(`document.querySelector('[data-testid="qz-ai"]').disabled`), 'case « réponses piégeuses » désactivée sans IA')
  await shot('quiz-setup')

  // 1. QCM de 10 questions, répondues au clavier.
  await click('[data-testid="qz-mode-mcq"]')
  await js(`[...document.querySelectorAll('.qz-seg button')].find(b => b.textContent.trim() === '10').click()`)
  await click('[data-testid="qz-start"]')
  await wait(900)
  check(await has('[data-testid="qz-question"]'), 'le quiz démarre')
  const n1 = await count('.qz-choice')
  check(n1 === 4, `QCM : 4 choix (${n1})`)
  let raw = false
  let answered = 0
  for (let i = 0; i < 10; i++) {
    const vis = await visible()
    if (RAW.test(vis)) raw = true
    if (i === 0) await shot('quiz-question')
    await key('1')
    await wait(250)
    if (await has('[data-testid="qz-feedback"]')) answered++
    if (i === 0) await shot('quiz-feedback')
    const rights = await count('.qz-choice.right')
    if (rights !== 1) check(false, `question ${i + 1} : ${rights} bonnes réponses affichées`)
    await key('Enter')
    await wait(250)
  }
  check(answered === 10, `10 questions répondues au clavier (${answered})`)
  check(!raw, 'aucun LaTeX brut pendant le quiz')
  check(await has('[data-testid="qz-result"]'), 'écran de résultat')
  const score = await text('[data-testid="qz-score"]')
  const m = /(\d+)\s*\/\s*(\d+)/.exec(score)
  check(!!m && m[2] === '10', `score affiché (« ${score} »)`)
  const good = m ? Number(m[1]) : -1
  const missBlocks = await count('.qz-miss')
  check(missBlocks === 10 - good, `liste des erreurs cohérente (${missBlocks} erreurs, ${good} bonnes)`)
  await shot('quiz-result')
  check(!RAW.test(await visible()), 'résultat : aucun LaTeX brut')

  // Sans « compter dans ma révision », le planning n'a pas bougé.
  const all1 = await invoke<{ rows: { reps: number }[] }>('card.search', { text: '', deckId, state: 'all', tag: null, sort: 'created', limit: 100, offset: 0 })
  check(all1.rows.every((r) => r.reps === 0), 'quiz sans comptage : aucune carte modifiée dans la révision')

  // 2. Refaire les erreurs (si besoin), puis Vrai/Faux.
  if (good < 10) {
    check(await click('.qz-actions .btn-primary'), 'bouton « Refaire les erreurs »')
    await wait(800)
    check(await has('[data-testid="qz-question"]'), 'les erreurs sont rejouées')
    const total = Number((/\/\s*(\d+)/.exec(await text('.qz-count')) ?? [])[1])
    check(total === 10 - good, `quiz de rattrapage : ${total} questions pour ${10 - good} erreurs`)
    await click('.qz-top .btn')
    await wait(400)
  } else {
    await click('.qz-actions .btn')
    await wait(400)
  }

  await click('[data-testid="qz-mode-tf"]')
  await click('[data-testid="qz-start"]')
  await wait(900)
  check((await count('.qz-choices.tf .qz-choice')) === 2 && (await has('.qz-claim')), 'Vrai/Faux : proposition + 2 boutons')
  await key('v')
  await wait(250)
  check(await has('[data-testid="qz-feedback"]'), 'Vrai/Faux : touche V répond')
  await shot('quiz-tf')
  await click('.qz-top .btn')
  await wait(300)

  // 3. Compter dans ma révision : une réponse fausse ou juste modifie la carte.
  await click('[data-testid="qz-review"]')
  await click('[data-testid="qz-mode-mcq"]')
  await js(`[...document.querySelectorAll('.qz-seg button')].find(b => b.textContent.trim() === '5').click()`)
  await click('[data-testid="qz-start"]')
  await wait(900)
  for (let i = 0; i < 5; i++) {
    await key('2')
    await wait(250)
    await key('Enter')
    await wait(250)
  }
  await wait(600)
  const all2 = await invoke<{ rows: { reps: number }[] }>('card.search', { text: '', deckId, state: 'all', tag: null, sort: 'created', limit: 100, offset: 0 })
  const touched = all2.rows.filter((r) => r.reps > 0).length
  check(touched === 5, `quiz avec comptage : 5 cartes passées dans la révision (${touched})`)

  // 4. Cartes à trous et maths dans un quiz de ce seul deck : aucune erreur affichée.
  const errs = await js<string>(`document.body.innerText.includes('Error') ? 'oui' : 'non'`)
  check(errs === 'non', 'aucun message d’erreur à l’écran')
}
