import { ArrowLeft, ExternalLink, Eye, FileText, Image as ImageIcon, Layers, Loader2, Minus, PenLine, Plus, RefreshCw, Save, ScanText, StickyNote } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocInfo } from '@shared/types'
import { call } from '../api'
import { PdfButton } from '../components/PdfButton'
import { useT, type Key } from '../i18n'
import { renderMarkdown } from '../lib/render'
import { texToMarkdown } from '../lib/tex'
import { useStore } from '../store'

pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('../pdf.worker.ts', import.meta.url), { type: 'module' })

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const NO_CARDS = new Set(['exercices', 'corrige', 'admin', 'doublon'])
const urlOf = (id: string): string => `mnemo-doc://${id}`

/* ---------------- PDF : pages à la demande, texte sélectionnable ---------------- */

function PdfPage({ doc, n, base, scale, onOcclude }: { doc: PDFDocumentProxy; n: number; base: { w: number; h: number }; scale: number; onOcclude: (n: number) => void }): React.JSX.Element {
  const t = useT()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '900px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    void (async () => {
      const page = await doc.getPage(n)
      const vp = page.getViewport({ scale })
      const c = canvas.current
      const tl = text.current
      if (!c || !tl || cancelled) return
      const dpr = window.devicePixelRatio || 1
      c.width = Math.floor(vp.width * dpr)
      c.height = Math.floor(vp.height * dpr)
      c.style.width = `${vp.width}px`
      c.style.height = `${vp.height}px`
      task = page.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      await task.promise
      if (cancelled) return
      tl.replaceChildren()
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp })
      await layer.render()
    })().catch((e) => {
      if (!cancelled) console.error('PDF', e)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, scale, doc, n])

  return (
    <div ref={wrap} className="pdf-page" style={{ width: base.w * scale, height: base.h * scale, ['--scale-factor' as string]: scale, ['--total-scale-factor' as string]: scale }}>
      <canvas ref={canvas} />
      <div ref={text} className="textLayer" />
      <button className="pdf-occ" title={t('dv.occlude')} aria-label={t('dv.occlude')} onClick={() => onOcclude(n)}>
        <ImageIcon size={15} />
        {t('dv.occludeShort')}
      </button>
    </div>
  )
}

function PdfView({ id, deckId }: { id: string; deckId: string | null }): React.JSX.Element {
  const t = useT()
  const { openEditor, toast } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<{ w: number; h: number }[]>([])
  const [width, setWidth] = useState(800)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    let dead = false
    setDoc(null)
    setError('')
    void (async () => {
      try {
        const buf = await (await fetch(urlOf(id))).arrayBuffer()
        const d = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
        const sizes: { w: number; h: number }[] = []
        for (let i = 1; i <= d.numPages; i++) {
          const vp = (await d.getPage(i)).getViewport({ scale: 1 })
          sizes.push({ w: vp.width, h: vp.height })
        }
        if (dead) return
        setPages(sizes)
        setDoc(d)
      } catch (e) {
        if (!dead) setError(errText(e))
      }
    })()
    return () => {
      dead = true
    }
  }, [id])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Une page du PDF devient l'image d'une carte à occlusion (schéma, graphique, tableau à compléter…).
  const occlude = async (n: number): Promise<void> => {
    if (!doc) return
    try {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: Math.min(3, 1800 / base.width) })
      const c = document.createElement('canvas')
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      await page.render({ canvas: c, viewport: vp }).promise
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
      if (!blob) throw new Error('capture')
      openEditor({ deckId, prefill: { image: await call('media.saveImage', await blob.arrayBuffer(), 'image/png') } })
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    }
  }

  const fit = pages.length ? Math.max(0.3, (width - 40) / Math.max(...pages.map((p) => p.w))) : 1
  const scale = fit * zoom

  return (
    <div className="pdf-view" ref={box}>
      <div className="pdf-tools">
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))} aria-label="−"><Minus size={16} /></button>
        <span className="num">{Math.round(zoom * 100)} %</span>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.15))} aria-label="+"><Plus size={16} /></button>
        {doc && <span className="muted" style={{ marginLeft: 8, fontSize: '0.8125rem' }}>{t('dv.pages', { n: doc.numPages })}</span>}
      </div>
      {error && <div className="warn" style={{ margin: 16 }}>{error}</div>}
      {!doc && !error && <div className="center-pad"><Loader2 className="spin" size={20} /></div>}
      {doc && pages.map((p, i) => <PdfPage key={i} doc={doc} n={i + 1} base={p} scale={scale} onOcclude={(k) => void occlude(k)} />)}
    </div>
  )
}

/* ---------------- Fichiers texte / LaTeX : éditeur + aperçu ---------------- */

