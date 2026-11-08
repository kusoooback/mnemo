import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import type { Api } from '../shared/api'
import type { BridgeInfo } from '../shared/types-extra'
import { cancelDownload, deleteModel, downloadModel, localStatus, setLocalAiSink } from './localai'
import { deleteDocument, documentSummary, documentText as docTextOf, listDocuments, makeCards, makeSummary, openDocument } from './documents'
import { autoLogin, doLogin, electronHttp, hasSavedLogin, logout, openLoginWindow } from './prepa-electron'
import { normalizeBase, scanSite } from './prepa'
import { runImportJob, runPrepaAuto } from './prepa-auto'
import { exportPdf, revealFile } from './exportpdf'
import { cancelJob, cancelKind, clearEndedJobs, listJobs, setJobsSink, startJob, type JobHandle } from './jobs'
import { documentFilePath, addDocumentPaths, addMarkdownDocument, setDocumentCategory, addDocumentsDialog, documentInfo, documentSource, rereadDocument, saveDocumentNotes, saveDocumentSource } from './docfiles'
import { openrouterModels, aiConfigure, aiDiagnose, aiDistractors, aiEstimate, aiExplain, aiCardsFromText, aiSummarize, aiLog, aiPickFile, aiStatus, aiTest } from './ai'
import { buildApkg, importApkg } from './anki'
import { ankiProfiles, documentText, inspectSource, pickSource, runImport } from './importer'
import { createSample, exportCsv, exportJson, exportMarkdown, importCsv, saveImage } from './data'
import { createBackup, dataDir, dbPath, listBackups, restoreBackup } from './db'
import {
  findDuplicates,
  listIntegrations,
  mergeDuplicates,
  notionConnect,
  notionForget,
  notionPageText,
  notionStatus,
  pickFolder,
  scanMarkdownFolder,
  startMarkdownWatch
} from './integrations'
import * as nb from './notebook'
import { webPage } from './web'
import { bridgeState, startBridge, stopBridge } from './bridge'
import { shareCancel, shareCatalog, shareExport, shareFetch, shareInstall, sharePick } from './share'
import { assistantAddCards, assistantChat, assistantMakeCards, assistantMakeExercises, assistantMakeSheets } from './assistant'
import * as repo from './repo'
import { getStats } from './stats'
import * as study from './study'
import { syncDisable, syncNow, syncSetup, syncStatus } from './syncctl'
import { getSettings, setSettings } from './util'
import { applyAutoZoom, currentZoom } from './winstate'

const TITLEBAR = {
  light: { color: '#f9f9f7', symbolColor: '#3d3d3a' },
  dark: { color: '#151515', symbolColor: '#c2c0b6' }
}

type AsyncApi = {
  [K in keyof Api]: (...a: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<ReturnType<Api[K]>>
}

/** Ce qu'il faut pour brancher Claude : le serveur MCP livré avec Mnémo et la façon de le lancer. */
function bridgeInfo(): BridgeInfo {
  const st = bridgeState()
  const script = app.isPackaged ? join(process.resourcesPath, 'mcp', 'mnemo-mcp.mjs') : join(app.getAppPath(), 'mcp', 'mnemo-mcp.mjs')
  return {
    enabled: getSettings().bridgeEnabled,
    running: st.running,
    port: st.port,
    script,
    command: app.isPackaged ? process.execPath : 'node',
    env: app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}
  }
}

export function emit(win: BrowserWindow | null, type: string, payload?: unknown): void {
  win?.webContents.send('mnemo:event', { type, payload })
}

let modelJob: JobHandle | null = null

