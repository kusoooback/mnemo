import { ArrowLeft, ArrowRight, Check, Compass, FileText, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { call } from '../api'
import { useT } from '../i18n'
import { renderInline } from '../lib/render'
import { useStore } from '../store'
import { Logo } from './ui'
import '../styles/tour.css'

/** Une scène animée par étape. Tout est en CSS : rien ne tourne quand l'utilisateur préfère moins d'animations. */
function SceneWelcome(): React.JSX.Element {
  return (
    <div className="tr-s1">
      {[0, 1, 2, 3, 4].map((n) => (
        <div key={n} className="tr-mini" style={{ ['--x' as string]: `${[-150, 150, -105, 112, 0][n]}px`, ['--y' as string]: `${[-46, -62, 52, 46, -86][n]}px`, ['--r' as string]: `${[-12, 10, 8, -9, 4][n]}deg`, ['--d' as string]: `${n * 0.5}s` }}>
          <i />
          <i />
        </div>
      ))}
      <div className="tr-glow" />
      <div className="tr-logo">
        <Logo size={104} />
      </div>
    </div>
  )
}

function SceneCreate({ t }: { t: (k: string) => string }): React.JSX.Element {
  return (
    <div className="tr-s2">
      <div className="tr-editor">
        <div className="tr-lab">{t('review.question')}</div>
        <div className="tr-field">
          <span className="tr-type tr-t1">{t('tour.demo.q')}</span>
          <i className="tr-caret" />
        </div>
        <div className="tr-lab">{t('review.answer')}</div>
        <div className="tr-field">
          <span className="tr-type tr-t2">{t('tour.demo.a')}</span>
        </div>
      </div>
      <div className="tr-ai">
        <Sparkles size={16} /> IA
      </div>
    </div>
  )
}

function SceneReview({ t }: { t: (k: string) => string }): React.JSX.Element {
  const rates: [string, string, string][] = [
    ['again', t('review.again'), '1 min'],
    ['hard', t('review.hard'), '6 min'],
    ['good', t('review.good'), '10 min'],
    ['easy', t('review.easy'), '8 j']
  ]
  return (
    <div className="tr-s3">
      <div className="tr-flip">
        <div className="tr-face tr-front">{t('tour.demo.q')}</div>
        <div className="tr-face tr-back">{t('tour.demo.a')}</div>
      </div>
      <div className="tr-rates">
        {rates.map(([k, label, when]) => (
          <span key={k} className={`tr-rate ${k}`}>
            <b>{label}</b>
            <small>{when}</small>
          </span>
        ))}
      </div>
    </div>
  )
}

function SceneSpaced({ t }: { t: (k: string) => string }): React.JSX.Element {
  const bars: [number, string][] = [
    [26, t('tour.demo.day1')],
    [44, t('tour.demo.day3')],
    [70, t('tour.demo.day8')],
    [108, t('tour.demo.week3')],
    [150, t('tour.demo.month2')]
  ]
  return (
    <div className="tr-s4">
      <div className="tr-bars">
        {bars.map(([h, label], n) => (
          <div key={n} className="tr-col" style={{ ['--h' as string]: `${h}px`, ['--d' as string]: `${n * 0.28}s` }}>
            <i className="tr-bar" />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <svg className="tr-curve" viewBox="0 0 300 150" aria-hidden>
        <path d="M6 138 C 70 134, 120 118, 160 86 S 250 22, 294 10" pathLength={1} />
      </svg>
    </div>
  )
}

function SceneQuiz({ t }: { t: (k: string) => string }): React.JSX.Element {
  const years = ['1955', '1989', '1919', '1947']
  return (
    <div className="tr-s5">
      <div className="tr-qcard">
        <div className="tr-qt">{t('tour.demo.quiz')}</div>
        {years.map((y, n) => (
          <div key={y} className={`tr-ch c${n}`}>
            <span className="tr-key">{'ABCD'[n]}</span>
            {y}
            {n === 1 && <Check size={15} className="tr-tick" />}
          </div>
        ))}
      </div>
    </div>
  )
}

function SceneChat({ t }: { t: (k: string) => string }): React.JSX.Element {
  return (
    <div className="tr-s6">
      <div className="tr-bub user">{t('tour.demo.user')}</div>
      <div className="tr-dots">
        <i />
        <i />
        <i />
      </div>
      <div className="tr-bub bot">{t('tour.demo.bot')}</div>
      <div className="tr-pops">
        {[0, 1, 2].map((n) => (
          <span key={n} className={`tr-pop${n + 1}`}>
            <FileText size={14} />
          </span>
        ))}
      </div>
    </div>
  )
}

function SceneShare({ t }: { t: (k: string) => string }): React.JSX.Element {
  return (
    <div className="tr-s7">
      <div className="tr-flight">
        <div className="tr-who a">M</div>
        <div className="tr-file">
          <FileText size={15} /> {t('tour.demo.share')}
        </div>
        <div className="tr-who b">A</div>
      </div>
      <div className="tr-chips">
        <Compass size={16} className="tr-spin" />
        {['python', 'maths', 'hgg', 'exams'].map((k, n) => (
          <span key={k} className="tr-chip" style={{ ['--d' as string]: `${n * 0.18}s` }}>
            {t(`tour.demo.${k}`)}
          </span>
        ))}
      </div>
    </div>
  )
}

function SceneDraw(): React.JSX.Element {
  return (
    <div className="tr-s8">
      <svg viewBox="0 0 300 130" aria-hidden className="tr-draw">
        <path className="tr-p1" pathLength={1} d="M14 108 C 50 20, 90 20, 120 70 S 190 118, 226 36" />
        <path className="tr-p2" pathLength={1} d="M208 40 L228 32 L234 54" />
      </svg>
      <div className="tr-formula" dangerouslySetInnerHTML={{ __html: renderInline('$\\int_0^1 x^2\\,dx=\\frac{1}{3}$', 80) }} />
    </div>
  )
}

function SceneCustom({ t }: { t: (k: string) => string }): React.JSX.Element {
  return (
    <div className="tr-s9">
      <div className="tr-theme">
        <b>{t('tour.demo.theme')}</b>
        <span>{t('tour.demo.q')}</span>
        <div className="tr-sw">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="tr-keys">
        {[['Ctrl', 'K'], ['Ctrl', 'N'], ['?']].map((k, n) => (
          <span key={n} className="tr-kbd" style={{ ['--d' as string]: `${n * 0.5}s` }}>
            {k.map((c) => (
              <kbd key={c}>{c}</kbd>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}

function SceneFinish(): React.JSX.Element {
  return (
    <div className="tr-s10">
      {Array.from({ length: 22 }, (_, n) => (
        <i key={n} className="tr-conf" style={{ ['--x' as string]: `${(n * 37) % 100}%`, ['--d' as string]: `${(n % 7) * 0.35}s`, ['--c' as string]: n % 4, ['--s' as string]: `${8 + (n % 5) * 2}px` }} />
      ))}
      <div className="tr-logo">
        <Logo size={96} />
      </div>
    </div>
  )
}

export function Tour(): React.JSX.Element {
  const t = useT() as unknown as (k: string, vars?: Record<string, string | number>) => string
  const { setTour, patchSettings, openEditor, go, bump } = useStore()
  const [i, setI] = useState(0)

  const steps = useMemo<{ nav?: string; scene: ReactNode }[]>(
    () => [
      { scene: <SceneWelcome /> },
      { nav: 'new', scene: <SceneCreate t={t} /> },
      { nav: 'home', scene: <SceneReview t={t} /> },
      { scene: <SceneSpaced t={t} /> },
      { nav: 'quiz', scene: <SceneQuiz t={t} /> },
      { nav: 'assistant', scene: <SceneChat t={t} /> },
      { nav: 'packs', scene: <SceneShare t={t} /> },
      { scene: <SceneDraw /> },
      { nav: 'settings', scene: <SceneCustom t={t} /> },
      { scene: <SceneFinish /> }
    ],
    [t]
  )
  const last = i === steps.length - 1

  const finish = async (then?: () => void | Promise<void>): Promise<void> => {
    setTour(false)
    await patchSettings({ tourDone: true })
    await then?.()
  }
  const go2 = (n: number): void => setI(Math.max(0, Math.min(steps.length - 1, n)))

  // La zone de l'appli dont on parle brille dans la barre latérale.
  useEffect(() => {
    const nav = steps[i].nav
    const el = nav ? document.querySelector<HTMLElement>(`[data-nav="${nav}"]`) : null
    el?.classList.add('tour-hl')
    return () => el?.classList.remove('tour-hl')
  }, [i, steps])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        stop()
        if (last) void finish()
        else go2(i + 1)
      } else if (e.key === 'ArrowLeft') {
        stop()
        go2(i - 1)
      } else if (e.key === 'Escape') {
        stop()
        void finish()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, last])

  return (
    <div className="tr-overlay" role="dialog" aria-modal="true" aria-label={t('tour.aria')} data-testid="tour">
      <div className="tr-card">
        <button className="tr-x icon-btn" onClick={() => void finish()} aria-label={t('tour.skip')} title={t('tour.skip')}>
          <X size={18} />
        </button>
        <div className="tr-scene" key={`s${i}`}>
          {steps[i].scene}
        </div>
        <div className="tr-body" key={`b${i}`}>
          <div className="tr-step num">{t('tour.step', { n: i + 1, total: steps.length })}</div>
          <h2 data-testid="tour-title">{t(`tour.${i + 1}.t`)}</h2>
          <p>{t(`tour.${i + 1}.d`)}</p>
        </div>
        <div className="tr-foot">
          <div className="tr-dotsnav" role="tablist">
            {steps.map((_, n) => (
              <button key={n} className={n === i ? 'on' : n < i ? 'seen' : ''} onClick={() => go2(n)} aria-label={t('tour.step', { n: n + 1, total: steps.length })} />
            ))}
          </div>
          {last ? (
            <div className="tr-cta">
              <button className="btn" onClick={() => void finish(async () => {
                const id = await call('data.createSample')
                await bump()
                go({ name: 'deck', id })
              })}>
                {t('tour.cta.sample')}
              </button>
              <button className="btn btn-primary" onClick={() => void finish(() => openEditor({}))} data-testid="tour-cta">
                {t('tour.cta.card')}
              </button>
            </div>
          ) : (
            <div className="tr-cta">
              {i === 0 ? (
                <button className="btn btn-ghost" onClick={() => void finish()} data-testid="tour-skip">
                  {t('tour.skip')}
                </button>
              ) : (
                <button className="btn" onClick={() => go2(i - 1)}>
                  <ArrowLeft size={14} /> {t('tour.prev')}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => go2(i + 1)} data-testid="tour-next">
                {t('tour.next')} <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
