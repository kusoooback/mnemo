import { Bold, Braces, Code, Image as ImageIcon, Italic, List, PenLine, ShieldCheck, Sigma, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteKind } from '@shared/types'
import { call } from '../api'
import { useT, type Key } from '../i18n'
import type { AiDiagnosis } from '@shared/types'
import { parseBoxes } from '../lib/occlusion'
import { cardFaces } from '../lib/render'
import { useStore } from '../store'
import { hasMod, shortcut } from '../lib/platform'
import { DrawPad } from './DrawPad'
import { OcclusionField } from './OcclusionField'
import { Modal, useConfirm } from './ui'

const KINDS: { kind: NoteKind; key: Key }[] = [
  { kind: 'basic', key: 'ed.basic' },
  { kind: 'basic-reverse', key: 'ed.reverse' },
  { kind: 'typed', key: 'ed.typed' },
  { kind: 'cloze', key: 'ed.cloze' },
  { kind: 'occlusion', key: 'ed.occlusion' }
]

type FieldKey = 'front' | 'back' | 'text' | 'extra' | 'image' | 'boxes'
const EMPTY: Record<FieldKey, string> = { front: '', back: '', text: '', extra: '', image: '', boxes: '[]' }

function Field({
  label,
  value,
  onChange,
  placeholder,
  fieldRef,
  rows = 4,
  withCloze,
  onFocus,
  onSubmit
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  fieldRef: (el: HTMLTextAreaElement | null) => void
  rows?: number
  withCloze?: boolean
  onFocus: () => void
  onSubmit: () => void
}): React.JSX.Element {
  const t = useT()
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const toast = useStore((s) => s.toast)
  const [drawing, setDrawing] = useState(false)

  const edit = (fn: (sel: string) => { text: string; selStart?: number; selEnd?: number }): void => {
    const el = ta.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const r = fn(value.slice(a, b))
    const next = value.slice(0, a) + r.text + value.slice(b)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + (r.selStart ?? r.text.length), a + (r.selEnd ?? r.text.length))
    })
  }
  const wrap = (before: string, after = before, empty = ''): void =>
    edit((sel) => {
      const body = sel || empty
      return { text: `${before}${body}${after}`, selStart: before.length, selEnd: before.length + body.length }
    })
  const nextCloze = (): number => {
    const nums = [...value.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]))
    return nums.length ? Math.max(...nums) + 1 : 1
  }
  const cloze = (sameNumber: boolean): void => {
    const n = sameNumber ? Math.max(1, nextCloze() - 1) : nextCloze()
    wrap(`{{c${n}::`, '}}', '…')
  }

  const addImage = async (file: Blob): Promise<void> => {
    try {
      const url = await call('media.saveImage', await file.arrayBuffer(), file.type)
      edit(() => ({ text: `![](${url})` }))
    } catch {
      toast(t('ed.imageErr'), { kind: 'error' })
    }
  }
  const pickImage = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'
    input.onchange = () => input.files?.[0] && void addImage(input.files[0])
    input.click()
  }

  return (
    <div>
      {drawing && (
        <DrawPad
          onClose={() => setDrawing(false)}
          onSave={(png) => {
            setDrawing(false)
            void addImage(png)
          }}
        />
      )}
      <label className="field-label">{label}</label>
      <div className="field-wrap">
        <div className="field-tools">
          <button className="icon-btn" type="button" title={`${t('ed.bold')} (${shortcut('Ctrl+B')})`} onClick={() => wrap('**', '**', 'texte')}>
            <Bold size={15} />
          </button>
          <button className="icon-btn" type="button" title={`${t('ed.italic')} (${shortcut('Ctrl+I')})`} onClick={() => wrap('*', '*', 'texte')}>
            <Italic size={15} />
          </button>
          <button className="icon-btn" type="button" title={t('ed.list')} onClick={() => edit((s) => ({ text: (s || 'élément').split('\n').map((l) => `- ${l}`).join('\n') }))}>
            <List size={15} />
          </button>
          <span className="sep" />
          <button className="icon-btn" type="button" title={t('ed.code')} onClick={() => wrap('`')}>
            <Code size={15} />
          </button>
          <button className="icon-btn" type="button" title={t('ed.math')} onClick={() => wrap('$', '$', 'x^2')}>
            <Sigma size={15} />
          </button>
          <button className="icon-btn" type="button" title={t('ed.image')} onClick={pickImage}>
            <ImageIcon size={15} />
          </button>
          <button className="icon-btn" type="button" title={t('ed.draw')} aria-label={t('ed.draw')} onClick={() => setDrawing(true)}>
            <PenLine size={15} />
          </button>
          {withCloze && (
            <>
              <span className="sep" />
              <button className="icon-btn" type="button" title={t('ed.clozeBtn')} onClick={() => cloze(false)}>
                <Braces size={15} />
              </button>
            </>
          )}
        </div>
        <textarea
          ref={(el) => {
            ta.current = el
            fieldRef(el)
          }}
          className="textarea selectable"
          rows={rows}
          value={value}
          placeholder={placeholder}
          spellCheck
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const img = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
            if (img) {
              e.preventDefault()
              void addImage(img)
            }
          }}
          onKeyDown={(e) => {
            const k = e.key.toLowerCase()
            if (hasMod(e) && e.shiftKey && k === 'c' && withCloze) {
              e.preventDefault()
              cloze(e.altKey)
            } else if (hasMod(e) && !e.shiftKey && k === 'b') {
              e.preventDefault()
              wrap('**', '**', 'texte')
            } else if (hasMod(e) && !e.shiftKey && k === 'i') {
              e.preventDefault()
              wrap('*', '*', 'texte')
            } else if (hasMod(e) && e.key === 'Enter') {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
      </div>
    </div>
  )
}

export function Editor(): React.JSX.Element | null {
  const t = useT()
  const { editor, openEditor, decks, bump, toast } = useStore()
  const [confirm, confirmNode] = useConfirm()
  const noteId = editor?.noteId
  const [kind, setKind] = useState<NoteKind>('basic')
  const [deckId, setDeckId] = useState<string>('')
  const [fields, setFields] = useState<Record<FieldKey, string>>(EMPTY)
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [allTags, setAllTags] = useState<string[]>([])
  const [dup, setDup] = useState(false)
  const [error, setError] = useState('')
  const [face, setFace] = useState<'front' | 'back'>('front')
  const [cardCount, setCardCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const [diag, setDiag] = useState<AiDiagnosis | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const refs = useRef<Partial<Record<FieldKey, HTMLTextAreaElement | null>>>({})
  const lastDeck = useRef<string>('')

  // Chargement : édition d'une note existante, ou formulaire vide.
  useEffect(() => {
    if (!editor) return
    setLoaded(false)
    setError('')
    setDup(false)
    setDiag(null)
    void call('ai.status').then((a) => setAiReady(a.ready))
    void (async () => {
      setAllTags(await call('tags.list'))
      if (editor.noteId) {
        const n = await call('note.get', editor.noteId)
        if (n) {
          setKind(n.kind)
          setFields({ ...EMPTY, ...n.fields })
          setTags(n.tags)
          setDeckId(n.cards[0]?.deckId ?? '')
          setCardCount(n.cards.length)
        }
      } else {
        setKind((k) => (editor.prefill?.image ? 'occlusion' : k))
        setFields({ ...EMPTY, front: editor.prefill?.text ?? '', image: editor.prefill?.image ?? '' })
        setTags([])
        setCardCount(0)
        const all = useStore.getState().decks
        setDeckId(editor.deckId ?? lastDeck.current ?? all[0]?.id ?? '')
      }
      setLoaded(true)
      setTimeout(() => (editor.noteId ? undefined : (refs.current.front ?? refs.current.text)?.focus()), 60)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.noteId, editor?.deckId, !!editor])

  useEffect(() => {
    if (!deckId && decks.length && !noteId) setDeckId(editor?.deckId ?? decks[0].id)
  }, [decks, deckId, noteId, editor?.deckId])

  const first = kind === 'occlusion' ? '' : kind === 'cloze' ? fields.text : fields.front
  useEffect(() => {
    if (!editor) return
    const h = setTimeout(async () => setDup(await call('note.checkDuplicate', kind, first, noteId)), 250)
    return () => clearTimeout(h)
  }, [kind, first, noteId, editor])

  const close = useCallback(() => openEditor(null), [openEditor])

  const payload = (): { kind: NoteKind; fields: Record<string, string>; tags: string[] } => {
    const t2 = tagDraft.trim()
    const allT = t2 ? [...tags, t2] : tags
    return {
      kind,
      fields:
        kind === 'occlusion'
          ? { image: fields.image, boxes: fields.boxes, extra: fields.extra.trim() }
          : kind === 'cloze'
            ? { text: fields.text.trim(), extra: fields.extra.trim() }
            : { front: fields.front.trim(), back: fields.back.trim() },
      tags: allT
    }
  }

  const save = async (keepOpen: boolean): Promise<void> => {
    setError('')
    const p = payload()
    if (!deckId) return setError(t('ed.needDeck'))
    if (kind === 'occlusion') {
      if (!p.fields.image) return setError(t('ed.occNoImage'))
      if (!parseBoxes(p.fields.boxes).length) return setError(t('ed.occNoBox'))
    } else if (kind === 'cloze') {
      if (!/\{\{c\d+::/.test(p.fields.text)) return setError(t('ed.noCloze'))
    } else if (!p.fields.front || !p.fields.back) return setError(t('ed.needContent'))
    try {
      if (noteId) await call('note.update', noteId, { ...p, deckId })
      else await call('note.add', { ...p, deckId })
      lastDeck.current = deckId
      await bump()
      if (keepOpen && !noteId) {
        toast(t('ed.added'))
        setFields(EMPTY)
        setTagDraft('')
        setTimeout(() => (refs.current.front ?? refs.current.text)?.focus(), 30)
      } else {
        toast(t('ed.saved'))
        close()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('ed.error'))
    }
  }

  const faces = useMemo(() => {
    if (kind === 'occlusion') return cardFaces('occlusion', { image: fields.image, boxes: fields.boxes, extra: fields.extra }, 1)
    if (kind === 'cloze') return cardFaces('cloze', { text: fields.text, extra: fields.extra }, 1)
    return cardFaces(kind, { front: fields.front, back: fields.back }, 0)
  }, [kind, fields])
  const reverseFaces = useMemo(
    () => (kind === 'basic-reverse' ? cardFaces(kind, { front: fields.front, back: fields.back }, 1) : null),
    [kind, fields]
  )

  if (!editor) return null

  const addTag = (raw: string): void => {
    const v = raw.trim().replace(/\s+/g, '_')
    if (v && !tags.includes(v)) setTags([...tags, v])
    setTagDraft('')
  }
  const suggestions = tagDraft
    ? allTags.filter((x) => x.toLowerCase().startsWith(tagDraft.toLowerCase()) && !tags.includes(x)).slice(0, 4)
    : []

  const fieldProps = (k: FieldKey): { value: string; onChange: (v: string) => void; fieldRef: (el: HTMLTextAreaElement | null) => void; onSubmit: () => void } => ({
    value: fields[k],
    onChange: (v) => setFields((f) => ({ ...f, [k]: v })),
    fieldRef: (el) => (refs.current[k] = el),
    onSubmit: () => void save(true)
  })

  return (
    <>
      <Modal
        title={noteId ? t('ed.editTitle') : t('ed.addTitle')}
        onClose={close}
        className="editor"
        footer={
          <>
            {noteId && (
              <button
                className="btn btn-ghost btn-danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: t('ed.deleteNote'),
                    text: t('lib.confirmDelete', { n: cardCount || 1 }),
                    confirmLabel: t('common.delete'),
                    danger: true
                  })
                  if (!ok) return
                  await call('note.delete', [noteId])
                  await bump()
                  toast(t('ed.deleted'))
                  close()
                }}
              >
                <Trash2 size={16} />
                {t('ed.deleteNote')}
              </button>
            )}
            {noteId && cardCount > 1 && <span className="muted" style={{ fontSize: '0.8125rem' }}>{t('ed.cardsInNote', { n: cardCount })}</span>}
            <span className="spacer" />
            <span className="kbd">{shortcut('Ctrl ↵')}</span>
            {!noteId && (
              <button className="btn" onClick={() => void save(true)}>
                {t('ed.saveNext')}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => void save(false)}>
              {t('ed.save')}
            </button>
          </>
        }
      >
        {loaded && (
          <div className="editor-body">
            <div className="editor-form">
              <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="field-label">{t('ed.deck')}</label>
                  <select className="select" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {' '.repeat(d.depth)}
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">{t('ed.type')}</label>
                <div className="segmented">
                  {KINDS.map((k) => (
                    <button key={k.kind} className={kind === k.kind ? 'on' : ''} onClick={() => setKind(k.kind)}>
                      {t(k.key)}
                    </button>
                  ))}
                </div>
              </div>

              {kind === 'occlusion' ? (
                <>
                  <OcclusionField image={fields.image} boxes={fields.boxes} onChange={(image, boxes) => setFields((f) => ({ ...f, image, boxes }))} />
                  <Field label={t('ed.extra')} placeholder="" rows={2} onFocus={() => setFace('back')} {...fieldProps('extra')} />
                </>
              ) : kind === 'cloze' ? (
                <>
                  <Field label={t('ed.text')} placeholder={t('ed.placeholderCloze')} rows={5} withCloze onFocus={() => setFace('front')} {...fieldProps('text')} />
                  <Field label={t('ed.extra')} placeholder="" rows={2} onFocus={() => setFace('back')} {...fieldProps('extra')} />
                </>
              ) : (
                <>
                  <Field label={t('ed.front')} placeholder={t('ed.placeholderFront')} rows={3} onFocus={() => setFace('front')} {...fieldProps('front')} />
                  <Field label={t('ed.back')} placeholder={t('ed.placeholderBack')} rows={4} onFocus={() => setFace('back')} {...fieldProps('back')} />
                </>
              )}

              <div>
                <label className="field-label">
                  {t('ed.tags')} <span className="faint">· {t('ed.tagsHint')}</span>
                </label>
                <div className="tag-input">
                  {tags.map((tg) => (
                    <span className="tag" key={tg}>
                      {tg}
                      <button onClick={() => setTags(tags.filter((x) => x !== tg))} aria-label="remove">
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        if (tagDraft.trim()) {
                          e.preventDefault()
                          e.stopPropagation()
                          addTag(tagDraft)
                        }
                      } else if (e.key === 'Backspace' && !tagDraft && tags.length) setTags(tags.slice(0, -1))
                    }}
                    onBlur={() => tagDraft.trim() && addTag(tagDraft)}
                  />
                </div>
                {suggestions.length > 0 && (
                  <div className="row" style={{ marginTop: 6, gap: 6 }}>
                    {suggestions.map((s) => (
                      <button key={s} className="tag" onMouseDown={(e) => { e.preventDefault(); addTag(s) }}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {aiReady && kind !== 'occlusion' && (
                <div>
                  <button
                    className="btn btn-sm"
                    disabled={diagBusy}
                    onClick={async () => {
                      setDiagBusy(true)
                      setDiag(null)
                      try {
                        setDiag(await call('ai.diagnose', kind === 'cloze' ? fields.text : fields.front, kind === 'cloze' ? fields.extra : fields.back, kind))
                      } catch (e) {
                        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('ai.error'))
                      } finally {
                        setDiagBusy(false)
                      }
                    }}
                  >
                    <ShieldCheck size={14} />
                    {diagBusy ? t('ai.explaining') : t('ai.diagnose')}
                  </button>
                  {diag && (
                    <div className="card card-pad" style={{ marginTop: 10, boxShadow: 'none', background: 'var(--surface-2)' }}>
                      <div style={{ fontWeight: 500 }}>{t(`ai.diag.${diag.verdict}` as Key)}</div>
                      {diag.issues.map((i, n) => (
                        <div key={n} className="muted" style={{ fontSize: '0.875rem' }}>{i}</div>
                      ))}
                      {diag.suggestion && (
                        <>
                          <div className="eyebrow" style={{ marginTop: 10 }}>{t('ai.diag.proposal')}</div>
                          <div className="selectable" style={{ fontSize: '0.875rem' }}>
                            {diag.suggestion.kind === 'cloze' ? diag.suggestion.text : `${diag.suggestion.front} → ${diag.suggestion.back}`}
                          </div>
                          <button
                            className="btn btn-sm btn-primary"
                            style={{ marginTop: 8 }}
                            onClick={() => {
                              const sg = diag.suggestion!
                              if (sg.kind === 'cloze') {
                                setKind('cloze')
                                setFields((f) => ({ ...f, text: sg.text, extra: sg.extra }))
                              } else {
                                if (kind === 'cloze') setKind('basic')
                                setFields((f) => ({ ...f, front: sg.front, back: sg.back }))
                              }
                              setDiag(null)
                            }}
                          >
                            {t('ai.diag.apply')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {dup && (
                <div className="warn">
                  <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
                  {t('ed.duplicate')}
                </div>
              )}
              {error && (
                <div className="warn" style={{ background: 'var(--again-soft)' }}>
                  <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
                  {error}
                </div>
              )}
            </div>

            <div className="editor-preview">
              <div className="row">
                <span className="eyebrow" style={{ margin: 0, flex: 1 }}>
                  {t('ed.preview')}
                </span>
                <div className="segmented">
                  <button className={face === 'front' ? 'on' : ''} onClick={() => setFace('front')}>
                    {t('ed.previewFront')}
                  </button>
                  <button className={face === 'back' ? 'on' : ''} onClick={() => setFace('back')}>
                    {t('ed.previewBack')}
                  </button>
                </div>
              </div>
              <div className="pv">
                <div
                  className="md selectable"
                  dangerouslySetInnerHTML={{
                    __html:
                      face === 'front'
                        ? faces.front || '<span class="faint">…</span>'
                        : kind === 'cloze' || kind === 'occlusion'
                          ? faces.answer + (faces.extra ? `<hr/><div class="dim">${faces.extra}</div>` : '')
                          : `${faces.front}<hr/>${faces.answer || '<span class="faint">…</span>'}`
                  }}
                />
              </div>
              {reverseFaces && (
                <>
                  <span className="eyebrow" style={{ margin: 0 }}>
                    {t('ed.reverse')}
                  </span>
                  <div className="pv">
                    <div
                      className="md selectable"
                      dangerouslySetInnerHTML={{
                        __html: face === 'front' ? reverseFaces.front : `${reverseFaces.front}<hr/>${reverseFaces.answer}`
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
      {confirmNode}
    </>
  )
}
