import { FileSpreadsheet, FolderPlus, Library, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { call } from '../api'
import { DeckList } from '../components/DeckList'
import { PromptModal, useConfirm } from '../components/ui'
import { useT } from '../i18n'
import { useStore } from '../store'

export function DeckPage({ id }: { id: string }): React.JSX.Element {
  const t = useT()
  const { decks, settings, go, bump, openEditor, openImport } = useStore()
  const deck = decks.find((d) => d.id === id)
  const [rename, setRename] = useState(false)
  const [sub, setSub] = useState(false)
  const [confirm, confirmNode] = useConfirm()
  const [limit, setLimit] = useState('')

  useEffect(() => {
    setLimit(deck?.newPerDay != null ? String(deck.newPerDay) : '')
  }, [deck?.id, deck?.newPerDay])

  if (!deck) {
    return (
      <div className="page">
        <div className="card empty">
          <h3>{t('deck.empty')}</h3>
          <button className="btn" onClick={() => go({ name: 'home' })}>
            {t('review.back')}
          </button>
        </div>
      </div>
    )
  }

  const children = decks.filter((d) => d.fullName.startsWith(`${deck.fullName}::`))
  const left = deck.newCount + deck.learnCount + deck.dueCount
  const crumbs = deck.fullName.split('::').slice(0, -1)

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {crumbs.length > 0 && <div className="eyebrow">{crumbs.join(' › ')}</div>}
          <h1 className="page-title">{deck.name}</h1>
          <p className="page-sub">{t('home.cards', { n: deck.totalCards })}</p>
        </div>
      </div>

      <div className="card today-card">
        <div className="row" style={{ gap: 32 }}>
          <div className="tri">
            <div className="it">
              <span className="v n">{deck.newCount}</span>
              <span className="l">{t('home.newCards')}</span>
            </div>
            <div className="it">
              <span className="v l2">{deck.learnCount}</span>
              <span className="l">{t('home.learning')}</span>
            </div>
            <div className="it">
              <span className="v d">{deck.dueCount}</span>
              <span className="l">{t('home.toReview')}</span>
            </div>
          </div>
          <span className="spacer" />
          <button
            className="btn btn-primary btn-lg"
            disabled={left === 0}
            title={left === 0 ? t('deck.nothingToStudy') : undefined}
            onClick={() => go({ name: 'review', deckId: deck.id })}
          >
            <Play size={16} fill="currentColor" />
            {t('deck.study')}
          </button>
        </div>
      </div>

      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => openEditor({ deckId: deck.id })}>
          <Plus size={16} />
          {t('deck.addCard')}
        </button>
        <button className="btn" onClick={() => go({ name: 'library', deckId: deck.id })}>
          <Library size={16} />
          {t('deck.browse')}
        </button>
        <button className="btn" onClick={() => openImport({ deckId: deck.id })}>
          <FileSpreadsheet size={16} />
          {t('deck.importCsv')}
        </button>
        <span className="spacer" />
        <button className="icon-btn" title={t('deck.newSub')} aria-label={t('deck.newSub')} onClick={() => setSub(true)}>
          <FolderPlus size={18} />
        </button>
        <button className="icon-btn" title={t('deck.rename')} aria-label={t('deck.rename')} onClick={() => setRename(true)}>
          <Pencil size={18} />
        </button>
        <button
          className="icon-btn"
          title={t('deck.delete')}
          aria-label={t('deck.delete')}
          onClick={async () => {
            const ok = await confirm({
              title: t('deck.delete'),
              text: t('deck.confirmDelete', { name: deck.name, n: deck.totalCards }),
              confirmLabel: t('common.delete'),
              danger: true
            })
            if (!ok) return
            await call('deck.delete', deck.id)
            await useStore.getState().bump()
            useStore.getState().toast(t('deck.deleted'))
            go({ name: 'home' })
          }}
        >
          <Trash2 size={18} />
        </button>
      </div>

      {children.length > 0 && (
        <>
          <div className="section-head">
            <h2>{t('deck.subdecks')}</h2>
          </div>
          <DeckList decks={children} baseDepth={deck.depth + 1} />
        </>
      )}

      <div className="section-head">
        <h2>{t('deck.limit')}</h2>
      </div>
      <div className="card card-pad row">
        <input
          className="input"
          style={{ width: 110 }}
          type="number"
          min={0}
          max={9999}
          placeholder={String(settings.newPerDay)}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          onBlur={async () => {
            const v = limit.trim() === '' ? null : Math.max(0, Math.round(Number(limit)))
            if (v === deck.newPerDay) return
            await call('deck.update', deck.id, { newPerDay: Number.isNaN(v) ? null : v })
            await bump()
          }}
        />
        <span className="muted" style={{ fontSize: '0.8125rem' }}>
          {t('deck.limitHint', { n: settings.newPerDay })}
        </span>
      </div>

      {rename && (
        <PromptModal
          title={t('deck.rename')}
          label={t('deck.name')}
          initial={deck.name}
          confirmLabel={t('deck.rename')}
          onClose={() => setRename(false)}
          onSubmit={async (name) => {
            await call('deck.rename', deck.id, name)
            setRename(false)
            await bump()
          }}
        />
      )}
      {sub && (
        <PromptModal
          title={t('deck.newSub')}
          label={t('deck.name')}
          confirmLabel={t('deck.create')}
          onClose={() => setSub(false)}
          onSubmit={async (name) => {
            await call('deck.create', name, deck.id)
            setSub(false)
            await bump()
          }}
        />
      )}
      {confirmNode}
    </div>
  )
}
