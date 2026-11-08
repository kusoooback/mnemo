import { BookOpen, ExternalLink, Plus, Search, Star, Trash2, Upload, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RESOURCES, RESOURCE_CATEGORIES, cleanUrl, searchResources, type Resource, type ResourceCategory } from '@shared/resources'
import { call } from '../api'
import { useT } from '../i18n'
import { useAssistant, wordCount } from '../lib/assistantStore'
import { useStore } from '../store'

interface Saved {
  favs: string[]
  custom: Resource[]
}

const KEY = 'mnemo.resources.v1'

function load(): Saved {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { favs: Array.isArray(d.favs) ? d.favs : [], custom: Array.isArray(d.custom) ? d.custom : [] }
  } catch {
    return { favs: [], custom: [] }
  }
}
function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* stockage indisponible : la liste reste en mémoire */
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function Resources(): React.JSX.Element {
  const t = useT()
  const { go, toast, settings } = useStore()
  const [saved, setSaved] = useState<Saved>(load)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('')
  const [onlyFav, setOnlyFav] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', url: '', cat: 'python' as ResourceCategory, desc: '' })
  const [busy, setBusy] = useState('')
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const en = settings.language === 'en'

  const all = useMemo(() => [...saved.custom, ...RESOURCES], [saved.custom])
  const shown = useMemo(() => searchResources(all, q, cat).filter((x) => !onlyFav || saved.favs.includes(x.id)), [all, q, cat, onlyFav, saved.favs])
  const update = (s: Saved): void => {
    setSaved(s)
    save(s)
  }
  const toggleFav = (id: string): void => update({ ...saved, favs: saved.favs.includes(id) ? saved.favs.filter((f) => f !== id) : [...saved.favs, id] })

  const addCustom = (): void => {
    const url = cleanUrl(form.url)
    if (!form.title.trim() || !url) return toast(t('rs.badUrl'), { kind: 'error' })
    update({ ...saved, custom: [{ id: `c-${Date.now()}`, title: form.title.trim(), url, cat: form.cat, desc: form.desc.trim(), tags: ['perso'] }, ...saved.custom] })
    setForm({ title: '', url: '', cat: form.cat, desc: '' })
    setAdding(false)
  }

  /** Lit la page (au clic seulement) et ouvre l'assistant dessus : cartes, fiche, exercices. */
  const readInto = async (x: Resource): Promise<void> => {
    setBusy(x.id)
    try {
      const page = await call('web.readPage', x.url)
      if (wordCount(page.text) < 40) throw new Error(t('rs.tooShort'))
      const A = useAssistant.getState()
      A.set({ source: A.source ? `${A.source}\n\n# ${page.title}\n${page.text}` : `# ${page.title}\n${page.text}`, dictation: false })
      A.push({ id: A.newId(), kind: 'choices', text: t('rs.read.msg', { title: page.title, n: wordCount(page.text) }) })
      go({ name: 'assistant' })
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    } finally {
      setBusy('')
    }
  }

  const exportList = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ mnemoResources: 1, custom: saved.custom, favs: saved.favs }))
      toast(t('rs.copied'))
    } catch {
      toast(t('rs.copyFail'), { kind: 'error' })
    }
  }
  const importList = (): void => {
    const raw = pasted.trim()
    if (!raw) return
    try {
      const d = JSON.parse(raw)
      if (d.mnemoResources !== 1) throw new Error('format')
      const have = new Set(saved.custom.map((c) => c.url))
      const add = (Array.isArray(d.custom) ? d.custom : [])
        .map((c: Resource) => ({ ...c, url: cleanUrl(String(c.url)) ?? '', title: String(c.title ?? '').slice(0, 80), desc: String(c.desc ?? '').slice(0, 300), tags: ['perso'], id: `c-${Math.random().toString(36).slice(2)}` }))
        .filter((c: Resource) => c.url && c.title && !have.has(c.url) && RESOURCE_CATEGORIES.some((k) => k.id === c.cat))
      update({ favs: [...new Set([...saved.favs, ...(Array.isArray(d.favs) ? d.favs.filter((f: unknown) => typeof f === 'string') : [])])], custom: [...add, ...saved.custom] })
      toast(t('rs.imported', { n: add.length }))
      setPasting(false)
      setPasted('')
    } catch {
      toast(t('rs.badList'), { kind: 'error' })
    }
  }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('rs.title')}</h1>
          <p className="page-sub">{t('rs.sub')}</p>
        </div>
        <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} /> {t('rs.add')}
        </button>
      </div>

      {adding && (
        <div className="card card-pad rs-form">
          <input className="input" placeholder={t('rs.f.title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" placeholder={t('rs.f.url')} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <select className="input" value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value as ResourceCategory })}>
            {RESOURCE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{en ? c.en : c.fr}</option>
            ))}
          </select>
          <input className="input" placeholder={t('rs.f.desc')} value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
          <button className="btn btn-primary" onClick={addCustom}>{t('rs.f.save')}</button>
        </div>
      )}

      {pasting && (
        <div className="card card-pad rs-form">
          <div className="d">{t('rs.pastePrompt')}</div>
          <textarea className="input" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button className="btn btn-primary" onClick={importList}>{t('rs.import')}</button>
        </div>
      )}

      <div className="rs-toolbar">
        <div className="rs-search">
          <Search size={15} />
          <input value={q} placeholder={t('rs.search')} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="as-web">
          <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} /> {t('rs.favOnly')}
        </label>
        <button className="link-btn" onClick={() => void exportList()}><Upload size={12} /> {t('rs.export')}</button>
        <button className="link-btn" onClick={() => setPasting((v) => !v)}><Download size={12} /> {t('rs.import')}</button>
      </div>
      <div className="rs-cats">
        <button className={`chip ${cat === '' ? 'on' : ''}`} onClick={() => setCat('')}>{t('rs.all')}</button>
        {RESOURCE_CATEGORIES.map((c) => (
          <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(cat === c.id ? '' : c.id)}>
            {en ? c.en : c.fr}
          </button>
        ))}
      </div>

      <div className="rs-list">
        {shown.length === 0 && <div className="d" style={{ padding: 16 }}>{t('rs.none')}</div>}
        {shown.map((x) => {
          const fav = saved.favs.includes(x.id)
          const custom = x.id.startsWith('c-')
          return (
            <div key={x.id} className="rs-item card">
              <div className="rs-main">
                <div className="rs-title">
                  {x.title}
                  <span className="badge">{(RESOURCE_CATEGORIES.find((c) => c.id === x.cat) ?? RESOURCE_CATEGORIES[0])[en ? 'en' : 'fr']}</span>
                  {custom && <span className="badge">{t('rs.mine')}</span>}
                  {x.unchecked && <span className="badge" title={t('rs.uncheckedHelp')}>{t('rs.unchecked')}</span>}
                </div>
                {x.desc && <div className="d">{x.desc}</div>}
                <div className="rs-host">{new URL(x.url).hostname}</div>
              </div>
              <div className="rs-actions">
                <button className="icon-btn" aria-label={t('rs.fav')} title={t('rs.fav')} onClick={() => toggleFav(x.id)}>
                  <Star size={16} fill={fav ? 'var(--accent)' : 'none'} color={fav ? 'var(--accent)' : 'currentColor'} />
                </button>
                <button className="btn btn-sm" onClick={() => void call('app.openExternal', x.url)}>
                  <ExternalLink size={14} /> {t('rs.open')}
                </button>
                <button className="btn btn-sm" disabled={busy === x.id} title={t('rs.readHelp')} onClick={() => void readInto(x)}>
                  <BookOpen size={14} /> {busy === x.id ? t('rs.reading') : t('rs.read')}
                </button>
                {custom && (
                  <button className="icon-btn" aria-label={t('rs.remove')} onClick={() => update({ favs: saved.favs.filter((f) => f !== x.id), custom: saved.custom.filter((c) => c.id !== x.id) })}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="d" style={{ marginTop: 16 }}>{t('rs.privacy')}</p>
    </div>
  )
}
