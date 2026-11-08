import { Check, ListChecks, Play, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CardRow } from '@shared/types'
import {
  buildQuiz,
  ratingFor,
  summarize,
  usableCards,
  type QuizCard,
  type QuizFocus,
  type QuizMode,
  type QuizQuestion,
  type QuizResult
} from '@shared/quiz'
import { call } from '../api'
import { useT } from '../i18n'
import { renderInline, renderMarkdown } from '../lib/render'
import { useStore } from '../store'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const COUNTS = [5, 10, 20, 50]
const LETTERS = ['A', 'B', 'C', 'D']

const toQuizCard = (r: CardRow): QuizCard => ({
  cardId: r.cardId,
  noteId: r.noteId,
  kind: r.kind,
  ord: r.ord,
  deckId: r.deckId,
  deckName: r.deckName,
  fields: r.fields,
  tags: r.tags,
  lapses: r.lapses
})

interface Prefs {
  mode: QuizMode
  count: number
  focus: QuizFocus
  review: boolean
  ai: boolean
}
const DEFAULTS: Prefs = { mode: 'mix', count: 10, focus: 'random', review: false, ai: false }
const loadPrefs = (): Prefs => {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('mnemo.quiz.v1') ?? '{}') as Partial<Prefs>) }
  } catch {
    return DEFAULTS
  }
}

