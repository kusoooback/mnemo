import { useEffect, useState } from 'react'
import type { DuplicateGroup } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'
import { Inline } from './Inline'
import { Modal } from './ui'

/** Fusion assistée des cartes en doublon (F10). */
export function DuplicatesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const { bump, toast } = useStore()
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)

  const load = async (): Promise<void> => setGroups(await call('dup.find'))
  useEffect(() => {
    void load()
  }, [])

  return (
    <Modal title={t('dup.title')} onClose={onClose} width={640}>
      <div className="modal-body">
        {groups === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : groups.length === 0 ? (
          <p className="muted">{t('dup.none')}</p>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 12, fontSize: '0.8125rem' }}>{t('dup.hint')}</p>
            {groups.map((g) => (
              <div key={g.key} className="card" style={{ marginBottom: 10, boxShadow: 'none' }}>
                {g.notes.map((n) => (
                  <div key={n.id} className="backup-row" style={{ padding: '10px 14px', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}><Inline text={n.front} max={160} /></div>
                      <div className="muted" style={{ fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>{n.back ? <Inline text={n.back} max={160} /> : '—'}</div>
                      <div className="faint" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                        {n.deckName} · {t('dup.reviews', { n: n.reviews })}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        await call('dup.merge', n.id, g.notes.filter((x) => x.id !== n.id).map((x) => x.id))
                        toast(t('dup.merged'))
                        await bump()
                        await load()
                      }}
                    >
                      {t('dup.keep')}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}
