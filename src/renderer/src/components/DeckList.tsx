import { ChevronDown, ChevronRight, FolderPlus, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { DeckInfo } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'
import { ContextMenu, PromptModal, useConfirm, type MenuItem } from './ui'

/** Liste de decks avec compteurs, repli des sous-decks et menu d'actions. */
export function DeckList({ decks, baseDepth = 0 }: { decks: DeckInfo[]; baseDepth?: number }): React.JSX.Element {
  const t = useT()
  const { go, bump, toast, openEditor } = useStore()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; deck: DeckInfo } | null>(null)
  const [rename, setRename] = useState<DeckInfo | null>(null)
  const [sub, setSub] = useState<DeckInfo | null>(null)
  const [confirm, confirmNode] = useConfirm()

  const hidden = new Set<string>()
  const rows = decks.filter((d) => {
    if (d.parentId && (hidden.has(d.parentId) || collapsed.has(d.parentId))) {
      hidden.add(d.id)
      return false
    }
    return true
  })

  const items = (d: DeckInfo): (MenuItem | 'sep')[] => [
    { label: t('deck.study'), icon: <Play size={15} />, onClick: () => go({ name: 'review', deckId: d.id }) },
    { label: t('deck.addCard'), icon: <Plus size={15} />, onClick: () => openEditor({ deckId: d.id }) },
    'sep',
    { label: t('deck.newSub'), icon: <FolderPlus size={15} />, onClick: () => setSub(d) },
    { label: t('deck.rename'), icon: <Pencil size={15} />, onClick: () => setRename(d) },
    'sep',
    {
      label: t('deck.delete'),
      icon: <Trash2 size={15} />,
      danger: true,
      onClick: async () => {
        const ok = await confirm({
          title: t('deck.delete'),
          text: t('deck.confirmDelete', { name: d.name, n: d.totalCards }),
          confirmLabel: t('common.delete'),
          danger: true
        })
        if (!ok) return
        await call('deck.delete', d.id)
        await bump()
        toast(t('deck.deleted'))
      }
    }
  ]

  return (
    <>
      <div className="deck-head-cols">
        <span>{t('home.newCards')}</span>
        <span>{t('home.learning')}</span>
        <span>{t('home.toReview')}</span>
        <span style={{ width: 32 }} />
      </div>
      <div className="card deck-list">
        {rows.map((d) => (
          <div
            key={d.id}
            className="deck-row"
            style={{ ['--depth' as string]: d.depth - baseDepth }}
            onClick={() => go({ name: 'deck', id: d.id })}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, deck: d })
            }}
          >
            {d.hasChildren ? (
              <button
                className="chev"
                onClick={(e) => {
                  e.stopPropagation()
                  setCollapsed((c) => {
                    const n = new Set(c)
                    if (n.has(d.id)) n.delete(d.id)
                    else n.add(d.id)
                    return n
                  })
                }}
                aria-label="toggle"
              >
                {collapsed.has(d.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : (
              <span style={{ width: 20 }} />
            )}
            <span className="name">{d.name}</span>
            <span className="nums num">
              <span className={`n ${d.newCount ? 'on' : ''}`}>{d.newCount}</span>
              <span className={`l ${d.learnCount ? 'on' : ''}`}>{d.learnCount}</span>
              <span className={`d ${d.dueCount ? 'on' : ''}`}>{d.dueCount}</span>
            </span>
            <button
              className="icon-btn row-actions"
              onClick={(e) => {
                e.stopPropagation()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setMenu({ x: r.left - 150, y: r.bottom + 4, deck: d })
              }}
              aria-label="actions"
            >
              <MoreHorizontal size={17} />
            </button>
          </div>
        ))}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.deck)} onClose={() => setMenu(null)} />}
      {rename && (
        <PromptModal
          title={t('deck.rename')}
          label={t('deck.name')}
          initial={rename.name}
          confirmLabel={t('deck.rename')}
          onClose={() => setRename(null)}
          onSubmit={async (name) => {
            await call('deck.rename', rename.id, name)
            setRename(null)
            await bump()
          }}
        />
      )}
      {sub && (
        <PromptModal
          title={t('deck.newSub')}
          label={t('deck.name')}
          hint={`${sub.fullName.replace(/::/g, ' › ')}`}
          confirmLabel={t('deck.create')}
          onClose={() => setSub(null)}
          onSubmit={async (name) => {
            await call('deck.create', name, sub.id)
            setSub(null)
            await bump()
          }}
        />
      )}
      {confirmNode}
    </>
  )
}
