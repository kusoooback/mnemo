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
  editor: EditorState | null
  /** Texte transmis à la page de génération IA (Notion, fichier…). */
  aiSeed: string | null
  onboarding: boolean
  /** Assistant d'import ouvert (éventuellement sur un fichier déposé ou pour un deck précis). */
  importer: { path?: string; deckId?: string | null } | null
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
  openEditor: (state: EditorState | null) => void
  setAiSeed: (text: string | null) => void
  setOnboarding: (on: boolean) => void
  openImport: (state: { path?: string; deckId?: string | null } | null) => void
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
  editor: null,
  aiSeed: null,
  onboarding: false,
  importer: null,
  toasts: [],
  rev: 0,

  init: async () => {
    const [settings, decks, jobs] = await Promise.all([call('settings.get'), call('deck.list'), call('jobs.list')])
    set({ settings, decks, jobs, ready: true, onboarding: !settings.onboarded && decks.length === 0 })
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
  openEditor: (editor) => set({ editor, palette: false }),
  setAiSeed: (aiSeed) => set({ aiSeed }),
  setOnboarding: (onboarding) => set({ onboarding }),
  openImport: (importer) => set({ importer, palette: false }),
  toast: (text, opts) => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, text, ...opts }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), opts?.action ? 6000 : 3200)
    void get
  }
}))

// Accès de débogage pour le contrôle de mise en page automatisé (rien de sensible : l'état est déjà celui de la page).
;(window as unknown as { __mnemo?: typeof useStore }).__mnemo = useStore
