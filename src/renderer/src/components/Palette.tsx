import { MessageCircle, BarChart3, BookOpen, CalendarDays, CornerDownLeft, FileText, Library, Moon, Play, Plug, Plus, RefreshCw, ScrollText, Search, Settings, Sparkles, Sun, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CardRow } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { plainText } from '../lib/format'
import { useStore } from '../store'

interface Item {
  id: string
  group: string
  label: string
  icon: ReactNode
  run: () => void
}

export function Palette(): React.JSX.Element {
  const t = useT()
  const { decks, go, setPalette, openEditor, settings, patchSettings, openImport } = useStore()
  const [q, setQ] = useState('')
  const [cards, setCards] = useState<CardRow[]>([])
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setCards([])
      return
    }
    const h = setTimeout(async () => {
      const r = await call('card.search', { text: q, deckId: null, state: 'all', tag: null, sort: 'created', limit: 6, offset: 0 })
      setCards(r.rows)
    }, 120)
    return () => clearTimeout(h)
  }, [q])

  const items = useMemo<Item[]>(() => {
    const dark = document.documentElement.dataset.theme === 'dark'
    const actions: Item[] = [
      { id: 'a-new', group: t('pal.actions'), label: t('nav.new'), icon: <Plus size={17} />, run: () => openEditor({}) },
      { id: 'a-import', group: t('pal.actions'), label: t('imp.title'), icon: <Upload size={17} />, run: () => openImport({}) },
      { id: 'a-study', group: t('pal.actions'), label: t('pal.studyAll'), icon: <Play size={17} />, run: () => go({ name: 'review', deckId: null }) },
      {
        id: 'a-theme',
        group: t('pal.actions'),
        label: t('pal.toggleTheme'),
        icon: dark ? <Sun size={17} /> : <Moon size={17} />,
        run: () => {
          setPalette(false)
          void patchSettings({ theme: dark ? 'light' : 'dark', skin: '' })
        }
      },
      { id: 'g-home', group: t('pal.go'), label: t('nav.today'), icon: <Sun size={17} />, run: () => go({ name: 'home' }) },
      { id: 'g-lib', group: t('pal.go'), label: t('nav.library'), icon: <Library size={17} />, run: () => go({ name: 'library' }) },
      { id: 'g-nb', group: t('pal.go'), label: t('nav.notebook'), icon: <CalendarDays size={17} />, run: () => go({ name: 'notebook' }) },
      { id: 'g-ai', group: t('pal.go'), label: t('nav.ai'), icon: <Sparkles size={17} />, run: () => go({ name: 'ai' }) },
      { id: 'g-assistant', group: t('pal.go'), label: t('nav.assistant'), icon: <MessageCircle size={17} />, run: () => go({ name: 'assistant' }) },
      { id: 'g-sheets', group: t('pal.go'), label: t('nav.sheets'), icon: <ScrollText size={17} />, run: () => go({ name: 'sheets' }) },
      { id: 'g-prepa', group: t('pal.go'), label: t('nav.prepa'), icon: <BookOpen size={17} />, run: () => go({ name: 'prepa' }) },
      { id: 'g-int', group: t('pal.go'), label: t('nav.integrations'), icon: <Plug size={17} />, run: () => go({ name: 'integrations' }) },
      { id: 'g-sync', group: t('pal.go'), label: t('nav.sync'), icon: <RefreshCw size={17} />, run: () => go({ name: 'sync' }) },
      { id: 'g-stats', group: t('pal.go'), label: t('nav.stats'), icon: <BarChart3 size={17} />, run: () => go({ name: 'stats' }) },
      { id: 'g-set', group: t('pal.go'), label: t('nav.settings'), icon: <Settings size={17} />, run: () => go({ name: 'settings' }) }
    ]
    const needle = q.trim().toLowerCase()
    const match = (s: string): boolean => !needle || s.toLowerCase().includes(needle)
    const deckItems: Item[] = decks
      .filter((d) => match(d.fullName))
      .slice(0, 6)
      .map((d) => ({
        id: `d-${d.id}`,
        group: t('pal.decks'),
        label: d.fullName.replace(/::/g, ' › '),
        icon: <BookOpen size={17} />,
        run: () => go({ name: 'deck', id: d.id })
      }))
    const cardItems: Item[] = cards.map((c) => ({
      id: `c-${c.cardId}`,
      group: t('pal.cards'),
      label: plainText(c.kind === 'cloze' ? (c.fields.text ?? '') : (c.fields.front ?? '')).slice(0, 90),
      icon: <FileText size={17} />,
      run: () => openEditor({ noteId: c.noteId })
    }))
    return [...cardItems, ...actions.filter((a) => match(a.label)), ...deckItems]
  }, [q, cards, decks, t, go, openEditor, setPalette, patchSettings, settings.theme, openImport])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const run = (it?: Item): void => {
    if (!it) return
    setPalette(false)
    it.run()
  }

  let lastGroup = ''
  return (
    <div
      className="overlay palette-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setPalette(false)
      }}
    >
      <div className="palette" role="dialog">
        <div className="palette-input">
          <Search size={19} />
          <input
            autoFocus
            placeholder={t('pal.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPalette(false)
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') run(items[idx])
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" ref={list}>
          {items.length === 0 && <div className="palette-group">{t('pal.none')}</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup
            lastGroup = it.group
            return (
              <div key={it.id}>
                {header && <div className="palette-group">{it.group}</div>}
                <button className={`palette-item ${i === idx ? 'on' : ''}`} onMouseMove={() => setIdx(i)} onClick={() => run(it)}>
                  {it.icon}
                  <span className="t">{it.label}</span>
                  {i === idx && <CornerDownLeft size={14} />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> {t('pal.navigate')}
          </span>
          <span>
            <span className="kbd">↵</span> {t('pal.open')}
          </span>
          <span>
            <span className="kbd">Esc</span> {t('pal.close')}
          </span>
        </div>
      </div>
    </div>
  )
}
