export type NoteKind = 'basic' | 'basic-reverse' | 'cloze' | 'typed' | 'occlusion'
export type Rating = 1 | 2 | 3 | 4 // Again, Hard, Good, Easy
export type CardState = 0 | 1 | 2 | 3 // New, Learning, Review, Relearning

export type ThemeMode = 'light' | 'dark' | 'system'
export type Language = 'fr' | 'en'

export interface Settings {
  theme: ThemeMode
  language: Language
  fontScale: number
  autoZoom: boolean
  newPerDay: number
  retention: number
  userName: string
  dyslexia: boolean
  /** Thème coloré choisi (identifiant de src/shared/skins.ts), vide = clair/sombre/système. */
  skin: string
  /** Couleur d'accent personnalisée (#rrggbb), vide = celle du thème. */
  accentColor: string
  /** Police des cartes pendant la révision : vide = empattement (serif), sinon « sans », « mono » ou « readable » (Atkinson). */
  cardFont: '' | 'sans' | 'mono' | 'readable'
  /** Taille du texte des cartes (1 = normal). */
  cardScale: number
  cardAlign: 'left' | 'center'
  showTimer: boolean
  onboarded: boolean
  // IA (la clé d'API n'est jamais ici : elle est dans le coffre du système)
  aiProvider: 'none' | 'builtin' | 'ollama' | 'openai' | 'anthropic'
  aiModel: string
  aiBaseUrl: string
  aiPriceIn: number
  aiPriceOut: number
  aiMonthlyCap: number
  /** Si le fournisseur en ligne échoue (hors ligne, limite atteinte), reprendre avec le modèle installé sur le PC. */
  aiFallbackLocal: boolean
  /** Un deuxième passage de l'IA relit chaque carte (exactitude, clarté) avant de l'ajouter. */
  aiReview: boolean
  // Synchronisation
  syncMode: 'off' | 'folder'
  syncFolder: string
  deviceName: string
  // Rappels
  reminderEnabled: boolean
  reminderTime: string
  // Intégrations
  quickAdd: boolean
  /** Passerelle locale (127.0.0.1) pour connecter Claude / un assistant. Désactivée par défaut. */
  bridgeEnabled: boolean
  obsidianFolder: string
  obsidianWatch: boolean
  prepaUrl: string
  prepaGuarantee: boolean
  // Synchronisation automatique du Cahier de Prépa au lancement (activée après un premier import)
  prepaAuto: boolean
  prepaDeckRoot: string
  prepaNotebook: boolean
  prepaMakeCards: boolean
  prepaMakeSummary: boolean
  prepaCardsPerDoc: number
  prepaLastSync: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'fr',
  fontScale: 1,
  autoZoom: true,
  newPerDay: 20,
  retention: 0.9,
  userName: '',
  dyslexia: false,
  skin: '',
  accentColor: '',
  cardFont: '',
  cardScale: 1,
  cardAlign: 'left',
  showTimer: false,
  onboarded: false,
  aiProvider: 'builtin',
  aiModel: 'balanced',
  aiBaseUrl: '',
  aiPriceIn: 1,
  aiPriceOut: 5,
  aiMonthlyCap: 5,
  aiFallbackLocal: true,
  aiReview: true,
  syncMode: 'off',
  syncFolder: '',
  deviceName: '',
  reminderEnabled: false,
  reminderTime: '18:00',
  quickAdd: true,
  bridgeEnabled: false,
  obsidianFolder: '',
  obsidianWatch: false,
  prepaUrl: 'https://cahier-de-prepa.fr/ecg1-clemenceau/',
  prepaGuarantee: true,
  prepaAuto: false,
  prepaDeckRoot: 'Prépa',
  prepaNotebook: true,
  prepaMakeCards: true,
  prepaMakeSummary: true,
  prepaCardsPerDoc: 12,
  prepaLastSync: 0
}

export interface DeckInfo {
  id: string
  parentId: string | null
  name: string
  fullName: string
  depth: number
  hasChildren: boolean
  color: string | null
  newPerDay: number | null
  newCount: number
  learnCount: number
  dueCount: number
  totalCards: number
}

export interface NoteInput {
  kind: NoteKind
  deckId: string
  fields: Record<string, string>
  tags: string[]
  /** Identifiant de la source externe (ex. fichier Markdown), pour la resynchronisation. */
  source?: string | null
}

export interface NoteCardInfo {
  id: string
  ord: number
  state: CardState
  due: number
  suspended: boolean
  deckId: string
}

export interface NoteRecord {
  id: string
  kind: NoteKind
  fields: Record<string, string>
  tags: string[]
  createdAt: number
  updatedAt: number
  cards: NoteCardInfo[]
}

export interface CardRow {
  cardId: string
  noteId: string
  kind: NoteKind
  ord: number
  deckId: string
  deckName: string
  fields: Record<string, string>
  tags: string[]
  state: CardState
  due: number
  suspended: boolean
  reps: number
  lapses: number
  stability: number
  difficulty: number
  createdAt: number
}

export interface SearchQuery {
  text: string
  deckId: string | null
  state: 'all' | 'new' | 'learning' | 'review' | 'suspended' | 'due'
  tag: string | null
  sort: 'created' | 'due' | 'lapses' | 'alpha'
  limit: number
  offset: number
}

export interface SearchResult {
  rows: CardRow[]
  total: number
}

/** Une carte prête à être révisée. */
export interface StudyCard {
  cardId: string
  noteId: string
  deckId: string
  deckName: string
  kind: NoteKind
  ord: number
  fields: Record<string, string>
  tags: string[]
  state: CardState
  /** Délai (ms) avant la prochaine échéance pour chaque bouton. */
  intervals: Record<Rating, number>
}

export interface StudyCounts {
  newCount: number
  learnCount: number
  dueCount: number
}

export interface DayStat {
  day: string
  count: number
  correct: number
}

export interface StatsData {
  today: { reviews: number; newCards: number; timeMs: number; correct: number }
  streak: number
  retention: number | null
  history: DayStat[]
  forecast: { day: string; count: number }[]
  states: { new: number; learning: number; young: number; mature: number; suspended: number }
  totalCards: number
  totalReviews: number
  totalTimeMs: number
  hardest: { cardId: string; front: string; lapses: number; deckName: string }[]
}

export interface BackupInfo {
  name: string
  size: number
  createdAt: number
}

export interface AppInfo {
  version: string
  dataDir: string
  dbPath: string
  platform: string
}

export * from './types-extra'
