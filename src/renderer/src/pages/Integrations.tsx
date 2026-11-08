import { Download, FileText, FolderOpen, Loader2, Plug, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiCallRow, AiProviderId, AiStatus, BridgeInfo, FreeModel, IntegrationInfo, NotionPage } from '@shared/types'
import { call } from '../api'
import { ApiKeyCard } from '../components/ApiKeyCard'
import { DuplicatesModal } from '../components/Duplicates'
import { LocalAiSetup } from '../components/LocalAiSetup'
import { Switch } from '../components/ui'
import { isMac } from '../lib/platform'
import { useT, type Key } from '../i18n'
import { useStore } from '../store'

const errText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const PROVIDERS: { id: AiProviderId; label: string }[] = [
  { id: 'none', label: '' },
  { id: 'builtin', label: '' },
  { id: 'openrouter', label: 'OpenRouter (modèles gratuits en ligne)' },
  { id: 'ollama', label: 'Ollama (local)' },
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI / compatible' }
]

function Section({ title, badge, children }: { title: string; badge?: 'active' | 'available' | 'planned'; children: React.ReactNode }): React.JSX.Element {
  const t = useT()
  return (
    <div className="set-group">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {title}
        {badge && (
          <span className="badge" style={badge === 'active' ? { background: 'var(--good-soft)', color: 'var(--good)' } : undefined}>
            {t(`int.status.${badge}` as Key)}
          </span>
        )}
      </h2>
      <div className="card card-pad">{children}</div>
    </div>
  )
}

