import { BrainCircuit, CloudUpload, Upload } from 'lucide-react'
import { call } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'
import { Logo, Modal } from './ui'

/** Premier lancement : trois étapes optionnelles, chacune passable sans conséquence. */
export function Onboarding(): React.JSX.Element {
  const t = useT()
  const { setOnboarding, patchSettings, go, bump, openImport } = useStore()
  const finish = async (): Promise<void> => {
    setOnboarding(false)
    await patchSettings({ onboarded: true })
  }
  const steps = [
    { icon: <Upload size={20} />, title: t('ob.step1'), desc: t('ob.step1.d'), run: async () => {
        await finish()
        openImport({})
      } },
    { icon: <CloudUpload size={20} />, title: t('ob.step2'), desc: t('ob.step2.d'), run: async () => {
        await finish()
        go({ name: 'sync' })
      } },
    { icon: <BrainCircuit size={20} />, title: t('ob.step3'), desc: t('ob.step3.d'), run: async () => {
        await finish()
        go({ name: 'integrations' })
      } }
  ]
  return (
    <Modal title={t('ob.title')} onClose={() => void finish()} width={560}>
      <div className="modal-body">
        <div className="row" style={{ gap: 14, marginBottom: 16 }}>
          <Logo size={44} />
          <p className="muted">{t('ob.sub')}</p>
        </div>
        {steps.map((s, i) => (
          <div key={i} className="card card-pad row" style={{ marginBottom: 10, boxShadow: 'none' }}>
            <span style={{ color: 'var(--accent)' }}>{s.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{s.title}</div>
              <div className="muted" style={{ fontSize: '0.8125rem' }}>{s.desc}</div>
            </div>
            <button className="btn btn-sm" onClick={() => void s.run()}>{t('ob.go')}</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 18 }}>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              const id = await call('data.createSample')
              await bump()
              await finish()
              go({ name: 'deck', id })
            }}
          >
            {t('ob.sample')}
          </button>
          <span className="spacer" />
          <button className="btn btn-dark" onClick={() => void finish()}>{t('ob.skip')}</button>
        </div>
      </div>
    </Modal>
  )
}
