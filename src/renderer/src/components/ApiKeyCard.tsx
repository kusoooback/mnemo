import { CheckCircle2, ExternalLink, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiStatus } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'

/**
 * Le champ « Clé API » en clair, sans avoir à choisir un fournisseur dans un menu :
 * on colle la clé OpenRouter, Mnémo l'enregistre (chiffrée par le système), sélectionne le meilleur modèle gratuit et teste.
 */
export function ApiKeyCard({ onChange }: { onChange?: () => void }): React.JSX.Element | null {
  const t = useT()
  const { toast } = useStore()
  const [st, setSt] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = (): void => void call('ai.status').then(setSt)
  useEffect(load, [])
  if (!st) return null

  const connected = st.provider === 'openrouter' && st.hasKey
  const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    setMsg(null)
    const before = st
    try {
      setSt(await call('ai.configure', { provider: 'openrouter', key: key.trim() }))
      const r = await call('ai.test')
      setMsg({ ok: r.ok, text: r.message })
      // Clé refusée : on ne la garde pas, et le réglage précédent est rétabli (l'IA du PC continue de fonctionner).
      if (!r.ok && /401|403|refus/i.test(r.message)) {
        await call('ai.configure', { key: null })
        await call('ai.configure', { provider: before.provider, model: before.model })
      }
      if (r.ok) {
        setKey('')
        setEditing(false)
        toast(t('key.saved'))
      }
      load()
      onChange?.()
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    await call('ai.configure', { key: null })
    await call('ai.configure', { provider: 'builtin' })
    setMsg(null)
    load()
    onChange?.()
  }

  return (
    <div className="card card-pad apikey">
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <KeyRound size={18} style={{ color: 'var(--accent)' }} />
        <div style={{ fontWeight: 600 }}>{t('key.title')}</div>
        <span className="spacer" />
        {connected && (
          <span className="tag" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>
            <CheckCircle2 size={12} /> {t('key.connected')}
          </span>
        )}
      </div>

      {connected && !editing ? (
        <>
          <p className="muted" style={{ fontSize: '0.875rem' }}>{t('key.connectedDesc', { model: st.model })}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-sm" onClick={() => setEditing(true)}>{t('key.change')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => void remove()}>{t('key.remove')}</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: '0.875rem', lineHeight: 1.55 }}>{t('key.desc')}</p>
          <ol className="muted" style={{ fontSize: '0.8125rem', margin: '8px 0 12px', paddingLeft: '1.2em', lineHeight: 1.6 }}>
            <li>{t('key.step1')}</li>
            <li>{t('key.step2')}</li>
            <li>{t('key.step3')}</li>
          </ol>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 240 }}
              type="password"
              autoComplete="off"
              placeholder="sk-or-v1-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
            <button className="btn btn-dark" disabled={busy || !key.trim()} onClick={() => void save()}>
              {busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
              {t('key.save')}
            </button>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn btn-sm" onClick={() => void call('app.openExternal', 'https://openrouter.ai/keys')}>
              <ExternalLink size={14} />
              {t('key.getKey')}
            </button>
            {editing && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setKey('') }}>{t('common.cancel')}</button>}
          </div>
        </>
      )}
      {msg && (
        <div className="warn selectable" style={{ marginTop: 12, background: msg.ok ? 'var(--good-soft)' : 'var(--again-soft)' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
