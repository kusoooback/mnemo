import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { startJob } from './jobs'

/**
 * Contrôle de mise en page de tous les écrans : MNEMO_QA_LAYOUT=1, MNEMO_QA_DIR=<sortie>.
 * Pour chaque thème et chaque taille de fenêtre : une capture par écran + détection des débordements.
 */
const SIZES: [number, number][] = [
  [900, 640],
  [1280, 800],
  [1920, 1080]
]

export async function runLayout(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const go = (route: object): Promise<void> => js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
  const click = (text: string): Promise<boolean> =>
    js(`(() => { const el = [...document.querySelectorAll('button, .t-row .a')].find(e => e.textContent && e.textContent.trim().includes(${JSON.stringify(text)})); if (el) { el.click(); return true } return false })()`)
  const report: string[] = []
  const log = (s: string): void => {
    report.push(s)
  }

  await wait(1500)
  await invoke('settings.set', { onboarded: true, theme: 'light', userName: 'Malo', prepaAuto: true, prepaLastSync: Date.now() - 12 * 60000 })
  await js('location.reload()')
  await wait(1300)

  // Données de démonstration : decks hiérarchiques, cartes automatiques avec formules, documents de chaque type.
  await invoke('data.createSample')
  const deck = await invoke<string>('deck.create', 'Prépa ECG::Mathématiques::Ensembles et applications', null)
  const add = (fields: Record<string, string>, kind: 'basic' | 'cloze'): Promise<unknown> => invoke('note.add', { kind, deckId: deck, fields, tags: ['ia-auto', 'mathematiques'] })
  await add({ front: 'Quelle est la définition d’une application $f : E \\to F$ **injective** ?', back: 'Pour tous $x, y \\in E$, $f(x) = f(y) \\Rightarrow x = y$.' }, 'basic')
  await add({ text: 'Une application est {{c1::surjective}} si tout élément de $F$ possède au moins un antécédent.', extra: '' }, 'cloze')
  await add({ text: 'Pour tout {{c1::$x \\in E$}}, on a $f(x) \\in F$.', extra: '' }, 'cloze')
  const files = [join(outDir, 'cours.tex'), join(outDir, 'enonce-DS1.txt'), join(outDir, 'fiche.md'), join(outDir, 'schema.png')]
  writeFileSync(files[0], '\\section{Probabilités}\nSoit $X$ une variable aléatoire. \\[ E(X)=\\sum_k k P(X=k) \\]\n' + 'Texte du cours. '.repeat(40))
  writeFileSync(files[1], 'Durée : 4 heures. Calculatrice interdite.\nExercice 1. Calculer la limite de la suite.\n'.repeat(8))
  writeFileSync(files[2], '# Applications\n\n## À retenir\n- Injective, surjective, bijective.\n\n## Définitions\n- **Injective** : deux éléments distincts ont des images distinctes.\n')
  writeFileSync(files[3], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  const { addMarkdownDocument } = await import('./docfiles')
  const NL = String.fromCharCode(10)
  addMarkdownDocument('Applications : injection, surjection, bijection', ['# Applications : injection, surjection, bijection', '', '> [!KEY] À retenir', '> - Une bijection est injective et surjective.', ''].join(NL))
  addMarkdownDocument('Probabilités conditionnelles', ['# Probabilités conditionnelles', '', '## 1. Définitions', '', '> [!DEFINITION] Probabilité conditionnelle', '> P(A | B) = P(A ∩ B) / P(B)', ''].join(NL))
  const added = await invoke<{ ids: string[] }>('docs.addPaths', files)
  const docs = await invoke<{ id: string; title: string }[]>('docs.list')
  const docId = (t: string): string => docs.find((d) => d.title.includes(t))?.id ?? ''

  // Tâches de fond simulées pour l'accueil.
  const imp = startJob('prepa', 'Import du Cahier de Prépa', { cancellable: true })
  imp.set(37, 119, 'Création des cartes · Fonctions de R dans R - continuité')
  startJob('cards', 'Cartes : Ensembles et applications').finish('9 cartes créées.')
  void added

  const PAGES: [string, () => Promise<void>][] = [
    ['home', () => go({ name: 'home' })],
    ['library', () => go({ name: 'library' })],
    ['stats', () => go({ name: 'stats' })],
    ['prepa-import', () => go({ name: 'prepa' })],
    ['prepa-docs', async () => { await go({ name: 'prepa' }); await wait(300); await click('Mes documents') }],
    ['notebook', () => go({ name: 'notebook' })],
    ['sheets', () => go({ name: 'sheets' })],
    ['ai-text', () => go({ name: 'ai' })],
    ['ai-topic', async () => { await go({ name: 'ai' }); await wait(300); await click('Depuis un sujet') }],
    ['settings', () => go({ name: 'settings' })],
    ['integrations', () => go({ name: 'integrations' })],
    ['sync', () => go({ name: 'sync' })],
    ['deck', async () => go({ name: 'deck', id: deck })],
    ['doc-tex', () => go({ name: 'doc', id: docId('cours') })],
    ['doc-fiche', () => go({ name: 'doc', id: docId('fiche') })],
    ['doc-exercice', () => go({ name: 'doc', id: docId('enonce') })],
    ['review', async () => { await go({ name: 'review', deckId: deck }) }]
  ]

  const OVERFLOW = `(() => {
    const W = innerWidth
    const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(o.overflowX)) return true } return false }
    const out = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      if (cs.position !== 'fixed' && (r.right > W + 1 || r.left < -1) && !clipped(el)) out.push('hors écran: ' + el.tagName + '.' + String(el.className).slice(0, 40) + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']')
      if (!el.children.length && el.textContent && el.textContent.trim().length > 3 && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && cs.display !== 'inline') out.push('texte qui déborde: ' + String(el.textContent).trim().slice(0, 40))
    }
    // La barre latérale doit avoir exactement la couleur du reste de l'application.
    const sb = document.querySelector('.sidebar'), main = document.querySelector('.main')
    if (sb && main && getComputedStyle(sb).backgroundColor !== getComputedStyle(main).backgroundColor) out.push('barre latérale d une autre couleur: ' + getComputedStyle(sb).backgroundColor + ' / ' + getComputedStyle(main).backgroundColor)
    return { hscroll: document.documentElement.scrollWidth > W + 1, offenders: out.slice(0, 6) }
  })()`

  let problems = 0
  for (const theme of ['light', 'dark'] as const) {
    await js(`window.__mnemo.getState().patchSettings({ theme: ${JSON.stringify(theme)} })`)
    await wait(700)
    for (const [w, h] of SIZES) {
      win.setMinimumSize(300, 300)
      if (win.isMaximized()) win.unmaximize()
      if (win.isFullScreen()) win.setFullScreen(false)
      win.setContentSize(w, h)
      await wait(900)
      const real = await js<number>('innerWidth')
      log(`-- fenêtre demandée ${w}x${h}, largeur réelle ${real} (zoom ${await js<number>('Math.round(devicePixelRatio * 100) / 100')})`)
      for (const [name, nav] of PAGES) {
        await nav()
        await wait(name.startsWith('doc') || name === 'review' ? 1500 : 650)
        if (name === 'review') {
          wc.sendInputEvent({ type: 'keyDown', keyCode: ' ' })
          wc.sendInputEvent({ type: 'char', keyCode: ' ' })
          wc.sendInputEvent({ type: 'keyUp', keyCode: ' ' })
          await wait(400)
        }
        const r = await js<{ hscroll: boolean; offenders: string[] }>(OVERFLOW)
        const bad = r.hscroll || r.offenders.length > 0
        if (bad) problems++
        log(`${bad ? 'PROBLEME' : 'ok      '} ${theme} ${w}x${h} ${name}${r.hscroll ? ' [défilement horizontal]' : ''}${r.offenders.length ? ' ' + JSON.stringify(r.offenders) : ''}`)
        // Captures conservées pour les tailles et thèmes utiles à l'œil.
        if ((w === 1280 && theme === 'light') || (w === 900 && theme === 'dark') || (w === 1920 && theme === 'dark' && ['home', 'ai-topic', 'deck'].includes(name))) {
          writeFileSync(join(outDir, `${theme}-${w}-${name}.png`), (await wc.capturePage()).toPNG())
        }
      }
    }
  }
  log(`\n${problems} écran(s) avec un problème de mise en page.`)
  writeFileSync(join(outDir, 'layout.txt'), report.join('\n'))
}
