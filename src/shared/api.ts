import type {
  AiCallRow,
  AiCardProposal,
  AiDiagnosis,
  AiEstimate,
  AiProviderId,
  AiStatus,
  DocumentRow,
  LocalAiStatus,
  DocInfo,
  FreeModel,
  Job,
  PrepaAutoEvent,
  PrepaImportOptions,
  PrepaImportResult,
  PrepaScan,
  AnkiImportReport,
  AnkiProfileInfo,
  ImportRequest,
  ImportResult,
  ImportSource,
  AppInfo,
  BackupInfo,
  DayLoad,
  DeckInfo,
  DuplicateGroup,
  Entry,
  IntegrationInfo,
  MarkdownImportReport,
  NoteInput,
  NoteRecord,
  NotionPage,
  BridgeInfo,
  AssistantChatReq,
  AssistantChatRes,
  AssistantCard,
  AssistantSheet,
  PlanItem,
  Rating,
  SearchQuery,
  SearchResult,
  Settings,
  StatsData,
  StudyCard,
  StudyCounts,
  Subject,
  SyncResult,
  SyncStatus,
  Task
} from './types'

/** Contrat IPC entre le processus principal (SQLite) et l'interface. */
export interface Api {
  'app.info': () => AppInfo
  'app.setTitleBar': (theme: 'light' | 'dark', colors?: { bg: string; fg: string }) => void
  'app.openDataDir': () => void
  'app.openExternal': (url: string) => void

  'settings.get': () => Settings
  'settings.set': (patch: Partial<Settings>) => Settings

  'deck.list': () => DeckInfo[]
  'deck.create': (name: string, parentId: string | null) => string
  'deck.rename': (id: string, name: string) => void
  'deck.update': (id: string, patch: { newPerDay?: number | null; color?: string | null }) => void
  'deck.delete': (id: string) => void

  'note.get': (id: string) => NoteRecord | null
  'note.add': (input: NoteInput) => string
  'note.update': (id: string, input: Omit<NoteInput, 'deckId'> & { deckId?: string }) => void
  'note.delete': (noteIds: string[]) => void
  'note.checkDuplicate': (kind: NoteInput['kind'], firstField: string, excludeNoteId?: string) => boolean

  'card.search': (q: SearchQuery) => SearchResult
  'card.move': (cardIds: string[], deckId: string) => void
  'card.suspend': (cardIds: string[], suspended: boolean) => void
  'card.reset': (cardIds: string[]) => void
  'tags.list': () => string[]

  'study.counts': (deckId: string | null) => StudyCounts
  'study.next': (deckId: string | null) => StudyCard | null
  'study.answer': (cardId: string, rating: Rating, durationMs: number) => void
  'study.undo': () => StudyCard | null
  'study.bury': (cardId: string) => void

  'stats.get': (deckId: string | null) => StatsData

  'media.saveImage': (bytes: ArrayBuffer, mime: string) => string

  'backup.list': () => BackupInfo[]
  'backup.create': () => BackupInfo
  'backup.restore': (name: string) => void

  'data.exportJson': () => string | null
  'data.importCsv': (deckId: string) => { added: number; skipped: number } | null
  'data.createSample': () => string
  'data.exportCsv': (deckId: string | null) => string | null
  'data.exportMarkdown': (deckId: string | null) => string | null

  'import.profiles': () => AnkiProfileInfo[]
  'import.pick': () => ImportSource | null
  'import.inspect': (path: string) => ImportSource
  'import.run': (req: ImportRequest) => ImportResult
  'import.documentText': (path: string) => string
  'anki.import': () => AnkiImportReport | null
  'anki.export': (deckId: string | null) => string | null

  'subject.list': () => Subject[]
  'subject.save': (s: Partial<Subject> & { name: string }) => string
  'subject.delete': (id: string) => void
  'entry.list': () => Entry[]
  'entry.save': (e: Partial<Entry> & { title: string; kind: Entry['kind'] }) => string
  'entry.delete': (id: string) => void
  'task.list': () => Task[]
  'task.save': (t: Partial<Task> & { title: string }) => string
  'task.toggle': (id: string, done: boolean) => void
  'task.delete': (id: string) => void
  'planning.items': () => PlanItem[]
  'planning.load': (fromDay: string, days: number) => DayLoad[]
  'planning.exportIcs': () => string | null

