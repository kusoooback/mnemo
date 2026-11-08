import { FilePlus2, Layers, Loader2, ScrollText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { DocumentRow } from '@shared/types'
import { call } from '../api'
import { useConfirm } from '../components/ui'
import { useT } from '../i18n'
import { useStore } from '../store'

/** Toutes les fiches de révision au même endroit : celles de la génération IA et celles des cours importés. */
export function Sheets(): React.JSX.Element {
  const t = useT()
  const { go, rev, bump, settings, toast } = useStore()
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [confirm, confirmNode] = useConfirm()
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => setDocs(await call('docs.list')), [])
  useEffect(() => {
    void load()
  }, [load, rev])

  const mine = docs.filter((d) => d.isSheet).sort((a, b) => b.addedAt - a.addedAt)
  const courses = docs.filter((d) => !d.isSheet && d.hasSummary)
  const date = (ms: number): string => new Date(ms).toLocaleDateString(settings.language === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const row = (d: DocumentRow, removable: boolean): React.JSX.Element => (
    <div key={d.id} className="t-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', cursor: 'pointer' }} onClick={() => go({ name: 'doc', id: d.id })}>
      <div className="front">
        <div className="a">{d.title}</div>
        <div className="b">{[d.subject, d.chapter, date(d.addedAt)].filter(Boolean).join(' · ')}</div>
      </div>
      <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-sm"
          disabled={!!busy}
          title={t('sh.cardsHint')}
          onClick={async () => {
            setBusy(d.id)
            try {
              toast(t('pp.docs.cardsDone', { n: await call('docs.makeCards', d.id, 12) }))
              await bump()
            } catch (e) {
              toast((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'error' })
            } finally {
              setBusy('')
            }
          }}
        >
          {busy === d.id ? <Loader2 size={14} className="spin" /> : <Layers size={14} />}
          {t('pp.docs.cards')}
        </button>
        <button className="btn btn-sm" onClick={() => go({ name: 'doc', id: d.id })}>{t('act.open')}</button>
        {removable && (
          <button
            className="icon-btn"
            aria-label={t('common.delete')}
            onClick={async () => {
              if (!(await confirm({ title: t('common.delete'), text: d.title, confirmLabel: t('common.delete'), danger: true }))) return
              await call('docs.delete', d.id, true)
              await bump()
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </span>
    </div>
  )

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('sh.title')}</h1>
          <p className="page-sub">{t('sh.sub')}</p>
        </div>
        <button className="btn btn-dark" onClick={() => go({ name: 'ai' })}>
          <FilePlus2 size={16} />
          {t('sh.create')}
        </button>
      </div>

      <div className="eyebrow">{t('sh.mine')} · {mine.length}</div>
      {mine.length === 0 ? (
        <div className="card empty" style={{ marginBottom: 22 }}>
          <ScrollText size={26} color="var(--accent)" />
          <p>{t('sh.empty')}</p>
        </div>
      ) : (
        <div className="card table" style={{ marginBottom: 22 }}>{mine.map((d) => row(d, true))}</div>
      )}

      <div className="eyebrow">{t('sh.courses')} · {courses.length}</div>
      {courses.length === 0 ? <p className="muted" style={{ fontSize: '0.875rem' }}>{t('sh.none2')}</p> : <div className="card table">{courses.map((d) => row(d, false))}</div>}
      {confirmNode}
    </div>
  )
}
