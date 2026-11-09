import { ArrowUp, BookOpen, Check, FolderOpen, Loader2, Mic, MicOff, Paperclip, Plus, RotateCcw, MessageCircle, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiStatus, AssistantActionType, DocumentRow } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { isEndOfDictation, useAssistant, wordCount, type ChatMsg } from '../lib/assistantStore'
import { renderMarkdown } from '../lib/render'
import { useStore } from '../store'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type CardsMsg = Extract<ChatMsg, { kind: 'cards' }>

function CardsBlock({ msg }: { msg: CardsMsg }): React.JSX.Element {
  const t = useT()
  const { decks, bump, toast } = useStore()
  const { patch } = useAssistant()
  const [busy, setBusy] = useState(false)
  const chosen = msg.cards.filter((c) => c.on)
  const toggle = (i: number): void => patch(msg.id, { cards: msg.cards.map((c, k) => (k === i ? { ...c, on: !c.on } : c)) })
  const setAll = (on: boolean): void => patch(msg.id, { cards: msg.cards.map((c) => ({ ...c, on })) })
  const add = async (): Promise<void> => {
    if (!msg.deck.trim() || !chosen.length) return
    setBusy(true)
    try {
      const r = await call('assistant.addCards', msg.deck, chosen.map(({ on: _on, dup: _dup, ...c }) => c))
      patch(msg.id, { added: r.added })
      toast(t('as.added', { n: r.added, deck: msg.deck }))
      await bump()
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="as-card-block card">
      <div className="as-block-head">
        <strong>{t('as.cards.title', { n: msg.cards.length })}</strong>
        {msg.added === undefined && (
          <span className="as-links">
            <button className="link-btn" onClick={() => setAll(true)}>{t('as.all')}</button>
            <button className="link-btn" onClick={() => setAll(false)}>{t('as.none')}</button>
          </span>
        )}
      </div>
      <div className="as-cards">
        {msg.cards.map((c, i) => (
          <label key={i} className={`as-card-row ${c.on ? '' : 'off'}`}>
            <input type="checkbox" checked={c.on} disabled={msg.added !== undefined} onChange={() => toggle(i)} />
            <span className="as-card-text">
              {c.kind === 'cloze' ? (
                <span className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.text.replace(/\{\{c\d+::([^}:]*)(?:::[^}]*)?\}\}/g, '**[$1]**')) }} />
              ) : (
                <>
                  <span className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.front) }} />
                  <span className="as-card-back md" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.back) }} />
                </>
              )}
              {c.dup && <span className="badge">{t('as.dup')}</span>}
            </span>
          </label>
        ))}
      </div>
      {msg.added === undefined ? (
        <div className="as-add">
          <input
            className="input"
            list="as-decks"
            value={msg.deck}
            placeholder={t('as.deck')}
            onChange={(e) => patch(msg.id, { deck: e.target.value })}
          />
          <datalist id="as-decks">
            {decks.map((d) => (
              <option key={d.id} value={d.fullName} />
            ))}
          </datalist>
          <button className="btn btn-primary" disabled={busy || !chosen.length || !msg.deck.trim()} onClick={() => void add()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} {t('as.addN', { n: chosen.length })}
          </button>
        </div>
      ) : (
        <div className="as-done">
          <Check size={15} /> {t('as.added', { n: msg.added, deck: msg.deck })}
        </div>
      )}
    </div>
  )
}