function TextEditor({ info, onSelect }: { info: DocInfo; onSelect: (s: string) => void }): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [src, setSrc] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [preview, setPreview] = useState(['md', 'markdown'].includes(info.ext)) // une fiche s'ouvre directement en belle page
  const previewable = ['md', 'markdown', 'tex', 'latex', 'rmd', 'qmd'].includes(info.ext)

  useEffect(() => {
    setSrc(null)
    void call('docs.source', info.id).then((s) => {
      setSrc(s)
      setSaved(s)
    }).catch((e) => toast(errText(e), { kind: 'error' }))
  }, [info.id, toast])

  const save = useCallback(async () => {
    if (src === null) return
    try {
      await call('docs.saveSource', info.id, src)
      setSaved(src)
      toast(t('dv.saved'))
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    }
  }, [src, info.id, toast, t])

  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [save])

  if (src === null) return <div className="center-pad"><Loader2 className="spin" size={20} /></div>
  const dirty = src !== saved
  const md = ['tex', 'latex'].includes(info.ext) ? texToMarkdown(src) : src
  return (
    <div className="doc-editor">
      <div className="pdf-tools">
        {previewable && (
          <button className={`btn btn-sm ${preview ? 'btn-dark' : ''}`} onClick={() => setPreview(!preview)}>
            {preview ? <PenLine size={14} /> : <Eye size={14} />}
            {preview ? t('dv.edit') : t('dv.preview')}
          </button>
        )}
        {preview && <PdfButton title={info.title} subtitle={[info.subject, info.chapter].filter(Boolean).join(' · ')} html={renderMarkdown(md)} />}
        <span className="spacer" />
        {dirty && <span className="muted" style={{ fontSize: '0.8125rem' }}>{t('dv.unsaved')}</span>}
        <button className="btn btn-sm btn-dark" disabled={!dirty} onClick={() => void save()}>
          <Save size={14} />
          {t('dv.save')}
        </button>
      </div>
      {preview ? (
        <div className="md selectable doc-preview sheet print-area" onMouseUp={() => onSelect(window.getSelection()?.toString().trim() ?? '')} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
      ) : (
        <textarea
          className="doc-textarea"
          spellCheck={false}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          onSelect={(e) => {
            const el = e.currentTarget
            onSelect(el.value.slice(el.selectionStart, el.selectionEnd).trim())
          }}
        />
      )}
    </div>
  )
}

/* ---------------- Page ---------------- */

