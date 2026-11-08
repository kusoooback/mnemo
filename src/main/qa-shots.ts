import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Captures du README : MNEMO_QA_SHOTS=1, MNEMO_QA_DIR=<sortie>. Données de démonstration fictives, fenêtre jamais affichée.
 * Les images sont ensuite copiées dans docs/screenshots.
 */
export async function runShots(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const log: string[] = []
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(1100)
  }
  const shot = async (name: string): Promise<void> => {
    await wait(500)
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
    log.push(`ok     ${name}`)
  }
  const key = async (keyCode: string): Promise<void> => {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'char', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await wait(300)
  }
  const day = 86400000

  try {
    await wait(1500)
    await invoke('settings.set', { onboarded: true, tourDone: true, theme: 'light', skin: '', accentColor: '', userName: 'Léa' })
    await js('location.reload()')
    await wait(1500)

    const decks: Record<string, [string, string][]> = {
      'Prépa ECG::Mathématiques::Analyse': [
        ['Définition d’une suite $(u_n)$ **convergente** vers $\\ell$ ?', 'Pour tout $\\varepsilon > 0$, il existe $N$ tel que $n \\geq N \\Rightarrow |u_n - \\ell| \\leq \\varepsilon$.'],
        ['Théorème de la limite monotone ?', 'Toute suite croissante et majorée converge ; croissante et non majorée tend vers $+\\infty$.'],
        ['Dérivée de $x \\mapsto \\ln(u(x))$ ?', '$$\\frac{u\'(x)}{u(x)}$$'],
        ['Formule de Taylor avec reste intégral ?', '$$f(b) = \\sum_{k=0}^{n} \\frac{f^{(k)}(a)}{k!}(b-a)^k + \\int_a^b \\frac{(b-t)^n}{n!} f^{(n+1)}(t)\\,dt$$'],
        ['Théorème des valeurs intermédiaires ?', 'Si $f$ est continue sur $[a,b]$, elle prend toute valeur entre $f(a)$ et $f(b)$.'],
        ['Intégration par parties ?', '$$\\int_a^b u v\' = [uv]_a^b - \\int_a^b u\'v$$']
      ],
      'Prépa ECG::Mathématiques::Algèbre linéaire': [
        ['Théorème du rang ?', '$\\dim E = \\dim \\ker f + \\operatorname{rg} f$'],
        ['Quand une matrice $A \\in \\mathcal{M}_n(\\mathbb{R})$ est-elle inversible ?', 'Quand $\\operatorname{rg}(A) = n$, ou $\\ker A = \\{0\\}$.'],
        ['Valeurs propres d’une matrice triangulaire ?', 'Ses coefficients diagonaux.'],
        ['Une matrice symétrique réelle est…', 'diagonalisable dans une base orthonormée (théorème spectral).']
      ],
      'Prépa ECG::Mathématiques::Probabilités': [
        ['Espérance d’une loi binomiale $\\mathcal{B}(n,p)$ ?', '$np$, et la variance vaut $np(1-p)$.'],
        ['Formule des probabilités totales ?', '$$P(B) = \\sum_i P(A_i)\\,P(B \\mid A_i)$$'],
        ['Inégalité de Bienaymé-Tchebychev ?', '$$P(|X - E(X)| \\geq \\varepsilon) \\leq \\frac{V(X)}{\\varepsilon^2}$$'],
        ['Loi faible des grands nombres ?', 'La moyenne empirique converge en probabilité vers l’espérance.']
      ],
      'Prépa ECG::Économie::Macroéconomie': [
        ['Que mesure le PIB ?', 'La valeur ajoutée totale produite sur un territoire pendant une période.'],
        ['Effet d’éviction ?', 'Quand la dépense publique financée par l’emprunt fait monter les taux et réduit l’investissement privé.'],
        ['Courbe de Phillips ?', 'Relation inverse, à court terme, entre inflation et chômage.'],
        ['Multiplicateur keynésien ?', '$$k = \\frac{1}{1 - c}$$ où $c$ est la propension marginale à consommer.']
      ],
      'Prépa ECG::Histoire-Géographie::Monde contemporain': [
        ['Date de la chute du mur de Berlin ?', '**9 novembre 1989.**'],
        ['Qu’est-ce que la doctrine Truman ?', 'La politique américaine d’endiguement du communisme (1947).'],
        ['Traité de Rome ?', 'Crée la CEE en **1957**.']
      ]
    }
    const ids: string[] = []
    for (const [name, cards] of Object.entries(decks)) {
      const deckId = await invoke<string>('deck.create', name, null)
      for (const [front, back] of cards) await invoke('note.add', { kind: 'basic', deckId, fields: { front, back }, tags: [] })
      ids.push(deckId)
    }
    await invoke('note.add', {
      kind: 'cloze',
      deckId: ids[0],
      fields: { text: 'Une suite {{c1::croissante et majorée}} est {{c2::convergente}}.', extra: 'Théorème de la limite monotone.' },
      tags: []
    })

    // Un peu d'historique de révision pour que les statistiques et l'accueil soient vivants.
    const ratings = [3, 3, 4, 3, 2, 3, 4, 3, 1, 3, 3, 4]
    for (let i = 0; i < ratings.length; i++) {
      const next = await invoke<{ cardId: string } | null>('study.next', null)
      if (!next) break
      await invoke('study.answer', next.cardId, ratings[i], 4000 + i * 700)
    }

    // Cahier de texte : matières, devoirs, colle, cours.
    const maths = await invoke<string>('subject.save', { name: 'Mathématiques' })
    const eco = await invoke<string>('subject.save', { name: 'Économie' })
    const hg = await invoke<string>('subject.save', { name: 'Histoire-Géographie' })
    const now = Date.now()
    await invoke('entry.save', { title: 'DS n°4 — Analyse et probabilités', kind: 'examen', subjectId: maths, dueAt: now + 4 * day, notes: 'Chapitres 8 à 11', status: 'todo', deckIds: [ids[0], ids[2]] })
    await invoke('entry.save', { title: 'Colle d’économie', kind: 'examen', subjectId: eco, dueAt: now + 2 * day, notes: 'Politiques conjoncturelles', status: 'todo', deckIds: [ids[3]] })
    await invoke('entry.save', { title: 'DM — Algèbre linéaire', kind: 'devoir', subjectId: maths, dueAt: now + 6 * day, notes: '', status: 'todo', deckIds: [ids[1]] })
    await invoke('entry.save', { title: 'Fiche : la guerre froide', kind: 'cours', subjectId: hg, dueAt: now - 1 * day, notes: '', status: 'done', deckIds: [ids[4]] })
    await invoke('task.save', { title: 'Refaire les exercices 12 à 15', subjectId: maths, dueAt: now + 1 * day })
    await invoke('task.save', { title: 'Relire le chapitre sur le multiplicateur', subjectId: eco, dueAt: now + 2 * day })

    await js('location.reload()')
    await wait(1500)

    // Clair
    await go({ name: 'home' })
    await shot('accueil')
    await go({ name: 'deck', id: ids[0] })
    await shot('deck')
    await go({ name: 'library' })
    await shot('bibliotheque')
    await go({ name: 'stats' })
    await shot('statistiques')
    await go({ name: 'notebook' })
    await shot('planning')
    await go({ name: 'ai' })
    await shot('ia')
    await go({ name: 'prepa' })
    await shot('cahier-de-prepa')
    await go({ name: 'home' })
    await js(`window.__mnemo.getState().openImport({})`)
    await wait(1800)
    await shot('import')
    await js(`window.__mnemo.getState().openImport(null)`)
    await wait(400)

    // Révision : question puis réponse.
    await go({ name: 'review', deckId: ids[2] })
    await shot('revision-question')
    await key(' ')
    await shot('revision')

    // Sombre
    await js(`window.__mnemo.getState().patchSettings({ theme: 'dark' })`)
    await wait(900)
    await shot('revision-sombre')
    await js(`window.__mnemo.getState().go({ name: 'home' })`)
    await wait(1000)
    await shot('accueil-sombre')
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'shots.txt'), log.join(String.fromCharCode(10)))
  }
}
