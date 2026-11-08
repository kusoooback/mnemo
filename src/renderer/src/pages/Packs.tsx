import { Download, FolderOpen, Globe, Share2 } from 'lucide-react'
import { useState } from 'react'
import type { CommunityPack, PackOpened } from '@shared/types-extra'
import { call } from '../api'
import { Inline } from '../components/Inline'
import { useT } from '../i18n'
import { useStore } from '../store'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const size = (b: number): string => (b > 1048576 ? `${(b / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`)
const COMMUNITY_PAGE = 'https://github.com/kusoooback/mnemo/tree/main/community'

export function Packs(): React.JSX.Element {
  const t = useT()
  const { decks, toast, refreshDecks, go } = useStore()
  const [deckId, setDeckId] = useState('')
  const [meta, setMeta] = useState({ name: '', description: '', author: '' })
  const [opened, setOpened] = useState<PackOpened | null>(null)
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState('')
  const [catalog, setCatalog] = useState<CommunityPack[] | null>(null)

  const run = async (what: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    } finally {
      setBusy('')
    }
  }

  const share = (): Promise<void> =>
    run('share', async () => {
      const r = await call('share.export', deckId || null, { name: meta.name.trim() || undefined, description: meta.description.trim(), author: meta.author.trim() })
      if (r) toast(t('pk.share.done', { n: r.notes, i: r.images, size: size(r.bytes) }))
    })

  const show = (o: PackOpened | null): void => {
    if (opened) void call('share.cancel', opened.token)
    setOpened(o)
    setRoot(o?.preview.name ?? '')
  }

  const install = (): Promise<void> =>
    run('install', async () => {
      if (!opened) return
      const r = await call('share.install', opened.token, root.trim())
      setOpened(null)
      await refreshDecks()
      toast(r.duplicates ? t('pk.installedDup', { n: r.added, deck: r.deck, d: r.duplicates }) : t('pk.installed', { n: r.added, deck: r.deck }))
    })

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('pk.title')}</h1>
          <p className="page-sub">{t('pk.sub')}</p>
        </div>
      </div>

      <section className="card card-pad pk-block">
        <h2 className="pk-h"><Share2 size={16} /> {t('pk.share.title')}</h2>
        <div className="pk-grid">
          <label className="pk-field">
            <span>{t('pk.share.deck')}</span>
            <select className="input" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              <option value="">{t('pk.share.all')}</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>{d.fullName}</option>
              ))}
            </select>
          </label>
          <label className="pk-field">
            <span>{t('pk.share.name')}</span>
            <input className="input" value={meta.name} maxLength={80} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </label>
          <label className="pk-field">
            <span>{t('pk.share.author')}</span>
            <input className="input" value={meta.author} maxLength={60} onChange={(e) => setMeta({ ...meta, author: e.target.value })} />
          </label>
          <label className="pk-field pk-wide">
            <span>{t('pk.share.desc')}</span>
            <input className="input" value={meta.description} maxLength={500} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
          </label>
        </div>
        <div className="pk-row">
          <button className="btn btn-primary" disabled={busy === 'share'} onClick={() => void share()}>
            <Share2 size={14} /> {t('pk.share.go')}
          </button>
          <span className="d">{t('pk.share.note')}</span>
        </div>
      </section>

      <section className="card card-pad pk-block">
        <h2 className="pk-h"><FolderOpen size={16} /> {t('pk.open.title')}</h2>
        {!opened && (
          <button className="btn" disabled={busy === 'pick'} onClick={() => void run('pick', async () => show(await call('share.pick')))}>
            <FolderOpen size={14} /> {t('pk.open.go')}
          </button>
        )}
        {opened && <PackPreviewCard o={opened} root={root} setRoot={setRoot} busy={busy === 'install'} onAdd={() => void install()} onCancel={() => show(null)} />}
      </section>

      <section className="card card-pad pk-block">
        <h2 className="pk-h"><Globe size={16} /> {t('pk.cat.title')}</h2>
        <p className="d">{t('pk.cat.sub')}</p>
        {catalog === null && (
          <button className="btn" disabled={busy === 'cat'} onClick={() => void run('cat', async () => setCatalog(await call('share.catalog')))}>
            <Download size={14} /> {busy === 'cat' ? t('pk.cat.loading') : t('pk.cat.go')}
          </button>
        )}
        {catalog && catalog.length === 0 && <div className="d">{t('pk.cat.empty')}</div>}
        {catalog && (
          <div className="pk-list">
            {catalog.map((p) => (
              <div key={p.id} className="pk-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="rs-title">
                    {p.title} <span className="badge">{p.lang.toUpperCase()}</span>
                    {p.notes > 0 && <span className="badge">{t('pk.cards', { n: p.notes })}</span>}
                  </div>
                  {p.description && <div className="d">{p.description}</div>}
                  {p.author && <div className="rs-host">{t('pk.by', { a: p.author })}</div>}
                </div>
                <button className="btn btn-sm" disabled={busy === `get-${p.id}`} onClick={() => void run(`get-${p.id}`, async () => show(await call('share.fetch', p.id)))}>
                  {t('pk.cat.get')}
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="link-btn" style={{ marginTop: 10 }} onClick={() => void call('app.openExternal', COMMUNITY_PAGE)}>{t('pk.cat.contribute')}</button>
      </section>

      <p className="d" style={{ marginTop: 16 }}>
        {t('pk.privacy')}{' '}
        <button className="link-btn" onClick={() => go({ name: 'resources' })}>{t('nav.resources')}</button>
      </p>
    </div>
  )
}

function PackPreviewCard(p: { o: PackOpened; root: string; setRoot: (v: string) => void; busy: boolean; onAdd: () => void; onCancel: () => void }): React.JSX.Element {
  const t = useT()
  const v = p.o.preview
  return (
    <div className="pk-preview">
      <div className="rs-title">
        {v.name} {v.author && <span className="rs-host">{t('pk.by', { a: v.author })}</span>}
      </div>
      {v.description && <div className="d">{v.description}</div>}
      <div className="d">{t('pk.preview.counts', { n: v.notes, d: v.decks, i: v.images })}</div>
      {v.duplicates > 0 && <div className="d">{t('pk.preview.dups', { n: v.duplicates })}</div>}
      <ul className="pk-sample">
        {v.sample.map((s, i) => (
          <li key={i}><Inline text={s} max={120} /></li>
        ))}
      </ul>
      <label className="pk-field">
        <span>{t('pk.preview.into')}</span>
        <input className="input" value={p.root} maxLength={80} onChange={(e) => p.setRoot(e.target.value)} />
      </label>
      <div className="pk-row">
        <button className="btn btn-primary" disabled={p.busy || !p.root.trim()} onClick={p.onAdd}>{t('pk.preview.add')}</button>
        <button className="btn" onClick={p.onCancel}>{t('pk.preview.cancel')}</button>
      </div>
    </div>
  )
}
