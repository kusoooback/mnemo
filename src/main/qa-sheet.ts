import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Rendu d'une fiche de révision (encadrés, tableau, formules) : MNEMO_QA_SHEET=1, MNEMO_QA_DIR=<sortie>. */
export async function runSheet(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  await wait(1500)
  await invoke('settings.set', { onboarded: true })
  await js('location.reload()')
  await wait(1300)
  const md = [
    '# Applications : injection, surjection, bijection',
    '',
    '*Comment une fonction associe les éléments de deux ensembles, et pourquoi la bijection est la notion centrale.*',
    '',
    '> [!KEY] À retenir',
    '> - Une application $f : E \\to F$ associe à chaque élément de $E$ **un seul** élément de $F$.',
    '> - Elle est **bijective** si elle est à la fois injective et surjective.',
    '> - Une bijection admet une application réciproque $f^{-1}$.',
    '',
    '## 1. Définitions',
    '',
    '> [!DEFINITION] Application injective',
    '> $f$ est **injective** si deux éléments distincts de $E$ ont des images distinctes :',
    '> $$\\forall x, y \\in E, \\; f(x) = f(y) \\Rightarrow x = y$$',
    '',
    '> [!DEFINITION] Application surjective',
    '> $f$ est **surjective** si tout élément de $F$ possède au moins un antécédent.',
    '',
    '| Notion | Condition | Intuition |',
    '| --- | --- | --- |',
    '| Injective | $f(x) = f(y) \\Rightarrow x = y$ | pas de « collision » |',
    '| Surjective | $f(E) = F$ | rien n’est oublié |',
    '| Bijective | injective et surjective | correspondance parfaite |',
    '',
    '## 2. Propriétés et théorèmes',
    '',
    '> [!THEOREM] Caractérisation de la bijection',
    '> $f$ est bijective si et seulement s’il existe $g : F \\to E$ telle que $g \\circ f = \\mathrm{Id}_E$ et $f \\circ g = \\mathrm{Id}_F$.',
    '',
    '> [!PROPERTY] Composée de bijections',
    '> Si $f$ et $g$ sont bijectives, alors $g \\circ f$ l’est aussi, et $(g \\circ f)^{-1} = f^{-1} \\circ g^{-1}$.',
    '',
    '## 3. Méthodes',
    '',
    '> [!METHOD] Montrer qu’une application est injective',
    '> 1. Prendre $x, y \\in E$ avec $f(x) = f(y)$.',
    '> 2. Déduire $x = y$ par le calcul.',
    '',
    '## 4. Pièges et erreurs fréquentes',
    '',
    '> [!WARNING] Confondre injective et surjective',
    '> Injective : on regarde les **antécédents** (au plus un). Surjective : on regarde les **images** (tout $F$ est atteint).',
    '',
    '## 5. Exemples types',
    '',
    '> [!EXAMPLE] $x \\mapsto e^x$ de $\\mathbb{R}$ dans $\\mathbb{R}_+^*$',
    '> Elle est bijective, de réciproque $\\ln$ : $\\ln(e^x) = x$ pour tout $x \\in \\mathbb{R}$.',
    '',
    '## Pour réviser',
    '- Donne la définition d’une application injective sans regarder.',
    '- Pourquoi $x \\mapsto x^2$ de $\\mathbb{R}$ dans $\\mathbb{R}$ n’est-elle ni injective ni surjective ?',
    '- Quelle est la réciproque d’une composée de bijections ?',
    ''
  ].join(String.fromCharCode(10))
  const file = join(outDir, 'fiche-applications.md')
  writeFileSync(file, md)
  const added = await invoke<{ ids: string[] }>('docs.addPaths', [file])
  for (const theme of ['light', 'dark'] as const) {
    await js(`window.__mnemo.getState().patchSettings({ theme: ${JSON.stringify(theme)} })`)
    await wait(600)
    win.setContentSize(1100, 1500)
    await wait(500)
    await js(`window.__mnemo.getState().go(${JSON.stringify({ name: 'doc', id: added.ids[0] })})`)
    await wait(1800)
    writeFileSync(join(outDir, `sheet-${theme}.png`), (await wc.capturePage()).toPNG())
  }
}
