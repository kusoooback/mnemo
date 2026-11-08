import { create } from 'zustand'
import type { AssistantCard, AssistantSheet, AssistantTrace } from '@shared/types'

/** Ce que contient la conversation. Elle reste d'une visite à l'autre de la page (et d'un lancement à l'autre). */
export type ChatMsg =
  | { id: number; kind: 'user'; text: string; dictation?: boolean }
  | { id: number; kind: 'assistant'; text: string; trace?: AssistantTrace[]; error?: boolean }
  | { id: number; kind: 'cards'; cards: (AssistantCard & { on: boolean })[]; deck: string; added?: number }
  | { id: number; kind: 'sheets'; title: string; sheets: AssistantSheet[] }
  | { id: number; kind: 'choices'; text: string }

export interface Attached {
  id: string
  title: string
  text: string
}

interface State {
  msgs: ChatMsg[]
  /** Cours dicté ou collé dans la conversation (utilisé en entier par l'application pour produire cartes et fiches). */
  source: string
  dictation: boolean
  web: boolean
  attached: Attached[]
  next: number
  set: (p: Partial<Omit<State, 'set' | 'push' | 'patch' | 'reset' | 'newId'>>) => void
  push: (m: ChatMsg | ChatMsg[]) => void
  patch: (id: number, p: Partial<ChatMsg>) => void
  reset: () => void
  newId: () => number
}

const KEY = 'mnemo.assistant.v1'

function load(): Pick<State, 'msgs' | 'source' | 'dictation' | 'web' | 'attached' | 'next'> {
  const empty = { msgs: [] as ChatMsg[], source: '', dictation: false, web: false, attached: [] as Attached[], next: 1 }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty
    const d = JSON.parse(raw)
    return { ...empty, ...d, next: (d.msgs ?? []).reduce((m: number, x: ChatMsg) => Math.max(m, x.id), 0) + 1 }
  } catch {
    return empty
  }
}

function save(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ msgs: s.msgs.slice(-200), source: s.source, dictation: s.dictation, web: s.web, attached: s.attached }))
  } catch {
    /* stockage plein ou indisponible : la conversation reste en mémoire */
  }
}

export const useAssistant = create<State>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p)
    save(get())
  },
  push: (m) => {
    set((s) => ({ msgs: [...s.msgs, ...(Array.isArray(m) ? m : [m])] }))
    save(get())
  },
  patch: (id, p) => {
    set((s) => ({ msgs: s.msgs.map((m) => (m.id === id ? ({ ...m, ...p } as ChatMsg) : m)) }))
    save(get())
  },
  reset: () => {
    set({ msgs: [], source: '', dictation: false, attached: [], next: 1 })
    save(get())
  },
  newId: () => {
    const id = get().next
    set({ next: id + 1 })
    return id
  }
}))

/** Nombre de mots d'un texte. */
export const wordCount = (t: string): number => (t.trim() ? t.trim().split(/\s+/).length : 0)

/** « Fini », « c'est tout »… : l'utilisateur annonce la fin de sa dictée. */
export const isEndOfDictation = (t: string): boolean => /^\s*(c['’]est\s+(tout|fini|terminé)|fini|terminé|j['’]ai\s+fini|fin\s+de\s+la\s+dictée|stop|ok\s+j['’]ai\s+fini)\s*[.!]?\s*$/i.test(t)
