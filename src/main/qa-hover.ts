import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Survol de la barre latérale : MNEMO_QA_HOVER=1, MNEMO_QA_DIR=<sortie>. Fenêtre jamais affichée. */
export async function runHover(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const log: string[] = []
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  try {
    await wait(1500)
    await js(`window.mnemo.invoke('settings.set', { onboarded: true, tourDone: true, userName: 'Malo' })`)
    await js('location.reload()')
    await wait(1500)
    const themes: [string, object][] = [
      ['clair', { theme: 'light', skin: '', accentColor: '' }],
      ['sombre', { theme: 'dark', skin: '', accentColor: '' }]
    ]
    for (const [name, p] of themes) {
      await js(`window.mnemo.invoke('settings.set', ${JSON.stringify(p)})`)
      await js('location.reload()')
      await wait(1500)
      const pos = await js<{ x: number; y: number } | null>(
        `(() => { const els = [...document.querySelectorAll('.nav-item:not(.new):not(.active)')]; const el = els[2]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`
      )
      if (!pos) {
        log.push(`ECHEC  ${name} : aucun élément de menu`)
        continue
      }
      wc.sendInputEvent({ type: 'mouseMove', x: pos.x, y: pos.y })
      await wait(700)
      const st = await js<{ shadow: string; bg: string; barH: string }>(
        `(() => { const el = document.querySelector('.nav-item:hover'); if (!el) return { shadow: '', bg: '', barH: '' }; const c = getComputedStyle(el); return { shadow: c.boxShadow, bg: c.backgroundImage, barH: getComputedStyle(el, '::before').height } })()`
      )
      log.push(`${st.shadow && st.shadow !== 'none' && st.bg.includes('gradient') ? 'ok     ' : 'ECHEC  '} ${name} : survol (lueur + dégradé) ${st.barH}`)
      writeFileSync(join(outDir, `hover-${name}.png`), (await wc.capturePage({ x: 0, y: 0, width: 330, height: 640 })).toPNG())
    }
  } catch (e) {
    log.push(`EXCEPTION ${e instanceof Error ? e.stack : String(e)}`)
  } finally {
    writeFileSync(join(outDir, 'hover.txt'), log.join(String.fromCharCode(10)))
  }
}
