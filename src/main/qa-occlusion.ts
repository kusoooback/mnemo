import { nativeImage, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { saveImage } from './data'

/** Occlusion d'image de bout en bout : MNEMO_QA_OCCLUSION=1, MNEMO_QA_DIR=<sortie>. Dessin à la souris, éditeur, révision. */
export async function runOcclusion(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const shot = async (name: string): Promise<void> => writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  const log: string[] = []
  const check = (ok: boolean, what: string): void => {
    log.push(`${ok ? 'ok     ' : 'ECHEC  '} ${what}`)
  }

  await wait(1500)
  await invoke('settings.set', { onboarded: true })
  await js('location.reload()')
  await wait(1300)

  // Un faux schéma : trois rectangles de couleur avec un fond clair.
  const W = 480
  const H = 300
  const bmp = Buffer.alloc(W * H * 4)
  const fill = (x0: number, y0: number, w: number, h: number, [r, g, b]: number[]): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) bmp.writeUInt32LE(((255 << 24) | (r << 16) | (g << 8) | b) >>> 0, (y * W + x) * 4)
  }
  fill(0, 0, W, H, [236, 232, 220])
  fill(40, 40, 160, 90, [120, 160, 200])
  fill(280, 60, 160, 90, [200, 140, 120])
  fill(150, 190, 180, 80, [140, 190, 140])
  const png = nativeImage.createFromBitmap(bmp, { width: W, height: H }).toPNG()
  const url = saveImage(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, 'image/png')

  const deck = await invoke<string>('deck.create', 'Biologie::Schémas', null)
  const boxes = [
    { x: 40 / W, y: 40 / H, w: 160 / W, h: 90 / H },
    { x: 280 / W, y: 60 / H, w: 160 / W, h: 90 / H }
  ]
  const noteId = await invoke<string>('note.add', { kind: 'occlusion', deckId: deck, fields: { image: url, boxes: JSON.stringify(boxes), extra: 'Les deux organites du schéma.' }, tags: [] })
  win.setContentSize(1280, 800)

  for (const theme of ['light', 'dark'] as const) {
    await js(`window.__mnemo.getState().patchSettings({ theme: ${JSON.stringify(theme)} })`)
    await wait(600)

    // Éditeur : dessin d'une troisième zone avec de vrais événements souris.
    await js(`window.__mnemo.getState().openEditor({ noteId: ${JSON.stringify(noteId)} })`)
    await wait(900)
    const geo = await js<{ l: number; t: number; w: number; h: number } | null>(`(() => { const r = document.querySelector('.occ-edit')?.getBoundingClientRect(); return r ? { l: r.left, t: r.top, w: r.width, h: r.height } : null })()`)
    check(!!geo, `${theme} : l'éditeur affiche l'image`)
    if (!geo) continue
    const before = await js<number>(`document.querySelectorAll('.occ-edit .occ-box').length`)
    check(before === 2, `${theme} : deux zones existantes (${before})`)
    const px = (fx: number, fy: number): { x: number; y: number } => ({ x: Math.round(geo.l + geo.w * fx), y: Math.round(geo.t + geo.h * fy) })
    const a = px(0.3, 0.65)
    const b = px(0.7, 0.9)
    wc.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y })
    wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 5; i++) wc.sendInputEvent({ type: 'mouseMove', x: Math.round(a.x + ((b.x - a.x) * i) / 5), y: Math.round(a.y + ((b.y - a.y) * i) / 5) })
    await wait(100)
    await shot(`${theme}-editor-drawing`)
    wc.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 })
    await wait(300)
    const after = await js<number>(`document.querySelectorAll('.occ-edit .occ-box').length`)
    check(after === 3, `${theme} : la zone dessinée à la souris est ajoutée (${after})`)
    await shot(`${theme}-editor`)

    // Enregistrer : trois cartes.
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Enregistrer')?.click()`)
    await wait(700)
    const n = await invoke<{ cards: unknown[] }>('note.get', noteId)
    check(n.cards.length === 3, `${theme} : la note a maintenant 3 cartes (${n.cards.length})`)

    // Révision : recto puis verso.
    await js(`window.__mnemo.getState().go({ name: 'review', deckId: ${JSON.stringify(deck)} })`)
    await wait(900)
    const front = await js<{ boxes: number; active: number; open: number }>(`({ boxes: document.querySelectorAll('.rv-q .occ-box').length, active: document.querySelectorAll('.rv-q .occ-box.active').length, open: document.querySelectorAll('.rv-q .occ-box.open').length })`)
    check(front.boxes === 3 && front.active === 1 && front.open === 0, `${theme} : recto, 3 zones masquées dont une en évidence ${JSON.stringify(front)}`)
    await shot(`${theme}-review-front`)
    wc.sendInputEvent({ type: 'keyDown', keyCode: ' ' })
    wc.sendInputEvent({ type: 'char', keyCode: ' ' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: ' ' })
    await wait(500)
    const back = await js<{ open: number; hidden: number; extra: boolean }>(`({ open: document.querySelectorAll('.rv-q .occ-box.open').length, hidden: document.querySelectorAll('.rv-q .occ-box:not(.open)').length, extra: document.body.innerText.includes('Les deux organites') })`)
    check(back.open === 1 && back.hidden === 2 && back.extra, `${theme} : verso, la zone est dévoilée, les autres restent cachées ${JSON.stringify(back)}`)
    await shot(`${theme}-review-back`)
    await js(`window.__mnemo.getState().go({ name: 'home' })`)
    await wait(300)
    // Pour le second thème on repart de trois cartes : retirer la troisième zone.
    const note = await invoke<{ fields: Record<string, string> }>('note.get', noteId)
    await invoke('note.update', noteId, { kind: 'occlusion', fields: { ...note.fields, boxes: JSON.stringify(boxes) }, tags: [] })
  }
  // Export Anki : chaque zone devient une note recto/verso dont les images ont les zones peintes.
  const { buildApkg } = await import('./anki')
  const { unzipSync } = await import('fflate')
  const apkg = buildApkg(deck)
  const files = unzipSync(new Uint8Array(apkg.data))
  const mediaMap = JSON.parse(new TextDecoder().decode(files.media)) as Record<string, string>
  check(apkg.notes === 2 && apkg.cards === 2, `export Anki : ${apkg.notes} notes, ${apkg.cards} cartes (attendu 2 et 2)`)
  check(Object.keys(mediaMap).length === 4, `export Anki : ${Object.keys(mediaMap).length} images peintes (attendu 4 : recto et verso de chaque zone)`)
  const first = Object.entries(mediaMap)[0]
  if (first) writeFileSync(join(outDir, 'anki-' + first[1]), files[first[0]])
  writeFileSync(join(outDir, 'occlusion.txt'), log.join('\n'))
}
