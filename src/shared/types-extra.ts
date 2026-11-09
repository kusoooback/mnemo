/* Types des modules ajoutés après le noyau : Anki, cahier de texte, IA, synchro, intégrations. */

export type AiProviderId = 'none' | 'builtin' | 'ollama' | 'openrouter' | 'openai' | 'anthropic'

/* ---------- Anki ---------- */
export interface AnkiImportReport {
  decks: number
  notes: number
  /** Notes déjà présentes (réimport) : seules leurs nouvelles révisions sont ajoutées. */
  existing: number
  cards: number
  reviews: number
  media: number
  skipped: number
  warnings: string[]
}

/* ---------- Cahier de texte ---------- */
export type EntryKind = 'cours' | 'devoir' | 'examen' | 'projet'

export interface Subject {
  id: string
  name: string
  color: string
  coefficient: number
  deckId: string | null
}

export interface Entry {
  id: string
  subjectId: string | null
  kind: EntryKind
  title: string
  notes: string
  dueAt: number | null
  status: 'todo' | 'done'
  deckIds: string[]
}

export interface Task {
  id: string
  subjectId: string | null
  title: string
  dueAt: number | null
  done: boolean
  recurrence: 'none' | 'daily' | 'weekly'
}

export interface PlanItem {
  entryId: string
  title: string
  subjectName: string | null
  color: string
  dueAt: number
  daysLeft: number
  totalCards: number
  newCards: number
  learnedCards: number
  dueNow: number
  /** Nouvelles cartes par jour pour tout avoir vu 2 jours avant l'échéance. */
  suggestedNewPerDay: number
  /** Charge moyenne attendue par jour (nouvelles + révisions). */
  avgPerDay: number
  deckIds: string[]
  deckNames: string[]
  currentLimits: (number | null)[]
  /** Part du programme encore retenue le jour J si l'élève ne révisait plus rien (0 à 1). */
  readiness: number
  /** Cartes que le planning fera revoir avant l'échéance. */
  revisitBefore: number
  kind: EntryKind
}

export interface DayLoad {
  day: string
  due: number
  planned: number
  entries: { id: string; title: string; kind: EntryKind; color: string }[]
  tasks: number
}

/* ---------- IA ---------- */
export interface AiStatus {
  /** L'IA est prête à répondre (modèle installé, clé saisie, serveur local choisi…). */
  ready: boolean
  provider: AiProviderId
  model: string
  baseUrl: string
  hasKey: boolean
  monthCost: number
  monthCalls: number
  cap: number
  priceIn: number
  priceOut: number
}

/** Modèle gratuit proposé par OpenRouter. */
export interface FreeModel {
  id: string
  name: string
  context: number
}

export interface AiCardProposal {
  kind: 'basic' | 'cloze'
  front: string
  back: string
  text: string
  extra: string
  tags: string[]
}

export interface AiEstimate {
  chars: number
  tokensIn: number
  tokensOut: number
  cost: number
  chunks: number
  overCap: boolean
}

export interface AiDiagnosis {
  verdict: 'ok' | 'ambiguous' | 'too-long' | 'multiple-answers' | 'other'
  issues: string[]
  suggestion: { kind: 'basic' | 'cloze'; front: string; back: string; text: string; extra: string } | null
}

export interface AiCallRow {
  id: string
  at: number
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
  cost: number
  purpose: string
}

/* ---------- Synchronisation ---------- */
export interface SyncDevice {
  id: string
  name: string
  lastSync: number | null
  isSelf: boolean
}

export interface SyncResult {
  at: number
  ok: boolean
  error?: string
  devices: number
  newNotes: number
  newReviews: number
  updated: number
  recomputed: number
}

export interface SyncStatus {
  mode: 'off' | 'folder'
  folder: string
  configured: boolean
  lastSync: number | null
  deviceId: string
  devices: SyncDevice[]
  running: boolean
  lastResult: SyncResult | null
}

/* ---------- Intégrations ---------- */
export interface IntegrationInfo {
  id: string
  name: string
  description: string
  status: 'active' | 'available' | 'planned'
  priority: string
}

export interface MarkdownImportReport {
  files: number
  added: number
  updated: number
  unchanged: number
}

export interface DuplicateGroup {
  key: string
  notes: { id: string; front: string; back: string; deckName: string; reviews: number }[]
}

