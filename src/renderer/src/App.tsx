import { FileUp, PanelLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Job, PrepaAutoEvent } from '@shared/types'
import { call } from './api'
import { Editor } from './components/Editor'
import { ImportWizard } from './components/ImportWizard'
import { Onboarding } from './components/Onboarding'
import { Palette } from './components/Palette'
import { Sidebar } from './components/Sidebar'
import { useT } from './i18n'
import { DeckPage } from './pages/DeckPage'
import { DocViewer } from './pages/DocViewer'
import { AiPage } from './pages/AiPage'
import { Assistant } from './pages/Assistant'
import { Resources } from './pages/Resources'
import { Packs } from './pages/Packs'
import { Quiz } from './pages/Quiz'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { Home } from './pages/Home'
import { Integrations } from './pages/Integrations'
import { Notebook } from './pages/Notebook'
import { Prepa } from './pages/Prepa'
import { SyncPage } from './pages/SyncPage'
import { Library } from './pages/Library'
import { Review } from './pages/Review'
import { Settings } from './pages/Settings'
import { Sheets } from './pages/Sheets'
import { Stats } from './pages/Stats'
import { skinById } from '@shared/skins'
import { shortcut } from './lib/platform'
import { SKIN_VAR_NAMES, skinVars } from './lib/skins'
import { useStore } from './store'

const jobStatus = new Map<string, Job['status']>()

