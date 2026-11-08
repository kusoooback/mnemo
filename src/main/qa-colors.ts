import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Couleurs réellement affichées (CSS calculé et pixels de la capture) : MNEMO_QA_COLORS=1, MNEMO_QA_DIR=<sortie>. */
export async function runColors(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const out: string[] = []
  await wait(1500)
  await invoke('settings.set', { onboarded: true })
  await js('location.reload()')
  await wait(1300)
  await invoke('data.createSample')
  win.setContentSize(1280, 800)
  for (const theme of ['dark', 'light'] as const) {
    await js(`window.__mnemo.getState().patchSettings({ theme: ${JSON.stringify(theme)} })`)
    await wait(900)
    for (const route of [{ name: 'home' }, { name: 'library' }, { name: 'ai' }, { name: 'settings' }]) {
      await js(`window.__mnemo.getState().go(${JSON.stringify(route)})`)
      await wait(500)
      const css = await js<Record<string, string>>(`(() => {
        const bg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : '(absent)' }
        return { body: bg('body'), app: bg('.app'), sidebar: bg('.sidebar'), sidebarTop: bg('.sidebar-top'), sidebarScroll: bg('.sidebar-scroll'), sidebarFoot: bg('.sidebar-foot'), main: bg('.main'), mainScroll: bg('.main-scroll') }
      })()`)
      const img = await wc.capturePage()
      const bmp = img.toBitmap()
      const w = img.getSize().width
      const px = (x: number, y: number): string => {
        const i = (y * w + x) * 4
        return `rgb(${bmp[i + 2]}, ${bmp[i + 1]}, ${bmp[i]})`
      }
      out.push(`${theme} / ${route.name}`)
      out.push(`  CSS      ${JSON.stringify(css)}`)
      out.push(`  pixels   barre latérale (150,700)=${px(150, 700)}  haut (150,10)=${px(150, 10)}  bas (20,780)=${px(20, 780)}  |  contenu (700,780)=${px(700, 780)}  haut (700,10)=${px(700, 10)}  coin droit (1270,10)=${px(1270, 10)}`)
      if (route.name === 'home') writeFileSync(join(outDir, `${theme}-home.png`), img.toPNG())
    }
  }
  writeFileSync(join(outDir, 'colors.txt'), out.join('\n'))
}
