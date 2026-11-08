import { renderInline } from '../lib/render'

/** Texte d'une carte sur une ligne, avec de vraies formules (jamais de « $x^2$ » brut). */
export function Inline({ text, max = 120, className }: { text: string; max?: number; className?: string }): React.JSX.Element {
  return <span className={`inl ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: renderInline(text, max) }} />
}
