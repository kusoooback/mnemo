import { Image as ImageIcon, PenLine, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call } from '../api'
import { useT } from '../i18n'
import { parseBoxes, type Box } from '../lib/occlusion'
import { useStore } from '../store'
import { DrawPad } from './DrawPad'

type Pt = { x: number; y: number }
const rect = (a: Pt, b: Pt): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })

/** Occlusion d'image : on choisit (ou colle) une image puis on dessine à la souris les zones à cacher ; chaque zone devient une carte. */
export function OcclusionField({ image, boxes, onChange }: { image: string; boxes: string; onChange: (image: string, boxes: string) => void }): React.JSX.Element {
  const t = useT()
  const toast = useStore((s) => s.toast)
  const list = useMemo(() => parseBoxes(boxes), [boxes])
  const wrap = useRef<HTMLDivElement>(null)
  const start = useRef<Pt | null>(null)
  const [draft, setDraft] = useState<Box | null>(null)
  const [sel, setSel] = useState(-1)
  const [drawing, setDrawing] = useState(false)

  const set = useCallback(
    (b: Box[]) => onChange(image, JSON.stringify(b.map((x) => ({ x: +x.x.toFixed(4), y: +x.y.toFixed(4), w: +x.w.toFixed(4), h: +x.h.toFixed(4) })))),
    [image, onChange]
  )

  const load = useCallback(
    async (file: Blob): Promise<void> => {
      try {
        onChange(await call('media.saveImage', await file.arrayBuffer(), file.type), '[]')
        setSel(-1)
      } catch {
        toast(t('ed.imageErr'), { kind: 'error' })
      }
    },
    [onChange, toast, t]
  )
  const pick = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp'
    input.onchange = () => input.files?.[0] && void load(input.files[0])
    input.click()
  }

  // Coller une capture d'écran n'importe où dans l'éditeur suffit.
  useEffect(() => {
    const on = (e: ClipboardEvent): void => {
      const img = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (img) {
        e.preventDefault()
        void load(img)
      }
    }
    window.addEventListener('paste', on)
    return () => window.removeEventListener('paste', on)
  }, [load])

  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (sel >= 0 && (e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).closest('textarea,input')) {
        e.preventDefault()
        set(list.filter((_, i) => i !== sel))
        setSel(-1)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [sel, list, set])

  const at = (e: React.PointerEvent): Pt => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  if (!image) {
    return (
      <div>
        <label className="field-label">{t('ed.occImage')}</label>
        <button type="button" className="occ-drop" onClick={pick}>
          <ImageIcon size={22} />
          <span>{t('ed.occPick')}</span>
          <span className="faint">{t('ed.occPaste')}</span>
        </button>
        <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setDrawing(true)}>
          <PenLine size={13} /> {t('ed.occDraw')}
        </button>
        {drawing && (
          <DrawPad
            onClose={() => setDrawing(false)}
            onSave={(png) => {
              setDrawing(false)
              void load(png)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <label className="field-label">{t('ed.occImage')}</label>
      <div
        className="occ occ-edit"
        ref={wrap}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = at(e)
          setSel(-1)
        }}
        onPointerMove={(e) => start.current && setDraft(rect(start.current, at(e)))}
        onPointerUp={(e) => {
          if (!start.current) return
          const b = rect(start.current, at(e))
          start.current = null
          setDraft(null)
          if (b.w > 0.015 && b.h > 0.015) {
            set([...list, b])
            setSel(list.length)
          }
        }}
      >
        <img src={image} alt="" draggable={false} />
        {list.map((b, i) => (
          <span
            key={i}
            className={`occ-box ${i === sel ? 'active' : ''}`}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation()
              setSel(i)
            }}
          />
        ))}
        {draft && <span className="occ-box draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '0.8125rem', flex: 1 }}>{list.length ? t('ed.occCount', { n: list.length }) : t('ed.occHint')}</span>
        <button type="button" className="btn btn-sm" disabled={sel < 0} onClick={() => { set(list.filter((_, i) => i !== sel)); setSel(-1) }}>
          <Trash2 size={14} />
          {t('ed.occRemove')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!list.length} onClick={() => { set([]); setSel(-1) }}>{t('ed.occClear')}</button>
        <button type="button" className="btn btn-sm" onClick={pick}>{t('ed.occChange')}</button>
      </div>
    </div>
  )
}
