import { Check, Copy, Cpu, Download, FolderOpen, Loader2, Trash2, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { LocalAiStatus } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'

/** Active l'IA gratuite et illimitée : un modèle open source qui tourne sur le PC. */
export function LocalAiSetup({ onReady }: { onReady?: () => void }): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [st, setSt] = useState<LocalAiStatus | null>(null)
  const [dl, setDl] = useState<{ id: string; downloaded: number; total: number } | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => setSt(await call('ai.local.status')), [])
  useEffect(() => {
    void load()
    return window.mnemo.onEvent((e) => {
      const p = e.payload as { id: string; downloaded?: number; total?: number; done?: boolean; error?: string }
      if (e.type === 'ai-download') {
        if (p.done || p.error) {
          setDl(null)
          if (p.error) setError(p.error)
          void load()
        } else setDl({ id: p.id, downloaded: p.downloaded ?? 0, total: p.total ?? 1 })
      } else if (e.type === 'ai-ready') {
        void load()
        toast(t('la.ready'))
        onReady?.()
      }
    })
  }, [load, onReady, toast, t])

  if (!st) return <div className="card card-pad muted">{t('common.loading')}</div>
  const busy = !!dl || !!st.downloading
  const active = dl ?? st.downloading
  const gb = (mb: number): string => (mb / 1000).toFixed(1).replace('.', ',')

  return (
    <div className="card card-pad">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Zap size={20} color="var(--accent)" style={{ marginTop: 3 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{t('la.title')}</div>
          <p className="muted" style={{ fontSize: '0.875rem', margin: '2px 0 0' }}>{t('la.desc')}</p>
          <p className="muted" style={{ fontSize: '0.8125rem', margin: '8px 0 0', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Cpu size={14} />
            {st.gpu ? t('la.gpu', { vram: Math.round(st.vramMb / 1000) }) : t('la.cpu')}
          </p>
          <div className="la-where">
            <span className="la-where-l">{t('la.where')}</span>
            <code className="selectable" title={st.dir}>{st.dir}</code>
            <button className="btn btn-sm" onClick={() => void call('ai.local.reveal')}>
              <FolderOpen size={14} />
              {t('set.open')}
            </button>
            <button
              className="icon-btn"
              aria-label={t('la.copyPath')}
              title={t('la.copyPath')}
              onClick={() => {
                void navigator.clipboard.writeText(st.dir)
                toast(t('la.pathCopied'))
              }}
            >
              <Copy size={15} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {st.models.map((m) => {
          const selected = st.selected === m.id
          const isDl = active?.id === m.id
          return (
            <div key={m.id} className="backup-row" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b style={{ fontWeight: 500 }}>{m.label}</b>
                  <span className="muted num" style={{ fontSize: '0.8125rem' }}>{t('la.size', { n: gb(m.sizeMb) })}</span>
                  {m.recommended && <span className="tag" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>{t('la.recommended')}</span>}
                </div>
                <div className="muted" style={{ fontSize: '0.8125rem' }}>{m.description}</div>
                {m.installed && m.path && (
                  <div className="la-file">
                    <code className="selectable" title={m.path}>{m.path}</code>
                    <button className="icon-btn" aria-label={t('la.reveal')} title={t('la.reveal')} onClick={() => void call('ai.local.reveal', m.id)}>
                      <FolderOpen size={14} />
                    </button>
                  </div>
                )}
                {isDl && (
                  <div className="stackbar" style={{ marginTop: 8, height: 6 }}>
                    <i style={{ background: 'var(--accent)', flex: Math.max(0.001, active!.downloaded) }} />
                    <i style={{ background: 'var(--border-strong)', flex: Math.max(0.001, active!.total - active!.downloaded) }} />
                  </div>
                )}
              </div>
              {isDl ? (
                <div className="row" style={{ gap: 8 }}>
                  <span className="muted num" style={{ fontSize: '0.8125rem' }}>{t('la.downloading', { pct: Math.round((active!.downloaded / Math.max(1, active!.total)) * 100) })}</span>
                  <button className="btn btn-sm" onClick={() => void call('ai.local.cancel')}>{t('la.cancel')}</button>
                </div>
              ) : m.installed ? (
                <div className="row" style={{ gap: 6 }}>
                  {selected ? (
                    <span className="tag" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>
                      <Check size={12} /> {t('la.using')}
                    </span>
                  ) : (
                    <button className="btn btn-sm" onClick={async () => { await call('ai.local.select', m.id); await load(); onReady?.() }}>{t('la.use')}</button>
                  )}
                  <button className="icon-btn" title={t('la.delete')} aria-label={t('la.delete')} onClick={async () => { await call('ai.local.delete', m.id); await load(); onReady?.() }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setError('')
                    setDl({ id: m.id, downloaded: 0, total: m.sizeMb * 1048576 })
                    await call('ai.local.download', m.id)
                  }}
                >
                  {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                  {t('la.install')}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {error && <div className="warn selectable" style={{ marginTop: 10, background: 'var(--again-soft)' }}>{error}</div>}
    </div>
  )
}
