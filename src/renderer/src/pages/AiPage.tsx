import { FileUp, Loader2, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiCardProposal, AiEstimate, AiStatus } from '@shared/types'
import { call } from '../api'
import { JobRow } from '../components/Activity'
import { ApiKeyCard } from '../components/ApiKeyCard'
import { LocalAiSetup } from '../components/LocalAiSetup'
import { useT } from '../i18n'
import { useStore } from '../store'

interface Row extends AiCardProposal {
  uid: number
  selected: boolean
  dup: boolean
}

const NEW = '__new'

const money = (n: number): string => (n < 0.01 && n > 0 ? '< 0,01' : n.toFixed(2)).replace('.', ',')

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function AiPage(): React.JSX.Element {
  const t = useT()
  const { decks, settings, go, bump, toast, aiSeed, setAiSeed } = useStore()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [count, setCount] = useState(15)
  const [hint, setHint] = useState('')
  const [deckId, setDeckId] = useState('')
  const [mode, setMode] = useState<'text' | 'topic'>('text')
  const [topic, setTopic] = useState('')
  const [newDeck, setNewDeck] = useState('')
  const [makeSheet, setMakeSheet] = useState(false)
  const [est, setEst] = useState<AiEstimate | null>(null)
  const [showText, setShowText] = useState(false)
  const [busy, setBusy] = useState<'file' | 'gen' | null>(null)
  const [error, setError] = useState('')
  const [chunks, setChunks] = useState(0)
  const [rows, setRows] = useState<Row[] | null>(null)
  const uid = useRef(0)
  const runningJob = useStore((s) => s.jobs.find((j) => (j.kind === 'cards' || j.kind === 'summary') && j.status === 'running'))

  useEffect(() => {
    void call('ai.status').then(setStatus)
    return window.mnemo.onEvent((e) => e.type === 'ai-progress' && setChunks((e.payload as { tokens: number }).tokens))
  }, [])
  useEffect(() => {
    if (aiSeed) {
      const m = /^Sujet\s*:\s*([\s\S]+)$/i.exec(aiSeed)
      if (m) {
        setMode('topic')
        setTopic(m[1].trim())
      } else setText(aiSeed)
      setAiSeed(null)
    }
  }, [aiSeed, setAiSeed])
  useEffect(() => {
    if (!deckId && decks.length) setDeckId(decks[0].id)
  }, [decks, deckId])
  useEffect(() => setEst(null), [text, topic, mode, count])

  const ready = !!status?.ready
  const local = status?.provider === 'ollama' || status?.provider === 'builtin'
  const freeCloud = status?.provider === 'openrouter' && (status.model === 'openrouter/free' || status.model.endsWith(':free'))
  // Seule une IA payante demande d'abord de confirmer le coût ; sinon un seul clic suffit.
  const needsEstimate = !!status && !local && !freeCloud
  /** Ce qui est envoyé à l'IA : le texte, ou « Sujet : … » quand on part d'une idée sans document. */
  const source = mode === 'topic' ? `Sujet : ${topic.trim()}` : text
  const sheetTitle = (mode === 'topic' ? topic.trim() : fileName.replace(/\.[a-z0-9]+$/i, '') || text.trim().slice(0, 50)).replace(/\s+/g, ' ').trim() || 'Fiche'
  const canGo = ready && (mode === 'topic' ? topic.trim().length >= 3 : !!text.trim()) && (deckId !== NEW || !!newDeck.trim()) && !!deckId

  const pickFile = async (): Promise<void> => {
    setBusy('file')
    setError('')
    try {
      const f = await call('ai.pickFile')
      if (f) {
        setText(f.text)
        setFileName(f.name)
        toast(t('ai.fileLoaded', { name: f.name, n: f.text.length }))
      }
    } catch {
      setError(t('ai.fileError'))
    } finally {
      setBusy(null)
    }
  }

  const generate = async (): Promise<void> => {
    setBusy('gen')
    setError('')
    setChunks(0)
    try {
      const props = await call('ai.generate', source, count, settings.language, hint)
      const withDup: Row[] = []
      for (const p of props) {
        const dup = await call('note.checkDuplicate', p.kind, p.kind === 'cloze' ? p.text : p.front)
        withDup.push({ ...p, uid: ++uid.current, selected: !dup, dup })
      }
      if (!withDup.length) setError(t('ai.noResult'))
      else setRows(withDup)
      setStatus(await call('ai.status'))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }

  const patch = (id: number, p: Partial<Row>): void => setRows((rs) => rs?.map((r) => (r.uid === id ? { ...r, ...p } : r)) ?? null)
  const selected = rows?.filter((r) => r.selected) ?? []

  const add = async (): Promise<void> => {
    if (!deckId) return
    // Deck existant ou nouveau (« Maths::Suites » crée aussi le parent).
    const target = deckId === NEW ? await call('deck.create', newDeck.trim(), null) : deckId
    for (const r of selected) {
      await call('note.add', {
        kind: r.kind,
        deckId: target,
        fields: r.kind === 'cloze' ? { text: r.text, extra: r.extra } : { front: r.front, back: r.back },
        tags: ['ia', ...r.tags]
      })
    }
    await bump()
    toast(t('ai.added', { n: selected.length }))
    if (makeSheet) {
      // La fiche se prépare en arrière-plan (visible dans « Activité ») ; on peut déjà réviser.
      void call('ai.makeSheet', sheetTitle, source)
        .then((id) => toast(t('ai.sheetDone'), { action: { label: t('ai.open'), run: () => go({ name: 'doc', id }) } }))
        .catch((e) => toast(errText(e), { kind: 'error' }))
    }
    setRows(null)
    setText('')
    setTopic('')
    setFileName('')
    go({ name: 'deck', id: target })
  }

  const providerLabel = useMemo(
    () => ({ ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic', none: '' })[status?.provider ?? 'none'],
    [status]
  )

  if (rows) {
    return (
      <div className="page">
        <div className="page-head" style={{ marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <h1 className="page-title">{t('ai.review')}</h1>
            <p className="page-sub">{t('ai.reviewSub', { n: rows.length })}</p>
          </div>
          <button className="btn btn-ghost" onClick={() => setRows(rows.map((r) => ({ ...r, selected: false })))}>
            {t('ai.rejectAll')}
          </button>
          <button className="btn" onClick={() => setRows(rows.map((r) => ({ ...r, selected: true })))}>
            {t('ai.acceptAll')}
          </button>
        </div>
        <div className="row" style={{ marginBottom: 16 }}>
          <label className="field-label" style={{ margin: 0 }}>{t('ai.deck')}</label>
          <select className="select select-sm" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{' '.repeat(d.depth)}{d.name}</option>
            ))}
            <option value={NEW}>{t('ai.newDeck')}</option>
          </select>
          {deckId === NEW && <input className="input" style={{ maxWidth: 260 }} autoFocus placeholder={t('ai.newDeckName')} value={newDeck} onChange={(e) => setNewDeck(e.target.value)} />}
          <label className="row" style={{ cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" className="checkbox" checked={makeSheet} onChange={(e) => setMakeSheet(e.target.checked)} />
            {t('ai.alsoSheet')}
          </label>
        </div>
        {rows.map((r) => (
          <div key={r.uid} className="card card-pad" style={{ marginBottom: 10, opacity: r.selected ? 1 : 0.55 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" className="checkbox" style={{ marginTop: 4 }} checked={r.selected} onChange={(e) => patch(r.uid, { selected: e.target.checked })} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {r.kind === 'cloze' ? (
                  <textarea className="textarea selectable" rows={2} value={r.text} onChange={(e) => patch(r.uid, { text: e.target.value })} />
                ) : (
                  <>
                    <textarea className="textarea selectable" rows={2} value={r.front} onChange={(e) => patch(r.uid, { front: e.target.value })} />
                    <textarea className="textarea selectable" rows={2} value={r.back} onChange={(e) => patch(r.uid, { back: e.target.value })} />
                  </>
                )}
                <div className="row" style={{ gap: 6 }}>
                  <span className="tag">{r.kind === 'cloze' ? 'Trous' : 'Recto / verso'}</span>
                  {r.dup && (
                    <span className="tag" style={{ background: 'var(--hard-soft)', color: 'var(--text-2)' }}>
                      <TriangleAlert size={12} /> {t('ai.dup')}
                    </span>
                  )}
                </div>
              </div>
              <button className="icon-btn" title={t('ai.reject')} aria-label={t('ai.reject')} onClick={() => setRows(rows.filter((x) => x.uid !== r.uid))}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        <div className="bulk-bar">
          <button className="btn btn-sm" onClick={() => setRows(null)}>{t('common.back')}</button>
          <button className="btn btn-sm" onClick={() => { setRows(null); void generate() }}>{t('ai.regenerate')}</button>
          <button className="btn btn-primary btn-sm" disabled={!selected.length || !deckId || (deckId === NEW && !newDeck.trim())} onClick={() => void add()}>
            {t('ai.addSelected', { n: selected.length })}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('ai.title')}</h1>
          <p className="page-sub">{t('ai.sub')}</p>
        </div>
      </div>

      {status && !(status.provider === 'openrouter' && status.hasKey) && (
        <div style={{ marginBottom: 20 }}>
          <ApiKeyCard onChange={() => void call('ai.status').then(setStatus)} />
        </div>
      )}

      {status && !ready && (
        <div style={{ marginBottom: 20 }}>
          <LocalAiSetup onReady={() => void call('ai.status').then(setStatus)} />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => go({ name: 'integrations' })}>{t('ai.configure')}</button>
        </div>
      )}

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>{t('ai.mode.text')}</button>
          <button className={mode === 'topic' ? 'on' : ''} onClick={() => setMode('topic')}>{t('ai.mode.topic')}</button>
        </div>
        {mode === 'text' ? (
          <>
            <div className="row">
              <button className="btn" disabled={busy !== null} onClick={() => void pickFile()}>
                {busy === 'file' ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}
                {t('ai.pickFile')}
              </button>
              <span className="muted" style={{ fontSize: '0.8125rem' }}>{fileName || t('ai.pickFileHint')}</span>
            </div>
            <textarea className="textarea selectable" rows={10} placeholder={t('ai.paste')} value={text} onChange={(e) => setText(e.target.value)} />
          </>
        ) : (
          <div>
            <input className="input" autoFocus placeholder={t('ai.topic.placeholder')} value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canGo && !needsEstimate && void generate()} />
            <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 8 }}>{t('ai.topic.hint')}</p>
          </div>
        )}
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 150 }}>
            <label className="field-label">{t('ai.count')}</label>
            <input className="input num" type="number" min={3} max={80} value={count} onChange={(e) => setCount(Math.max(3, Math.min(80, Number(e.target.value) || 15)))} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="field-label">{t('ai.hint')}</label>
            <input className="input" placeholder={t('ai.hintPlaceholder')} value={hint} onChange={(e) => setHint(e.target.value)} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="field-label">{t('ai.deck')}</label>
            <select className="select" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>{' '.repeat(d.depth)}{d.name}</option>
              ))}
              <option value={NEW}>{t('ai.newDeck')}</option>
            </select>
          </div>
          {deckId === NEW && (
            <div style={{ minWidth: 200 }}>
              <label className="field-label">{t('ai.newDeckName')}</label>
              <input className="input" value={newDeck} placeholder={mode === 'topic' ? topic : fileName.replace(/\.[a-z0-9]+$/i, '')} onChange={(e) => setNewDeck(e.target.value)} />
            </div>
          )}
        </div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" className="checkbox" checked={makeSheet} onChange={(e) => setMakeSheet(e.target.checked)} />
          {t('ai.alsoSheet')}
        </label>
        {decks.length === 0 && <p className="muted">{t('home.nothingYet')}</p>}

        {!est ? (
          <div className="row">
            <span className="spacer" />
            <button
              className="btn btn-primary"
              disabled={!canGo || busy === 'gen'}
              onClick={async () => (needsEstimate ? setEst(await call('ai.estimate', source, count)) : void generate())}
            >
              {busy === 'gen' ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              {busy === 'gen' ? (chunks ? t('la.working', { n: chunks }) : t('ai.generating')) : needsEstimate ? t('ai.estimate') : t('ai.send')}
            </button>
          </div>
        ) : (
          <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none', padding: '16px 18px' }}>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>{t('ai.est.title')}</div>
            <div>{local ? t('ai.est.local', { model: status?.model ?? '' }) : t('ai.est.cloud', { provider: providerLabel ?? '', model: status?.model ?? '' })}</div>
            <div className="muted num" style={{ fontSize: '0.875rem', marginTop: 4 }}>
              {t('ai.est.tokens', { a: est.tokensIn, b: est.tokensOut, c: est.chunks })} · {local ? t('ai.est.free') : t('ai.est.cost', { cost: money(est.cost) })}
            </div>
            {est.overCap && (
              <div className="warn" style={{ marginTop: 10 }}>
                <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
                {t('ai.est.overCap')}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, marginLeft: -10 }} onClick={() => setShowText(!showText)}>
              {t('ai.showText')}
            </button>
            {showText && (
              <pre className="selectable" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.8125rem', whiteSpace: 'pre-wrap', background: 'var(--code-bg)', padding: 12, borderRadius: 10, margin: '6px 0 0' }}>
                {text.slice(0, 20000)}
                {text.length > 20000 ? '\n…' : ''}
              </pre>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <span className="spacer" />
              <button className="btn btn-primary" disabled={busy === 'gen' || est.overCap} onClick={() => void generate()}>
                {busy === 'gen' ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {busy === 'gen' ? (chunks ? t('la.working', { n: chunks }) : t('ai.generating')) : t('ai.send')}
              </button>
            </div>
          </div>
        )}
        {busy === 'gen' && runningJob && (
          <div className="card" style={{ boxShadow: 'none', padding: '4px 16px' }}>
            <JobRow job={runningJob} />
          </div>
        )}
        {error && (
          <div className="warn" style={{ background: 'var(--again-soft)' }}>
            <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
            <span className="selectable">{t('ai.error')} — {error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
