import { Circle, Eraser, Highlighter, ImagePlus, Minus, MoveUpRight, Pencil, Redo2, Square, Trash2, Type, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT, type Key } from '../i18n'
import { CANVAS_H, CANVAS_W, PAPERS, SIZES, SWATCHES, fontSize, hasInk, paintItem, paintPaper, type Item, type Paper, type Pt, type ShapeKind, type Tool } from '../lib/draw'
import { hasMod, shortcut } from '../lib/platform'
import { Modal } from './ui'

const PREFS = 'mnemo.draw.v1'
interface Prefs {
  color: string
  size: number
  paper: Paper
  tool: Tool
}
function loadPrefs(): Prefs {
  const d: Prefs = { color: SWATCHES[0], size: 4, paper: 'white', tool: 'pen' }
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}')
    return {
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : d.color,
      size: SIZES.includes(p.size) ? p.size : d.size,
      paper: PAPERS.some((x) => x.id === p.paper) ? p.paper : d.paper,
      tool: ['pen', 'marker', 'eraser', 'line', 'arrow', 'rect', 'ellipse', 'text'].includes(p.tool) ? p.tool : d.tool
    }
  } catch {
    return d
  }
}

const TOOLS: { id: Tool; key: Key; icon: React.ReactNode; hot: string }[] = [
  { id: 'pen', key: 'dp.pen', icon: <Pencil size={16} />, hot: 'P' },
  { id: 'marker', key: 'dp.marker', icon: <Highlighter size={16} />, hot: 'M' },
  { id: 'eraser', key: 'dp.eraser', icon: <Eraser size={16} />, hot: 'E' },
  { id: 'line', key: 'dp.line', icon: <Minus size={16} />, hot: 'L' },
  { id: 'arrow', key: 'dp.arrow', icon: <MoveUpRight size={16} />, hot: 'A' },
  { id: 'rect', key: 'dp.rect', icon: <Square size={16} />, hot: 'R' },
  { id: 'ellipse', key: 'dp.ellipse', icon: <Circle size={16} />, hot: 'O' },
  { id: 'text', key: 'dp.text', icon: <Type size={16} />, hot: 'T' }
]

const PAPER_KEY: Record<Paper, Key> = { white: 'dp.paper.white', cream: 'dp.paper.cream', slate: 'dp.paper.slate', grid: 'dp.paper.grid', lined: 'dp.paper.lined' }