function useAppearance(): void {
  const { theme, skin, accentColor, fontScale, dyslexia, language, cardFont, cardScale, cardAlign } = useStore((s) => s.settings)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sk = skinById(skin)
    const apply = (): void => {
      const dark = sk ? sk.base === 'dark' : theme === 'dark' || (theme === 'system' && mq.matches)
      const base = dark ? 'dark' : 'light'
      const root = document.documentElement
      root.dataset.theme = base
      if (sk) root.dataset.skin = sk.id
      else delete root.dataset.skin
      for (const name of SKIN_VAR_NAMES) root.style.removeProperty(name)
      for (const [name, value] of Object.entries(skinVars(sk, base, accentColor))) root.style.setProperty(name, value)
      void call('app.setTitleBar', base, sk ? { bg: sk.bg, fg: sk.text2 } : undefined)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, skin, accentColor])
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * fontScale}px`
  }, [fontScale])
  // Typographie des cartes (révision) : trois variables, posées seulement si elles s'écartent du réglage par défaut.
  useEffect(() => {
    const root = document.documentElement.style
    const fonts: Record<string, string> = {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
      readable: "'Atkinson Hyperlegible', var(--font-sans)"
    }
    const set = (name: string, value: string | null): void => {
      if (value) root.setProperty(name, value)
      else root.removeProperty(name)
    }
    set('--card-font', fonts[cardFont] ?? null)
    set('--card-scale', cardScale && cardScale !== 1 ? String(Math.min(1.8, Math.max(0.7, cardScale))) : null)
    set('--card-align', cardAlign === 'center' ? 'center' : null)
  }, [cardFont, cardScale, cardAlign])
  useEffect(() => {
    if (dyslexia) document.documentElement.dataset.font = 'dyslexia'
    else delete document.documentElement.dataset.font
  }, [dyslexia])
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
}

const NARROW = 880

/**
 * Fenêtre étroite : la barre latérale se replie d'elle-même (et redevient comme l'utilisateur la voulait quand la fenêtre
 * s'élargit). Dans ce mode elle s'ouvre en tiroir par-dessus le contenu et se referme quand on choisit une page.
 */
function useNarrow(): boolean {
  const { setSidebar, route } = useStore()
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW)
  const wanted = useRef(true)
  const prev = useRef(false)
  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth < NARROW)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  useEffect(() => {
    if (narrow && !prev.current) {
      wanted.current = useStore.getState().sidebarOpen
      setSidebar(false)
    } else if (!narrow && prev.current) setSidebar(wanted.current)
    prev.current = narrow
  }, [narrow, setSidebar])
  // En mode tiroir, choisir une page referme la barre latérale.
  useEffect(() => {
    if (narrow) setSidebar(false)
  }, [route, narrow, setSidebar])
  return narrow
}

function useGlobalShortcuts(): void {
  const { sidebarOpen, setSidebar, setPalette, palette, openEditor, editor, route } = useStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // « ? » ouvre l'aide des raccourcis, sauf quand on est en train d'écrire.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) {
        e.preventDefault()
        useStore.getState().setShortcuts(!useStore.getState().shortcuts)
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setPalette(!palette)
      } else if (k === 'n' && !editor) {
        e.preventDefault()
        openEditor({ deckId: route.name === 'deck' ? route.id : null })
      } else if (k === 'b' && !e.shiftKey && !(e.target as HTMLElement).closest('textarea')) {
        e.preventDefault()
        setSidebar(!sidebarOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen, setSidebar, setPalette, palette, openEditor, editor, route])
}

export default function App(): React.JSX.Element | null {
  const t = useT()
  const { ready, init, route, sidebarOpen, setSidebar, palette, shortcuts, editor, toasts, onboarding, bump, openEditor, toast, importer, openImport, go } = useStore()
  const [dragging, setDragging] = useState(false)
  useAppearance()
  useGlobalShortcuts()
  const narrow = useNarrow()

  useEffect(() => {
    void init()
  }, [init])

  // Événements venant du processus principal : synchro, dossier Markdown surveillé, ajout rapide.
  useEffect(
    () =>
      window.mnemo.onEvent((e) => {
        if (e.type === 'jobs') {
          const list = e.payload as Job[]
          useStore.getState().setJobs(list)
          // Une tâche vient de se terminer : notification en bas de l'écran.
          for (const j of list) {
            const was = jobStatus.get(j.id)
            jobStatus.set(j.id, j.status)
            if (was === 'running' && j.status !== 'running' && j.kind !== 'scan') {
              toast(`${j.title} — ${j.result || (j.status === 'cancelled' ? t('act.cancelled') : '')}`, {
                kind: j.status === 'error' ? 'error' : undefined,
                action: j.docId ? { label: t('act.open'), run: () => go({ name: 'doc', id: j.docId as string }) } : { label: t('act.title'), run: () => go({ name: 'home' }) }
              })
              if (j.status === 'done') void bump()
            } else if (was === undefined) jobStatus.set(j.id, j.status)
          }
        } else if (e.type === 'data-changed') void bump()
        else if (e.type === 'quick-add') {
          openEditor({ prefill: { text: String(e.payload ?? '') } })
          toast(t('review.quickAdded'))
        } else if (e.type === 'prepa-auto') {
          const p = e.payload as PrepaAutoEvent
          if (p.state !== 'done') return
          const r = p.result
          if (r.downloaded + r.cards + r.events > 0) toast(t('pp.autoNew', { docs: r.downloaded, cards: r.cards, events: r.events }), { action: { label: t('nav.prepa'), run: () => go({ name: 'prepa' }) } })
          else if (p.needLogin) toast(t('pp.autoLogin'), { action: { label: t('nav.prepa'), run: () => go({ name: 'prepa' }) } })
        }
      }),
    [bump, openEditor, toast, t, go]
  )

  // Glisser-déposer un fichier n'importe où : l'assistant d'import s'ouvre dessus.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const f = e.dataTransfer?.files[0]
      if (f) {
        const path = window.mnemo.pathForFile(f)
        if (path) openImport({ path })
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [openImport])

  if (!ready) return null
  const reviewing = route.name === 'review'

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'} ${narrow ? 'narrow' : ''} ${window.mnemo.platform === 'darwin' ? 'mac' : ''}`}>
      <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
      <div className="titlebar">
        <div className="titlebar-drag" />
      </div>
      {!sidebarOpen && (
        <button className="icon-btn floating-toggle no-drag" onClick={() => setSidebar(true)} title={`${t('nav.sidebar')} (${shortcut('Ctrl+B')})`} aria-label={t('nav.sidebar')}>
          <PanelLeft size={18} />
        </button>
      )}
      <Sidebar />
      <main className="main">
          {route.name === 'review' && <Review deckId={route.deckId} />}
        <div className="main-scroll" hidden={reviewing} key={route.name + ('id' in route ? route.id : '')}>
          {route.name === 'home' && <Home />}
          {route.name === 'deck' && <DeckPage id={route.id} />}
          {route.name === 'library' && <Library initialDeck={route.deckId} initialText={route.text} />}
          {route.name === 'stats' && <Stats />}
          {route.name === 'settings' && <Settings />}
          {route.name === 'notebook' && <Notebook />}
          {route.name === 'ai' && <AiPage />}
          {route.name === 'assistant' && <Assistant />}
          {route.name === 'resources' && <Resources />}
          {route.name === 'packs' && <Packs />}
          {route.name === 'quiz' && <Quiz />}
          {route.name === 'sync' && <SyncPage />}
          {route.name === 'integrations' && <Integrations />}
          {route.name === 'prepa' && <Prepa />}
          {route.name === 'doc' && <DocViewer id={route.id} />}
          {route.name === 'sheets' && <Sheets />}
        </div>
      </main>

      {editor && <Editor />}
      {palette && <Palette />}
      {shortcuts && <ShortcutsHelp />}
      {onboarding && <Onboarding />}
      {importer && <ImportWizard />}
      {dragging && (
        <div className="drop-overlay">
          <div>
            <FileUp size={28} color="var(--accent)" />
            {t('imp.drop')}
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind ?? ''}`}>
            {x.text}
            {x.action && <button onClick={x.action.run}>{x.action.label}</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
