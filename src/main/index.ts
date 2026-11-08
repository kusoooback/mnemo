import { app, BrowserWindow, clipboard, nativeImage, globalShortcut, nativeTheme, net, Notification, protocol, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { closeDb, ensureDailyBackup, mediaDir, openDb } from './db'
import { emit, registerHandlers } from './handlers'
import { startMarkdownWatch, stopMarkdownWatch } from './integrations'
import { shutdownLocalAi } from './localai'
import { documentFilePath } from './docfiles'
import { dueSummary } from './notebook'
import { startPrepaAuto, stopPrepaAuto } from './prepa-auto'
import { installMenu } from './menu'
import { startBridge, stopBridge } from './bridge'
import { loadWinState, trackWinState, watchAutoZoom } from './winstate'
import { startAutoSync, stopAutoSync, syncOnQuit } from './syncctl'
import { getSettings, setSettings } from './util'
import { skinById } from '../shared/skins'

app.setPath('userData', process.env.MNEMO_USER_DATA || join(app.getPath('appData'), 'Mnemo'))

protocol.registerSchemesAsPrivileged([
  { scheme: 'mnemo-media', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'mnemo-doc', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

let mainWindow: BrowserWindow | null = null

function isDark(): boolean {
  const { theme, skin } = getSettings()
  const sk = skinById(skin)
  if (sk) return sk.base === 'dark'
  if (theme === 'system') return nativeTheme.shouldUseDarkColors
  return theme === 'dark'
}

function createWindow(): void {
  const dark = isDark()
  const sk = skinById(getSettings().skin)
  const bg = sk?.bg ?? (dark ? '#151515' : '#f9f9f7')
  const saved = process.env.MNEMO_QA_DIR ? { width: 1280, height: 820, maximized: false, fullscreen: false } : loadWinState()
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 600,
    minHeight: 480,
    show: false,
    backgroundColor: bg,
    title: 'Mnémo',
    ...(is.dev ? { icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')) } : {}),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : {
          titleBarOverlay: {
            color: bg,
            symbolColor: sk?.text2 ?? (dark ? '#c2c0b6' : '#3d3d3a'),
            height: 40
          }
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (!process.env.MNEMO_QA_DIR) trackWinState(mainWindow)
  watchAutoZoom(mainWindow)
  mainWindow.on('ready-to-show', () => {
    if (saved.maximized) mainWindow?.maximize()
    if (saved.fullscreen) mainWindow?.setFullScreen(true)
    mainWindow?.show()
  })
  // F11 : plein écran, comme dans un navigateur.
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      e.preventDefault()
      mainWindow?.setFullScreen(!mainWindow.isFullScreen())
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:/.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Raccourci global : crée une carte depuis le texte copié, depuis n'importe quelle application. */
function setupQuickAdd(): void {
  if (!getSettings().quickAdd) return
  const trigger = (): void => {
    const text = clipboard.readText().trim()
    if (!mainWindow) createWindow()
    mainWindow?.show()
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
    // La fenêtre peut être en train de se charger : on laisse l'interface s'initialiser.
    setTimeout(() => emit(mainWindow, 'quick-add', text.slice(0, 4000)), mainWindow?.webContents.isLoading() ? 1500 : 50)
  }
  // Sur Mac, ⌘⇧C ouvre l'inspecteur des navigateurs : on ne le détourne pas.
  const accelerators = process.platform === 'darwin' ? ['CommandOrControl+Alt+Shift+C'] : ['Super+Shift+C', 'CommandOrControl+Alt+Shift+C']
  for (const accel of accelerators) {
    try {
      if (globalShortcut.register(accel, trigger)) return
    } catch {
      /* raccourci refusé, on essaie le suivant */
    }
  }
}

/** Notification système à l'heure choisie, avec le nombre de cartes dues. */
function setupReminders(): void {
  let lastDay = ''
  setInterval(() => {
    const s = getSettings()
    if (!s.reminderEnabled) return
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const day = now.toDateString()
    if (hhmm < s.reminderTime || lastDay === day) return
    lastDay = day
    const d = dueSummary()
    const total = d.due + d.learning
    if (total === 0 || !Notification.isSupported()) return
    const n = new Notification({
      title: 'Mnémo',
      body: s.language === 'fr' ? `${total} carte${total > 1 ? 's' : ''} à réviser aujourd’hui.` : `${total} card${total > 1 ? 's' : ''} due today.`
    })
    n.on('click', () => {
      if (!mainWindow) createWindow()
      mainWindow?.show()
      mainWindow?.focus()
    })
    n.show()
  }, 30_000)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('app.mnemo')
    installMenu(process.platform, 'Mnémo', is.dev)

    protocol.handle('mnemo-media', (req) => {
      const file = new URL(req.url).hostname + new URL(req.url).pathname.replace(/\/$/, '')
      if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/.test(file)) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(join(mediaDir(), file)).toString())
    })

    // Documents de la bibliothèque (PDF, images, vidéos…) servis au lecteur intégré, avec lecture partielle pour les vidéos.
    protocol.handle('mnemo-doc', (req) => {
      const path = documentFilePath(decodeURIComponent(new URL(req.url).hostname))
      if (!path) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(path).toString(), { headers: req.headers }).then((r) => {
        const headers = new Headers(r.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(r.body, { status: r.status, headers })
      })
    })

    openDb()
    registerHandlers(() => mainWindow)
    setupQuickAdd()
    setupReminders()
    startMarkdownWatch(() => emit(mainWindow, 'data-changed'))
    startAutoSync(() => emit(mainWindow, 'data-changed'))
    startPrepaAuto(() => mainWindow, emit)
    if (getSettings().bridgeEnabled) void startBridge(() => emit(mainWindow, 'data-changed')).catch((e) => console.error('Passerelle locale impossible', e))
    ensureDailyBackup().catch((e) => console.error('Sauvegarde automatique échouée', e))

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    if (process.env.MNEMO_QA_DIR && !process.env.MNEMO_QA_TOUR) setSettings({ tourDone: true })
    createWindow()
    if (process.env.MNEMO_QA_DIR && mainWindow) {
      const win = mainWindow
      win.webContents.once('did-finish-load', () => {
        const load = process.env.MNEMO_QA_TOUR ? import('./qa-tour').then((m) => m.runTour) : process.env.MNEMO_QA_ECO ? import('./qa-eco').then((m) => m.runEco) : process.env.MNEMO_QA_MATH ? import('./qa-math').then((m) => m.runMath) : process.env.MNEMO_QA_QUIZ ? import('./qa-quiz').then((m) => m.runQuiz) : process.env.MNEMO_QA_ASSISTANT ? import('./qa-assistant').then((m) => m.runAssistant) : process.env.MNEMO_QA_BRIDGE ? import('./qa-bridge').then((m) => m.runBridge) : process.env.MNEMO_QA_SKINS ? import('./qa-skins').then((m) => m.runSkins) : process.env.MNEMO_QA_OCCLUSION ? import('./qa-occlusion').then((m) => m.runOcclusion) : process.env.MNEMO_QA_KEY ? import('./qa-key').then((m) => m.runKey) : process.env.MNEMO_QA_PDFEXPORT ? import('./qa-pdf').then((m) => m.runPdfExport) : process.env.MNEMO_QA_SHEET ? import('./qa-sheet').then((m) => m.runSheet) : process.env.MNEMO_QA_COLORS ? import('./qa-colors').then((m) => m.runColors) : process.env.MNEMO_QA_LAYOUT ? import('./qa-layout').then((m) => m.runLayout) : process.env.MNEMO_QA_REVIEW ? import('./qa-review').then((m) => m.runReview) : process.env.MNEMO_QA_CARDS ? import('./qa-cards').then((m) => m.runCards) : process.env.MNEMO_QA_TRIAGE ? import('./qa-triage').then((m) => m.runTriage) : process.env.MNEMO_QA_HOME ? import('./qa-home').then((m) => m.runHome) : process.env.MNEMO_QA_VIEWER ? import('./qa-viewer').then((m) => m.runViewer) : process.env.MNEMO_QA_SIZES ? import('./qa-sizes').then((m) => m.runSizes) : import('./qa').then((m) => m.runQa)
        load
          .then((run) => run(win, process.env.MNEMO_QA_DIR as string))
          .catch((e) => console.error('QA', e))
          .finally(() => setTimeout(() => app.quit(), 500))
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    stopAutoSync()
    stopPrepaAuto()
    stopMarkdownWatch()
    void stopBridge()
    globalShortcut.unregisterAll()
    void shutdownLocalAi()
    try {
      syncOnQuit()
    } catch {
      /* la synchro de fermeture ne doit jamais empêcher de quitter */
    }
    closeDb()
  })
}