/** Carnet de dessin : stylo, surligneur, gomme, formes, texte, couleurs libres, fond au choix, image à annoter. Le résultat est un PNG. */
export function DrawPad({ onSave, onClose }: { onSave: (png: Blob) => void; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [items, setItems] = useState<Item[]>([])
  const [redo, setRedo] = useState<Item[]>([])
  const [under, setUnder] = useState<HTMLImageElement | null>(null)
  const [draft, setDraft] = useState<Item | null>(null)
  const [textBox, setTextBox] = useState<{ at: Pt; css: [number, number]; scale: number; value: string } | null>(null)
  const [askDiscard, setAskDiscard] = useState(false)
  const main = useRef<HTMLCanvasElement>(null)
  const layer = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = CANVAS_W
    c.height = CANVAS_H
    return c
  }, [])
  const drawing = useRef(false)

  const patch = (p: Partial<Prefs>): void => {
    const n = { ...prefs, ...p }
    setPrefs(n)
    try {
      localStorage.setItem(PREFS, JSON.stringify(n))
    } catch {
      /* préférences non mémorisées : sans importance */
    }
  }

  // Rendu : fond (+ image) puis couche d'encre ; la gomme n'efface que l'encre, jamais le fond ni l'image.
  useEffect(() => {
    const ctx = main.current?.getContext('2d')
    const lctx = layer.getContext('2d')
    if (!ctx || !lctx) return
    lctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    for (const it of items) paintItem(lctx, it)
    if (draft) paintItem(lctx, draft)
    paintPaper(ctx, prefs.paper, under)
    ctx.drawImage(layer, 0, 0)
  }, [items, draft, prefs.paper, under, layer])

  const commit = useCallback((it: Item): void => {
    setItems((l) => [...l, it])
    setRedo([])
  }, [])
  const undo = useCallback((): void => {
    setItems((l) => {
      if (!l.length) return l
      setRedo((r) => [...r, l[l.length - 1]])
      return l.slice(0, -1)
    })
  }, [])
  const redoIt = useCallback((): void => {
    setRedo((r) => {
      if (!r.length) return r
      setItems((l) => [...l, r[r.length - 1]])
      return r.slice(0, -1)
    })
  }, [])

  const point = (e: React.PointerEvent): Pt => {
    const r = main.current!.getBoundingClientRect()
    return [Math.min(CANVAS_W, Math.max(0, ((e.clientX - r.left) / r.width) * CANVAS_W)), Math.min(CANVAS_H, Math.max(0, ((e.clientY - r.top) / r.height) * CANVAS_H))]
  }

  const finishText = (): void => {
    if (textBox && textBox.value.trim()) commit({ t: 'text', color: prefs.color, size: prefs.size, at: textBox.at, text: textBox.value })
    setTextBox(null)
  }

  const onDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (textBox) finishText()
    const p = point(e)
    if (prefs.tool === 'text') {
      const r = main.current!.getBoundingClientRect()
      e.preventDefault() // sinon le canvas reprend le focus et ferme aussitôt la zone de texte
      setTextBox({ at: p, css: [e.clientX - r.left, e.clientY - r.top], scale: r.width / CANVAS_W, value: '' })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    if (prefs.tool === 'pen' || prefs.tool === 'marker' || prefs.tool === 'eraser') setDraft({ t: 'path', tool: prefs.tool, color: prefs.color, size: prefs.size, pts: [p] })
    else setDraft({ t: 'shape', kind: prefs.tool as ShapeKind, color: prefs.color, size: prefs.size, a: p, b: p })
  }
  const onMove = (e: React.PointerEvent): void => {
    if (!drawing.current) return
    const p = point(e)
    setDraft((d) => {
      if (!d) return d
      if (d.t === 'path') {
        const last = d.pts[d.pts.length - 1]
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return d
        return { ...d, pts: [...d.pts, p] }
      }
      return d.t === 'shape' ? { ...d, b: p } : d
    })
  }
  const onUp = (): void => {
    if (!drawing.current) return
    drawing.current = false
    setDraft((d) => {
      if (d && (d.t === 'path' || Math.hypot((d as { b: Pt }).b[0] - (d as { a: Pt }).a[0], (d as { b: Pt }).b[1] - (d as { a: Pt }).a[1]) > 3)) commit(d)
      return null
    })
  }

  // Raccourcis : annuler / rétablir, et une lettre par outil (sauf pendant la saisie de texte).
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input,textarea')) return
      const k = e.key.toLowerCase()
      if (hasMod(e) && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoIt()
        else undo()
      } else if (hasMod(e) && k === 'y') {
        e.preventDefault()
        redoIt()
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tool = TOOLS.find((x) => x.hot.toLowerCase() === k)
        if (tool) patch({ tool: tool.id })
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redoIt, prefs])

  const loadUnder = useCallback((file: Blob): void => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setUnder(img)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }, [])
  useEffect(() => {
    const on = (e: ClipboardEvent): void => {
      const img = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (img) {
        e.preventDefault()
        loadUnder(img)
      }
    }
    window.addEventListener('paste', on)
    return () => window.removeEventListener('paste', on)
  }, [loadUnder])
  const pickUnder = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp'
    input.onchange = () => input.files?.[0] && loadUnder(input.files[0])
    input.click()
  }

  const dirty = hasInk(items) || !!under
  const requestClose = (): void => {
    if (textBox) return setTextBox(null)
    if (dirty) return setAskDiscard(true)
    onClose()
  }
  const save = (): void => {
    if (textBox) finishText()
    main.current?.toBlob((b) => b && onSave(b), 'image/png')
  }

  return (
    <Modal title={t('dp.title')} onClose={requestClose} className="draw-modal" width={1040}>
      <div className="dp-tools" role="toolbar" aria-label={t('dp.title')}>
        <div className="dp-group">
          {TOOLS.map((x) => (
            <button key={x.id} type="button" className={`icon-btn dp-tool ${prefs.tool === x.id ? 'on' : ''}`} aria-pressed={prefs.tool === x.id} title={`${t(x.key)} (${x.hot})`} aria-label={t(x.key)} onClick={() => patch({ tool: x.id })}>
              {x.icon}
            </button>
          ))}
        </div>
        <div className="dp-group" aria-label={t('dp.color')}>
          {SWATCHES.map((c) => (
            <button key={c} type="button" className={`dp-swatch ${prefs.color.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} title={c} onClick={() => patch({ color: c })} />
          ))}
          <label className="dp-swatch dp-custom" title={t('dp.custom')}>
            <input type="color" value={prefs.color} onChange={(e) => patch({ color: e.target.value })} aria-label={t('dp.custom')} />
          </label>
        </div>
        <div className="dp-group" aria-label={t('dp.size')}>
          {SIZES.map((s) => (
            <button key={s} type="button" className={`dp-size ${prefs.size === s ? 'on' : ''}`} aria-label={`${t('dp.size')} ${s}`} title={`${t('dp.size')} ${s}`} onClick={() => patch({ size: s })}>
              <span style={{ width: Math.min(22, s + 3), height: Math.min(22, s + 3) }} />
            </button>
          ))}
        </div>
        <div className="dp-group">
          <select className="input dp-paper" value={prefs.paper} aria-label={t('dp.paper')} onChange={(e) => patch({ paper: e.target.value as Paper })}>
            {PAPERS.map((p) => (
              <option key={p.id} value={p.id}>{t(PAPER_KEY[p.id])}</option>
            ))}
          </select>
          <button type="button" className="icon-btn" title={t('dp.image')} aria-label={t('dp.image')} onClick={pickUnder}>
            <ImagePlus size={16} />
          </button>
        </div>
        <div className="dp-group">
          <button type="button" className="icon-btn" title={`${t('dp.undo')} (${shortcut('Ctrl+Z')})`} aria-label={t('dp.undo')} disabled={!items.length} onClick={undo}>
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-btn" title={`${t('dp.redo')} (${shortcut('Ctrl+Maj+Z')})`} aria-label={t('dp.redo')} disabled={!redo.length} onClick={redoIt}>
            <Redo2 size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t('dp.clear')}
            aria-label={t('dp.clear')}
            disabled={!dirty}
            onClick={() => {
              setItems([])
              setRedo([])
              setUnder(null)
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="dp-stage">
        <canvas
          ref={main}
          width={CANVAS_W}
          height={CANVAS_H}
          className={`dp-canvas tool-${prefs.tool}`}
          aria-label={t('dp.canvas')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {textBox && (
          <input
            autoFocus
            className="dp-text"
            style={{ left: textBox.css[0], top: textBox.css[1], color: prefs.color, fontSize: Math.max(12, fontSize(prefs.size) * textBox.scale) }}
            value={textBox.value}
            placeholder={t('dp.textHint')}
            onChange={(e) => setTextBox({ ...textBox, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishText()
            }}
            onBlur={finishText}
          />
        )}
      </div>

      <div className="dp-foot">
        <span className="d">{askDiscard ? t('dp.discardAsk') : t('dp.hint')}</span>
        <span style={{ flex: 1 }} />
        {askDiscard ? (
          <>
            <button className="btn" onClick={() => setAskDiscard(false)}>{t('dp.keep')}</button>
            <button className="btn btn-danger" onClick={onClose}>{t('dp.discard')}</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={requestClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" disabled={!dirty} onClick={save}>{t('dp.save')}</button>
          </>
        )}
      </div>
    </Modal>
  )
}