export function Assistant(): React.JSX.Element {
  const t = useT()
  const { go, toast, settings, patchSettings } = useStore()
  const A = useAssistant()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [status, setStatus] = useState<AiStatus | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const generation = useRef(0)

  useEffect(() => {
    void call('ai.status').then(setStatus)
  }, [])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [A.msgs.length, busy])

  const words = useMemo(() => wordCount(A.source), [A.source])
  const noAi = status?.provider === 'none'

  const say = (text: string, extra: Partial<Extract<ChatMsg, { kind: 'assistant' }>> = {}): void => A.push({ id: A.newId(), kind: 'assistant', text, ...extra })

  /** Texte de départ d'une action : le cours dicté, sinon les fiches jointes, sinon la dernière réponse. */
  const sourceFor = (pref?: string): string => {
    const s = useAssistant.getState()
    const lastReply = [...s.msgs].reverse().find((m) => m.kind === 'assistant' && !m.error)
    const last = lastReply && lastReply.kind === 'assistant' ? lastReply.text : ''
    const sheets = s.attached.map((a) => a.text).join('\n\n')
    const p = (pref ?? '').toLowerCase()
    if (p.startsWith('dern')) return last
    if (p.startsWith('fiche')) return sheets || s.source
    return s.source || sheets || last
  }

  const run = async (type: AssistantActionType, params: Record<string, string> = {}, text?: string): Promise<void> => {
    if (type === 'dictation') {
      A.set({ dictation: true })
      return
    }
    const src = text ?? sourceFor(params.source)
    const nb = Number(params.nb) || 0
    const title = params.titre || params.title || ''
    try {
      if (type === 'cards') {
        setBusy(t('as.busy.cards'))
        const rows = await call('assistant.makeCards', src, nb, '')
        if (!rows.length) return say(t('as.noCards'), { error: true })
        A.push({ id: A.newId(), kind: 'cards', cards: rows.map((c) => ({ ...c, on: !c.dup })), deck: params.deck || title || t('as.defaultDeck') })
      } else if (type === 'sheet') {
        setBusy(t('as.busy.sheet'))
        const sheets = await call('assistant.makeSheets', src, title)
        A.push({ id: A.newId(), kind: 'sheets', title: t('as.sheets.title', { n: sheets.length }), sheets })
      } else {
        setBusy(t('as.busy.ex'))
        const sheet = await call('assistant.makeExercises', src, title, nb)
        A.push({ id: A.newId(), kind: 'sheets', title: t('as.ex.title'), sheets: [sheet] })
      }
    } catch (e) {
      say(errText(e), { error: true })
    } finally {
      setBusy(null)
    }
  }

  const endDictation = (): void => {
    const s = useAssistant.getState()
    A.set({ dictation: false })
    A.push({ id: A.newId(), kind: 'choices', text: t('as.dictDone', { n: wordCount(s.source) }) })
  }

  const send = async (raw: string): Promise<void> => {
    const text = raw.trim()
    if (!text || busy) return
    setInput('')
    const s = useAssistant.getState()
    if (s.dictation) {
      if (isEndOfDictation(text)) return endDictation()
      A.set({ source: s.source ? `${s.source}\n\n${text}` : text })
      A.push({ id: A.newId(), kind: 'user', text, dictation: true })
      return
    }
    // Un long texte collé est un cours : l'application le garde en entier pour produire cartes et fiches.
    const source = text.length >= 800 ? (s.source ? `${s.source}\n\n${text}` : text) : s.source
    A.set({ source })
    const history = s.msgs
      .filter((m): m is Extract<ChatMsg, { kind: 'user' | 'assistant' }> => (m.kind === 'user' || m.kind === 'assistant') && !('error' in m && m.error) && !('dictation' in m && m.dictation))
      .map((m) => ({ role: m.kind, content: m.text }))
    A.push({ id: A.newId(), kind: 'user', text })
    const mine = ++generation.current
    setBusy(t('as.thinking'))
    try {
      const res = await call('assistant.chat', { history, message: text, web: s.web, source, attached: s.attached.map((a) => ({ title: a.title, text: a.text })) })
      if (mine !== generation.current) return
      say(res.reply, { trace: res.trace })
      setBusy(null)
      for (const a of res.actions) await run(a.type, a.params)
    } catch (e) {
      if (mine === generation.current) say(errText(e), { error: true })
    } finally {
      if (mine === generation.current) setBusy(null)
    }
  }

  const openPicker = async (): Promise<void> => {
    setPicker((v) => !v)
    if (!docs.length) setDocs((await call('docs.list')).filter((d) => d.hasText))
  }
  const attach = async (d: DocumentRow): Promise<void> => {
    if (A.attached.some((a) => a.id === d.id)) return
    try {
      const text = await call('docs.text', d.id)
      A.set({ attached: [...A.attached, { id: d.id, title: d.title, text }] })
      setPicker(false)
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    }
  }

  const suggestions = [t('as.sug.dict'), t('as.sug.quiz'), t('as.sug.enrich'), t('as.sug.how')]

  const bubble = (m: ChatMsg): React.JSX.Element | null => {
    if (m.kind === 'user')
      return (
        <div key={m.id} className="as-row user">
          <div className={`as-bubble user ${m.dictation ? 'dict' : ''}`}>
            {m.dictation ? (
              <>
                <Mic size={13} /> {t('as.dictAdded', { n: wordCount(m.text) })}
                <div className="as-dict-text">{m.text.length > 180 ? `${m.text.slice(0, 180)}…` : m.text}</div>
              </>
            ) : m.text.length > 700 ? (
              <>
                <div className="as-pre">{m.text.slice(0, 500)}…</div>
                <div className="as-dict-text">{t('as.longPaste', { n: wordCount(m.text) })}</div>
              </>
            ) : (
              <div className="as-pre">{m.text}</div>
            )}
          </div>
        </div>
      )
    if (m.kind === 'assistant')
      return (
        <div key={m.id} className="as-row">
          <div className={`as-bubble assistant ${m.error ? 'err' : ''}`}>
            {m.trace?.map((tr, i) => (
              <div key={i} className="as-trace">
                {tr.kind === 'sheet' ? <BookOpen size={13} /> : tr.kind === 'file' ? <FolderOpen size={13} /> : <Search size={13} />} {tr.kind === 'search' ? t('as.searched', { q: tr.label }) : tr.kind === 'page' ? t('as.read', { q: tr.label }) : tr.kind === 'file' ? t('as.readFile', { q: tr.label }) : t('as.readSheet', { q: tr.label })}
                {tr.links.map((l) => (
                  <button key={l.url} className="link-btn" onClick={() => void call('app.openExternal', l.url)}>
                    {l.title}
                  </button>
                ))}
              </div>
            ))}
            {m.error ? <div className="selectable">{m.text}</div> : <div className="md selectable" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />}
            {!m.error && m.text.length > 250 && (
              <div className="as-tools">
                <button className="link-btn" disabled={!!busy} onClick={() => void run('cards', { source: 'dernière' })}>{t('as.toCards')}</button>
                <button className="link-btn" disabled={!!busy} onClick={() => void run('sheet', { source: 'dernière' })}>{t('as.toSheet')}</button>
              </div>
            )}
          </div>
        </div>
      )
    if (m.kind === 'choices')
      return (
        <div key={m.id} className="as-row">
          <div className="as-bubble assistant">
            <div>{m.text}</div>
            <div className="as-choices">
              <button className="btn" disabled={!!busy} onClick={() => void run('cards')}>{t('as.mkCards')}</button>
              <button className="btn" disabled={!!busy} onClick={() => void run('sheet')}>{t('as.mkSheet')}</button>
              <button className="btn" disabled={!!busy} onClick={() => void run('exercises')}>{t('as.mkEx')}</button>
              <button className="btn" disabled={!!busy} onClick={async () => { await run('cards'); await run('sheet') }}>{t('as.mkBoth')}</button>
            </div>
          </div>
        </div>
      )
    if (m.kind === 'cards')
      return (
        <div key={m.id} className="as-row wide">
          <CardsBlock msg={m} />
        </div>
      )
    return (
      <div key={m.id} className="as-row wide">
        <div className="as-card-block card">
          <strong>{m.title}</strong>
          {m.sheets.map((s) => (
            <div key={s.id} className="backup-row">
              <span style={{ flex: 1 }}>{s.title}</span>
              <button className="btn btn-sm" onClick={() => go({ name: 'doc', id: s.id })}>{t('act.open')}</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="page as-page">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('as.title')}</h1>
          <p className="page-sub">{t('as.sub')}</p>
        </div>
        {A.msgs.length > 0 && (
          <button className="btn btn-sm" onClick={() => { generation.current++; setBusy(null); A.reset() }}>
            <RotateCcw size={14} /> {t('as.new')}
          </button>
        )}
      </div>

      {noAi && (
        <div className="warn" style={{ marginBottom: 12 }}>
          {t('as.noAi')} <button className="link-btn" onClick={() => go({ name: 'integrations' })}>{t('as.noAiBtn')}</button>
        </div>
      )}

      <div className="as-chat">
        {A.msgs.length === 0 && (
          <div className="as-empty">
            <MessageCircle size={22} color="var(--accent)" />
            <p>{t('as.hello')}</p>
            <div className="as-sugs">
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {A.msgs.map(bubble)}
        {busy && (
          <div className="as-row">
            <div className="as-bubble assistant as-busy"><Loader2 size={15} className="spin" /> {busy}</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="as-composer">
        {(words > 0 || A.attached.length > 0 || A.dictation) && (
          <div className="as-chips">
            {A.dictation && (
              <span className="chip on">
                <Mic size={13} /> {t('as.dictOn', { n: words })}
                <button className="link-btn" onClick={endDictation}>{t('as.dictEnd')}</button>
              </span>
            )}
            {!A.dictation && words > 0 && (
              <span className="chip">
                {t('as.course', { n: words })}
                <button aria-label={t('as.clear')} onClick={() => A.set({ source: '' })}><X size={12} /></button>
              </span>
            )}
            {A.attached.map((a) => (
              <span key={a.id} className="chip">
                <BookOpen size={12} /> {a.title}
                <button aria-label={t('as.clear')} onClick={() => A.set({ attached: A.attached.filter((x) => x.id !== a.id) })}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        {picker && (
          <div className="as-picker card">
            {docs.length === 0 && <div className="d" style={{ padding: 10 }}>{t('as.noDocs')}</div>}
            {docs.slice(0, 80).map((d) => (
              <button key={d.id} className="nav-item" onClick={() => void attach(d)}>
                <BookOpen size={15} /> <span className="label">{d.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="as-input card">
          <textarea
            ref={area}
            value={input}
            rows={A.dictation ? 4 : 2}
            placeholder={A.dictation ? t('as.ph.dict') : t('as.ph')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(input)
              }
            }}
          />
          <div className="as-bar">
            <button className={`btn btn-sm ${A.dictation ? 'btn-primary' : ''}`} title={t('as.dictHelp')} onClick={() => (A.dictation ? endDictation() : A.set({ dictation: true }))}>
              {A.dictation ? <MicOff size={14} /> : <Mic size={14} />} {t('as.dict')}
            </button>
            <button className="btn btn-sm" title={t('as.attachHelp')} onClick={() => void openPicker()}>
              <Paperclip size={14} /> {t('as.attach')}
            </button>
            <button className={`btn btn-sm ${settings.assistantFolder ? 'btn-primary' : ''}`} title={t('as.folderHelp')} onClick={() => void call('assistant.pickFolder').then(async (f) => { if (f) await patchSettings({ assistantFolder: f }) })}>
              <FolderOpen size={14} /> {t('as.folder')}
            </button>
            <label className="as-web" title={t('as.webHelp')}>
              <input type="checkbox" checked={A.web} onChange={(e) => A.set({ web: e.target.checked })} /> {t('as.web')}
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" disabled={!input.trim() || !!busy} onClick={() => void send(input)} aria-label={t('as.send')}>
              <ArrowUp size={15} />
            </button>
          </div>
        </div>
        {A.web && <div className="d as-webnote">{t('as.webNote')}</div>}
        {settings.assistantFolder && (
          <div className="d as-webnote as-folder">
            <FolderOpen size={13} /> <span>{t('as.folderNote', { p: settings.assistantFolder })}</span>
            <button className="link-btn" onClick={() => void patchSettings({ assistantFolder: '' })}>{t('as.folderRemove')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