/* Assistant (conversation) */
export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

export type AssistantActionType = 'cards' | 'sheet' | 'exercises' | 'dictation'

/** Une action demandée par l'assistant, exécutée par l'application (jamais sans que l'utilisateur la voie). */
export interface AssistantAction {
  type: AssistantActionType
  params: Record<string, string>
}

export interface AssistantTrace {
  kind: 'search' | 'page' | 'sheet' | 'file'
  label: string
  links: { title: string; url: string }[]
}

export interface AssistantChatReq {
  history: AssistantTurn[]
  message: string
  /** Autoriser la recherche sur le web (Wikipédia, pages https) pour cette conversation. */
  web: boolean
  /** Cours dicté ou collé dans la conversation. */
  source: string
  /** Fiches jointes par l'utilisateur. */
  attached: { title: string; text: string }[]
}

export interface AssistantChatRes {
  reply: string
  actions: AssistantAction[]
  trace: AssistantTrace[]
}

export interface AssistantCard extends AiCardProposal {
  dup: boolean
}

export interface AssistantSheet {
  id: string
  title: string
}

export interface BridgeInfo {
  enabled: boolean
  running: boolean
  port: number
  /** Fichier du serveur MCP à brancher dans Claude. */
  script: string
  /** Programme qui l'exécute (Mnémo lui-même une fois installé : Node n'est pas nécessaire). */
  command: string
  /** Variables d'environnement nécessaires (vide en développement). */
  env: Record<string, string>
}

/* ---------- Partage de paquets (.mnemodeck) ---------- */
export interface PackMeta {
  name?: string
  description?: string
  author?: string
}

export interface PackPreview {
  name: string
  description: string
  author: string
  notes: number
  decks: number
  images: number
  /** Cartes déjà présentes dans ta collection (elles seront ignorées). */
  duplicates: number
  sample: string[]
}

export interface PackOpened {
  token: string
  preview: PackPreview
}

export interface PackResult {
  added: number
  duplicates: number
  skipped: number
  deck: string
}

export interface CommunityPack {
  id: string
  title: string
  description: string
  author: string
  lang: 'fr' | 'en'
  tags: string[]
  notes: number
  sha256: string
}

export interface NotionPage {
  id: string
  title: string
}

/* ---------- Import universel ---------- */
export interface AnkiSummary {
  notes: number
  cards: number
  decks: string[]
  reviews: number
  newNotes: number
  known: number
}

export interface AnkiProfileInfo {
  name: string
  dir: string
  size: number
  modified: number
}

export type ImportSource =
  | { kind: 'anki'; name: string; path: string; local: boolean; summary: AnkiSummary; warnings: string[] }
  | { kind: 'text'; name: string; path: string; text: string }
  | { kind: 'markdown'; name: string; path: string; cards: number; sample: { front: string; back: string }[] }
  | { kind: 'mnemo'; name: string; path: string; decks: number; notes: number; reviews: number }
  | { kind: 'document'; name: string; path: string; text: string; paths?: string[]; image?: boolean }
  | { kind: 'unsupported'; name: string; reason: string }

export interface TextImportRequest {
  delimiter: 'auto' | 'tab' | 'semicolon' | 'comma' | 'pipe' | 'custom'
  custom: string
  rowSeparator: string
  header: 'auto' | 'yes' | 'no'
  roles: ('front' | 'back' | 'extra' | 'tags' | 'deck' | 'kind' | 'guid' | 'skip')[]
  kind: 'auto' | 'basic' | 'basic-reverse' | 'cloze' | 'typed'
  deckMode: 'existing' | 'new' | 'column'
  deckId: string | null
  deckName: string
  html: boolean
  skipDuplicates: boolean
}

export interface ImportRequest {
  kind: 'anki' | 'markdown' | 'mnemo' | 'text'
  path: string
  name: string
  text?: string
  deckName?: string
  options?: TextImportRequest
}

export interface ImportResult {
  source: string
  added: number
  /** Déjà présentes (réimport) ou doublons ignorés. */
  existing: number
  invalid: number
  reviews: number
  decks: number
  media: number
  warnings: string[]
  deckId: string | null
}

/* ---------- IA intégrée (gratuite, sur le PC) ---------- */
export interface LocalModelInfo {
  id: 'light' | 'balanced' | 'best'
  label: string
  description: string
  sizeMb: number
  installed: boolean
  /** Chemin complet du fichier du modèle sur le disque (vide s'il n'est pas installé). */
  path: string
  recommended: boolean
}

