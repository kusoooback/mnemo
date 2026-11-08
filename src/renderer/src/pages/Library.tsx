import { Pause, Play, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardRow, SearchQuery } from '@shared/types'
import { call } from '../api'
import { DuplicatesModal } from '../components/Duplicates'
import { useConfirm } from '../components/ui'
import { useT, type Key } from '../i18n'
import { formatDue, plainText } from '../lib/format'
import { useStore } from '../store'

const PAGE = 100

const stateOf = (r: CardRow): 'is-new' | 'is-learning' | 'is-review' | 'is-susp' =>
  r.suspended ? 'is-susp' : r.state === 0 ? 'is-new' : r.state === 2 ? 'is-review' : 'is-learning'

const stateLabel = (r: CardRow): Key =>
  r.suspended
    ? 'lib.state.label.suspended'
    : r.state === 0
      ? 'lib.state.label.new'
      : r.state === 1
        ? 'lib.state.label.learning'
        : r.state === 3
          ? 'lib.state.label.relearning'
          : 'lib.state.label.review'

function cardText(r: CardRow): { a: string; b: string } {
  if (r.kind === 'cloze') return { a: plainText(r.fields.text ?? ''), b: plainText(r.fields.extra ?? '') }
  if (r.kind === 'occlusion') return { a: `Image à compléter · zone ${r.ord}`, b: plainText(r.fields.extra ?? '') }
  const rev = r.kind === 'basic-reverse' && r.ord === 1
  return { a: plainText((rev ? r.fields.back : r.fields.front) ?? ''), b: plainText((rev ? r.fields.front : r.fields.back) ?? '') }
}