export function registerHandlers(getWindow: () => BrowserWindow | null): void {
  setJobsSink((list) => emit(getWindow(), 'jobs', list))
  setLocalAiSink((event, payload) => {
    emit(getWindow(), event, payload)
    if (event === 'ai-download' && modelJob) {
      const p = payload as { downloaded?: number; total?: number }
      if (p.total) modelJob.set(p.downloaded ?? 0, p.total, `${Math.round((p.downloaded ?? 0) / 1048576)} / ${Math.round(p.total / 1048576)} Mo`)
    }
  })
  const handlers: AsyncApi = {
    'app.info': () => ({ version: app.getVersion(), dataDir: dataDir(), dbPath: dbPath(), platform: process.platform }),
    'app.setTitleBar': (theme, colors) => {
      const win = getWindow()
      if (win && process.platform !== 'darwin') {
        try {
          const c = colors && /^#[0-9a-f]{6}$/i.test(colors.bg) && /^#[0-9a-f]{6}$/i.test(colors.fg) ? { color: colors.bg, symbolColor: colors.fg } : TITLEBAR[theme]
          win.setTitleBarOverlay({ ...c, height: Math.round(40 * currentZoom()) })
        } catch {
          /* non pris en charge */
        }
      }
    },
    'app.openDataDir': () => void shell.openPath(dataDir()),
    'app.openExternal': (url) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
    },

    'settings.get': () => getSettings(),
    'settings.set': (patch) => {
      const next = setSettings(patch)
      if ('autoZoom' in patch) {
        const w = getWindow()
        if (w) applyAutoZoom(w)
      }
      if ('obsidianWatch' in patch || 'obsidianFolder' in patch)
        startMarkdownWatch(() => emit(getWindow(), 'data-changed'))
      return next
    },

    'deck.list': () => repo.listDecks(),
    'deck.create': (name, parentId) => repo.createDeck(name, parentId),
    'deck.rename': (id, name) => repo.renameDeck(id, name),
    'deck.update': (id, patch) => repo.updateDeck(id, patch),
    'deck.delete': (id) => repo.deleteDeck(id),

    'note.get': (id) => repo.getNote(id),
    'note.add': (input) => repo.addNote(input),
    'note.update': (id, input) => repo.updateNote(id, input),
    'note.delete': (ids) => repo.deleteNotes(ids),
    'note.checkDuplicate': (kind, first, exclude) => repo.checkDuplicate(kind, first, exclude),

    'card.search': (q) => repo.searchCards(q),
    'card.move': (ids, deckId) => repo.moveCards(ids, deckId),
    'card.suspend': (ids, s) => repo.suspendCards(ids, s),
    'card.reset': (ids) => repo.resetCards(ids),
    'tags.list': () => repo.listTags(),

    'study.counts': (deckId) => study.counts(deckId),
    'study.next': (deckId) => study.next(deckId),
    'study.answer': (id, rating, ms) => study.answer(id, rating, ms),
    'study.undo': () => study.undo(),
    'study.bury': (id) => study.bury(id),

    'stats.get': (deckId) => getStats(deckId),

    'media.saveImage': (bytes, mime) => saveImage(bytes, mime),

    'backup.list': () => listBackups(),
    'backup.create': () => createBackup(`manuel-${Date.now()}`),
    'backup.restore': (name) => {
      restoreBackup(name)
      app.relaunch()
      app.exit(0)
    },

    'data.exportJson': () => exportJson(getWindow()),
    'data.importCsv': (deckId) => importCsv(getWindow(), deckId),
    'data.createSample': () => createSample(),
    'data.exportCsv': (deckId) => exportCsv(getWindow(), deckId),
    'data.exportMarkdown': (deckId) => exportMarkdown(getWindow(), deckId),

    'import.profiles': () => ankiProfiles(),
    'import.pick': () => pickSource(getWindow()),
    'import.inspect': (path) => inspectSource(path),
    'import.run': (req) => runImport(req),
    'import.documentText': (path) => documentText(path),
    'anki.import': async () => {
      const win = getWindow()
      const opts = {
        title: 'Importer un paquet Anki',
        properties: ['openFile' as const],
        filters: [{ name: 'Paquet Anki', extensions: ['apkg', 'colpkg'] }]
      }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return null
      return importApkg(readFileSync(res.filePaths[0]))
    },
    'anki.export': async (deckId) => {
      const win = getWindow()
      const opts = {
        title: 'Exporter en paquet Anki',
        defaultPath: 'mnemo-export.apkg',
        filters: [{ name: 'Paquet Anki', extensions: ['apkg'] }]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      writeFileSync(res.filePath, buildApkg(deckId).data)
      return res.filePath
    },

    'subject.list': () => nb.listSubjects(),
    'subject.save': (s) => nb.saveSubject(s),
    'subject.delete': (id) => nb.deleteSubject(id),
    'entry.list': () => nb.listEntries(),
    'entry.save': (e) => nb.saveEntry(e),
    'entry.delete': (id) => nb.deleteEntry(id),
    'task.list': () => nb.listTasks(),
    'task.save': (t) => nb.saveTask(t),
    'task.toggle': (id, done) => nb.toggleTask(id, done),
    'task.delete': (id) => nb.deleteTask(id),
    'planning.items': () => nb.planningItems(),
    'planning.load': (from, days) => nb.planningLoad(from, days),
    'planning.exportIcs': async () => {
      const win = getWindow()
      const opts = { title: 'Exporter le calendrier', defaultPath: 'mnemo-planning.ics', filters: [{ name: 'Calendrier', extensions: ['ics'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      writeFileSync(res.filePath, nb.buildIcs(), 'utf8')
      return res.filePath
    },

    'ai.status': () => aiStatus(),
    'ai.configure': (p) => aiConfigure(p),
    'ai.test': () => aiTest(),
    'ai.openrouterModels': () => openrouterModels(),
    'ai.estimate': (text, count) => aiEstimate(text, count),
    'ai.generate': async (text, count, lang, hint) => {
      const job = startJob('cards', 'Création des cartes', { detail: 'Démarrage…' })
      try {
        const cards = await aiCardsFromText(text, count, lang, hint, { onStep: (done, total, label) => job.set(done, total, label) })
        job.finish(`${cards.length} carte${cards.length > 1 ? 's' : ''} proposée${cards.length > 1 ? 's' : ''}.`)
        return cards
      } catch (e) {
        job.fail((e as Error).message)
        throw e
      }
    },
    'ai.makeSheet': async (title, text) => {
      const short = title.replace(/\s+/g, ' ').trim().slice(0, 70) || 'Fiche'
      const job = startJob('summary', `Fiche : ${short}`, { detail: 'Rédaction de la fiche par l’IA… (1 à 2 minutes avec un gros modèle)' })
      try {
        const md = await aiSummarize(short, text)
        // Le titre de la fiche est celui que l'IA a écrit (« # Titre »), pas les premiers mots du texte collé.
        const h1 = /^#\s+(.+)$/m.exec(md)?.[1]?.replace(/\s+/g, ' ').trim()
        const id = addMarkdownDocument(h1 && h1.length <= 90 ? h1 : short, md)
        job.attach(id)
        job.finish('Fiche prête : ouvre-la dans « Fiches ».')
        emit(getWindow(), 'data-changed')
        return id
      } catch (e) {
        job.fail((e as Error).message)
        throw e
      }
    },
    'ai.diagnose': (f, b, k) => aiDiagnose(f, b, k),
    'ai.explain': (id) => aiExplain(id),
    'ai.distractors': (items) => aiDistractors(items),
    'ai.pickFile': () => aiPickFile(getWindow()),
    'ai.log': () => aiLog(),

    'ai.local.status': () => localStatus(getSettings().aiModel || 'balanced'),
    'ai.local.download': (id) => {
      // Le téléchargement est long : on rend la main tout de suite, l'avancement arrive par événements.
      const job = startJob('model', `Téléchargement du modèle IA (${id})`, { cancellable: true, onCancel: () => void cancelDownload(), detail: 'Démarrage…' })
      modelJob = job
      void downloadModel(id)
        .then(() => {
          setSettings({ aiProvider: 'builtin', aiModel: id })
          emit(getWindow(), 'ai-ready')
          job.finish('Modèle installé : l’IA est prête.')
        })
        .catch((e: Error) => (job.cancelled ? job.finish('Téléchargement annulé.') : job.fail(e.message)))
        .finally(() => {
          modelJob = null
        })
    },
    'ai.local.cancel': () => void cancelDownload(),
    'ai.local.delete': (id) => deleteModel(id),
    'ai.local.select': (id) => {
      setSettings({ aiProvider: 'builtin', aiModel: id })
      return aiStatus()
    },

    'prepa.status': () => ({ baseUrl: getSettings().prepaUrl, hasSavedLogin: hasSavedLogin() }),
    'prepa.login': async (base, id, pw, remember) => {
      const r = await doLogin(base, id, pw, remember)
      if (r.ok) setSettings({ prepaUrl: normalizeBase(base) })
      return r
    },
    'prepa.loginWindow': async (base) => {
      await openLoginWindow(getWindow(), base)
    },
    'prepa.logout': () => logout(getSettings().prepaUrl),
    'prepa.scan': async (base) => {
      const url = normalizeBase(base)
      setSettings({ prepaUrl: url })
      const job = startJob('scan', 'Analyse du Cahier de Prépa', { detail: 'Lecture des matières, dossiers et documents…' })
      try {
        await autoLogin(url)
        const scan = await scanSite(electronHttp(), url)
        job.finish(`${scan.docs.length} documents trouvés dans ${scan.subjects.length} matières.`)
        return scan
      } catch (e) {
        job.fail((e as Error).message)
        throw e
      }
    },
    'prepa.import': async (opts) => {
      const r = await runImportJob('Import du Cahier de Prépa', opts, getWindow, emit).finally(() => emit(getWindow(), 'data-changed'))
      // Premier import réussi : on se souvient des choix et la synchronisation se fera seule à chaque lancement.
      if (r.downloaded + r.skipped > 0)
        setSettings({
          prepaUrl: normalizeBase(opts.baseUrl),
          prepaAuto: true,
          prepaDeckRoot: opts.deckRoot.trim() || 'Prépa',
          prepaNotebook: opts.addToNotebook,
          prepaMakeCards: opts.generateCards,
          prepaMakeSummary: opts.makeSummary,
          prepaCardsPerDoc: opts.cardsPerDoc
        })
      return r
    },
    'prepa.autoNow': () => runPrepaAuto(getWindow, emit, true),
    'prepa.cancel': () => {
      cancelKind('prepa')
    },

    'jobs.list': () => listJobs(),
    'jobs.cancel': (id) => cancelJob(id),
    'jobs.clear': () => clearEndedJobs(),
    'docs.list': () => listDocuments(),
    'docs.info': (id) => documentInfo(id),
    'docs.exportPdf': (title, subtitle, html, css) => exportPdf(getWindow(), { title, subtitle, html, css }),
    'app.reveal': (path) => revealFile(path),
    'docs.setCategory': (id, category) => setDocumentCategory(id, category),
    'docs.source': (id) => documentSource(id),
    'docs.saveSource': (id, content) => saveDocumentSource(id, content),
    'docs.saveNotes': (id, notes) => saveDocumentNotes(id, notes),
    'docs.reread': (id) => rereadDocument(id),
    'docs.add': async () => {
      const r = await addDocumentsDialog(getWindow())
      if (r.added) emit(getWindow(), 'data-changed')
      return r
    },
    'docs.addPaths': async (paths) => {
      const r = await addDocumentPaths(paths)
      if (r.added) emit(getWindow(), 'data-changed')
      return r
    },
    'docs.open': (id) => openDocument(id),
    'docs.toMedia': (id) => {
      const p = documentFilePath(id)
      if (!p) throw new Error('Le fichier a été déplacé ou supprimé.')
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[extname(p).slice(1).toLowerCase()]
      if (!mime) throw new Error('Format d’image non pris en charge pour l’occlusion (PNG, JPEG, GIF ou WebP).')
      const b = readFileSync(p)
      return saveImage(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, mime)
    },
    'docs.summary': (id) => documentSummary(id),
    'docs.makeSummary': (id) => makeSummary(id),
    'docs.makeCards': async (id, count) => {
      const n = await makeCards(id, count)
      emit(getWindow(), 'data-changed')
      return n
    },
    'docs.text': (id) => docTextOf(id),
    'docs.delete': (id, rm) => deleteDocument(id, rm),

    'sync.status': () => syncStatus(),
    'sync.pickFolder': () => pickFolder(getWindow(), 'Choisir le dossier de synchronisation'),
    'sync.setup': (folder, pass) => syncSetup(folder, pass),
    'sync.now': () => syncNow(),
    'sync.disable': () => syncDisable(),

    'integrations.list': () => listIntegrations(),
    'obsidian.pickFolder': async () => {
      const f = await pickFolder(getWindow(), 'Choisir le dossier de notes (Obsidian, Markdown…)')
      if (f) {
        setSettings({ obsidianFolder: f })
        startMarkdownWatch(() => emit(getWindow(), 'data-changed'))
      }
      return f
    },
    'obsidian.scan': () => scanMarkdownFolder(getSettings().obsidianFolder),
    'dup.find': () => findDuplicates(),
    'dup.merge': (keep, remove) => mergeDuplicates(keep, remove),
    'notion.connect': (token) => notionConnect(token),
    'notion.pageText': (id) => notionPageText(id),
    'notion.forget': () => notionForget(),
    'notion.status': () => notionStatus(),
    'assistant.chat': (req) => assistantChat(req),
    'assistant.makeCards': (source, count, hint) => assistantMakeCards(source, count, hint),
    'assistant.addCards': (deck, cards) => {
      const r = assistantAddCards(deck, cards)
      emit(getWindow(), 'data-changed')
      return r
    },
    'assistant.makeSheets': async (source, title) => {
      const r = await assistantMakeSheets(source, title)
      emit(getWindow(), 'data-changed')
      return r
    },
    'assistant.makeExercises': async (source, title, count) => {
      const r = await assistantMakeExercises(source, title, count)
      emit(getWindow(), 'data-changed')
      return r
    },
    'web.readPage': (url) => webPage(url, 60_000),
    'share.export': (deckId, meta) => shareExport(getWindow(), deckId, meta),
    'share.pick': () => sharePick(getWindow()),
    'share.install': (token, root) => {
      const r = shareInstall(token, root)
      emit(getWindow(), 'data-changed')
      return r
    },
    'share.cancel': (token) => shareCancel(token),
    'share.catalog': () => shareCatalog(),
    'share.fetch': (id) => shareFetch(id),
    'bridge.status': () => bridgeInfo(),
    'bridge.set': async (enabled) => {
      setSettings({ bridgeEnabled: enabled })
      if (enabled) await startBridge(() => emit(getWindow(), 'data-changed'))
      else await stopBridge()
      return bridgeInfo()
    }
  }

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args))
  }
}
