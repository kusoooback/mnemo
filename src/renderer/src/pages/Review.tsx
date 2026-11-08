import { ArrowLeft, ChevronLeft, Clock, EyeOff, Lightbulb, Pause, Pencil, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Rating, StudyCard, StudyCounts } from '@shared/types'
import { call } from '../api'
import { Logo } from '../components/ui'
import { useT, type Key } from '../i18n'
import { formatDuration, formatInterval } from '../lib/format'
import { cardFaces, renderMarkdown } from '../lib/render'
import { plainText } from '../lib/format'
import { hasMod } from '../lib/platform'
import { useStore } from '../store'

const RATINGS: { r: Rating; key: Key }[] = [
  { r: 1, key: 'review.again' },
  { r: 2, key: 'review.hard' },
  { r: 3, key: 'review.good' },
  { r: 4, key: 'review.easy' }
]

export function Review({ deckId }: { deckId: string | null }): React.JSX.Element {
  const t = useT()
  const { go, bump, openEditor, editor, rev, settings, toast, decks } = useStore()
  const [card, setCard] = useState<StudyCard | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [counts, setCounts] = useState<StudyCounts>({ newCount: 0, learnCount: 0, dueCount: 0 })
  const [session, setSession] = useState({ done: 0, correct: 0, timeMs: 0 })
  const [elapsed, setElapsed] = useState(0)
  const [typed, setTyped] = useState('')
  const [aiReady, setAiReady] = useState(false)
  const [explain, setExplain] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)
  const shownAt = useRef(Date.now())
  const busy = useRef(false)

  const load = useCallback(async () => {
    const [c, n] = await Promise.all([call('study.next', deckId), call('study.counts', deckId)])
    setCard(c)
    setCounts(n)
    setRevealed(false)
    setTyped('')
    setExplain(null)
    setLoaded(true)
    shownAt.current = Date.now()
    setElapsed(0)
  }, [deckId])

  useEffect(() => {
    void load()
    void call('ai.status').then((a) => setAiReady(a.ready))
  }, [load])

  // Une modification faite depuis l'éditeur ou ailleurs : on recharge la carte courante (sans perdre la réponse affichée).
  const lastRev = useRef(rev)
  useEffect(() => {
    if (rev === lastRev.current) return
    lastRev.current = rev
    if (editor) return
    const wasRevealed = revealed
    void load().then(() => wasRevealed && setRevealed(true))
  }, [rev, editor, load, revealed])

  useEffect(() => {
    if (!settings.showTimer || !card) return
    const id = setInterval(() => setElapsed(Date.now() - shownAt.current), 500)
    return () => clearInterval(id)
  }, [settings.showTimer, card])

  const answer = useCallback(
    async (r: Rating) => {
      if (!card || busy.current) return
      busy.current = true
      const ms = Date.now() - shownAt.current
      try {
        await call('study.answer', card.cardId, r, ms)
        setSession((s) => ({ done: s.done + 1, correct: s.correct + (r > 1 ? 1 : 0), timeMs: s.timeMs + ms }))
        await load()
      } finally {
        busy.current = false
      }
    },
    [card, load]
  )

  const undo = useCallback(async () => {
    const c = await call('study.undo')
    if (!c) return
    setSession((s) => ({ ...s, done: Math.max(0, s.done - 1) }))
    setCard(c)
    setRevealed(false)
    setCounts(await call('study.counts', deckId))
    shownAt.current = Date.now()
  }, [deckId])

  const exit = useCallback(async () => {
    await bump()
    go(deckId ? { name: 'deck', id: deckId } : { name: 'home' })
  }, [bump, go, deckId])

  const askExplain = useCallback(async () => {
    if (!card) return
    setExplaining(true)
    try {
      setExplain(await call('ai.explain', card.cardId))
    } catch (e) {
      setExplain(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('ai.error'))
    } finally {
      setExplaining(false)
    }
  }, [card, t])

  const suspend = useCallback(async () => {
    if (!card) return
    await call('card.suspend', [card.cardId], true)
    toast(t('review.suspended'))
    await load()
  }, [card, load, toast, t])

  const bury = useCallback(async () => {
    if (!card) return
    await call('study.bury', card.cardId)
    toast(t('review.buried'))
    await load()
  }, [card, load, toast, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (editor) return
      const el = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (hasMod(e) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') void exit()
      else if (!card) return
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!revealed) setRevealed(true)
        else void answer(3)
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        if (!revealed) setRevealed(true)
        else void answer(Number(e.key) as Rating)
      } else if (e.key.toLowerCase() === 'z') void undo()
      else if (e.key.toLowerCase() === 'e') openEditor({ noteId: card.noteId })
      else if (e.key.toLowerCase() === 's') void suspend()
      else if (e.key.toLowerCase() === 'b') void bury()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, revealed, editor, answer, undo, exit, openEditor, suspend, bury])

  const faces = useMemo(
    () => (card ? cardFaces(card.kind, card.fields, card.ord) : null),
    [card]
  )
  const remaining = counts.newCount + counts.learnCount + counts.dueCount
  const progress = session.done + remaining > 0 ? (session.done / (session.done + remaining)) * 100 : 0
  const deckName = deckId ? decks.find((d) => d.id === deckId)?.fullName.replace(/::/g, ' › ') : null
  const cur = card ? (card.state === 0 ? 'n' : card.state === 2 ? 'd' : 'l') : ''
  const typedCard = !!card && card.kind === 'typed'

  return (
    <div className="rv">
      <div className="rv-top">
        <button className="btn btn-ghost btn-sm" onClick={() => void exit()} title={`${t('review.close')} (Esc)`}>
          <ChevronLeft size={16} />
          {deckName ?? t('nav.today')}
        </button>
        <div className="rv-counts num">
          <span className={`n ${cur === 'n' ? 'cur' : ''}`} title={t('review.new')}>
            <i /> {counts.newCount}
          </span>
          <span className={`l ${cur === 'l' ? 'cur' : ''}`} title={t('review.learn')}>
            <i /> {counts.learnCount}
          </span>
          <span className={`d ${cur === 'd' ? 'cur' : ''}`} title={t('review.due')}>
            <i /> {counts.dueCount}
          </span>
        </div>
        <span className="spacer" />
        {settings.showTimer && card && (
          <span className="muted num row" style={{ fontSize: '0.8125rem', gap: 5 }}>
            <Clock size={14} />
            {Math.floor(elapsed / 1000)} s
          </span>
        )}
        <button className="icon-btn" disabled={!card && session.done === 0} onClick={() => void undo()} title={`${t('review.undo')} (Z)`} aria-label={t('review.undo')}>
          <Undo2 size={17} />
        </button>
        <button className="icon-btn" disabled={!card} onClick={() => card && openEditor({ noteId: card.noteId })} title={`${t('review.edit')} (E)`} aria-label={t('review.edit')}>
          <Pencil size={17} />
        </button>
        {aiReady && (
          <button className="icon-btn" disabled={!card || !revealed || explaining} onClick={() => void askExplain()} title={t('ai.explain')} aria-label={t('ai.explain')}>
            <Lightbulb size={17} className={explaining ? 'spin' : ''} />
          </button>
        )}
        <button className="icon-btn" disabled={!card} onClick={() => void bury()} title={`${t('review.bury')} (B)`} aria-label={t('review.bury')}>
          <EyeOff size={17} />
        </button>
        <button className="icon-btn" disabled={!card} onClick={() => void suspend()} title={`${t('review.suspend')} (S)`} aria-label={t('review.suspend')}>
          <Pause size={17} />
        </button>
      </div>
      <div className="rv-progress">
        <i style={{ width: `${progress}%` }} />
      </div>

      {!loaded ? null : card && faces ? (
        <>
          <div className="rv-scroll">
            <article className="rv-doc" key={card.cardId}>
              <div className="rv-meta">
                <span>{t('review.question')}</span>
                {card.tags.map((tg) => (
                  <span className="tag" key={tg}>
                    {tg}
                  </span>
                ))}
              </div>
              {(card.kind === 'cloze' || card.kind === 'occlusion') && revealed ? (
                <div className="rv-q md selectable" dangerouslySetInnerHTML={{ __html: faces.answer }} />
              ) : (
                <div className="rv-q md selectable" dangerouslySetInnerHTML={{ __html: faces.front }} />
              )}

              {revealed && (
                <section className="rv-answer">
                  <div className="rv-rule">
                    <span>{t('review.answer')}</span>
                  </div>
                  {typedCard && typed.trim() && <TypedDiff typed={typed} expected={plainText(card.fields.back ?? '')} label={t('review.expected')} />}
                  {card.kind !== 'cloze' && card.kind !== 'occlusion' && <div className="rv-a md selectable" dangerouslySetInnerHTML={{ __html: faces.answer }} />}
                  {(card.kind === 'cloze' || card.kind === 'occlusion') && faces.extra && <div className="rv-a md selectable" dangerouslySetInnerHTML={{ __html: faces.extra }} />}
                  {explain && (
                    <div className="rv-explain">
                      <div className="eyebrow" style={{ marginBottom: 6 }}>
                        <Lightbulb size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                        {t('ai.explain')}
                      </div>
                      <div className="md selectable" dangerouslySetInnerHTML={{ __html: renderMarkdown(explain) }} />
                    </div>
                  )}
                </section>
              )}
            </article>
          </div>

          <div className="rv-dock">
            <div className="rv-composer">
              {!revealed ? (
                <>
                  {typedCard ? (
                    <input
                      className="rv-input"
                      autoFocus
                      placeholder={t('review.typeHere')}
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          setRevealed(true)
                        }
                      }}
                    />
                  ) : (
                    <span className="rv-hint">{t('review.hint')}</span>
                  )}
                  <button className="btn btn-primary" onClick={() => setRevealed(true)}>
                    {t('review.showAnswer')}
                    <span className="kbd" style={{ background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,.45)' }}>
                      {typedCard ? '↵' : settings.language === 'fr' ? 'Espace' : 'Space'}
                    </span>
                  </button>
                </>
              ) : (
                <div className="rv-rate">
                  {RATINGS.map(({ r, key }) => (
                    <button key={r} className={`rv-r r${r}`} onClick={() => void answer(r)}>
                      <span className="rv-r-top">
                        <i />
                        {t(key)}
                        <span className="kbd">{r}</span>
                      </span>
                      <span className="rv-r-int">{formatInterval(card.intervals[r], settings.language)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="rv-scroll">
          <div className="done">
            <Logo size={44} />
            <h2>{session.done > 0 ? t('review.doneTitle') : t('review.doneNone')}</h2>
            {session.done > 0 && <p className="muted">{t('review.doneText', { n: session.done })}</p>}
            {session.done > 0 && (
              <div className="summary">
                <div>
                  <div className="v num">{session.done}</div>
                  <div className="l">{t('review.summaryCards')}</div>
                </div>
                <div>
                  <div className="v num">{formatDuration(session.timeMs)}</div>
                  <div className="l">{t('review.summaryTime')}</div>
                </div>
                <div>
                  <div className="v num">{Math.round((session.correct / session.done) * 100)} %</div>
                  <div className="l">{t('review.summaryRight')}</div>
                </div>
              </div>
            )}
            <button className="btn btn-dark btn-lg" onClick={() => void exit()}>
              <ArrowLeft size={16} />
              {t('review.back')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Compare la réponse tapée à la réponse attendue, caractère par caractère. */
function TypedDiff({ typed, expected, label }: { typed: string; expected: string; label: string }): React.JSX.Element {
  const norm = (x: string): string => x.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const ok = norm(typed) === norm(expected)
  return (
    <div style={{ marginBottom: 14, fontSize: '1.0625rem' }}>
      <div style={{ color: ok ? 'var(--good)' : 'var(--again)', textDecoration: ok ? 'none' : 'line-through', textDecorationThickness: 1.5 }}>{typed}</div>
      {!ok && (
        <div style={{ color: 'var(--good)', marginTop: 4 }}>
          <span className="muted" style={{ fontSize: '0.75rem', marginRight: 8 }}>{label}</span>
          {expected}
        </div>
      )}
    </div>
  )
}
