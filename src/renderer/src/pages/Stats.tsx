import { useEffect, useMemo, useState } from 'react'
import type { StatsData } from '@shared/types'
import { call } from '../api'
import { useT } from '../i18n'
import { Inline } from '../components/Inline'
import { formatDuration } from '../lib/format'
import { useStore } from '../store'

function Heatmap({ history, lang }: { history: StatsData['history']; lang: 'fr' | 'en' }): React.JSX.Element {
  const max = Math.max(1, ...history.map((d) => d.count))
  const lead = useMemo(() => {
    const first = new Date(`${history[0]?.day}T12:00:00`)
    return (first.getDay() + 6) % 7 // lundi = 0
  }, [history])
  const level = (n: number): number => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))
  const fmt = (day: string): string =>
    new Date(`${day}T12:00:00`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <>
      <div className="heatmap">
        {Array.from({ length: lead }, (_, i) => (
          <i key={`p${i}`} style={{ visibility: 'hidden' }} />
        ))}
        {history.map((d) => (
          <i key={d.day} data-l={level(d.count)} title={`${fmt(d.day)} — ${d.count}`} />
        ))}
      </div>
      <div className="heat-legend">
        <span>{lang === 'fr' ? 'Moins' : 'Less'}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} data-l={l} />
        ))}
        <span>{lang === 'fr' ? 'Plus' : 'More'}</span>
      </div>
    </>
  )
}

export function Stats(): React.JSX.Element {
  const t = useT()
  const { decks, rev, settings } = useStore()
  const [deckId, setDeckId] = useState<string | null>(null)
  const [s, setS] = useState<StatsData | null>(null)

  useEffect(() => {
    void call('stats.get', deckId).then(setS)
  }, [deckId, rev])

  if (!s) return <div className="page" />
  const fcMax = Math.max(1, ...s.forecast.map((f) => f.count))
  const st = s.states
  const stateItems = [
    { k: 'stats.new' as const, v: st.new, c: 'var(--text-2)' },
    { k: 'stats.learning' as const, v: st.learning, c: 'var(--again)' },
    { k: 'stats.young' as const, v: st.young, c: 'var(--hard)' },
    { k: 'stats.mature' as const, v: st.mature, c: 'var(--good)' },
    { k: 'stats.suspended' as const, v: st.suspended, c: 'var(--faint)' }
  ]
  const stTotal = stateItems.reduce((a, b) => a + b.v, 0)
  const dayLabel = (day: string, i: number): string =>
    i === 0
      ? t('stats.day.today')
      : i === 1
        ? t('stats.day.tomorrow')
        : new Date(`${day}T12:00:00`).toLocaleDateString(settings.language === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric' })

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('stats.title')}</h1>
          <p className="page-sub">{t('stats.sub')}</p>
        </div>
        <select className="select select-sm" value={deckId ?? ''} onChange={(e) => setDeckId(e.target.value || null)}>
          <option value="">{t('stats.allDecks')}</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {' '.repeat(d.depth)}
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="v">{s.today.reviews}</div>
          <div className="l">{t('stats.today')}</div>
        </div>
        <div className="card kpi">
          <div className="v">{s.streak}</div>
          <div className="l">{t('stats.streak')}</div>
        </div>
        <div className="card kpi">
          <div className="v">{s.retention === null ? '—' : `${Math.round(s.retention * 100)} %`}</div>
          <div className="l">{s.retention === null ? t('stats.retentionNA') : t('stats.retention')}</div>
        </div>
        <div className="card kpi">
          <div className="v">{formatDuration(s.totalTimeMs)}</div>
          <div className="l">{t('stats.time')}</div>
        </div>
      </div>

      <div className="card panel">
        <h3>{t('stats.activity')}</h3>
        <p className="sub">
          {t('stats.activitySub')} · {t('stats.reviewsTotal', { n: s.totalReviews })}
        </p>
        <Heatmap history={s.history} lang={settings.language} />
      </div>

      <div className="card panel">
        <h3>{t('stats.forecast')}</h3>
        <p className="sub">{t('stats.forecastSub')}</p>
        <div className="bars">
          {s.forecast.map((f, i) => (
            <div className="b" key={f.day} title={`${f.day} — ${f.count}`}>
              <i className={f.count === 0 ? 'zero' : ''} style={{ height: f.count === 0 ? 2 : `${Math.max(4, (f.count / fcMax) * 100)}%` }} />
              <span className="num">{dayLabel(f.day, i)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card panel">
          <h3>{t('stats.states')}</h3>
          <p className="sub">{t('stats.cardsTotal', { n: s.totalCards })}</p>
          {stTotal > 0 && (
            <div className="stackbar">
              {stateItems
                .filter((x) => x.v > 0)
                .map((x) => (
                  <i key={x.k} style={{ background: x.c, flex: x.v }} title={`${t(x.k)} — ${x.v}`} />
                ))}
            </div>
          )}
          <div className="legend">
            {stateItems.map((x) => (
              <span key={x.k}>
                <i style={{ background: x.c }} />
                {t(x.k)} <b className="num">{x.v}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="card panel">
          <h3>{t('stats.hardest')}</h3>
          <p className="sub">{t('stats.hardestSub')}</p>
          {s.hardest.length === 0 ? (
            <p className="muted">{t('stats.none')}</p>
          ) : (
            s.hardest.map((h) => (
              <div className="hard-row" key={h.cardId}>
                <span className="t">{h.front ? <Inline text={h.front} max={140} /> : '…'}</span>
                <span className="tag">{t('stats.lapses', { n: h.lapses })}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