function AiSection({ active }: { active: boolean }): React.JSX.Element {
  const t = useT()
  const { toast, settings, patchSettings } = useStore()
  const [free, setFree] = useState<FreeModel[]>([])
  const [st, setSt] = useState<AiStatus | null>(null)
  const [provider, setProvider] = useState<AiProviderId>('none')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [priceIn, setPriceIn] = useState(1)
  const [priceOut, setPriceOut] = useState(5)
  const [cap, setCap] = useState(5)
  const [test, setTest] = useState<{ ok: boolean; message: string; models?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<AiCallRow[] | null>(null)

  const apply = (s: AiStatus): void => {
    setSt(s)
    setProvider(s.provider)
    setModel(s.model)
    setBaseUrl(s.baseUrl)
    setPriceIn(s.priceIn)
    setPriceOut(s.priceOut)
    setCap(s.cap)
  }
  useEffect(() => {
    void call('ai.status').then(apply)
  }, [])
  // Liste publique des modèles gratuits d'OpenRouter (aucune clé nécessaire pour la lire).
  useEffect(() => {
    if (provider === 'openrouter' && free.length === 0) void call('ai.openrouterModels').then(setFree).catch(() => undefined)
  }, [provider, free.length])

  const changeProvider = async (p: AiProviderId): Promise<void> => {
    apply(await call('ai.configure', { provider: p }))
    setKey('')
    setTest(null)
  }
  const save = async (): Promise<void> => {
    apply(
      await call('ai.configure', {
        model,
        baseUrl,
        priceIn,
        priceOut,
        monthlyCap: cap,
        ...(key ? { key } : {})
      })
    )
    setKey('')
    toast(t('int.ai.saved'))
  }

  return (
    <Section title={t('int.ai')} badge={active ? 'active' : 'available'}>
      <div style={{ marginBottom: 16 }}>
        <ApiKeyCard onChange={() => void call('ai.status').then(apply)} />
      </div>
      <p className="muted" style={{ marginBottom: 14, fontSize: '0.875rem' }}>{t('int.ai.privacy')}</p>
      {provider !== 'none' && (
        <label className="row" style={{ cursor: 'pointer', marginBottom: 14 }}>
          <Switch on={settings.aiReview} label={t('ai.reviewOpt')} onChange={(v) => void patchSettings({ aiReview: v })} />
          <span>
            {t('ai.reviewOpt')}
            <span className="muted" style={{ display: 'block', fontSize: '0.8125rem' }}>{t('ai.reviewOptDesc')}</span>
          </span>
        </label>
      )}
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220 }}>
          <label className="field-label">{t('int.ai.provider')}</label>
          <select className="select" value={provider} onChange={(e) => void changeProvider(e.target.value as AiProviderId)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.id === 'none' ? t('int.ai.none') : p.id === 'builtin' ? t('int.ai.builtin') : p.label}</option>
            ))}
          </select>
        </div>
        {provider !== 'none' && provider !== 'builtin' && provider !== 'openrouter' && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="field-label">{t('int.ai.model')}</label>
            <input className="input" value={model} list="ai-models" onChange={(e) => setModel(e.target.value)} />
            <datalist id="ai-models">{test?.models?.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
        )}
      </div>

      {provider === 'builtin' && (
        <div style={{ marginTop: 14 }}>
          <LocalAiSetup onReady={() => void call('ai.status').then(apply)} />
        </div>
      )}

      {provider === 'openrouter' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
          <p className="selectable" style={{ fontSize: '0.875rem', lineHeight: 1.55 }}>{t('or.intro')}</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => void call('app.openExternal', 'https://openrouter.ai/keys')}>{t('or.getKey')}</button>
          </div>
          <div>
            <label className="field-label">{t('int.ai.key')}</label>
            <input className="input" type="password" autoComplete="off" value={key} placeholder={st?.hasKey ? '••••••••••••' : 'sk-or-v1-…'} onChange={(e) => setKey(e.target.value)} />
            <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 6 }}>{st?.hasKey ? t('int.ai.keySaved') : t('int.ai.keyHint')}</p>
          </div>
          <div>
            <label className="field-label">{t('or.model')}</label>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              {!free.some((m) => m.id === model) && <option value={model}>{model}</option>}
              {free.map((m) => (
                <option key={m.id} value={m.id}>{m.id === 'openrouter/free' ? t('or.auto') : `${m.name} · ${Math.round(m.context / 1000)}k`}</option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 6 }}>{t('or.modelHint')}</p>
          </div>
          <div className="warn selectable" style={{ fontSize: '0.8125rem' }}>{t('or.privacy')}</div>
          <label className="row" style={{ cursor: 'pointer' }}>
            <Switch on={settings.aiFallbackLocal} label={t('or.fallback')} onChange={(v) => void patchSettings({ aiFallbackLocal: v })} />
            {t('or.fallback')}
          </label>
          <div className="row">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await save()
                setTest(await call('ai.test'))
                setBusy(false)
              }}
            >
              {busy && <Loader2 size={15} className="spin" />}
              {t('int.ai.test')}
            </button>
            <button className="btn btn-primary" onClick={() => void save()}>{t('int.ai.save')}</button>
          </div>
          {test && (
            <div className="warn" style={{ background: test.ok ? 'var(--good-soft)' : 'var(--again-soft)' }}>
              <span className="selectable">{test.message}</span>
            </div>
          )}
        </div>
      )}

      {provider !== 'none' && provider !== 'builtin' && provider !== 'openrouter' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
          {provider === 'openai' && (
            <div>
              <label className="field-label">{t('int.ai.presets')}</label>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {[
                  { n: 'Groq', u: 'https://api.groq.com/openai/v1', m: 'llama-3.3-70b-versatile' },
                  { n: 'OpenRouter', u: 'https://openrouter.ai/api/v1', m: 'meta-llama/llama-3.3-70b-instruct:free' },
                  { n: 'Google Gemini', u: 'https://generativelanguage.googleapis.com/v1beta/openai', m: 'gemini-2.0-flash' }
                ].map((pr) => (
                  <button key={pr.n} className="btn btn-sm" onClick={() => { setBaseUrl(pr.u); setModel(pr.m); setPriceIn(0); setPriceOut(0) }}>{pr.n}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="field-label">{t('int.ai.baseUrl')}</label>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          {provider === 'ollama' ? (
            <p className="muted selectable" style={{ fontSize: '0.8125rem' }}>{t('int.ai.ollamaHelp')}</p>
          ) : (
            <div>
              <label className="field-label">{t('int.ai.key')}</label>
              <input className="input" type="password" autoComplete="off" value={key} placeholder={st?.hasKey ? '••••••••••••' : 'sk-…'} onChange={(e) => setKey(e.target.value)} />
              <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 6 }}>
                {st?.hasKey ? t('int.ai.keySaved') : t('int.ai.keyHint')}
              </p>
            </div>
          )}
          {provider !== 'ollama' && (
            <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ width: 150 }}>
                <label className="field-label">{t('int.ai.priceIn')}</label>
                <input className="input num" type="number" min={0} step={0.05} value={priceIn} onChange={(e) => setPriceIn(Number(e.target.value))} />
              </div>
              <div style={{ width: 150 }}>
                <label className="field-label">{t('int.ai.priceOut')}</label>
                <input className="input num" type="number" min={0} step={0.05} value={priceOut} onChange={(e) => setPriceOut(Number(e.target.value))} />
              </div>
              <div style={{ width: 150 }}>
                <label className="field-label">{t('int.ai.cap')}</label>
                <input className="input num" type="number" min={0} step={1} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
              </div>
              <span className="muted" style={{ fontSize: '0.75rem', flex: 1, minWidth: 180 }}>{t('int.ai.priceNote')}</span>
            </div>
          )}
          {st && provider !== 'ollama' && (
            <div className="muted num" style={{ fontSize: '0.8125rem' }}>
              {t('int.ai.usage', { cost: st.monthCost.toFixed(3), cap: st.cap || '∞', n: st.monthCalls })}
            </div>
          )}
          <div className="row">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await save()
                setTest(await call('ai.test'))
                setBusy(false)
              }}
            >
              {busy && <Loader2 size={15} className="spin" />}
              {t('int.ai.test')}
            </button>
            <button className="btn btn-primary" onClick={() => void save()}>{t('int.ai.save')}</button>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={async () => setLog(log ? null : await call('ai.log'))}>{t('int.ai.log')}</button>
          </div>
          {test && (
            <div className="warn" style={{ background: test.ok ? 'var(--good-soft)' : 'var(--again-soft)' }}>
              <span className="selectable">{test.message}</span>
            </div>
          )}
          {log && (
            <div style={{ maxHeight: 220, overflow: 'auto' }}>
              {log.length === 0 && <p className="muted">{t('int.ai.logEmpty')}</p>}
              {log.map((r) => (
                <div key={r.id} className="backup-row" style={{ fontSize: '0.8125rem' }}>
                  <span style={{ width: 130 }} className="muted">{new Date(r.at).toLocaleString()}</span>
                  <span style={{ flex: 1 }}>{r.purpose} · {r.model}</span>
                  <span className="num muted">{r.tokensIn}/{r.tokensOut}</span>
                  <span className="num" style={{ width: 60, textAlign: 'right' }}>{r.cost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function ClaudeSection(): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [info, setInfo] = useState<BridgeInfo | null>(null)
  useEffect(() => {
    void call('bridge.status').then(setInfo)
  }, [])
  if (!info) return <></>
  const q = (s: string): string => (/[\s"]/.test(s) ? `"${s}"` : s)
  const envFlags = Object.entries(info.env).map(([k, v]) => `-e ${k}=${v}`)
  const cli = ['claude mcp add mnemo', ...envFlags, '--', q(info.command), q(info.script)].join(' ')
  const json = JSON.stringify({ mcpServers: { mnemo: { command: info.command, args: [info.script], ...(Object.keys(info.env).length ? { env: info.env } : {}) } } }, null, 2)
  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      toast(t('int.claude.copied'))
    } catch {
      /* presse-papiers indisponible : le texte reste sélectionnable */
    }
  }
  const toggle = async (on: boolean): Promise<void> => {
    try {
      setInfo(await call('bridge.set', on))
    } catch (e) {
      toast(errText(e), { kind: 'error' })
    }
  }
  return (
    <Section title={t('int.claude')} badge={info.running ? 'active' : 'available'}>
      <div className="d" style={{ marginBottom: 12 }}>{t('int.claude.desc')}</div>
      <div className="set-row" style={{ padding: 0, borderBottom: 0 }}>
        <div className="info">
          <div className="t">{t('int.claude.enable')}</div>
          <div className="d">{info.running ? t('int.claude.on', { port: info.port }) : t('int.claude.off')}</div>
        </div>
        <div className="ctrl">
          <Switch on={info.enabled} label={t('int.claude.enable')} onChange={(v) => void toggle(v)} />
        </div>
      </div>
      {info.enabled && (
        <>
          <div className="eyebrow" style={{ marginTop: 16 }}>{t('int.claude.step')}</div>
          <pre className="selectable code-box">{cli}</pre>
          <button className="btn btn-sm" onClick={() => void copy(cli)}>{t('int.claude.copy')}</button>
          <div className="eyebrow" style={{ marginTop: 16 }}>{t('int.claude.desktop')}</div>
          <pre className="selectable code-box">{json}</pre>
          <button className="btn btn-sm" onClick={() => void copy(json)}>{t('int.claude.copy')}</button>
          <div className="d" style={{ marginTop: 14 }}>{t('int.claude.try')}</div>
        </>
      )}
      <div className="d" style={{ marginTop: 12 }}>{t('int.claude.privacy')}</div>
    </Section>
  )
}

export function Integrations(): React.JSX.Element {
  const t = useT()
  const { settings, patchSettings, toast, bump, go, setAiSeed, decks, openImport } = useStore()
  const [list, setList] = useState<IntegrationInfo[]>([])
  const [dups, setDups] = useState(false)
  const [obsReport, setObsReport] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [notionOn, setNotionOn] = useState(false)
  const [pages, setPages] = useState<NotionPage[]>([])
  const [notionErr, setNotionErr] = useState('')
  const [busy, setBusy] = useState('')

  const reload = async (): Promise<void> => setList(await call('integrations.list'))
  useEffect(() => {
    void reload()
    void call('notion.status').then(setNotionOn)
  }, [settings.aiProvider, settings.obsidianFolder, settings.syncMode, settings.quickAdd])

  const active = (id: string): boolean => list.find((x) => x.id === id)?.status === 'active'
  const exportDeck = null as string | null
  const saved = (): void => toast(t('int.files.done'))

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('int.title')}</h1>
          <p className="page-sub">{t('int.sub')}</p>
        </div>
        <button className="btn" onClick={() => go({ name: 'sync' })}>
          {t('nav.sync')}
        </button>
      </div>

      <AiSection active={active('ai')} />

      <Section title={t('int.anki')} badge="active">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => openImport({})}>
            <Upload size={16} />
            {t('imp.title')}
          </button>
          <button
            className="btn"
            onClick={async () => {
              if (await call('anki.export', exportDeck)) toast(t('int.anki.exported'))
            }}
          >
            <Download size={16} />
            {t('int.anki.export')}
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 12 }}>{t('int.anki.note')}</p>
      </Section>

      <Section title={t('int.files')} badge="active">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={async () => (await call('data.exportCsv', null)) && saved()}>
            <FileText size={16} />
            {t('int.files.csv')}
          </button>
          <button className="btn" onClick={async () => (await call('data.exportMarkdown', null)) && saved()}>
            <FileText size={16} />
            {t('int.files.md')}
          </button>
          <button className="btn" onClick={async () => (await call('planning.exportIcs')) && saved()}>
            <Download size={16} />
            {t('int.files.ics')}
          </button>
        </div>
      </Section>

      <Section title={t('int.obsidian')} badge={active('obsidian') ? 'active' : 'available'}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={async () => { await call('obsidian.pickFolder'); await patchSettings({}) }}>
            <FolderOpen size={16} />
            {t('int.obs.choose')}
          </button>
          <span className="muted selectable" style={{ fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
            {settings.obsidianFolder || t('int.obs.none')}
          </span>
        </div>
        {settings.obsidianFolder && (
          <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
            <Switch on={settings.obsidianWatch} label={t('int.obs.watch')} onChange={(v) => void patchSettings({ obsidianWatch: v })} />
            <span>{t('int.obs.watch')}</span>
            <span className="spacer" />
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  const r = await call('obsidian.scan')
                  setObsReport(t('int.obs.report', { ...r }))
                  await bump()
                } catch (e) {
                  setObsReport(errText(e))
                }
              }}
            >
              {t('int.obs.scan')}
            </button>
          </div>
        )}
        {obsReport && <div className="warn" style={{ marginTop: 12 }}>{obsReport}</div>}
        <p className="muted selectable" style={{ fontSize: '0.8125rem', marginTop: 12 }}>{t('int.obs.syntax')}</p>
      </Section>

      <Section title={t('int.notion')} badge={notionOn ? 'active' : 'available'}>
        {notionOn ? (
          <>
            <div className="row">
              <span style={{ flex: 1 }}>{t('int.notion.connected')}</span>
              <button className="btn btn-sm" onClick={async () => { await call('notion.forget'); setNotionOn(false); setPages([]); await reload() }}>
                {t('int.notion.disconnect')}
              </button>
            </div>
            {pages.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginTop: 16 }}>{t('int.notion.pages')}</div>
                {pages.map((p) => (
                  <div className="backup-row" key={p.id}>
                    <span style={{ flex: 1 }}>{p.title}</span>
                    <button
                      className="btn btn-sm"
                      disabled={busy === p.id}
                      onClick={async () => {
                        setBusy(p.id)
                        try {
                          setAiSeed(await call('notion.pageText', p.id))
                          go({ name: 'ai' })
                        } catch (e) {
                          setNotionErr(errText(e))
                        } finally {
                          setBusy('')
                        }
                      }}
                    >
                      {t('int.notion.use')}
                    </button>
                  </div>
                ))}
              </>
            )}
            {pages.length === 0 && (
              <button
                className="btn btn-sm"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  try {
                    setPages(await call('notion.connect', ''))
                  } catch {
                    setNotionErr(t('int.notion.error'))
                  }
                }}
              >
                {t('int.notion.pages')}
              </button>
            )}
          </>
        ) : (
          <>
            <label className="field-label">{t('int.notion.token')}</label>
            <div className="row">
              <input className="input" type="password" autoComplete="off" value={notionToken} onChange={(e) => setNotionToken(e.target.value)} placeholder="secret_…" />
              <button
                className="btn btn-primary"
                disabled={!notionToken.trim()}
                onClick={async () => {
                  setNotionErr('')
                  try {
                    setPages(await call('notion.connect', notionToken))
                    setNotionOn(true)
                    setNotionToken('')
                    await reload()
                  } catch (e) {
                    setNotionErr(errText(e))
                  }
                }}
              >
                {t('int.notion.connect')}
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 10 }}>{t('int.notion.help')}</p>
          </>
        )}
        {notionErr && <div className="warn selectable" style={{ marginTop: 10, background: 'var(--again-soft)' }}>{notionErr}</div>}
      </Section>

      <ClaudeSection />

      <Section title={t('int.quick')} badge={settings.quickAdd ? 'active' : 'available'}>
        <div className="set-row" style={{ padding: 0, borderBottom: 0 }}>
          <div className="info">
            <div className="d">{t(isMac() ? 'int.quick.descMac' : 'int.quick.desc')}</div>
            <div className="d">{t('int.quick.restart')}</div>
          </div>
          <div className="ctrl">
            <Switch on={settings.quickAdd} label={t('int.quick')} onChange={(v) => void patchSettings({ quickAdd: v })} />
          </div>
        </div>
        <div className="set-row" style={{ paddingBottom: 0, borderBottom: 0 }}>
          <div className="info">
            <div className="t">{t('int.reminder')}</div>
            <div className="d">{t('int.reminder.desc')}</div>
          </div>
          <div className="ctrl">
            <input className="input" type="time" style={{ width: 120 }} value={settings.reminderTime} onChange={(e) => void patchSettings({ reminderTime: e.target.value })} />
            <Switch on={settings.reminderEnabled} label={t('int.reminder')} onChange={(v) => void patchSettings({ reminderEnabled: v })} />
          </div>
        </div>
      </Section>

      <Section title={t('int.tools')}>
        <div className="row">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{t('int.dups')}</div>
            <div className="muted" style={{ fontSize: '0.8125rem' }}>{t('int.dups.desc')}</div>
          </div>
          <button className="btn" disabled={decks.length === 0} onClick={() => setDups(true)}>{t('lib.dups')}</button>
        </div>
      </Section>

      <Section title={t('int.roadmap')}>
        {list.filter((i) => i.status === 'planned').map((i) => (
          <div className="backup-row" key={i.id}>
            <Plug size={16} color="var(--muted)" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{i.name}</div>
              <div className="muted" style={{ fontSize: '0.8125rem' }}>{i.description}</div>
            </div>
            <span className="badge">{t('int.status.planned')}</span>
          </div>
        ))}
        <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 12 }}>{t('int.add')}</p>
      </Section>

      {dups && <DuplicatesModal onClose={() => setDups(false)} />}
    </div>
  )
}
