import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { SKINS } from '../shared/skins'

/** Thèmes colorés réellement affichés : MNEMO_QA_SKINS=1, MNEMO_QA_DIR=<sortie>. Couleurs, barre latérale, retour au thème par défaut. */
export async function runSkins(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const go = (route: object): Promise<void> => js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
  const patch = (p: object): Promise<void> => js(`window.__mnemo.getState().patchSettings(${JSON.stringify(p)})`)
  const log: string[] = []
  let bad = 0
  const check = (ok: boolean, what: string): void => {
    if (!ok) bad++
    log.push(`${ok ? 'ok     ' : 'ECHEC  '} ${what}`)
  }
  const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

  await wait(1500)
  await invoke('settings.set', { onboarded: true, userName: 'Malo' })
  await js('location.reload()')
  await wait(1300)
  await invoke('data.createSample')
  win.setContentSize(1280, 800)

  const probe = `(() => {
    const bg = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : '' }
    const btn = document.querySelector('.btn-dark, .btn-primary')
    return { main: bg('.main'), sidebar: bg('.sidebar'), body: bg('body'), theme: document.documentElement.dataset.theme, skin: document.documentElement.dataset.skin || '',
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), hscroll: document.documentElement.scrollWidth > innerWidth + 1 }
  })()`

  for (const s of SKINS) {
    await patch({ skin: s.id })
    await wait(450)
    for (const [name, route] of [['home', { name: 'home' }], ['library', { name: 'library' }], ['settings', { name: 'settings' }]] as [string, object][]) {
      await go(route)
      await wait(450)
      const p = await js<{ main: string; sidebar: string; body: string; theme: string; skin: string; accent: string; hscroll: boolean }>(probe)
      check(p.main === rgb(s.bg) && p.sidebar === p.main, `${s.id} / ${name} : fond ${p.main}, barre latérale ${p.sidebar} (attendu ${rgb(s.bg)})`)
      check(p.theme === s.base && p.skin === s.id && !p.hscroll, `${s.id} / ${name} : mode ${p.theme}, pas de défilement horizontal`)
      if (name !== 'library') writeFileSync(join(outDir, `${s.id}-${name}.png`), (await wc.capturePage()).toPNG())
    }
    // Révision d'une carte (recto puis verso) dans ce thème.
    await go({ name: 'review', deckId: null })
    await wait(700)
    if (['sepia', 'oled', 'ambre'].includes(s.id)) writeFileSync(join(outDir, `${s.id}-review.png`), (await wc.capturePage()).toPNG())
  }

  // Couleur d'accent personnalisée, sur un thème puis sans thème.
  await patch({ skin: 'cafe', accentColor: '#22aa66' })
  await go({ name: 'settings' })
  await wait(500)
  let p = await js<{ accent: string; main: string }>(probe)
  check(p.accent === '#22aa66' && p.main === rgb('#1a1411'), `accent personnalisé sur Café : ${p.accent}, fond ${p.main}`)
  writeFileSync(join(outDir, 'cafe-accent-vert.png'), (await wc.capturePage()).toPNG())

  // Retour aux réglages d'origine : plus aucune variable de thème ne doit traîner.
  await patch({ skin: '', accentColor: '', theme: 'dark' })
  await wait(500)
  p = await js<{ accent: string; main: string }>(probe)
  const leftovers = await js<string>(`document.documentElement.getAttribute('style') || ''`)
  check(p.main === 'rgb(21, 21, 21)' && p.accent.toLowerCase() === '#d97757' && leftovers.replace(/font-size:[^;]*;?/, '').trim() === '', `retour au sombre : fond ${p.main}, accent ${p.accent}, style restant « ${leftovers} »`)
  await patch({ theme: 'light' })
  await wait(500)
  p = await js<{ accent: string; main: string }>(probe)
  check(p.main === 'rgb(249, 249, 247)', `retour au clair : fond ${p.main}`)

  log.push(`\n${bad} vérification(s) en échec.`)
  writeFileSync(join(outDir, 'skins.txt'), log.join('\n'))
}
