import { CalendarDays, CalendarPlus, Check, Download, Plus, Settings2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DayLoad, Entry, EntryKind, PlanItem, Subject, Task } from '@shared/types'
import { call } from '../api'
import { Modal, useConfirm } from '../components/ui'
import { useT, type Key } from '../i18n'
import { useStore } from '../store'

const KINDS: EntryKind[] = ['cours', 'devoir', 'examen', 'projet']
const PALETTE = ['#c96442', '#6b8450', '#5f8fbf', '#b8873f', '#a35d8a', '#4f8f8b', '#8a6f4e', '#7a7a74']
const DAY = 86_400_000

const pad = (n: number): string => String(n).padStart(2, '0')
const toLocalInput = (ts: number | null): string => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string): number | null => (v ? new Date(v).getTime() : null)
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function fmtDate(ts: number, lang: string, withTime = true): string {
  return new Date(ts).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  })
}

/* ---------------- Modales ---------------- */

function SubjectsModal({ subjects, onClose, onChanged }: { subjects: Subject[]; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const t = useT()
  const { decks } = useStore()
  const [confirm, node] = useConfirm()
  const [draft, setDraft] = useState<Partial<Subject>>({ name: '', color: PALETTE[0], coefficient: 1, deckId: null })
  return (
    <Modal title={t('nb.subjects')} onClose={onClose} width={560}>
      <div className="modal-body">
        {subjects.length === 0 && <p className="muted" style={{ marginBottom: 14 }}>{t('nb.subject.empty')}</p>}
        {subjects.map((s) => (
          <div key={s.id} className="backup-row">
            <span style={{ width: 12, height: 12, borderRadius: 4, background: s.color, flex: 'none' }} />
            <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
            <span className="muted num">×{s.coefficient}</span>
            <button className="icon-btn" onClick={() => setDraft(s)} aria-label={t('common.edit')}>
              <Settings2 size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label={t('common.delete')}
              onClick={async () => {
                if (!(await confirm({ title: t('common.delete'), text: t('nb.confirmDeleteSubject'), confirmLabel: t('common.delete'), danger: true }))) return
                await call('subject.delete', s.id)
                onChanged()
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <div className="eyebrow" style={{ marginTop: 20 }}>{draft.id ? t('common.edit') : t('nb.subject.new')}</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">{t('nb.subject.name')}</label>
            <input className="input" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div style={{ width: 90 }}>
            <label className="field-label">{t('nb.subject.coef')}</label>
            <input className="input" type="number" min={0.5} step={0.5} value={draft.coefficient ?? 1} onChange={(e) => setDraft({ ...draft, coefficient: Number(e.target.value) || 1 })} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">{t('nb.subject.deck')}</label>
            <select className="select" value={draft.deckId ?? ''} onChange={(e) => setDraft({ ...draft, deckId: e.target.value || null })}>
              <option value="">{t('common.none')}</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>{' '.repeat(d.depth)}{d.name}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="field-label" style={{ marginTop: 12 }}>{t('nb.subject.color')}</label>
        <div className="row" style={{ gap: 8 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setDraft({ ...draft, color: c })}
              aria-label={c}
              style={{ width: 26, height: 26, borderRadius: 8, background: c, outline: draft.color === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }}
            />
          ))}
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <span className="spacer" />
          {draft.id && <button className="btn" onClick={() => setDraft({ name: '', color: PALETTE[0], coefficient: 1, deckId: null })}>{t('common.cancel')}</button>}
          <button
            className="btn btn-primary"
            disabled={!draft.name?.trim()}
            onClick={async () => {
              await call('subject.save', { ...draft, name: draft.name as string })
              setDraft({ name: '', color: PALETTE[0], coefficient: 1, deckId: null })
              onChanged()
            }}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
      {node}
    </Modal>
  )
}

function EntryModal({ entry, subjects, onClose, onSaved }: { entry: Partial<Entry> | null; subjects: Subject[]; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const t = useT()
  const { decks } = useStore()
  const [e, setE] = useState<Partial<Entry> & { title: string; kind: EntryKind }>({
    kind: 'examen',
    title: '',
    subjectId: null,
    notes: '',
    deckIds: [],
    dueAt: Date.now() + 7 * DAY,
    ...entry
  })
  const toggleDeck = (id: string): void =>
    setE({ ...e, deckIds: e.deckIds?.includes(id) ? e.deckIds.filter((d) => d !== id) : [...(e.deckIds ?? []), id] })
  return (
    <Modal
      title={e.id ? t('common.edit') : t('nb.addEntry')}
      onClose={onClose}
      width={600}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!e.title.trim()}
            onClick={async () => {
              await call('entry.save', e)
              onSaved()
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          {KINDS.map((k) => (
            <button key={k} className={e.kind === k ? 'on' : ''} onClick={() => setE({ ...e, kind: k })}>
              {t(`nb.kind.${k}` as Key)}
            </button>
          ))}
        </div>
        <div>
          <label className="field-label">{t('nb.field.title')}</label>
          <input className="input" autoFocus value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} />
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">{t('nb.field.subject')}</label>
            <select className="select" value={e.subjectId ?? ''} onChange={(ev) => setE({ ...e, subjectId: ev.target.value || null })}>
              <option value="">{t('nb.noSubject')}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">{t('nb.field.date')}</label>
            <input className="input" type="datetime-local" value={toLocalInput(e.dueAt ?? null)} onChange={(ev) => setE({ ...e, dueAt: fromLocalInput(ev.target.value) })} />
          </div>
        </div>
        <div>
          <label className="field-label">{t('nb.field.decks')}</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {decks.length === 0 && <span className="muted">—</span>}
            {decks.map((d) => (
              <button
                key={d.id}
                className={`btn btn-sm ${e.deckIds?.includes(d.id) ? 'btn-dark' : ''}`}
                onClick={() => toggleDeck(d.id)}
              >
                {e.deckIds?.includes(d.id) && <Check size={13} />}
                {d.fullName.replace(/::/g, ' › ')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="field-label">{t('nb.field.notes')}</label>
          <textarea className="textarea selectable" rows={4} value={e.notes ?? ''} onChange={(ev) => setE({ ...e, notes: ev.target.value })} />
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Planning ---------------- */

function PlanCard({ p, onApplied }: { p: PlanItem; onApplied: () => void }): React.JSX.Element {
  const t = useT()
  const { toast, bump, openEditor, settings } = useStore()
  const seen = p.totalCards ? (p.learnedCards / p.totalCards) * 100 : 0
  const currentLimit = p.currentLimits.find((l) => l !== null) ?? settings.newPerDay
  return (
    <div className="card card-pad" style={{ marginBottom: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, marginTop: 7, flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: '1.0625rem' }}>{p.title}</div>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>
            {p.subjectName ? `${p.subjectName} · ` : ''}
            {fmtDate(p.dueAt, settings.language)} · {p.deckNames.join(', ')}
          </div>
        </div>
        <div className="serif" style={{ fontSize: '1.5rem', whiteSpace: 'nowrap' }}>
          {t('nb.plan.daysLeft', { n: p.daysLeft })}
        </div>
      </div>
      <div className="stackbar" style={{ margin: '16px 0 8px' }}>
        <i style={{ background: 'var(--good)', flex: Math.max(0.0001, seen) }} />
        <i style={{ background: 'var(--border-strong)', flex: Math.max(0.0001, 100 - seen) }} />
      </div>
      <div className="legend" style={{ marginTop: 0 }}>
        <span><b className="num">{p.totalCards}</b> cartes</span>
        <span><i style={{ background: 'var(--good)' }} /> <b className="num">{p.learnedCards}</b> {t('nb.plan.learned')}</span>
        <span><i style={{ background: 'var(--text-2)' }} /> <b className="num">{p.newCards}</b> {t('nb.plan.new')}</span>
        <span><i style={{ background: 'var(--again)' }} /> <b className="num">{p.dueNow}</b> {t('nb.plan.dueNow')}</span>
      </div>
      <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 500 }}>
            {p.newCards > 0 ? t('nb.plan.suggest', { n: p.suggestedNewPerDay }) : t('nb.plan.allSeen')}
          </div>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>
            {t('nb.plan.avg', { n: p.avgPerDay })} · {t('nb.plan.current', { n: currentLimit })}
          </div>
          {p.totalCards > 0 && (
            <div style={{ fontSize: '0.8125rem', marginTop: 6, color: 'var(--text-2)' }}>
              {t('nb.plan.ready', { n: Math.round(p.readiness * 100) })} {p.revisitBefore > 0 && t('nb.plan.revisit', { n: p.revisitBefore })}
            </div>
          )}
        </div>
        {p.newCards > 0 && p.suggestedNewPerDay !== currentLimit && (
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              for (const d of p.deckIds) await call('deck.update', d, { newPerDay: p.suggestedNewPerDay })
              await bump()
              toast(t('nb.plan.applied'))
              onApplied()
            }}
          >
            {t('nb.plan.apply')}
          </button>
        )}
        <button className="btn btn-sm" onClick={() => openEditor({ deckId: p.deckIds[0] })}>
          <Plus size={14} />
          {t('nb.createCards')}
        </button>
      </div>
    </div>
  )
}

function Heat({ load }: { load: DayLoad[] }): React.JSX.Element {
  const t = useT()
  const [sel, setSel] = useState<string | null>(null)
  // Échelle absolue : une journée à 1-2 cartes ne doit pas paraître chargée.
  const max = Math.max(24, ...load.map((l) => l.due + l.planned))
  const first = new Date(`${load[0]?.day}T12:00:00`)
  const lead = (first.getDay() + 6) % 7
  const level = (n: number): number => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))
  const detail = load.find((l) => l.day === sel)
  const names = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
  const today = dayKey(new Date())
  return (
    <>
      <div className="cal">
        {names.map((n, i) => (
          <span key={i} className="cal-h">{n}</span>
        ))}
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {load.map((l) => {
          const n = l.due + l.planned
          return (
            <button
              key={l.day}
              className={`cal-d ${sel === l.day ? 'sel' : ''} ${l.day === today ? 'today' : ''}`}
              data-l={level(n)}
              onClick={() => setSel(l.day === sel ? null : l.day)}
              title={`${l.day} — ${n}`}
            >
              <span className="n">{Number(l.day.slice(8))}</span>
              <span className="dots">
                {l.entries.slice(0, 3).map((e) => (
                  <i key={e.id} style={{ background: e.color }} />
                ))}
              </span>
              {n > 0 && <span className="v num">{n}</span>}
            </button>
          )
        })}
      </div>
      {detail && (
        <div className="card card-pad" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>
            {new Date(`${detail.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          {detail.due + detail.planned === 0 && detail.entries.length === 0 && <div className="muted">{t('nb.day.none')}</div>}
          {detail.due > 0 && <div>{t('nb.day.due', { n: detail.due })}</div>}
          {detail.planned > 0 && <div className="muted">{t('nb.day.planned', { n: detail.planned })}</div>}
          {detail.entries.map((e) => (
            <div key={e.id} className="row" style={{ marginTop: 4 }}>
              <i style={{ width: 8, height: 8, borderRadius: 3, background: e.color }} />
              <span className="tag">{t(`nb.kind.${e.kind}` as Key)}</span> {e.title}
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 10 }}>{t('nb.calendarHint')}</p>
    </>
  )
}

/* ---------------- Page ---------------- */

export function Notebook(): React.JSX.Element {
  const t = useT()
  const { rev, bump, toast, openEditor, settings } = useStore()
  const [tab, setTab] = useState<'plan' | 'entries' | 'tasks'>('plan')
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [load, setLoad] = useState<DayLoad[]>([])
  const [editing, setEditing] = useState<Partial<Entry> | null>(null)
  const [managing, setManaging] = useState(false)
  const [subjectFilter, setSubjectFilter] = useState('')
  const [taskText, setTaskText] = useState('')
  const [taskRec, setTaskRec] = useState<Task['recurrence']>('none')
  const [confirm, confirmNode] = useConfirm()

  const reload = useCallback(async () => {
    const monday = new Date()
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const [s, e, tk, p, l] = await Promise.all([
      call('subject.list'),
      call('entry.list'),
      call('task.list'),
      call('planning.items'),
      call('planning.load', dayKey(monday), 28)
    ])
    setSubjects(s)
    setEntries(e)
    setTasks(tk)
    setPlan(p)
    setLoad(l)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, rev])

  const subj = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const now = Date.now()
  const shown = entries.filter((e) => !subjectFilter || e.subjectId === subjectFilter)
  const upcoming = shown.filter((e) => e.status === 'todo' && (!e.dueAt || e.dueAt >= now - DAY))
  const past = shown.filter((e) => !upcoming.includes(e))

  const row = (e: Entry): React.JSX.Element => (
    <div key={e.id} className="t-row" style={{ gridTemplateColumns: '14px minmax(0,1fr) 170px auto', cursor: 'default' }}>
      <i style={{ width: 10, height: 10, borderRadius: 3, background: (e.subjectId && subj.get(e.subjectId)?.color) || 'var(--faint)' }} />
      <div className="front">
        <div className="a" style={{ textDecoration: e.status === 'done' ? 'line-through' : 'none' }}>
          <span className="tag" style={{ marginRight: 8 }}>{t(`nb.kind.${e.kind}` as Key)}</span>
          {e.title}
        </div>
        <div className="b">{(e.subjectId && subj.get(e.subjectId)?.name) || t('nb.noSubject')}{e.deckIds.length ? ` · ${e.deckIds.length} deck(s)` : ''}</div>
      </div>
      <span className="muted" style={{ fontSize: '0.8125rem' }}>{e.dueAt ? fmtDate(e.dueAt, settings.language) : '—'}</span>
      <span className="row" style={{ gap: 2 }}>
        <button
          className="icon-btn"
          title={e.status === 'done' ? t('nb.reopen') : t('nb.markDone')}
          onClick={async () => {
            await call('entry.save', { ...e, status: e.status === 'done' ? 'todo' : 'done' })
            await bump()
          }}
        >
          <Check size={16} />
        </button>
        <button className="icon-btn" title={t('nb.createCards')} onClick={() => openEditor({ deckId: e.deckIds[0] ?? null })}>
          <CalendarPlus size={16} />
        </button>
        <button className="icon-btn" title={t('common.edit')} onClick={() => setEditing(e)}>
          <Settings2 size={16} />
        </button>
        <button
          className="icon-btn"
          title={t('common.delete')}
          onClick={async () => {
            if (!(await confirm({ title: t('common.delete'), text: t('nb.confirmDeleteEntry'), confirmLabel: t('common.delete'), danger: true }))) return
            await call('entry.delete', e.id)
            await bump()
          }}
        >
          <Trash2 size={16} />
        </button>
      </span>
    </div>
  )

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('nb.title')}</h1>
          <p className="page-sub">{t('nb.sub')}</p>
        </div>
        <button className="btn" onClick={() => setManaging(true)}>
          <Settings2 size={16} />
          {t('nb.subjects')}
        </button>
        <button
          className="btn"
          onClick={async () => {
            if (await call('planning.exportIcs')) toast(t('nb.icsDone'))
          }}
        >
          <Download size={16} />
          .ics
        </button>
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          <Plus size={16} />
          {t('nb.addEntry')}
        </button>
      </div>

      <div className="segmented" style={{ marginBottom: 20 }}>
        {(['plan', 'entries', 'tasks'] as const).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(`nb.tab.${k}` as Key)}
          </button>
        ))}
      </div>

      {tab === 'plan' && (
        <>
          {plan.length === 0 ? (
            <div className="card empty">
              <CalendarDays size={28} color="var(--accent)" />
              <h3>{t('nb.plan.emptyTitle')}</h3>
              <p>{t('nb.plan.emptyText')}</p>
              <div className="actions">
                <button className="btn btn-primary" onClick={() => setEditing({ kind: 'examen' })}>
                  <Plus size={16} />
                  {t('nb.addEntry')}
                </button>
              </div>
            </div>
          ) : (
            plan.map((p) => <PlanCard key={p.entryId} p={p} onApplied={() => void reload()} />)
          )}
          <p className="muted" style={{ fontSize: '0.8125rem', margin: '4px 0 24px' }}>{t('nb.plan.rule')}</p>
          <div className="section-head" style={{ marginTop: 8 }}>
            <h2>{t('nb.calendar')}</h2>
          </div>
          {load.length > 0 && <Heat load={load} />}
        </>
      )}

      {tab === 'entries' && (
        <>
          <div className="toolbar">
            <select className="select select-sm" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
              <option value="">{t('nb.subjects')}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {shown.length === 0 && <div className="card empty"><p>{t('nb.entriesEmpty')}</p></div>}
          {upcoming.length > 0 && (
            <>
              <div className="eyebrow">{t('nb.upcoming')}</div>
              <div className="card table" style={{ marginBottom: 24 }}>{upcoming.map(row)}</div>
            </>
          )}
          {past.length > 0 && (
            <>
              <div className="eyebrow">{t('nb.past')}</div>
              <div className="card table">{past.map(row)}</div>
            </>
          )}
        </>
      )}

      {tab === 'tasks' && (
        <>
          <div className="card card-pad row" style={{ marginBottom: 14 }}>
            <input
              className="input"
              placeholder={t('nb.tasks.add')}
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && taskText.trim()) {
                  await call('task.save', { title: taskText, recurrence: taskRec, dueAt: taskRec === 'none' ? null : Date.now() + (taskRec === 'daily' ? DAY : 7 * DAY) })
                  setTaskText('')
                  await bump()
                }
              }}
            />
            <select className="select select-sm" style={{ width: 150 }} value={taskRec} onChange={(e) => setTaskRec(e.target.value as Task['recurrence'])}>
              {(['none', 'daily', 'weekly'] as const).map((r) => (
                <option key={r} value={r}>{t(`nb.tasks.rec.${r}` as Key)}</option>
              ))}
            </select>
          </div>
          {tasks.length === 0 && <div className="card empty"><p>{t('nb.tasks.none')}</p></div>}
          {tasks.length > 0 && (
            <div className="card table">
              {tasks.map((k) => (
                <div key={k.id} className="t-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) 150px 36px', cursor: 'default' }}>
                  <input type="checkbox" className="checkbox" checked={k.done} onChange={async (e) => { await call('task.toggle', k.id, e.target.checked); await bump() }} />
                  <span style={{ textDecoration: k.done ? 'line-through' : 'none', color: k.done ? 'var(--muted)' : undefined }}>{k.title}</span>
                  <span className="muted" style={{ fontSize: '0.8125rem' }}>
                    {k.recurrence !== 'none' ? t(`nb.tasks.rec.${k.recurrence}` as Key) : k.dueAt ? fmtDate(k.dueAt, settings.language, false) : ''}
                  </span>
                  <button className="icon-btn" aria-label={t('common.delete')} onClick={async () => { await call('task.delete', k.id); await bump() }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <EntryModal
          entry={editing}
          subjects={subjects}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await bump()
            toast(t('nb.saved'))
          }}
        />
      )}
      {managing && <SubjectsModal subjects={subjects} onClose={() => setManaging(false)} onChanged={() => void reload()} />}
      {confirmNode}
    </div>
  )
}
