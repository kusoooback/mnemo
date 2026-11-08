import { FileDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { call } from '../api'
import { useT } from '../i18n'
import { buildPdfCss } from '../lib/pdf'
import { useStore } from '../store'

/** « Exporter en PDF » : la fiche part dans une vraie page A4 (voir exportpdf.ts), pas dans une capture de l'écran. */
export function PdfButton({ title, subtitle, html, size = 'sm' }: { title: string; subtitle: string; html: string; size?: 'sm' | 'md' }): React.JSX.Element {
  const t = useT()
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  return (
    <button
      className={`btn ${size === 'sm' ? 'btn-sm' : ''}`}
      disabled={busy || !html.trim()}
      onClick={async () => {
        setBusy(true)
        try {
          const path = await call('docs.exportPdf', title, subtitle, html, buildPdfCss())
          if (path) toast(t('pdf.done'), { action: { label: t('pdf.show'), run: () => void call('app.reveal', path) } })
        } catch (e) {
          toast((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'error' })
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 size={14} className="spin" /> : <FileDown size={14} />}
      {t('pdf.export')}
    </button>
  )
}