export function Library({ initialDeck, initialText }: { initialDeck?: string | null; initialText?: string }): React.JSX.Element {
  const t = useT()
  const { decks, openEditor, rev, bump, toast, settings } = useStore()
  const [q, setQ] = useState<Omit<SearchQuery, 'limit' | 'offset'>>({
    text: initialText ?? '',
    deckId: initialDeck ?? null,
    state: 'all',
    tag: null,
    sort: 'created'
  })
  const [rows, setRows] = useState<CardRow[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [moveTo, setMoveTo] = useState('')
  const [dupOpen, setDupOpen] = useState(false)
  const [confirm, confirmNode] = useConfirm()
  const limit = useRef(PAGE)
  const seq = useRef(0)

  const run = useCallback(async () => {
    const my = ++seq.current
    const res = await call('card.search', { ...q, limit: limit.current, offset: 0 })
    if (my !== seq.current) return
    setRows(res.rows)
    setTotal(res.total)
  }, [q])

  useEffect(() => {
    limit.current = PAGE
    const h = setTimeout(() => void run(), q.text ? 120 : 0)
    return () => clearTimeout(h)
  }, [q, run, rev])

  useEffect(() => {
    void call('tags.list').then(setTags)
  }, [rev])

  const toggle = (id: string): void =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.cardId))
  const ids = [...sel]

  const after = async (): Promise<void> => {
    setSel(new Set())
    await bump()
  }

  return (
    <div className="page page-wide">
      <div className="page-head" style={{ marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('lib.title')}</h1>
          <p className="page-sub num">{t('lib.count', { n: total })}</p>
        </div>
        <button className="btn btn-sm" onClick={() => setDupOpen(true)}>{t('lib.dups')}</button>
      </div>

      <div className="toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            className="input"
            placeholder={t('lib.search')}
            value={q.text}
            autoFocus
            onChange={(e) => setQ({ ...q, text: e.target.value })}
          />
        </div>
        <select className="select select-sm" value={q.deckId ?? ''} onChange={(e) => setQ({ ...q, deckId: e.target.value || null })}>
          <option value="">{t('lib.allDecks')}</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {' '.repeat(d.depth)}
              {d.name}
            </option>
          ))}
        </select>
        <select className="select select-sm" value={q.state} onChange={(e) => setQ({ ...q, state: e.target.value as SearchQuery['state'] })}>
          <option value="all">{t('lib.allStates')}</option>
          <option value="new">{t('lib.state.new')}</option>
          <option value="learning">{t('lib.state.learning')}</option>
          <option value="review">{t('lib.state.review')}</option>
          <option value="due">{t('lib.state.due')}</option>
          <option value="suspended">{t('lib.state.suspended')}</option>
        </select>
        <select className="select select-sm" value={q.tag ?? ''} onChange={(e) => setQ({ ...q, tag: e.target.value || null })}>
          <option value="">{t('lib.allTags')}</option>
          {tags.map((x) => (
            <option key={x} value={x}>
              #{x}
            </option>
          ))}
        </select>
        <select className="select select-sm" value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value as SearchQuery['sort'] })}>
          <option value="created">{t('lib.sort.created')}</option>
          <option value="due">{t('lib.sort.due')}</option>
          <option value="lapses">{t('lib.sort.lapses')}</option>
          <option value="alpha">{t('lib.sort.alpha')}</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">
          <h3>{t('lib.emptyTitle')}</h3>
          <p>{t('lib.emptyText')}</p>
        </div>
      ) : (
        <div className="card table">
          <div className="t-head">
            <input
              type="checkbox"
              className="checkbox"
              checked={allSelected}
              onChange={() => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.cardId)))}
              aria-label="select all"
            />
            <span>{t('lib.col.card')}</span>
            <span>{t('lib.col.deck')}</span>
            <span>{t('lib.col.state')}</span>
            <span>{t('lib.col.due')}</span>
          </div>
          {rows.map((r) => {
            const { a, b } = cardText(r)
            return (
              <div
                key={r.cardId}
                className={`t-row ${sel.has(r.cardId) ? 'sel' : ''}`}
                onClick={() => openEditor({ noteId: r.noteId })}
              >
                <span onClick={(e) => e.stopPropagation()} style={{ display: 'grid' }}>
                  <input type="checkbox" className="checkbox" checked={sel.has(r.cardId)} onChange={() => toggle(r.cardId)} aria-label="select" />
                </span>
                <div className="front">
                  <div className="a">{a || '…'}</div>
                  <div className="b">
                    {b || ' '}
                    {r.tags.length > 0 && <span className="faint"> {b ? '·' : ''} #{r.tags.join(' #')}</span>}
                  </div>
                </div>
                <span className="deckname">{r.deckName}</span>
                <span className={`state-chip ${stateOf(r)}`}>
                  <i />
                  {t(stateLabel(r))}
                </span>
                <span className="muted num" style={{ fontSize: '0.8125rem' }}>
                  {r.suspended ? '—' : formatDue(r.due, r.state, settings.language)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {rows.length < total && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            className="btn"
            onClick={() => {
              limit.current += PAGE
              void run()
            }}
          >
            {t('lib.more')} ({rows.length}/{total})
          </button>
        </div>
      )}

      {sel.size > 0 && (
        <div className="bulk-bar">
          <span className="num" style={{ marginRight: 4 }}>
            {t('lib.selected', { n: sel.size })}
          </span>
          <select
            className="select"
            style={{ width: 160 }}
            value={moveTo}
            onChange={async (e) => {
              const dest = e.target.value
              setMoveTo('')
              if (!dest) return
              await call('card.move', ids, dest)
              toast(t('lib.done'))
              await after()
            }}
          >
            <option value="">{t('lib.move')}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {' '.repeat(d.depth)}
                {d.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const suspend = !rows.filter((r) => sel.has(r.cardId)).every((r) => r.suspended)
              await call('card.suspend', ids, suspend)
              await after()
            }}
          >
            {rows.filter((r) => sel.has(r.cardId)).every((r) => r.suspended) ? <Play size={14} /> : <Pause size={14} />}
            {rows.filter((r) => sel.has(r.cardId)).every((r) => r.suspended) ? t('lib.unsuspend') : t('lib.suspend')}
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (!(await confirm({ title: t('lib.reset'), text: t('lib.confirmReset', { n: sel.size }), confirmLabel: t('lib.reset') }))) return
              await call('card.reset', ids)
              await after()
            }}
          >
            <RotateCcw size={14} />
            {t('lib.reset')}
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (!(await confirm({ title: t('lib.delete'), text: t('lib.confirmDelete', { n: sel.size }), confirmLabel: t('common.delete'), danger: true }))) return
              const noteIds = [...new Set(rows.filter((r) => sel.has(r.cardId)).map((r) => r.noteId))]
              await call('note.delete', noteIds)
              await after()
            }}
          >
            <Trash2 size={14} />
            {t('lib.delete')}
          </button>
        </div>
      )}
      {confirmNode}
      {dupOpen && <DuplicatesModal onClose={() => setDupOpen(false)} />}
    </div>
  )
}
