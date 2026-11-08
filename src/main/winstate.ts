import { app, BrowserWindow, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getSettings } from './util'

/** Taille, position et état (agrandie / plein écran) de la fenêtre, retrouvés au prochain lancement. */
interface WinState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
  fullscreen: boolean
}

const DEFAULT: WinState = { width: 1280, height: 820, maximized: false, fullscreen: false }
const file = (): string => join(app.getPath('userData'), 'window-state.json')

export function loadWinState(): WinState {
  try {
    if (!existsSync(file())) return DEFAULT
    const s = { ...DEFAULT, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<WinState>) }
    // Un écran branché la dernière fois peut avoir disparu : on vérifie que la fenêtre reste visible.
    if (s.x !== undefined && s.y !== undefined) {
      const area = screen.getDisplayMatching({ x: s.x, y: s.y, width: s.width, height: s.height }).workArea
      const visible = s.x + s.width > area.x + 80 && s.x < area.x + area.width - 80 && s.y >= area.y - 10 && s.y < area.y + area.height - 80
      if (!visible) return { ...s, x: undefined, y: undefined }
    }
    return { ...s, width: Math.max(600, s.width), height: Math.max(480, s.height) }
  } catch {
    return DEFAULT
  }
}

/** Sauvegarde différée : on n'écrit pas à chaque pixel déplacé. */
export function trackWinState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const fullscreen = win.isFullScreen()
    // En plein écran ou agrandie, on garde les dimensions de la fenêtre « normale ».
    const b = maximized || fullscreen ? (win.getNormalBounds?.() ?? win.getBounds()) : win.getBounds()
    try {
      writeFileSync(file(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized, fullscreen }))
    } catch {
      /* dossier en lecture seule : tant pis */
    }
  }
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', later)
  win.on('unmaximize', later)
  win.on('enter-full-screen', later)
  win.on('leave-full-screen', later)
  win.on('close', save)
}

let zoom = 1
export const currentZoom = (): number => zoom

/**
 * Très grand écran : tout est agrandi proportionnellement pour que l'interface ne reste pas une petite colonne
 * perdue au milieu du vide. Aucun effet jusqu'à ~2100 px de large (portables et écrans Full HD).
 */
export function applyAutoZoom(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const width = win.getContentSize()[0]
  const factor = getSettings().autoZoom && width > 2100 ? Math.min(1.3, Math.round((width / 1920) * 20) / 20) : 1
  if (factor === zoom && win.webContents.getZoomFactor() === factor) return
  zoom = factor
  win.webContents.setZoomFactor(factor)
  if (process.platform !== 'darwin') {
    try {
      win.setTitleBarOverlay({ height: Math.round(40 * factor) })
    } catch {
      /* non pris en charge */
    }
  }
}

export function watchAutoZoom(win: BrowserWindow): void {
  const apply = (): void => applyAutoZoom(win)
  win.on('resize', apply)
  win.on('enter-full-screen', apply)
  win.on('leave-full-screen', apply)
  win.webContents.on('did-finish-load', apply)
}
