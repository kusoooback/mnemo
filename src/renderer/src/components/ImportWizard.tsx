import { ArrowLeft, BookOpen, Check, ClipboardPaste, FileUp, FolderOpen, Layers, Loader2, NotebookText, Sparkles, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AnkiProfileInfo,
  ImportResult,
  ImportSource,
  TextImportRequest
} from '@shared/types'
import { DEFAULT_TEXT_OPTIONS, parseText, type Role } from '@shared/textimport'
import { call } from '../api'
import { useT, type Key } from '../i18n'
import { formatBytes } from '../lib/format'
import { Inline } from './Inline'
import { useStore } from '../store'
import { Logo, Modal } from './ui'

const errText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const ROLES: Role[] = ['front', 'back', 'extra', 'tags', 'deck', 'kind', 'guid', 'skip']

function Tile({ icon, title, desc, onClick, disabled }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button className="tile" onClick={onClick} disabled={disabled}>
      <span className="tile-ic">{icon}</span>
      <span className="tile-tx">
        <b>{title}</b>
        <span>{desc}</span>
      </span>
    </button>
  )
}

/* ---------------- Réglages d'un fichier texte ---------------- */

function TextStep({ source, onDone, deckId: presetDeck }: { source: Extract<ImportSource, { kind: 'text' }>; onDone: (r: ImportResult) => void; deckId: string | null }): React.JSX.Element {
  const t = useT()
  const { decks } = useStore()
  const [delimiter, setDelimiter] = useState<TextImportRequest['delimiter']>('auto')
  const [custom, setCustom] = useState('')
  const [rowSeparator, setRowSeparator] = useState('')
  const [header, setHeader] = useState<TextImportRequest['header']>('auto')
  const [kind, setKind] = useState<TextImportRequest['kind']>('auto')
  const [advanced, setAdvanced] = useState(false)
  const [dedupe, setDedupe] = useState(true)
  const [htmlOverride, setHtmlOverride] = useState<boolean | null>(null)

  const parsed = useMemo(
    () => parseText(source.text, { ...DEFAULT_TEXT_OPTIONS, delimiter, custom, rowSeparator, header }),
    [source.text, delimiter, custom, rowSeparator, header]
  )
  const [roles, setRoles] = useState<Role[]>(parsed.roles)
  const sig = `${parsed.delimiterText}|${parsed.hasHeader}|${parsed.columns}`
  useEffect(() => setRoles(parsed.roles), [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasDeckCol = roles.includes('deck')
  const [deckMode, setDeckMode] = useState<TextImportRequest['deckMode']>(presetDeck ? 'existing' : hasDeckCol ? 'column' : 'new')
  useEffect(() => {
    if (!presetDeck) setDeckMode(hasDeckCol ? 'column' : (m) => (m === 'column' ? 'new' : m))
  }, [hasDeckCol, presetDeck])
  const [deckId, setDeckId] = useState<string>(presetDeck ?? decks[0]?.id ?? '')
  const [deckName, setDeckName] = useState(source.name.replace(/\.[^.]+$/, ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const html = htmlOverride ?? parsed.html
  const total = parsed.rows.length
  const hasFront = roles.includes('front')

  const setRole = (i: number, r: Role): void => setRoles((rs) => rs.map((x, j) => (j === i ? r : x)))
  const preview = parsed.rows.slice(0, 5)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const res = await call('import.run', {
        kind: 'text',
        path: source.path,
        name: source.name,
        text: source.text,
        options: { delimiter, custom, rowSeparator, header, roles, kind, deckMode, deckId: deckMode === 'existing' ? deckId : null, deckName, html, skipDuplicates: dedupe }
      })
      onDone(res)
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ minWidth: 190 }}>
          <label className="field-label">{t('imp.text.delimiter')}</label>
          <select className="select select-sm" style={{ width: '100%' }} value={delimiter} onChange={(e) => setDelimiter(e.target.value as TextImportRequest['delimiter'])}>
            {(['auto', 'tab', 'semicolon', 'comma', 'pipe', 'custom'] as const).map((d) => (
              <option key={d} value={d}>{t(`imp.sep.${d}` as Key)}</option>
            ))}
          </select>
        </div>
        {delimiter === 'custom' && (
          <div style={{ width: 150 }}>
            <label className="field-label">&nbsp;</label>
            <input className="input" style={{ height: 32 }} placeholder={t('imp.text.customPlaceholder')} value={custom} onChange={(e) => setCustom(e.target.value)} />
          </div>
        )}
        <div style={{ minWidth: 190 }}>
          <label className="field-label">{t('imp.text.header')}</label>
          <select className="select select-sm" style={{ width: '100%' }} value={header} onChange={(e) => setHeader(e.target.value as TextImportRequest['header'])}>
            {(['auto', 'yes', 'no'] as const).map((d) => (
              <option key={d} value={d}>{t(`imp.header.${d}` as Key)}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 170 }}>
          <label className="field-label">{t('imp.text.kind')}</label>
          <select className="select select-sm" style={{ width: '100%' }} value={kind} onChange={(e) => setKind(e.target.value as TextImportRequest['kind'])}>
            <option value="auto">{t('imp.kind.auto')}</option>
            <option value="basic">{t('ed.basic')}</option>
            <option value="basic-reverse">{t('ed.reverse')}</option>
            <option value="typed">{t('ed.typed')}</option>
            <option value="cloze">{t('ed.cloze')}</option>
          </select>
        </div>
      </div>

      <div className="eyebrow">
        {t('imp.text.preview')} · <span className="num">{t('imp.text.total', { n: total })}</span>
      </div>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              {Array.from({ length: parsed.columns }, (_, i) => (
                <th key={i} style={{ padding: '6px 8px' }}>
                  <select className="select select-sm" style={{ width: '100%', minWidth: 120 }} value={roles[i] ?? 'skip'} onChange={(e) => setRole(i, e.target.value as Role)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{t(`imp.role.${r}` as Key)}</option>
                    ))}
                  </select>
                  {parsed.headers[i] && <div className="faint" style={{ fontWeight: 400, marginTop: 3 }}>{parsed.headers[i]}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((r, ri) => (
              <tr key={ri}>
                {Array.from({ length: parsed.columns }, (_, i) => (
                  <td key={i} style={{ whiteSpace: 'normal', maxWidth: 220, opacity: roles[i] === 'skip' ? 0.4 : 1 }}>
                    <div style={{ maxHeight: 44, overflow: 'hidden' }}><Inline text={r[i] ?? ''} max={90} /></div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn btn-ghost btn-sm" style={{ marginLeft: -10 }} onClick={() => setAdvanced(!advanced)}>
        {t('imp.text.settings')}
      </button>
      {advanced && (
        <div className="card card-pad" style={{ boxShadow: 'none', background: 'var(--surface-2)', margin: '6px 0 12px' }}>
          <label className="field-label">{t('imp.text.rowSep')}</label>
          <input className="input" style={{ maxWidth: 220 }} value={rowSeparator} onChange={(e) => setRowSeparator(e.target.value)} placeholder=";;" />
          <p className="muted" style={{ fontSize: '0.8125rem', margin: '6px 0 12px' }}>{t('imp.text.rowSepHint')}</p>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" className="checkbox" checked={html} onChange={(e) => setHtmlOverride(e.target.checked)} />
            {t('imp.text.html')}
          </label>
        </div>
      )}

      <div className="eyebrow" style={{ marginTop: 14 }}>{t('imp.dest')}</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="segmented">
          <button className={deckMode === 'new' ? 'on' : ''} onClick={() => setDeckMode('new')}>{t('imp.dest.new')}</button>
          <button className={deckMode === 'existing' ? 'on' : ''} onClick={() => setDeckMode('existing')} disabled={decks.length === 0}>{t('imp.dest.existing')}</button>
          {hasDeckCol && <button className={deckMode === 'column' ? 'on' : ''} onClick={() => setDeckMode('column')}>{t('imp.dest.column')}</button>}
        </div>
        {deckMode === 'new' && <input className="input" style={{ maxWidth: 240, height: 34 }} value={deckName} onChange={(e) => setDeckName(e.target.value)} />}
        {deckMode === 'existing' && (
          <select className="select select-sm" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{' '.repeat(d.depth)}{d.name}</option>
            ))}
          </select>
        )}
      </div>
      <label className="row" style={{ marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" className="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} />
        {t('imp.text.dups')}
      </label>

      {error && (
        <div className="warn selectable" style={{ marginTop: 12, background: 'var(--again-soft)' }}>
          <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
          {error}
        </div>
      )}
      <div className="row" style={{ marginTop: 18 }}>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={busy || !hasFront || total === 0 || (deckMode === 'new' && !deckName.trim())} onClick={() => void run()}>
          {busy && <Loader2 size={15} className="spin" />}
          {busy ? t('imp.running') : t('imp.goN', { n: total })}
        </button>
      </div>
    </>
  )
}

/* ---------------- Assistant ---------------- */

export function ImportWizard(): React.JSX.Element | null {
  const t = useT()
  const { importer, openImport, go, bump, toast, setAiSeed } = useStore()
  const [profiles, setProfiles] = useState<AnkiProfileInfo[]>([])
  const [source, setSource] = useState<ImportSource | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [mdDeck, setMdDeck] = useState('')

  useEffect(() => {
    if (!importer) return
    setSource(null)
    setResult(null)
    setPasting(false)
    setError('')
    void call('import.profiles').then(setProfiles)
    if (importer.path) {
      setBusy(true)
      void call('import.inspect', importer.path)
        .then(setSource)
        .catch((e) => setError(errText(e)))
        .finally(() => setBusy(false))
    }
  }, [importer])

  useEffect(() => {
    if (source?.kind === 'markdown') setMdDeck(source.name.replace(/\.[^.]+$/, ''))
  }, [source])

  if (!importer) return null
  const close = (): void => openImport(null)

  const inspect = async (path: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setSource(await call('import.inspect', path))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const finish = async (r: ImportResult): Promise<void> => {
    setResult(r)
    setBusy(false)
    await bump()
  }

  const runSimple = async (): Promise<void> => {
    if (!source || source.kind === 'unsupported' || source.kind === 'text' || source.kind === 'document') return
    setBusy(true)
    setError('')
    try {
      await finish(await call('import.run', { kind: source.kind, path: source.path, name: source.name, deckName: mdDeck }))
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  const back = (): void => {
    setSource(null)
    setPasting(false)
    setError('')
  }

  const title = result ? t('imp.done') : t('imp.title')
  return (
    <Modal title={title} onClose={close} width={source?.kind === 'text' ? 860 : 640}>
      <div className="modal-body">
        {/* ---- Résultat ---- */}
        {result ? (
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <Logo size={56} />
            <div className="serif" style={{ fontSize: '2rem', margin: '10px 0 2px' }}>{t('imp.done.added', { n: result.added })}</div>
            <div className="muted" style={{ marginBottom: 14 }}>{result.source}</div>
            <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
              {result.existing > 0 && <span className="tag">{t('imp.done.existing', { n: result.existing })}</span>}
              {result.reviews > 0 && <span className="tag">{t('imp.done.reviews', { n: result.reviews })}</span>}
              {result.decks > 0 && <span className="tag">{t('imp.done.decks', { n: result.decks })}</span>}
              {result.media > 0 && <span className="tag">{t('imp.done.media', { n: result.media })}</span>}
              {result.invalid > 0 && <span className="tag">{t('imp.done.invalid', { n: result.invalid })}</span>}
            </div>
            {result.warnings.length > 0 && (
              <div className="warn selectable" style={{ textAlign: 'left', margin: '12px 0', flexDirection: 'column', gap: 4 }}>
                {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
              {result.deckId && (
                <button className="btn" onClick={() => { close(); go({ name: 'deck', id: result.deckId as string }) }}>
                  <BookOpen size={16} />
                  {t('imp.done.openDeck')}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => { close(); if (result.added || result.reviews) go({ name: 'home' }) }}>
                {t('imp.done.close')}
              </button>
            </div>
          </div>
        ) : busy && !source ? (
          <p className="muted row" style={{ padding: '24px 0' }}><Loader2 size={16} className="spin" /> {t('common.loading')}</p>
        ) : /* ---- Choix de la source ---- */ !source && !pasting ? (
          <>
            <p className="muted" style={{ marginBottom: 16 }}>{t('imp.sub')}</p>
            <div className="dropzone">
              <FileUp size={22} color="var(--accent)" />
              <div>
                <b>{t('imp.drop')}</b>
                <div className="muted" style={{ fontSize: '0.8125rem' }}>{t('imp.dropHint')}</div>
              </div>
            </div>
            <div className="tiles">
              {profiles.map((p) => (
                <Tile
                  key={p.dir}
                  icon={<NotebookText size={20} />}
                  title={t('imp.localAnki')}
                  desc={t('imp.localAnkiDesc', { name: p.name, size: formatBytes(p.size) })}
                  onClick={() => void inspect(p.dir)}
                />
              ))}
              <Tile
                icon={<FileUp size={20} />}
                title={t('imp.pickFile')}
                desc={t('imp.pickFileDesc')}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const s = await call('import.pick')
                    if (s) setSource(s)
                  } catch (e) {
                    setError(errText(e))
                  } finally {
                    setBusy(false)
                  }
                }}
              />
              <Tile icon={<ClipboardPaste size={20} />} title={t('imp.paste')} desc={t('imp.pasteDesc')} onClick={() => setPasting(true)} />
              <Tile icon={<FolderOpen size={20} />} title={t('imp.folder')} desc={t('imp.folderDesc')} onClick={() => { close(); go({ name: 'integrations' }) }} />
              <Tile icon={<NotebookText size={20} />} title={t('imp.notion')} desc={t('imp.notionDesc')} onClick={() => { close(); go({ name: 'integrations' }) }} />
              <Tile icon={<Sparkles size={20} />} title={t('imp.ai')} desc={t('imp.aiDesc')} onClick={() => { close(); go({ name: 'ai' }) }} />
            </div>
            {profiles.length === 0 && <p className="faint" style={{ fontSize: '0.8125rem', marginTop: 12 }}>{t('imp.noAnki')}</p>}
            {error && <div className="warn selectable" style={{ marginTop: 12, background: 'var(--again-soft)' }}>{error}</div>}
          </>
        ) : pasting && !source ? (
          <>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: -10, marginBottom: 8 }} onClick={back}>
              <ArrowLeft size={15} />
              {t('imp.back')}
            </button>
            <label className="field-label">{t('imp.pasteTitle')}</label>
            <textarea className="textarea selectable" rows={10} autoFocus value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t('imp.pastePlaceholder')} />
            <div className="row" style={{ marginTop: 14 }}>
              <span className="spacer" />
              <button className="btn btn-primary" disabled={!pasted.trim()} onClick={() => setSource({ kind: 'text', name: 'Texte collé', path: '', text: pasted })}>
                {t('imp.pasteNext')}
              </button>
            </div>
          </>
        ) : source ? (
          <>
            {!importer.path && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: -10, marginBottom: 10 }} onClick={back}>
                <ArrowLeft size={15} />
                {t('imp.back')}
              </button>
            )}
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="tag">{source.name}</span>
            </div>

            {source.kind === 'unsupported' && (
              <>
                <div className="warn selectable"><TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />{source.reason}</div>
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn" onClick={back}>{t('imp.other')}</button>
                </div>
              </>
            )}

            {source.kind === 'anki' && (
              <>
                <div className="serif" style={{ fontSize: '1.5rem', marginBottom: 4 }}>
                  {t('imp.anki.summary', { notes: source.summary.notes, cards: source.summary.cards, reviews: source.summary.reviews })}
                </div>
                {source.summary.decks.length > 0 && (
                  <p className="muted selectable" style={{ fontSize: '0.875rem' }}>
                    {t('imp.anki.decks', { list: source.summary.decks.slice(0, 8).join(' · ') + (source.summary.decks.length > 8 ? '…' : '') })}
                  </p>
                )}
                {source.summary.known > 0 && (
                  <div className="warn" style={{ margin: '12px 0', background: 'var(--accent-soft)' }}>
                    <Check size={16} style={{ flex: 'none', marginTop: 2 }} />
                    {t('imp.anki.known', { n: source.summary.known })}
                  </div>
                )}
                <ul className="muted" style={{ fontSize: '0.875rem', paddingLeft: 18, margin: '10px 0 16px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <li>{t('imp.anki.safe')}</li>
                  {source.local && <li>{t('imp.anki.close')}</li>}
                  <li>{t('imp.anki.keepUsing')}</li>
                </ul>
                {source.warnings.map((w, i) => <p key={i} className="muted" style={{ fontSize: '0.8125rem' }}>{w}</p>)}
                {error && <div className="warn selectable" style={{ background: 'var(--again-soft)', marginBottom: 12 }}>{error}</div>}
                <div className="row">
                  <span className="spacer" />
                  <button className="btn btn-primary" disabled={busy || source.summary.notes === 0} onClick={() => void runSimple()}>
                    {busy && <Loader2 size={15} className="spin" />}
                    {busy ? t('imp.running') : t('imp.go')}
                  </button>
                </div>
              </>
            )}

            {source.kind === 'text' && <TextStep source={source} deckId={importer.deckId ?? null} onDone={(r) => void finish(r)} />}

            {source.kind === 'markdown' && (
              <>
                <div className="serif" style={{ fontSize: '1.5rem', marginBottom: 8 }}>{t('imp.md.sample', { n: source.cards })}</div>
                {source.sample.map((c, i) => (
                  <div key={i} className="backup-row" style={{ fontSize: '0.875rem' }}>
                    <span style={{ flex: 1, fontWeight: 500 }}><Inline text={c.front} max={80} /></span>
                    <span className="muted" style={{ flex: 1 }}><Inline text={c.back} max={80} /></span>
                  </div>
                ))}
                <label className="field-label" style={{ marginTop: 14 }}>{t('imp.md.deck')}</label>
                <input className="input" value={mdDeck} onChange={(e) => setMdDeck(e.target.value)} />
                {error && <div className="warn selectable" style={{ background: 'var(--again-soft)', marginTop: 12 }}>{error}</div>}
                <div className="row" style={{ marginTop: 16 }}>
                  <span className="spacer" />
                  <button className="btn btn-primary" disabled={busy || source.cards === 0 || !mdDeck.trim()} onClick={() => void runSimple()}>
                    {t('imp.goN', { n: source.cards })}
                  </button>
                </div>
              </>
            )}

            {source.kind === 'mnemo' && (
              <>
                <div className="serif" style={{ fontSize: '1.5rem', marginBottom: 8 }}>
                  {t('imp.mnemo.summary', { decks: source.decks, notes: source.notes, reviews: source.reviews })}
                </div>
                <p className="muted">{t('imp.mnemo.note')}</p>
                {error && <div className="warn selectable" style={{ background: 'var(--again-soft)', marginTop: 12 }}>{error}</div>}
                <div className="row" style={{ marginTop: 16 }}>
                  <span className="spacer" />
                  <button className="btn btn-primary" disabled={busy} onClick={() => void runSimple()}>{t('imp.go')}</button>
                </div>
              </>
            )}

            {source.kind === 'document' && (
              <>
                <div className="serif" style={{ fontSize: '1.5rem', marginBottom: 6 }}>{t('imp.doc.title')}</div>
                <p className="muted">{t('imp.doc.text')}</p>
                {error && <div className="warn selectable" style={{ background: 'var(--again-soft)', marginTop: 12 }}>{error}</div>}
                <div className="row" style={{ marginTop: 16 }}>
                  <span className="spacer" />
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        setAiSeed(await call('import.documentText', source.path))
                        close()
                        go({ name: 'ai' })
                        toast(source.name)
                      } catch (e) {
                        setError(errText(e))
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    <Layers size={16} />
                    {t('imp.doc.go')}
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