export function DocViewer({ id }: { id: string }): React.JSX.Element {
  const t = useT()
  const { go, openEditor, toast, bump, rev } = useStore()
  const [info, setInfo] = useState<DocInfo | null>(null)
  const [error, setError] = useState('')
  const [side, setSide] = useState<'notes' | 'text' | 'summary'>('notes')
  const [notes, setNotes] = useState('')
  const [selection, setSelection] = useState('')
  const [busy, setBusy] = useState('')
  const savedNotes = useRef('')

  const load = useCallback(async () => {
    try {
      const i = await call('docs.info', id)
      setInfo(i)
      setNotes((n) => (savedNotes.current === n || savedNotes.current === '' ? i.notes : n))
      savedNotes.current = i.notes
    } catch (e) {
      setError(errText(e))
    }
  }, [id])
  useEffect(() => {
    savedNotes.current = ''
    setInfo(null)
    setSelection('')
    void load()
  }, [load, rev])

  // Les notes s'enregistrent toutes seules.
  useEffect(() => {
    if (!info || notes === savedNotes.current) return
    const h = setTimeout(() => {
      savedNotes.current = notes
      void call('docs.saveNotes', id, notes)
    }, 600)
    return () => clearTimeout(h)
  }, [notes, id, info])

  const work = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    } finally {
      setBusy('')
    }
  }

  if (error) return <div className="page"><div className="warn">{error}</div></div>
  if (!info) return <div className="center-pad"><Loader2 className="spin" size={22} /></div>

  const grabSelection = (): void => {
    const s = window.getSelection()?.toString().trim() ?? ''
    setSelection(s.length > 3 ? s.slice(0, 1500) : '')
  }

  return (
    <div className="doc-page">
      <div className="doc-head">
        <button className="icon-btn" onClick={() => go({ name: 'prepa' })} aria-label={t('common.back')}><ArrowLeft size={18} /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="doc-title">{info.title}</div>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>{[info.subject, info.folder, info.ext.toUpperCase()].filter(Boolean).join(' · ')}</div>
        </div>
        <select
          className="select select-sm"
          title={t('cat.change')}
          value={info.category}
          onChange={(e) => void call('docs.setCategory', id, e.target.value).then(async () => { await load(); await bump() })}
        >
          {['', 'cours', 'methode', 'vocabulaire', 'exercices', 'corrige', 'admin', 'autre'].map((c) => (
            <option key={c} value={c}>{t(`cat.${c || 'none'}` as Key)}</option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => void call('docs.open', id).catch((e) => toast(errText(e), { kind: 'error' }))}>
          <ExternalLink size={14} />
          {t('dv.openExternal')}
        </button>
        {info.kind === 'image' && (
          <button
            className="btn btn-sm btn-dark"
            onClick={() => void work('occ', async () => openEditor({ deckId: info.deckId, prefill: { image: await call('docs.toMedia', id) } }))}
          >
            <ImageIcon size={14} />
            {t('ed.occlusion')}
          </button>
        )}
        <button
          className="btn btn-sm"
          disabled={!info.text.trim() || busy === 'sum' || NO_CARDS.has(info.category)}
          title={NO_CARDS.has(info.category) ? t('cat.noCards') : undefined}
          onClick={() => void work('sum', async () => { await call('docs.makeSummary', id); await load(); setSide('summary') })}
        >
          {busy === 'sum' ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
          {t('pp.docs.summary')}
        </button>
        <button
          className="btn btn-sm btn-dark"
          disabled={!info.text.trim() || busy === 'cards' || NO_CARDS.has(info.category)}
          title={NO_CARDS.has(info.category) ? t('cat.noCards') : undefined}
          onClick={() => void work('cards', async () => { toast(t('pp.docs.cardsDone', { n: await call('docs.makeCards', id, 12) })); await bump() })}
        >
          {busy === 'cards' ? <Loader2 size={14} className="spin" /> : <Layers size={14} />}
          {t('pp.docs.cards')}
        </button>
      </div>

      <div className="doc-body">
        <div className="doc-main" onMouseUp={grabSelection}>
          {info.kind === 'pdf' && <PdfView id={id} deckId={info.deckId} />}
          {info.kind === 'image' && <div className="doc-media"><img src={urlOf(id)} alt={info.title} /></div>}
          {info.kind === 'video' && <div className="doc-media"><video controls src={urlOf(id)} /></div>}
          {info.kind === 'audio' && <div className="doc-media"><audio controls src={urlOf(id)} /></div>}
          {info.kind === 'text' && <TextEditor info={info} onSelect={(s) => setSelection(s.length > 3 ? s.slice(0, 1500) : '')} />}
          {(info.kind === 'office' || info.kind === 'other') && (
            <div className="doc-plain selectable">
              {info.text.trim() ? <pre>{info.text}</pre> : <p className="muted">{t('dv.noText')}</p>}
            </div>
          )}
        </div>

        <aside className="doc-side">
          <div className="segmented" style={{ margin: '0 0 10px' }}>
            <button className={side === 'notes' ? 'on' : ''} onClick={() => setSide('notes')}><StickyNote size={13} /> {t('dv.notes')}</button>
            <button className={side === 'text' ? 'on' : ''} onClick={() => setSide('text')}><ScanText size={13} /> {t('dv.text')}</button>
            {info.summary && <button className={side === 'summary' ? 'on' : ''} onClick={() => setSide('summary')}>{t('pp.docs.summary')}</button>}
          </div>
          {side === 'notes' && (
            <textarea className="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('dv.notesHint')} />
          )}
          {side === 'text' && (
            <div className="doc-plain selectable" style={{ flex: 1, overflow: 'auto' }} onMouseUp={grabSelection}>
              {info.text.trim() ? <pre>{info.text}</pre> : <p className="muted">{t('dv.noText')}</p>}
              <button className="btn btn-sm" style={{ marginTop: 10 }} disabled={busy === 'ocr'} onClick={() => void work('ocr', async () => { await call('docs.reread', id); await load() })}>
                {busy === 'ocr' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                {t('dv.reread')}
              </button>
            </div>
          )}
          {side === 'summary' && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <PdfButton title={info.title} subtitle={[info.subject, info.chapter].filter(Boolean).join(' · ')} html={renderMarkdown(info.summary)} />
              </div>
              <div className="md selectable" style={{ flex: 1, overflow: 'auto', fontSize: '0.9375rem' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(info.summary) }} />
            </>
          )}
        </aside>
      </div>

      {selection && (
        <div className="doc-selbar">
          <span className="muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>« {selection} »</span>
          <button className="btn btn-sm btn-dark" onClick={() => { openEditor({ deckId: info.deckId, prefill: { text: selection } }); setSelection('') }}>
            <Plus size={14} />
            {t('dv.makeCard')}
          </button>
        </div>
      )}
    </div>
  )
}