export function Quiz(): React.JSX.Element {
  const t = useT()
  const { decks, toast } = useStore()
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [deckId, setDeckId] = useState('')
  const [cards, setCards] = useState<QuizCard[]>([])
  const [aiReady, setAiReady] = useState(false)
  const [phase, setPhase] = useState<'setup' | 'play' | 'done'>('setup')
  const [busy, setBusy] = useState('')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [results, setResults] = useState<QuizResult[]>([])
  const counted = useRef(new Set<string>())
  const shownAt = useRef(0)

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]): void =>
    setPrefs((p) => {
      const n = { ...p, [k]: v }
      try {
        localStorage.setItem('mnemo.quiz.v1', JSON.stringify(n))
      } catch {
        /* préférences non sauvegardées : sans gravité */
      }
      return n
    })

  useEffect(() => {
    void call('ai.status').then((s) => setAiReady(!!s.ready)).catch(() => setAiReady(false))
  }, [])

  useEffect(() => {
    let alive = true
    void call('card.search', { text: '', deckId: deckId || null, state: 'all', tag: null, sort: 'created', limit: 3000, offset: 0 }).then((r) => {
      if (alive) setCards(r.rows.filter((c) => !c.suspended).map(toQuizCard))
    })
    return () => {
      alive = false
    }
  }, [deckId])

  const usable = useMemo(() => usableCards(cards, prefs.mode), [cards, prefs.mode])

  const play = useCallback(
    async (pool: QuizCard[]): Promise<void> => {
      setBusy(t('qz.preparing'))
      try {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
        const base = { mode: prefs.mode, count: prefs.count, focus: prefs.focus, seed }
        let qs = buildQuiz(pool, base)
        if (prefs.ai && aiReady && qs.length) {
          setBusy(t('qz.aiPreparing'))
          try {
            const ai = await call('ai.distractors', qs.map((q) => ({ id: q.cardId, q: q.prompt, a: q.answer })))
            qs = buildQuiz(pool, { ...base, ai })
          } catch (e) {
            toast(t('qz.aiFail', { e: errText(e) }), { kind: 'error' })
          }
        }
        if (!qs.length) {
          toast(t('qz.none'), { kind: 'error' })
          return
        }
        counted.current = new Set()
        setQuestions(qs)
        setIdx(0)
        setPicked(null)
        setResults([])
        shownAt.current = Date.now()
        setPhase('play')
      } finally {
        setBusy('')
      }
    },
    [prefs, aiReady, t, toast]
  )

  const q = questions[idx]

  const choose = useCallback(
    (i: number): void => {
      if (phase !== 'play' || picked !== null || !q || !q.choices[i]) return
      const correct = q.choices[i].correct
      const ms = Math.max(300, Date.now() - shownAt.current)
      setPicked(i)
      setResults((r) => [...r, { questionId: q.id, cardId: q.cardId, correct, ms }])
      if (prefs.review && !counted.current.has(q.cardId)) {
        counted.current.add(q.cardId)
        void call('study.answer', q.cardId, ratingFor(correct), ms).catch(() => undefined)
      }
    },
    [phase, picked, q, prefs.review]
  )

  const next = useCallback((): void => {
    if (picked === null) return
    if (idx + 1 >= questions.length) {
      setPhase('done')
      if (prefs.review && counted.current.size) {
        toast(t('qz.counted', { n: counted.current.size }))
        void useStore.getState().refreshDecks()
      }
      return
    }
    setIdx(idx + 1)
    setPicked(null)
    shownAt.current = Date.now()
  }, [picked, idx, questions.length, prefs.review, t, toast])

  useEffect(() => {
    if (phase !== 'play') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = e.key.toLowerCase()
      if (picked !== null && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
        e.preventDefault()
        next()
        return
      }
      if (!q) return
      if (q.type === 'tf') {
        if (k === 'v' || k === 't' || k === '1') choose(0)
        else if (k === 'f' || k === '2') choose(1)
      } else if (/^[1-4]$/.test(k)) choose(Number(k) - 1)
      else if (/^[a-d]$/.test(k)) choose(k.charCodeAt(0) - 97)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, picked, q, choose, next])

  const sum = summarize(results)
  const wrongQuestions = questions.filter((qq) => results.some((r) => r.questionId === qq.id && !r.correct))

  if (phase === 'play' && q) {
    const answered = picked !== null
    const okNow = answered && q.choices[picked as number]?.correct
    return (
      <div className="page qz">
        <div className="qz-top">
          <button className="btn btn-sm" onClick={() => setPhase('setup')}>
            <X size={14} /> {t('qz.leave')}
          </button>
          <span className="qz-count num">{t('qz.q', { n: idx + 1, total: questions.length })}</span>
          <span className="qz-deck">{q.deckName}</span>
        </div>
        <div className="qz-bar" aria-hidden>
          <i style={{ width: `${(idx / questions.length) * 100}%` }} />
        </div>

        <section className="card card-pad qz-card" data-testid="qz-question">
          <div className="md qz-prompt" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.prompt) }} />
          {q.type === 'tf' && (
            <div className="qz-claim">
              <span className="qz-claim-l">{t('qz.tf.claim')}</span>
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.statement ?? '') }} />
            </div>
          )}
          <div className={`qz-choices ${q.type === 'tf' ? 'tf' : ''}`}>
            {q.choices.map((c, i) => {
              const state = !answered ? '' : c.correct ? 'right' : i === picked ? 'wrong' : 'dim'
              return (
                <button key={i} className={`qz-choice ${state}`} disabled={answered} onClick={() => choose(i)} data-choice={i}>
                  <span className="qz-key">{q.type === 'tf' ? (i === 0 ? 'V' : 'F') : LETTERS[i]}</span>
                  {q.type === 'tf' ? (
                    <span>{i === 0 ? t('qz.true') : t('qz.false')}</span>
                  ) : (
                    <span className="inl" dangerouslySetInnerHTML={{ __html: renderInline(c.text, 260) }} />
                  )}
                  {answered && c.correct && <Check size={16} className="qz-ico" />}
                  {answered && state === 'wrong' && <X size={16} className="qz-ico" />}
                </button>
              )
            })}
          </div>

          {answered && (
            <div className={`qz-feedback ${okNow ? 'ok' : 'ko'}`} data-testid="qz-feedback">
              <strong>{okNow ? t('qz.good') : t('qz.bad')}</strong>
              {!okNow && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.answer) }} />}
              {q.extra && <div className="md qz-extra" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.extra) }} />}
              <button className="btn btn-primary" onClick={next} data-testid="qz-next">
                {idx + 1 >= questions.length ? t('qz.finish') : t('qz.next')}
              </button>
            </div>
          )}
        </section>
        <p className="d qz-kbd">{t('qz.kbd')}</p>
      </div>
    )
  }

  if (phase === 'done') {
    const msg = sum.pct >= 100 ? 'top' : sum.pct >= 70 ? 'good' : sum.pct >= 50 ? 'mid' : 'low'
    return (
      <div className="page qz">
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('qz.result')}</h1>
          </div>
        </div>
        <section className="card card-pad qz-result" data-testid="qz-result">
          <div className="qz-score">
            <span className="num" data-testid="qz-score">{sum.good} / {sum.total}</span>
            <span className="qz-pct num">{sum.pct} %</span>
          </div>
          <p>{t(`qz.msg.${msg}`)}</p>
          <div className="qz-actions">
            {wrongQuestions.length > 0 && (
              <button
                className="btn btn-primary"
                disabled={!!busy}
                onClick={() => void play(cards.filter((c) => sum.wrongCardIds.includes(c.cardId)))}
              >
                <RotateCcw size={14} /> {t('qz.again')}
              </button>
            )}
            <button className="btn" onClick={() => setPhase('setup')}>
              <ListChecks size={14} /> {t('qz.new')}
            </button>
          </div>
        </section>

        <section className="card card-pad qz-card">
          <h2 className="pk-h">{t('qz.mistakes')}</h2>
          {wrongQuestions.length === 0 ? (
            <p className="d">{t('qz.noMistakes')}</p>
          ) : (
            wrongQuestions.map((w) => (
              <div key={w.id} className="qz-miss">
                <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(w.prompt) }} />
                <div className="qz-miss-a">
                  <Check size={14} />
                  <span className="inl" dangerouslySetInnerHTML={{ __html: renderInline(w.answer, 300) }} />
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="page qz">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('qz.title')}</h1>
          <p className="page-sub">{t('qz.sub')}</p>
        </div>
      </div>

      <section className="card card-pad qz-setup pk-block">
        <label className="pk-field">
          <span>{t('qz.deck')}</span>
          <select className="input" value={deckId} onChange={(e) => setDeckId(e.target.value)} data-testid="qz-deck">
            <option value="">{t('qz.all')}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{d.fullName}</option>
            ))}
          </select>
        </label>

        <div className="pk-field">
          <span>{t('qz.mode')}</span>
          <div className="qz-seg" role="group">
            {(['mcq', 'tf', 'mix'] as const).map((m) => (
              <button key={m} className={prefs.mode === m ? 'on' : ''} onClick={() => setPref('mode', m)} data-testid={`qz-mode-${m}`}>
                {t(`qz.mode.${m}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="pk-field">
          <span>{t('qz.count')}</span>
          <div className="qz-seg" role="group">
            {COUNTS.map((n) => (
              <button key={n} className={prefs.count === n ? 'on' : ''} onClick={() => setPref('count', n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="pk-field">
          <span>{t('qz.focus')}</span>
          <div className="qz-seg" role="group">
            {(['random', 'weak'] as const).map((f) => (
              <button key={f} className={prefs.focus === f ? 'on' : ''} onClick={() => setPref('focus', f)}>
                {t(`qz.focus.${f}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="qz-check">
          <input type="checkbox" className="checkbox" checked={prefs.ai && aiReady} disabled={!aiReady} onChange={(e) => setPref('ai', e.target.checked)} data-testid="qz-ai" />
          <span>
            <strong>{t('qz.ai')}</strong>
            <span className="d">{aiReady ? t('qz.ai.hint') : t('qz.ai.off')}</span>
          </span>
        </label>

        <label className="qz-check">
          <input type="checkbox" className="checkbox" checked={prefs.review} onChange={(e) => setPref('review', e.target.checked)} data-testid="qz-review" />
          <span>
            <strong>{t('qz.review')}</strong>
            <span className="d">{t('qz.review.hint')}</span>
          </span>
        </label>

        <div className="pk-row">
          <button className="btn btn-primary" disabled={!!busy || usable.length === 0} onClick={() => void play(cards)} data-testid="qz-start">
            <Play size={14} /> {busy || t('qz.start')}
          </button>
          <span className="d" data-testid="qz-available">{usable.length ? t('qz.available', { n: usable.length }) : t('qz.none')}</span>
        </div>
      </section>
    </div>
  )
}
