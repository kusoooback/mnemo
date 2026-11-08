import { ArrowUp, BookOpenCheck, CalendarDays, CornerDownLeft, Flame, FolderPlus, PenLine, Play, Plus, Rocket, Sparkles, Telescope, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { call } from '../api'
import { ActivityButton, ActivityPanel } from '../components/Activity'
import { DeckList } from '../components/DeckList'
import { HomeDash } from '../components/HomeDash'
import { Logo, PromptModal } from '../components/ui'
import { useT } from '../i18n'
import { useStore } from '../store'

export function Home(): React.JSX.Element {
  const t = useT()
  const { decks, settings, go, bump, toast, rev, openImport, openEditor, setAiSeed } = useStore()
  const [streak, setStreak] = useState(0)
  const [newDeck, setNewDeck] = useState(false)
  const [text, setText] = useState('')
  const [aiReady, setAiReady] = useState(false)
  const [actOpen, setActOpen] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void call('stats.get', null).then((s) => setStreak(s.streak))
  }, [rev])
  useEffect(() => {
    void call('ai.status').then((a) => setAiReady(a.ready))
  }, [])
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(220, Math.max(52, el.scrollHeight))}px`
  }, [text])

  const roots = decks.filter((d) => d.depth === 0)
  const sum = (k: 'newCount' | 'learnCount' | 'dueCount'): number => roots.reduce((a, d) => a + d[k], 0)
  const left = sum('newCount') + sum('learnCount') + sum('dueCount')
  const hour = new Date().getHours()
  const greeting = hour >= 5 && hour < 18 ? t('home.morning') : t('home.evening')
  const name = settings.userName.trim()

  /** Comme dans Claude : on écrit, on envoie. Avec l'IA un long texte devient des cartes à relire, sinon une carte à compléter. */
  const send = (): void => {
    const v = text.trim()
    if (!v) return
    setText('')
    if (aiReady && v.length > 80) {
      setAiSeed(v)
      go({ name: 'ai' })
    } else openEditor({ prefill: { text: v } })
  }

  return (
    <div className="home">
      <div className="home-actions">
        <ActivityButton open={actOpen} onClick={() => setActOpen(!actOpen)} />
      </div>
      {actOpen && (
        <>
          <div className="activity-scrim" onClick={() => setActOpen(false)} />
          <div className="activity-pop">
            <ActivityPanel />
          </div>
        </>
      )}
      <div className="hello">
        <Logo size={52} />
        <h1>
          {greeting}
          {name ? `, ${name}` : ''}
        </h1>
      </div>

      {decks.length > 0 && (
        <p className="today-line">
          {left > 0 ? t('home.leftToday', { n: left === 1 ? t('home.oneLeft') : t('home.manyLeft', { n: left }) }) : t('home.allDone')}
          {streak > 0 && (
            <span className="streak" style={{ marginLeft: 10 }}>
              <Flame size={14} />
              {t('home.streak', { n: streak })}
            </span>
          )}
        </p>
      )}

      <div className="composer">
        <textarea
          ref={area}
          rows={1}
          value={text}
          autoFocus
          placeholder={t('home.composer')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="composer-bar">
          <button className="icon-pill" onClick={() => openImport({})} title={t('imp.title')} aria-label={t('imp.title')}>
            <Plus size={18} />
          </button>
          {aiReady && (
            <span className="pill-btn">
              <CornerDownLeft size={15} />
              {text.trim().length > 80 ? t('home.composerAi') : t('home.composerCard')}
            </span>
          )}
          {aiReady && text.trim().length >= 3 && text.trim().length <= 120 && (
            <button className="pill-btn" onClick={() => { setAiSeed(`Sujet : ${text.trim()}`); go({ name: 'ai' }) }}>
              <Telescope size={15} />
              {t('home.composerTopic')}
            </button>
          )}
          <span className="spacer" />
          <button className="send" onClick={send} disabled={!text.trim()} aria-label={t('common.add')}>
            <ArrowUp size={18} />
          </button>
        </div>
      </div>

      <div className="chips">
        <button className={`chip ${left > 0 ? 'strong' : ''}`} disabled={left === 0} onClick={() => go({ name: 'review', deckId: null })}>
          <Play size={15} fill="currentColor" />
          {t('home.start')}
          {left > 0 && <span className="num">· {left}</span>}
        </button>
        <button className="chip" onClick={() => openEditor({})}>
          <PenLine size={15} />
          {t('nav.new')}
        </button>
        <button className="chip" onClick={() => openImport({})}>
          <Upload size={15} />
          {t('nav.import')}
        </button>
        <button className="chip" onClick={() => go({ name: 'ai' })}>
          <Sparkles size={15} />
          {t('nav.ai')}
        </button>
        <button className="chip" onClick={() => go({ name: 'prepa' })}>
          <BookOpenCheck size={15} />
          {t('nav.prepa')}
        </button>
        <button className="chip" onClick={() => go({ name: 'notebook' })}>
          <CalendarDays size={15} />
          {t('nav.notebook')}
        </button>
      </div>

      <HomeDash />

      {decks.length === 0 ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <h3>{t('home.emptyTitle')}</h3>
          <p>{t('home.emptyText')}</p>
          <div className="actions">
            <button className="btn btn-dark" onClick={() => openImport({})}>
              <Upload size={16} />
              {t('imp.title')}
            </button>
            <button className="btn" onClick={() => setNewDeck(true)}>
              <FolderPlus size={16} />
              {t('home.createDeck')}
            </button>
            <button
              className="btn"
              onClick={async () => {
                const id = await call('data.createSample')
                await bump()
                go({ name: 'deck', id })
              }}
            >
              <Rocket size={16} />
              {t('home.sample')}
            </button>
          </div>
        </div>
      ) : (
        <div className="recents">
          <div className="recents-head">
            <span style={{ flex: 1 }}>{t('home.yourDecks')}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setNewDeck(true)}>
              <Plus size={15} />
              {t('home.newDeck')}
            </button>
          </div>
          <DeckList decks={decks} />
        </div>
      )}

      {newDeck && (
        <PromptModal
          title={t('home.newDeck')}
          label={t('deck.name')}
          hint={t('deck.nameHint')}
          confirmLabel={t('deck.create')}
          onClose={() => setNewDeck(false)}
          onSubmit={async (nm) => {
            setNewDeck(false)
            const id = await call('deck.create', nm, null)
            await bump()
            toast(t('deck.created'))
            go({ name: 'deck', id })
          }}
        />
      )}
    </div>
  )
}
