import { dialog, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveImage } from './data'
import { mediaDir } from './db'
import { readPack } from './deckpack'

/**
 * Écosystème (ressources, paquets partagés, carnet de dessin, thème sur mesure, typographie, raccourcis) dans la vraie
 * application : MNEMO_QA_ECO=1, MNEMO_QA_DIR=<sortie>. Les boîtes de dialogue du système sont remplacées par des chemins fixes.
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

export async function runEco(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const logRef: string[] = []
  try {
    await runEcoInner(win, outDir, logRef)
  } catch (e) {
    logRef.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'eco.txt'), logRef.join(String.fromCharCode(10)))
  }
}

async function runEcoInner(win: BrowserWindow, outDir: string, log: string[]): Promise<void> {
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const shot = async (name: string): Promise<void> => writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  const check = (ok: boolean, what: string): void => {
    log.push(`${ok ? 'ok     ' : 'ECHEC  '} ${what}`)
  }
  const body = (): Promise<string> => js<string>('document.body.innerText')
  const until = async (cond: () => Promise<boolean>, ms = 12000): Promise<boolean> => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await cond()) return true
      await wait(200)
    }
    return false
  }
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const click = (sel: string): Promise<boolean> => js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true })()`)
  const clickText = (sel: string, text: string): Promise<boolean> =>
    js<boolean>(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
  const clickExact = (sel: string, text: string): Promise<boolean> =>
    js<boolean>(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
  const patch = async (p: object): Promise<void> => {
    await js(`window.__mnemo.getState().patchSettings(${JSON.stringify(p)})`)
    await wait(500)
  }
  const setInput = (sel: string, value: string): Promise<boolean> =>
    js<boolean>(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false; const proto = t instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : t instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event(t instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true })()`)
  const go = async (route: object): Promise<void> => {
    await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
    await wait(600)
  }
  const toasts = (): Promise<string> => js<string>(`[...document.querySelectorAll('.toast')].map(x => x.textContent).join(' | ')`)
  const key = async (keyCode: string): Promise<void> => {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
    await wait(150)
  }
  const mouse = async (pts: [number, number][]): Promise<void> => {
    const [x0, y0] = pts[0]
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x0), y: Math.round(y0) })
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x0), y: Math.round(y0), button: 'left', clickCount: 1 })
    for (const [x, y] of pts.slice(1)) {
      wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), modifiers: ['leftbuttondown'] })
      await wait(12)
    }
    const [xe, ye] = pts[pts.length - 1]
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(xe), y: Math.round(ye), button: 'left', clickCount: 1 })
    await wait(120)
  }

  await wait(1500)
  await invoke('settings.set', { onboarded: true })
  await js('location.reload()')
  await wait(1300)
  win.setContentSize(1280, 900)
  await js(`window.__seen = []; new MutationObserver(() => document.querySelectorAll('.toast').forEach((t) => { if (!window.__seen.includes(t.textContent)) window.__seen.push(t.textContent) })).observe(document.body, { childList: true, subtree: true })`)
  const seen = (): Promise<string> => js<string>(`window.__seen.join(' | ')`)

  /* ------------------------------------------------------------ Ressources */
  await js(`localStorage.removeItem('mnemo.resources.v1')`)
  await go({ name: 'resources' })
  const nRes = await js<number>(`document.querySelectorAll('.rs-item').length`)
  check(nRes >= 40, `la page Ressources liste ${nRes} sources`)
  await shot('1-ressources')
  await setInput('.rs-search input', 'pycime')
  await wait(300)
  const pycime = await js<string[]>(`[...document.querySelectorAll('.rs-item')].map(x => x.innerText)`)
  check(pycime.length >= 1 && pycime.every((t) => /pycime/i.test(t)), `la recherche « pycime » trouve le site demandé (${pycime.length})`)
  check(pycime.every((t) => !t.includes('non vérifié')), 'PyCime n’est pas signalé « non vérifié » (adresse testée en ligne)')
  await setInput('.rs-search input', 'géopolitique')
  await wait(300)
  check((await js<number>(`document.querySelectorAll('.rs-item').length`)) >= 2, 'la recherche ignore les accents et la casse')
  await setInput('.rs-search input', '')
  await click('.rs-item .rs-actions .icon-btn')
  await wait(200)
  check((await js<string>(`localStorage.getItem('mnemo.resources.v1')`)).includes('"favs":["'), 'un favori est mémorisé')
  await clickText('button', 'Ajouter une source')
  await wait(200)
  const ins = document_inputs()
  await setInput(ins.title, 'Wiki Python')
  await setInput(ins.url, 'http://exemple.fr')
  await clickText('.rs-form button', 'Enregistrer')
  await wait(300)
  check((await toasts()).includes('adresse https'), 'une adresse http:// est refusée pour une source perso')
  await setInput(ins.url, 'https://fr.wikipedia.org/wiki/Python_(langage)')
  await clickText('.rs-form button', 'Enregistrer')
  await wait(300)
  check(await js<boolean>(`[...document.querySelectorAll('.rs-item')].some(x => x.innerText.includes('Wiki Python') && x.innerText.includes('Ma source'))`), 'une source perso valide est ajoutée')
  // lecture réelle d'une page (une seule requête, au clic) puis passage à l'assistant
  const read = await js<boolean>(`(() => { const it = [...document.querySelectorAll('.rs-item')].find(x => x.innerText.includes('Wiki Python')); const b = [...it.querySelectorAll('button')].find(x => x.textContent.includes('Lire')); if (!b) return false; b.click(); return true })()`)
  check(read, 'le bouton « Lire et créer des cartes » existe')
  const toAssistant = await until(async () => (await js<string>('document.body.innerText')).includes('Que veux-tu en faire'), 30000)
  check(toAssistant, 'la page lue arrive dans l’assistant (appel réseau réel vers Wikipédia)')
  if (!toAssistant) log.push('   toasts : ' + (await toasts()))
  await shot('2-ressources-lecture')
  await js(`localStorage.removeItem('mnemo.assistant.v1')`)

  /* ------------------------------------------------------------ Paquets */
  const tmp = join(tmpdir(), `mnemo-eco-${Date.now()}`)
  mkdirSync(tmp, { recursive: true })
  const packFile = join(tmp, 'maths.mnemodeck')
  let nextOpen = packFile
  ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: packFile })
  ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [nextOpen] })

  const imgUrl = saveImage(PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) as ArrayBuffer, 'image/png')
  const deckId = await invoke<string>('deck.create', 'QA Maths', null)
  const sub = await invoke<string>('deck.create', 'QA Maths::Dérivées', null)
  await invoke('note.add', { kind: 'basic', deckId, fields: { front: 'Dérivée de $x^2$ ?', back: `$2x$ ![](${imgUrl})` }, tags: ['maths', 'analyse'] })
  await invoke('note.add', { kind: 'cloze', deckId: sub, fields: { text: 'La dérivée de $e^x$ est {{c1::$e^x$}}.', extra: '' }, tags: [] })
  await invoke('note.add', { kind: 'basic', deckId: sub, fields: { front: 'Dérivée de $\\ln x$ ?', back: '$1/x$' }, tags: [] })
  await js(`window.__mnemo.getState().bump()`)
  await go({ name: 'packs' })
  await shot('3-paquets')
  check((await body()).includes('Partager un deck') && (await body()).includes('Catalogue communautaire'), 'la page Paquets affiche partage, ouverture et catalogue')
  await setInput('.pk-block select', deckId)
  await setInput('.pk-grid label:nth-child(2) input', 'Maths QA')
  await setInput('.pk-grid label:nth-child(3) input', 'Moi')
  await clickText('.pk-block button', 'Créer le fichier')
  check(await until(async () => existsSync(packFile)), 'le fichier .mnemodeck est écrit')
  check((await toasts()).includes('3 cartes'), `le résumé annonce 3 cartes (${await toasts()})`)
  const raw = readFileSync(packFile)
  check(raw.subarray(0, 6).toString('latin1') === 'MNDK1\n', 'le fichier commence par la signature MNDK1')
  const pack = readPack(raw)
  check(pack.notes.length === 3 && Object.keys(pack.media).length === 1, `le paquet contient 3 cartes et l’image (${pack.notes.length}/${Object.keys(pack.media).length})`)
  check(pack.notes.some((n) => n.deck === 'Dérivées') && pack.notes.some((n) => n.deck === ''), 'la hiérarchie des sous-decks est conservée')
  check(!raw.toString('latin1').includes('apiKey'), 'aucune clé ni réglage dans le fichier')

  // le deck d'origine disparaît (corbeille) : on se comporte comme un ami qui reçoit le fichier
  await invoke('deck.delete', deckId)
  await js(`window.__mnemo.getState().bump()`)
  await go({ name: 'packs' })
  nextOpen = packFile
  await clickText('.pk-block button', 'Choisir un fichier')
  check(await until(() => has('.pk-preview')), 'l’aperçu du paquet reçu s’affiche avant tout ajout')
  const prev = await js<string>(`document.querySelector('.pk-preview')?.innerText ?? ''`)
  check(prev.includes('Maths QA') && prev.includes('3 cartes') && prev.includes('1 images'), `l’aperçu annonce nom, cartes, images (${prev.split(String.fromCharCode(10)).join(' / ').slice(0, 120)})`)
  await shot('4-apercu')
  await setInput('.pk-preview input', 'QA Reçu')
  await clickText('.pk-preview button', 'Ajouter à ma collection')
  const added = await until(async () => (await seen()).includes('3 cartes ajoutées dans « QA Reçu »'))
  check(added, 'le paquet est ajouté')
  if (!added) log.push('   toasts vus : ' + (await seen()) + ' | decks : ' + JSON.stringify((await invoke<{ fullName: string; totalCards: number }[]>('deck.list')).map((d) => d.fullName + ':' + d.totalCards)))
  const decks1 = await invoke<{ fullName: string; totalCards: number }[]>('deck.list')
  check(decks1.some((d) => d.fullName === 'QA Reçu::Dérivées' && d.totalCards === 2) && decks1.some((d) => d.fullName === 'QA Reçu' && d.totalCards === 3), 'les cartes sont rangées dans « QA Reçu » (1) et « QA Reçu::Dérivées » (2)')
  const found = await invoke<{ rows: { fields: Record<string, string> }[] }>('card.search', { text: 'Dérivée', deckId: null, state: 'all', tag: null, sort: 'created', limit: 20, offset: 0 })
  check(found.rows.some((r) => (r.fields.back ?? '').includes('mnemo-media://')), 'l’image de la carte est retrouvée dans la collection')
  const imgOk = await js<boolean>(`new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = ${JSON.stringify(imgUrl)} })`)
  check(imgOk, 'l’image est servie par l’application (mnemo-media)')

  // ré-ouvrir le même fichier : tout est reconnu comme doublon
  await go({ name: 'packs' })
  await clickText('.pk-block button', 'Choisir un fichier')
  await until(() => has('.pk-preview'))
  const dupTxt = await js<string>(`document.querySelector('.pk-preview')?.innerText ?? ''`)
  check(dupTxt.includes('3 cartes que tu possèdes déjà'), `rouvrir le même paquet signale 3 doublons (${dupTxt.split(String.fromCharCode(10)).join(' / ').slice(0, 140)})`)
  await clickText('.pk-preview button', 'Annuler')

  // paquet Python livré avec le dépôt
  const python = join(process.cwd(), 'community', 'packs', 'python-prepa-bases.mnemodeck')
  if (existsSync(python)) {
    nextOpen = python
    await go({ name: 'packs' })
    await clickText('.pk-block button', 'Choisir un fichier')
    await until(() => has('.pk-preview'))
    check((await js<string>(`document.querySelector('.pk-preview')?.innerText ?? ''`)).includes('50 cartes'), 'le paquet Python de départ s’ouvre (50 cartes)')
    await setInput('.pk-preview input', 'Python QA')
    await clickText('.pk-preview button', 'Ajouter à ma collection')
    await until(async () => (await seen()).includes('50 cartes ajoutées'))
    const decks2 = await invoke<{ fullName: string; totalCards: number }[]>('deck.list')
    const rootDeck = decks2.find((d) => d.fullName === 'Python QA')
    const kids = decks2.filter((d) => d.fullName.startsWith('Python QA::'))
    log.push('   decks Python : ' + JSON.stringify(decks2.filter((d) => d.fullName.startsWith('Python QA')).map((d) => d.fullName + ':' + d.totalCards)))
    check(rootDeck?.totalCards === 51 && kids.length === 7, `50 notes Python installées en 51 cartes (une carte à deux trous) dans 7 sous-decks (${rootDeck?.totalCards} cartes, ${kids.length} sous-decks)`)
    await shot('5-python')
  } else check(false, 'paquet Python introuvable : lancer depuis la racine du dépôt')

  // fichier qui n'est pas un paquet
  const junk = join(tmp, 'faux.mnemodeck')
  writeFileSync(junk, 'ceci n’est pas un paquet')
  nextOpen = junk
  await go({ name: 'packs' })
  await clickText('.pk-block button', 'Choisir un fichier')
  await wait(500)
  check((await toasts()).includes('pas un paquet') && !(await has('.pk-preview')), 'un fichier invalide est refusé avec un message clair')

  // catalogue : requête réelle vers le dépôt public (404 tant que le dossier community/ n'est pas publié)
  await go({ name: 'packs' })
  await clickText('.pk-block button', 'Parcourir le catalogue')
  const cat = await until(async () => (await has('.pk-item')) || (await toasts()).includes('catalogue') || (await body()).includes('catalogue est vide'), 20000)
  const catItems = await js<number>(`document.querySelectorAll('.pk-item').length`)
  check(cat, catItems ? `catalogue en ligne : ${catItems} paquet(s)` : `catalogue : réponse gérée sans erreur de l’interface (${await toasts()})`)
  await shot('6-catalogue')

  /* ------------------------------------------------------------ Carnet de dessin */
  await js(`localStorage.removeItem('mnemo.draw.v1')`)
  await js(`window.__mnemo.getState().openEditor({ deckId: null })`)
  await wait(700)
  check(await click('button[aria-label="Dessiner"]'), 'le bouton « Dessiner » est dans la barre de l’éditeur')
  check(await until(() => has('.draw-modal')), 'le carnet de dessin s’ouvre')
  await wait(300)
  const rect = await js<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.querySelector('.dp-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  const at = (fx: number, fy: number): [number, number] => [rect.x + rect.w * fx, rect.y + rect.h * fy]
  await shot('7-carnet-vide')
  await click('button[aria-label="#e03131"]')
  await click('button[aria-label="Épaisseur 8"]')
  await mouse([at(0.1, 0.2), at(0.2, 0.3), at(0.3, 0.25), at(0.4, 0.4), at(0.5, 0.35)])
  await click('button[aria-label="Rectangle"]')
  await click('button[aria-label="#1971c2"]')
  await mouse([at(0.55, 0.15), at(0.8, 0.5)])
  await click('button[aria-label="Flèche"]')
  await click('button[aria-label="#2f9e44"]')
  await mouse([at(0.2, 0.8), at(0.5, 0.7)])
  await click('button[aria-label="Texte"]')
  await click('button[aria-label="#1b1b1b"]')
  await mouse([at(0.6, 0.65), at(0.6, 0.65)])
  check(await until(() => has('.dp-text')), 'l’outil Texte ouvre une zone de saisie')
  wc.insertText('Aorte')
  await wait(150)
  await key('Return')
  check(!(await has('.dp-text')), 'Entrée valide le texte')
  await shot('8-carnet-dessin')
  const undoDisabled0 = await js<boolean>(`document.querySelector('button[aria-label="Annuler"]').disabled`)
  await click('button[aria-label="Annuler"]')
  const redoEnabled = await js<boolean>(`!document.querySelector('button[aria-label="Rétablir"]').disabled`)
  await click('button[aria-label="Rétablir"]')
  check(!undoDisabled0 && redoEnabled, 'annuler puis rétablir fonctionnent')
  await setInput('.dp-paper', 'grid')
  await wait(200)
  check((await js<string>('JSON.parse(localStorage.getItem("mnemo.draw.v1")).paper')) === 'grid', 'le fond choisi est mémorisé')
  await shot('9-carnet-quadrille')
  await clickText('.dp-foot button', 'Insérer dans la carte')
  check(await until(async () => !(await has('.draw-modal'))), 'le carnet se ferme après insertion')
  await wait(500)
  const ta = await js<string>(`document.querySelector('.field-wrap textarea')?.value ?? ''`)
  const m = /!\[\]\((mnemo-media:\/\/[a-f0-9]{64}\.png)\)/.exec(ta)
  check(!!m, `l’image dessinée est insérée dans la carte (${ta.slice(0, 40)})`)
  if (m) {
    const file = join(mediaDir(), m[1].replace('mnemo-media://', ''))
    check(existsSync(file), 'le PNG est rangé dans le dossier des médias')
    const b64 = readFileSync(file).toString('base64')
    const stats = await js<{ w: number; h: number; red: number; blue: number; green: number; dark: number; grid: number; total: number }>(`(async () => {
      const bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + ${JSON.stringify(b64)} })
      const c = document.createElement('canvas'); c.width = bmp.naturalWidth; c.height = bmp.naturalHeight
      const x = c.getContext('2d'); x.drawImage(bmp, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data
      let red = 0, blue = 0, green = 0, dark = 0, grid = 0
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2]
        if (r > 200 && g < 90 && b < 90) red++
        else if (b > 170 && r < 80) blue++
        else if (g > 130 && r < 90 && b < 90) green++
        else if (r < 60 && g < 60 && b < 60) dark++
        else if (r > 195 && r < 235 && g > 200 && g < 240 && b > 210 && b < 250) grid++
      }
      return { w: c.width, h: c.height, red, blue, green, dark, grid, total: c.width * c.height }
    })()`)
    check(stats.w === 1000 && stats.h === 625, `le PNG fait ${stats.w}×${stats.h}`)
    check(stats.red > 300, `trait rouge au stylo présent (${stats.red} px)`)
    check(stats.blue > 100, `rectangle bleu présent (${stats.blue} px)`)
    check(stats.green > 100, `flèche verte présente (${stats.green} px)`)
    check(stats.dark > 60, `texte « Aorte » noir présent (${stats.dark} px)`)
    check(stats.grid > 2000, `fond quadrillé présent (${stats.grid} px)`)
  }
  // abandon d'un dessin : confirmation avant de perdre le travail
  await click('button[aria-label="Dessiner"]')
  await until(() => has('.draw-modal'))
  await click('button[aria-label="Stylo"]')
  await mouse([at(0.1, 0.1), at(0.2, 0.2), at(0.3, 0.3)])
  log.push('   abandon : annuler désactivé = ' + (await js<boolean>(`document.querySelector('button[aria-label="Annuler"]').disabled`)) + ', outil = ' + (await js<string>(`document.querySelector('.dp-tool.on')?.getAttribute('aria-label') ?? ''`)))
  await shot('9b-abandon')
  await key('Escape')
  await wait(200)
  check((await body()).includes('Abandonner ce dessin'), 'Échap sur un dessin non enregistré demande confirmation')
  await clickText('.dp-foot button', 'Continuer à dessiner')
  check(await has('.draw-modal'), '« Continuer à dessiner » garde le carnet ouvert')
  await key('Escape')
  await clickText('.dp-foot button', 'Abandonner')
  check(await until(async () => !(await has('.draw-modal'))), '« Abandonner » ferme le carnet')
  await js(`window.__mnemo.getState().openEditor(null)`)
  await wait(300)

  /* ------------------------------------------------------------ Thème sur mesure */
  const bgs = (): Promise<{ main: string; sidebar: string; skin: string; theme: string }> =>
    js(`(() => { const g = (s) => getComputedStyle(document.querySelector(s)).backgroundColor; return { main: g('.main'), sidebar: g('.sidebar'), skin: document.documentElement.dataset.skin || '', theme: document.documentElement.dataset.theme } })()`)
  await patch({ skin: 'custom:10151f:e8ecf4:4da3ff' })
  const dk = await bgs()
  check(dk.main === 'rgb(16, 21, 31)' && dk.theme === 'dark', `thème sur mesure sombre appliqué (${dk.main}, ${dk.theme})`)
  check(dk.sidebar === dk.main, 'la barre latérale suit le fond du thème sur mesure')
  await shot('10-theme-sombre')
  await go({ name: 'settings' })
  check(await has('.ct'), 'la section « Mon thème » est dans les réglages')
  await setInput('.ct-actions input', 'custom:f4efe6:2b2b2b:c0562b')
  await clickExact('.ct-actions button', 'Utiliser')
  await wait(600)
  const lt = await bgs()
  check(lt.main === 'rgb(244, 239, 230)' && lt.theme === 'light' && lt.sidebar === lt.main, `un code collé change le thème (${lt.main})`)
  await shot('11-theme-clair')
  await setInput('.ct-actions input', 'n’importe quoi')
  await clickExact('.ct-actions button', 'Utiliser')
  await wait(300)
  check((await toasts()).includes('pas valable'), 'un code invalide est refusé')
  check((await invoke<{ skin: string }>('settings.get')).skin === 'custom:f4efe6:2b2b2b:c0562b', 'le thème précédent reste actif après un code invalide')

  /* ------------------------------------------------------------ Typographie des cartes */
  await patch({ skin: '', cardFont: 'mono', cardScale: 1.4, cardAlign: 'center' })
  await go({ name: 'settings' })
  const ty = await js<{ font: string; align: string; size: number }>(`(() => { const s = getComputedStyle(document.querySelector('.cs-preview .rv-q')); return { font: s.fontFamily, align: s.textAlign, size: parseFloat(s.fontSize) } })()`)
  check(/mono|Consolas/i.test(ty.font) && ty.align === 'center' && ty.size > 24, `l’aperçu applique police machine, centrage, taille (${ty.font.slice(0, 30)}, ${ty.align}, ${ty.size}px)`)
  await shot('12-typo')
  const sample = await invoke<unknown>('data.createSample').catch(() => null)
  void sample
  await go({ name: 'review', deckId: null })
  await wait(900)
  const rv = await js<{ font: string; align: string } | null>(`(() => { const e = document.querySelector('.rv-q'); if (!e) return null; const s = getComputedStyle(e); return { font: s.fontFamily, align: s.textAlign } })()`)
  check(!!rv && /mono|Consolas/i.test(rv.font) && rv.align === 'center', `la carte en révision suit les réglages (${rv ? rv.font.slice(0, 24) + ', ' + rv.align : 'aucune carte à réviser'})`)
  await shot('13-revision-typo')
  await patch({ cardFont: '', cardScale: 1, cardAlign: 'left' })
  const rv2 = await js<string>(`(() => { const e = document.querySelector('.rv-q'); return e ? getComputedStyle(e).textAlign : 'none' })()`)
  check(rv2 === 'left' || rv2 === 'start' || rv2 === 'none', `retour aux réglages par défaut (${rv2})`)
  await key('Escape')

  /* ------------------------------------------------------------ Raccourcis */
  await go({ name: 'home' })
  await js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`)
  await wait(300)
  check(await has('.sc-body'), 'la touche ? ouvre l’aide des raccourcis')
  const sc = await js<string>(`document.querySelector('.sc-body')?.innerText ?? ''`)
  check(sc.includes('Pendant la révision') && sc.includes('Carnet de dessin') && /Ctrl|⌘/.test(sc), 'l’aide liste les raccourcis de la révision, de l’éditeur et du carnet')
  await shot('14-raccourcis')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(250)
  check(!(await has('.sc-body')), 'Échap referme l’aide')
  await js(`window.__mnemo.getState().openEditor({ deckId: null })`)
  await wait(500)
  await js(`document.querySelector('.field-wrap textarea').dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`)
  await wait(250)
  check(!(await has('.sc-body')), 'taper « ? » dans un champ de texte n’ouvre pas l’aide')
  await js(`window.__mnemo.getState().openEditor(null)`)

  writeFileSync(join(outDir, 'eco.txt'), log.join('\n'))
}

/** Sélecteurs du petit formulaire « Ajouter une source » (nom, adresse). */
function document_inputs(): { title: string; url: string } {
  return { title: '.rs-form input:nth-of-type(1)', url: '.rs-form input:nth-of-type(2)' }
}
