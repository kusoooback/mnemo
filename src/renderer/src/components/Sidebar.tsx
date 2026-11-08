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
import type { LucideIcon } from 'lucide-react'
import { useT, type Key } from '../i18n'
import { useStore, type Route } from '../store'
import { shortcut } from '../lib/platform'
import { Logo, PromptModal } from './ui'
import { call } from '../api'

type NavItem = {
  key: string
  icon: LucideIcon
  label: Key
  route?: Route['name']
  run?: () => void
}

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const {
    decks,
    route,
    go,
    settings,
    setPalette,
    openEditor,
    setSidebar,
    toast,
    refreshDecks,
    openImport
  } = useStore()
  const [newDeck, setNewDeck] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Les rubriques secondaires restent repliées : la barre latérale ne montre que l'essentiel, le reste est à un clic.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('mnemo.navOpen') || '[]'))
    } catch {
      return new Set()
    }
  })
  const setGroups = (next: Set<string>): void => {
    setOpenGroups(next)
    try {
      localStorage.setItem('mnemo.navOpen', JSON.stringify([...next]))
    } catch {
      /* stockage indisponible : l'état n'est simplement pas gardé */
    }
  }
  const toggleGroup = (id: string): void => {
    const n = new Set(openGroups)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setGroups(n)
  }

  const PRIMARY: NavItem[] = [
    { key: 'home', icon: Sun, label: 'nav.today', route: 'home' },
    { key: 'library', icon: Library, label: 'nav.library', route: 'library' },
    { key: 'quiz', icon: ListChecks, label: 'nav.quiz', route: 'quiz' },
    { key: 'stats', icon: BarChart3, label: 'nav.stats', route: 'stats' },
    { key: 'assistant', icon: MessageCircle, label: 'nav.assistant', route: 'assistant' }
  ]
  const GROUPS: { id: string; label: Key; items: NavItem[] }[] = [
    {
      id: 'create',
      label: 'nav.grp.create',
      items: [
        { key: 'ai', icon: Sparkles, label: 'nav.ai', route: 'ai' },
        { key: 'import', icon: Upload, label: 'nav.import', run: () => openImport({}) },
        { key: 'sheets', icon: ScrollText, label: 'nav.sheets', route: 'sheets' }
      ]
    },
    {
      id: 'course',
      label: 'nav.grp.course',
      items: [
        { key: 'prepa', icon: BookOpenCheck, label: 'nav.prepa', route: 'prepa' },
        { key: 'notebook', icon: CalendarDays, label: 'nav.notebook', route: 'notebook' }
      ]
    },
    {
      id: 'explore',
      label: 'nav.grp.explore',
      items: [
        { key: 'resources', icon: Compass, label: 'nav.resources', route: 'resources' },
        { key: 'packs', icon: Share2, label: 'nav.packs', route: 'packs' }
      ]
    }
  ]
  // La visite guidée demande d'ouvrir la rubrique de l'entrée qu'elle présente.
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const key = (e as CustomEvent<string>).detail
      const g = GROUPS.find((x) => x.items.some((it) => it.key === key))
      if (g && !openGroups.has(g.id)) setGroups(new Set([...openGroups, g.id]))
    }
    window.addEventListener('mnemo:nav-open', onOpen)
    return () => window.removeEventListener('mnemo:nav-open', onOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGroups])

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
  const navButton = (it: NavItem): React.JSX.Element => (
    <button
      key={it.key}
      className={`nav-item ${it.route && is(it.route) ? 'active' : ''}`}
      data-nav={it.key}
      onClick={() => (it.run ? it.run() : it.route && go({ name: it.route } as Route))}
    >
      <it.icon size={18} />
      <span className="label">{t(it.label)}</span>
    </button>
  )
  const activeDeck = route.name === 'deck' ? route.id : null
  const initial = (settings.userName || t('nav.you')).trim().charAt(0).toUpperCase()

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button
          className="icon-btn"
          onClick={() => setSidebar(false)}
          title={`${t('nav.sidebar')} (${shortcut('Ctrl+B')})`}
          aria-label={t('nav.sidebar')}
        >
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

        <button
          data-nav="new"
          className="nav-item new"
          onClick={() => openEditor({ deckId: activeDeck })}
        >
          <span className="new-dot">
            <Plus size={14} />
          </span>
          <span className="label">{t('nav.new')}</span>
          <span className="kbd">{shortcut('Ctrl N')}</span>
        </button>
        {PRIMARY.map((it) => navButton(it))}

        {GROUPS.map((g) => {
          const open = openGroups.has(g.id) || g.items.some((it) => it.route && is(it.route))
          return (
            <div key={g.id} className={`nav-group ${open ? 'open' : ''}`}>
              <button
                className="nav-group-head"
                onClick={() => toggleGroup(g.id)}
                aria-expanded={open}
                data-group={g.id}
              >
                <ChevronRight size={14} className="chev" />
                <span className="gl">{t(g.label)}</span>
                {!open && (
                  <span className="gi">
                    {g.items.map((it) => (
                      <it.icon key={it.key} size={14} />
                    ))}
                  </span>
                )}
              </button>
              {open && <div className="nav-group-body">{g.items.map((it) => navButton(it))}</div>}
            </div>
          )
        })}

        <div className="nav-section">
          <span style={{ flex: 1 }}>{t('nav.decks')}</span>
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            onClick={() => setNewDeck(true)}
            aria-label={t('home.newDeck')}
          >
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
          <button
            className="sub"
            style={{ textAlign: 'left' }}
            onClick={() => go({ name: 'sync' })}
            title={t('nav.sync')}
          >
            <i
              className="status-dot"
              style={settings.syncMode === 'folder' ? undefined : { background: 'var(--faint)' }}
            />
            {settings.syncMode === 'folder' ? t('sync.active') : t('nav.localOnly')}
          </button>
        </div>
        <button
          data-nav="settings"
          className={`icon-btn ${is('settings') ? 'on' : ''}`}
          onClick={() => go({ name: 'settings' })}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
        >
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
