import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Library,
  PanelLeft,
  Plus,
  Search,
  ScrollText,
  Settings,
  Sparkles,
  Sun,
  Upload,
  MessageCircle,
  Compass,
  Share2,
  ListChecks
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useStore, type Route } from '../store'
import { shortcut } from '../lib/platform'
import { Logo, PromptModal } from './ui'
import { call } from '../api'

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const { decks, route, go, settings, setPalette, openEditor, setSidebar, toast, refreshDecks, openImport } = useStore()
  const [newDeck, setNewDeck] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Les decks qui contiennent des sous-decks (ex. « Prépa ECG ») arrivent repliés : sinon la liste devient interminable.
  const seen = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = decks.filter((d) => !seen.current.has(d.id))
    if (fresh.length === 0) return
    fresh.forEach((d) => seen.current.add(d.id))
    const toFold = fresh.filter((d) => d.hasChildren).map((d) => d.id)
    if (toFold.length) setCollapsed((c) => new Set([...c, ...toFold]))
  }, [decks])

  const toggle = (id: string): void =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const visible = useMemo(() => {
    const hidden = new Set<string>()
    return decks.filter((d) => {
      if (d.parentId && (hidden.has(d.parentId) || collapsed.has(d.parentId))) {
        hidden.add(d.id)
        return false
      }
      return true
    })
  }, [decks, collapsed])

  const is = (name: Route['name']): boolean => route.name === name
  const activeDeck = route.name === 'deck' ? route.id : null
  const initial = (settings.userName || t('nav.you')).trim().charAt(0).toUpperCase()

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="icon-btn" onClick={() => setSidebar(false)} title={`${t('nav.sidebar')} (${shortcut('Ctrl+B')})`} aria-label={t('nav.sidebar')}>
          <PanelLeft size={18} />
        </button>
        <div className="brand">
          <Logo size={30} />
          Mnémo
        </div>
      </div>

      <div className="sidebar-scroll">
        <button className="search-box" onClick={() => setPalette(true)}>
          <Search size={16} />
          <span>{t('nav.search')}</span>
          <span className="kbd">{shortcut('Ctrl K')}</span>
        </button>

        <button className="nav-item new" onClick={() => openEditor({ deckId: activeDeck })}>
          <span className="new-dot">
            <Plus size={14} />
          </span>
          <span className="label">{t('nav.new')}</span>
          <span className="kbd">{shortcut('Ctrl N')}</span>
        </button>
        <button className={`nav-item ${is('home') ? 'active' : ''}`} onClick={() => go({ name: 'home' })}>
          <Sun size={18} />
          <span className="label">{t('nav.today')}</span>
        </button>
        <button className={`nav-item ${is('library') ? 'active' : ''}`} onClick={() => go({ name: 'library' })}>
          <Library size={18} />
          <span className="label">{t('nav.library')}</span>
        </button>
        <button className={`nav-item ${is('stats') ? 'active' : ''}`} onClick={() => go({ name: 'stats' })}>
          <BarChart3 size={18} />
          <span className="label">{t('nav.stats')}</span>
        </button>
        <button className="nav-item" onClick={() => openImport({})}>
          <Upload size={18} />
          <span className="label">{t('nav.import')}</span>
        </button>
        <button className={`nav-item ${is('prepa') ? 'active' : ''}`} onClick={() => go({ name: 'prepa' })}>
          <BookOpenCheck size={18} />
          <span className="label">{t('nav.prepa')}</span>
        </button>
        <button className={`nav-item ${is('notebook') ? 'active' : ''}`} onClick={() => go({ name: 'notebook' })}>
          <CalendarDays size={18} />
          <span className="label">{t('nav.notebook')}</span>
        </button>
        <button className={`nav-item ${is('ai') ? 'active' : ''}`} onClick={() => go({ name: 'ai' })}>
          <Sparkles size={18} />
          <span className="label">{t('nav.ai')}</span>
        </button>
        <button className={`nav-item ${is('assistant') ? 'active' : ''}`} onClick={() => go({ name: 'assistant' })}>
          <MessageCircle size={18} />
          <span className="label">{t('nav.assistant')}</span>
        </button>
        <button className={`nav-item ${is('resources') ? 'active' : ''}`} onClick={() => go({ name: 'resources' })}>
          <Compass size={18} />
          <span className="label">{t('nav.resources')}</span>
        </button>
        <button className={`nav-item ${is('quiz') ? 'active' : ''}`} onClick={() => go({ name: 'quiz' })}>
          <ListChecks size={18} />
          <span className="label">{t('nav.quiz')}</span>
        </button>
        <button className={`nav-item ${is('packs') ? 'active' : ''}`} onClick={() => go({ name: 'packs' })}>
          <Share2 size={18} />
          <span className="label">{t('nav.packs')}</span>
        </button>
        <button className={`nav-item ${is('sheets') ? 'active' : ''}`} onClick={() => go({ name: 'sheets' })}>
          <ScrollText size={18} />
          <span className="label">{t('nav.sheets')}</span>
        </button>

        <div className="nav-section">
          <span style={{ flex: 1 }}>{t('nav.decks')}</span>
          <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setNewDeck(true)} aria-label={t('home.newDeck')}>
            <Plus size={16} />
          </button>
        </div>
        {visible.map((d) => (
          <button
            key={d.id}
            className={`nav-item deck-nav ${activeDeck === d.id ? 'active' : ''}`}
            style={{ ['--depth' as string]: d.depth }}
            onClick={() => go({ name: 'deck', id: d.id })}
          >
            {d.hasChildren ? (
              <span
                className="deck-chev"
                role="button"
                aria-label="toggle"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(d.id)
                }}
              >
                {collapsed.has(d.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </span>
            ) : (
              <span className="deck-chev" />
            )}
            <BookOpen size={16} />
            <span className="label">{d.name}</span>
            {d.newCount + d.learnCount + d.dueCount > 0 && (
              <span className="count-pill">{d.newCount + d.learnCount + d.dueCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="avatar">{initial}</div>
        <div className="foot-meta">
          <div className="name">{settings.userName || t('nav.you')}</div>
          <button className="sub" style={{ textAlign: 'left' }} onClick={() => go({ name: 'sync' })} title={t('nav.sync')}>
            <i className="status-dot" style={settings.syncMode === 'folder' ? undefined : { background: 'var(--faint)' }} />
            {settings.syncMode === 'folder' ? t('sync.active') : t('nav.localOnly')}
          </button>
        </div>
        <button className={`icon-btn ${is('settings') ? 'on' : ''}`} onClick={() => go({ name: 'settings' })} aria-label={t('nav.settings')} title={t('nav.settings')}>
          <Settings size={18} />
        </button>
      </div>

      {newDeck && (
        <PromptModal
          title={t('home.newDeck')}
          label={t('deck.name')}
          hint={t('deck.nameHint')}
          confirmLabel={t('deck.create')}
          onClose={() => setNewDeck(false)}
          onSubmit={async (name) => {
            setNewDeck(false)
            const id = await call('deck.create', name, null)
            await refreshDecks()
            toast(t('deck.created'))
            go({ name: 'deck', id })
          }}
        />
      )}
    </aside>
  )
}