export interface LocalAiStatus {
  gpu: string | false
  vramMb: number
  ramMb: number
  models: LocalModelInfo[]
  selected: string
  /** Dossier où sont rangés les modèles. */
  dir: string
  downloading: { id: string; downloaded: number; total: number } | null
  loaded: boolean
}

/* ---------- Cahier de Prépa et bibliothèque de documents ---------- */
export interface PrepaSubject {
  slug: string
  name: string
}

export interface PrepaDoc {
  remoteId: string
  title: string
  subject: string
  folder: string
  size: string
  publishedAt: number | null
  kind: 'doc' | 'colle'
}

export interface PrepaEvent {
  title: string
  date: number
  subject: string
  type: string
}

export interface PrepaScan {
  baseUrl: string
  siteName: string
  loggedIn: boolean
  subjects: PrepaSubject[]
  docs: PrepaDoc[]
  events: PrepaEvent[]
  protectedPages: number
  warnings: string[]
}

export interface PrepaImportOptions {
  baseUrl: string
  remoteIds: string[]
  deckRoot: string
  addToNotebook: boolean
  generateCards: boolean
  makeSummary: boolean
  cardsPerDoc: number
}

export interface PrepaProgress {
  phase: 'download' | 'read' | 'triage' | 'cards' | 'summary' | 'done' | 'error'
  index: number
  total: number
  title: string
  detail?: string
}

/** Résultat d'un passage de la synchronisation automatique (événement `prepa-auto`). */
export type PrepaAutoEvent =
  | { state: 'off' | 'busy' | 'start' }
  | { state: 'error'; message: string }
  | { state: 'done'; fresh: number; result: PrepaImportResult; needLogin: boolean }

export interface PrepaImportResult {
  downloaded: number
  skipped: number
  failed: number
  decks: number
  cards: number
  summaries: number
  events: number
  /** Documents déjà présents dont le texte a pu être relu depuis le fichier. */
  reread?: number
  /** Doublons détectés (non importés comme nouveaux cours). */
  duplicates?: number
  /** Documents écartés des cartes : énoncés, corrigés, informations pratiques. */
  ignored?: number
  /** Anciennes cartes de mauvaise qualité supprimées. */
  purged?: number
  /** Documents déjà présents remis dans la bonne matière / le bon dossier. */
  moved?: number
  warnings: string[]
}

/** Tout ce qu'il faut pour afficher un document dans le lecteur intégré. */
export interface DocInfo {
  id: string
  title: string
  subject: string
  folder: string
  ext: string
  kind: 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'office' | 'other'
  size: number
  text: string
  notes: string
  summary: string
  cards: number
  deckId: string | null
  category: string
  chapter: string
}

/** Une tâche de fond (import, création de cartes, téléchargement du modèle…). */
/** Où mène le clic sur une tâche terminée (le résultat de la tâche). */
export type JobLink =
  | { name: 'deck' | 'doc'; id: string }
  | { name: 'library'; deckId?: string | null }
  | { name: 'ai' | 'assistant' | 'prepa' | 'sheets' | 'home' }

export interface Job {
  id: string
  kind: 'prepa' | 'cards' | 'summary' | 'model' | 'scan'
  title: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  done: number
  /** 0 = durée inconnue (barre sans pourcentage). */
  total: number
  detail: string
  startedAt: number
  endedAt: number | null
  result: string
  cancellable: boolean
  cancelRequested: boolean
  /** Document créé ou concerné par la tâche (fiche prête à ouvrir). */
  docId?: string
  /** Écran à ouvrir en cliquant sur la tâche terminée ; à défaut, celui du type de tâche. */
  link?: JobLink
}

export interface DocumentRow {
  id: string
  title: string
  subject: string
  folder: string
  ext: string
  size: number
  addedAt: number
  publishedAt: number | null
  deckId: string | null
  cards: number
  hasText: boolean
  /** cours, methode, vocabulaire, exercices, corrige, admin, autre, doublon — vide tant que le tri n'a pas eu lieu. */
  category: string
  chapter: string
  dupTitle: string
  /** Fiche de révision créée par la génération IA (et non importée du site). */
  isSheet: boolean
  hasSummary: boolean
}
