import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Visite guidée dans la vraie application : MNEMO_QA_TOUR=1, MNEMO_QA_DIR=<sortie>, profil vierge. */
export async function runTour(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  try {
    await inner(win, outDir, log)
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'tour.txt'), log.join(String.fromCharCode(10)))
  }
}

async function inner(win: BrowserWindow, outDir: string, log: string[]): Promise<void> {
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const shot = async (name: string): Promise<void> => writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  const check = (ok: boolean, what: string): void => {
    log.push(`${ok ? 'ok     ' : 'ECHEC  '} ${what}`)
  }
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const click = (sel: string): Promise<boolean> => js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)
  const key = (k: string): Promise<void> => js<void>(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`)
  const title = (): Promise<string> => js<string>(`(document.querySelector('[data-testid="tour-title"]') || {}).innerText || ''`)
  const hl = (): Promise<string> => js<string>(`[...document.querySelectorAll('.tour-hl')].map(e => e.getAttribute('data-nav')).join(',')`)
  const tourDone = (): Promise<boolean> => js<boolean>(`window.__mnemo.getState().settings.tourDone`)

  await wait(1800)
  check(await has('[data-testid="tour"]'), 'la visite s’affiche au premier lancement')
  check(!(await js<boolean>(`[...document.querySelectorAll('button')].some(x => x.textContent.includes('sans rien configurer'))`)), 'l’accueil (onboarding) attend la fin de la visite')
  check((await tourDone()) === false, 'tourDone est faux au départ')
  const titles: string[] = [await title()]
  await shot('tour-01')

  const navs: string[] = [await hl()]
  for (let n = 2; n <= 10; n++) {
    if (n % 2 === 0) check(await click('[data-testid="tour-next"]'), `bouton Suivant (étape ${n})`)
    else await key('ArrowRight')
    await wait(900)
    titles.push(await title())
    navs.push(await hl())
    await shot(`tour-${String(n).padStart(2, '0')}`)
  }
  check(new Set(titles).size === 10 && titles.every((x) => x.length > 2), `10 étapes aux titres différents : ${titles.join(' | ')}`)
  check(navs.filter(Boolean).length === 6, `6 étapes surlignent la barre latérale : ${navs.join(' / ')}`)
  check(navs[1] === 'new' && navs[2] === 'home' && navs[4] === 'quiz' && navs[5] === 'assistant' && navs[6] === 'packs' && navs[8] === 'settings', 'chaque étape surligne la bonne entrée')

  // Retour en arrière (flèche gauche) puis les points.
  await key('ArrowLeft')
  await wait(500)
  check((await title()) === titles[8], 'flèche gauche : retour à l’étape 9')
  check((await hl()) === 'settings' && !(await has('[data-nav="packs"].tour-hl')), 'le surlignage suit l’étape (un seul à la fois)')
  await js(`document.querySelectorAll('.tr-dotsnav button')[3].click()`)
  await wait(500)
  check((await title()) === titles[3], 'clic sur un point : étape 4')
  check((await hl()) === '', 'étape sans cible : plus aucun surlignage')
  await js(`document.querySelectorAll('.tr-dotsnav button')[9].click()`)
  await wait(900)
  check(await has('[data-testid="tour-cta"]'), 'dernière étape : bouton « Créer ma première carte »')

  // Fin : Entrée termine la visite, l’accueil prend le relais.
  await key('Enter')
  for (let k = 0; k < 20 && (await has('[data-testid="tour"]')); k++) await wait(250)
  check(!(await has('[data-testid="tour"]')), 'Entrée sur la dernière étape ferme la visite')
  check((await tourDone()) === true, 'tourDone enregistré')
  check((await has('.tour-hl')) === false, 'plus de surlignage après la visite')
  for (let k = 0; k < 20 && !(await js<boolean>(`[...document.querySelectorAll('button')].some(x => x.textContent.includes('sans rien configurer'))`)); k++) await wait(250)
  check(await js<boolean>(`[...document.querySelectorAll('button')].some(x => x.textContent.includes('sans rien configurer'))`), 'l’accueil apparaît ensuite')
  await shot('apres-visite')
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('sans rien configurer')); if (b) b.click() })()`)
  await wait(500)

  // Revoir la visite, puis passer avec Échap.
  await js(`window.__mnemo.getState().setTour(true)`)
  await wait(700)
  check(await has('[data-testid="tour"]'), 'on peut revoir la visite')
  await key('Escape')
  await wait(500)
  check(!(await has('[data-testid="tour"]')), 'Échap passe la visite')

  // Dernier écran : « Essayer le deck d’exemple ».
  await js(`window.__mnemo.getState().setTour(true)`)
  await wait(500)
  await js(`document.querySelectorAll('.tr-dotsnav button')[9].click()`)
  await wait(700)
  check(await js<boolean>(`[...document.querySelectorAll('.tr-cta button')].some(b => b.textContent.includes('exemple'))`), 'bouton deck d’exemple présent')
  await js(`[...document.querySelectorAll('.tr-cta button')].find(b => b.textContent.includes('exemple')).click()`)
  await wait(1500)
  check(!(await has('[data-testid="tour"]')), 'le deck d’exemple ferme la visite')
  check(await js<boolean>(`window.__mnemo.getState().route.name === 'deck'`), 'et ouvre ce deck')

  // Mouvement réduit : l’état final reste lisible.
  await js(`window.__mnemo.getState().setTour(true)`)
  await wait(600)
  const overflow = await js<boolean>(`(() => { const c = document.querySelector('.tr-card').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight && c.left >= 0 && c.right <= innerWidth })()`)
  check(overflow, 'la carte tient dans la fenêtre')
  const z = await js<number>(`(() => { const o = +getComputedStyle(document.querySelector('.tr-overlay')).zIndex; return o })()`)
  check(z >= 200, 'voile au-dessus de l’appli')
  await shot('rejouee')
}