  'ai.status': () => AiStatus
  'ai.configure': (p: {
    provider?: AiProviderId
    model?: string
    baseUrl?: string
    priceIn?: number
    priceOut?: number
    monthlyCap?: number
    key?: string | null
  }) => AiStatus
  'ai.openrouterModels': () => FreeModel[]
  'ai.test': () => { ok: boolean; message: string; models?: string[] }
  'ai.estimate': (text: string, count: number) => AiEstimate
  'ai.generate': (text: string, count: number, lang: 'fr' | 'en', hint: string) => AiCardProposal[]
  'ai.diagnose': (front: string, back: string, kind: string) => AiDiagnosis
  'ai.explain': (cardId: string) => string
  'ai.makeSheet': (title: string, text: string) => string
  'ai.pickFile': () => { name: string; text: string } | null
  'ai.log': () => AiCallRow[]

  'ai.local.status': () => LocalAiStatus
  'ai.local.download': (id: string) => void
  'ai.local.cancel': () => void
  'ai.local.delete': (id: string) => void
  'ai.local.select': (id: string) => AiStatus

  'prepa.status': () => { baseUrl: string; hasSavedLogin: boolean }
  'prepa.login': (baseUrl: string, id: string, password: string, remember: boolean) => { ok: boolean; message: string }
  'prepa.loginWindow': (baseUrl: string) => void
  'prepa.logout': () => void
  'prepa.scan': (baseUrl: string) => PrepaScan
  'prepa.import': (opts: PrepaImportOptions) => PrepaImportResult
  'prepa.cancel': () => void
  'prepa.autoNow': () => PrepaAutoEvent

  'jobs.list': () => Job[]
  'jobs.cancel': (id: string) => void
  'jobs.clear': () => void
  'docs.list': () => DocumentRow[]
  'docs.info': (id: string) => DocInfo
  'docs.exportPdf': (title: string, subtitle: string, html: string, css: string) => string | null
  'app.reveal': (path: string) => void
  'docs.setCategory': (id: string, category: string) => void
  'docs.source': (id: string) => string
  'docs.saveSource': (id: string, content: string) => void
  'docs.saveNotes': (id: string, notes: string) => void
  'docs.reread': (id: string) => number
  'docs.add': () => { added: number; ids: string[]; failed: string[] }
  'docs.addPaths': (paths: string[]) => { added: number; ids: string[]; failed: string[] }
  'docs.open': (id: string) => void
  /** Copie l'image d'un document dans les médias des cartes (pour l'occlusion d'image). */
  'docs.toMedia': (id: string) => string
  'docs.summary': (id: string) => string
  'docs.makeSummary': (id: string) => string
  'docs.makeCards': (id: string, count: number) => number
  'docs.text': (id: string) => string
  'docs.delete': (id: string, removeFile: boolean) => void

  'sync.status': () => SyncStatus
  'sync.pickFolder': () => string | null
  'sync.setup': (folder: string, passphrase: string) => SyncStatus
  'sync.now': () => SyncResult
  'sync.disable': () => SyncStatus

  'integrations.list': () => IntegrationInfo[]
  'obsidian.pickFolder': () => string | null
  'obsidian.scan': () => MarkdownImportReport
  'dup.find': () => DuplicateGroup[]
  'dup.merge': (keepId: string, removeIds: string[]) => void
  'notion.connect': (token: string) => NotionPage[]
  'notion.pageText': (id: string) => string
  'notion.forget': () => void
  'notion.status': () => boolean
  'assistant.chat': (req: AssistantChatReq) => AssistantChatRes
  'assistant.makeCards': (source: string, count: number, hint: string) => AssistantCard[]
  'assistant.addCards': (deck: string, cards: AiCardProposal[]) => { added: number; deckId: string }
  'assistant.makeSheets': (source: string, title: string) => AssistantSheet[]
  'assistant.makeExercises': (source: string, title: string, count: number) => AssistantSheet
  'bridge.status': () => BridgeInfo
  'bridge.set': (enabled: boolean) => BridgeInfo
}

export type ApiName = keyof Api
export type ApiArgs<K extends ApiName> = Parameters<Api[K]>
export type ApiResult<K extends ApiName> = ReturnType<Api[K]>
