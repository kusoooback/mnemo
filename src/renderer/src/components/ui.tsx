import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n'

export function Logo({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden>
      <rect width="512" height="512" rx="112" fill="#C6613F" />
      <g transform="translate(256 256)">
        <rect x="-104" y="-132" width="208" height="264" rx="40" transform="rotate(-11)" fill="#FAF9F5" opacity="0.38" />
        <rect x="-104" y="-132" width="208" height="264" rx="40" fill="#FAF9F5" />
        <path
          d="M-44 52V-18c0-18 12-28 28-28 15 0 26 10 26 28v70m0-70c0-18 12-28 28-28 15 0 26 10 26 28V52"
          transform="translate(4 8)"
          stroke="#C6613F"
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  className = '',
  width
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
  width?: number
}): React.JSX.Element {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal ${className}`} style={width ? { maxWidth: width } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

interface ConfirmOptions {
  title: string
  text: string
  confirmLabel: string
  danger?: boolean
}

/** Boîte de confirmation : `const [confirm, node] = useConfirm()` puis `if (await confirm({...}))`. */
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const t = useT()
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    []
  )
  const close = (v: boolean): void => {
    state?.resolve(v)
    setState(null)
  }
  const node = state ? (
    <Modal
      title={state.title}
      width={440}
      onClose={() => close(false)}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={() => close(false)}>
            {t('common.cancel')}
          </button>
          <button
            className={`btn ${state.danger ? 'btn-dark' : 'btn-primary'}`}
            autoFocus
            onClick={() => close(true)}
          >
            {state.confirmLabel}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <p className="confirm-text">{state.text}</p>
      </div>
    </Modal>
  ) : null
  return [confirm, node]
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onClick: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: (MenuItem | 'sep')[]
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) })
    const off = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [x, y, onClose])
  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon}
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    />
  )
}

/** Petit champ de saisie de texte dans une boîte de dialogue. */
export function PromptModal({
  title,
  label,
  hint,
  initial = '',
  confirmLabel,
  onSubmit,
  onClose
}: {
  title: string
  label: string
  hint?: string
  initial?: string
  confirmLabel: string
  onSubmit: (value: string) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [value, setValue] = useState(initial)
  const submit = (): void => {
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <Modal
      title={title}
      width={440}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!value.trim()} onClick={submit}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <label className="field-label">{label}</label>
        <input
          className="input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          onFocus={(e) => e.target.select()}
        />
        {hint && <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 8 }}>{hint}</p>}
      </div>
    </Modal>
  )
}
