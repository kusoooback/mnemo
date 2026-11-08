import { create } from 'zustand'
import type { DeckInfo, Job, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { call } from './api'

export type Route =
  | { name: 'home' }
  | { name: 'deck'; id: string }
  | { name: 'review'; deckId: string | null }
  | { name: 'library'; deckId?: string | null; text?: string }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'notebook' }
  | { name: 'ai' }
  | { name: 'assistant' }
  | { name: 'resources' }
  | { name: 'packs' }
  | { name: 'quiz' }
  | { name: 'sync' }
  | { name: 'integrations' }
  | { name: 'prepa' }
  | { name: 'doc'; id: string }
  | { name: 'sheets' }

export interface EditorState {
  noteId?: string
  deckId?: string | null
  /** Contenu pré-rempli (ajout rapide depuis le presse-papiers). */
  prefill?: { text?: string; image?: string }
}

export interface Toast {
  id: number
  text: string
  kind?: 'error'
  action?: { label: string; run: () => void }
  /** Vrai pendant l'animation de sortie, juste avant que la notification disparaisse. */
  leaving?: boolean
  /** Durée d'affichage en ms (sert aussi à la barre de progression). */
  life?: number
}

interface Store {
  ready: boolean
  settings: Settings
  decks: DeckInfo[]
  route: Route
  sidebarOpen: boolean
  jobs: Job[]
  setJobs: (jobs: Job[]) => void
  palette: boolean
  /** Fenêtre d'aide des raccourcis clavier. */
  shortcuts: boolean
  editor: EditorState | null
  /** Texte transmis à la page de génération IA (Notion, fichier…). */
  aiSeed: string | null
  onboarding: boolean
  /** Visite guidée (premier lancement, ou rejouée à la demande). */
  tour: boolean
  /** Assistant d'import ouvert (éventuellement sur un fichier déposé ou pour un deck précis). */
  importer: { path?: string; paths?: string[]; deckId?: string | null } | null
  toasts: Toast[]
  /** Incrémenté à chaque modification de données pour que les écrans se rechargent. */
  rev: number

  init: () => Promise<void>
  refreshDecks: () => Promise<void>
  bump: () => Promise<void>
  go: (route: Route) => void
  patchSettings: (patch: Partial<Settings>) => Promise<void>
  setSidebar: (open: boolean) => void
  setPalette: (open: boolean) => void
  setShortcuts: (open: boolean) => void
  openEditor: (state: EditorState | null) => void
  setAiSeed: (text: string | null) => void
  setOnboarding: (on: boolean) => void
  setTour: (on: boolean) => void
  openImport: (state: { path?: string; paths?: string[]; deckId?: string | null } | null) => void
  toast: (text: string, opts?: Partial<Omit<Toast, 'id' | 'text'>>) => void
}

let toastId = 1

export const useStore = create<Store>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  decks: [],
  route: { name: 'home' },
  sidebarOpen: true,
  jobs: [],
  setJobs: (jobs) => set({ jobs }),
  palette: false,
  shortcuts: false,
  editor: null,
  aiSeed: null,
  onboarding: false,
  tour: false,
  importer: null,
  toasts: [],
  rev: 0,

  init: async () => {
    const [settings, decks, jobs] = await Promise.all([call('settings.get'), call('deck.list'), call('jobs.list')])
    set({ settings, decks, jobs, ready: true, onboarding: !settings.onboarded && decks.length === 0, tour: !settings.tourDone })
  },
  refreshDecks: async () => set({ decks: await call('deck.list') }),
  bump: async () => {
    const decks = await call('deck.list')
    set((s) => ({ decks, rev: s.rev + 1 }))
  },
  go: (route) => set({ route, palette: false }),
  patchSettings: async (patch) => set({ settings: await call('settings.set', patch) }),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  setPalette: (palette) => set({ palette }),
  setShortcuts: (shortcuts) => set({ shortcuts, palette: false }),
  openEditor: (editor) => set({ editor, palette: false }),
  setAiSeed: (aiSeed) => set({ aiSeed }),
  setOnboarding: (onboarding) => set({ onboarding }),
  setTour: (tour) => set({ tour }),
  openImport: (importer) => set({ importer, palette: false }),
  toast: (text, opts) => {
    const id = toastId++
    const life = opts?.action ? 6000 : opts?.kind === 'error' ? 5000 : 3200
    set((s) => ({ toasts: [...s.toasts, { id, text, life, ...opts }] }))
    // Fondu de sortie (260 ms) avant de retirer la notification.
    setTimeout(() => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })), life)
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), life + 260)
    void get
  }
}))

// Accès de débogage pour le contrôle de mise en page automatisé (rien de sensible : l'état est déjà celui de la page).
;(window as unknown as { __mnemo?: typeof useStore }).__mnemo = useStore
