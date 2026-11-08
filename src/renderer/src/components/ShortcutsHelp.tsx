import { useT, type Key } from '../i18n'
import { shortcut } from '../lib/platform'
import { useStore } from '../store'
import { Modal } from './ui'

/** Les raccourcis qui existent vraiment (voir Review.tsx, Editor.tsx, DrawPad.tsx, App.tsx), regroupés par endroit. */
const GROUPS: { title: Key; rows: [string[], Key][] }[] = [
  {
    title: 'sc.general',
    rows: [
      [['Ctrl+K'], 'sc.palette'],
      [['Ctrl+N'], 'sc.newCard'],
      [['Ctrl+B'], 'sc.sidebar'],
      [['?'], 'sc.help']
    ]
  },
  {
    title: 'sc.review',
    rows: [
      [['Espace', 'Entrée'], 'sc.reveal'],
      [['1', '2', '3', '4'], 'sc.rate'],
      [['Z'], 'sc.undo'],
      [['E'], 'sc.edit'],
      [['S'], 'sc.suspend'],
      [['B'], 'sc.bury'],
      [['Échap'], 'sc.quit']
    ]
  },
  {
    title: 'sc.editor',
    rows: [
      [['Ctrl+Entrée'], 'sc.save'],
      [['Ctrl+B'], 'sc.bold'],
      [['Ctrl+I'], 'sc.italic'],
      [['Ctrl+Maj+C'], 'sc.cloze'],
      [['Ctrl+Maj+Alt+C'], 'sc.clozeSame']
    ]
  },
  {
    title: 'sc.draw',
    rows: [
      [['P', 'M', 'E'], 'sc.drawTools'],
      [['L', 'A', 'R', 'O', 'T'], 'sc.drawShapes'],
      [['Ctrl+Z'], 'sc.drawUndo'],
      [['Ctrl+Maj+Z'], 'sc.drawRedo']
    ]
  }
]

export function ShortcutsHelp(): React.JSX.Element {
  const t = useT()
  const setShortcuts = useStore((s) => s.setShortcuts)
  return (
    <Modal title={t('sc.title')} onClose={() => setShortcuts(false)} width={640}>
      <div className="sc-body">
        {GROUPS.map((g) => (
          <section key={g.title} className="sc-group">
            <h3 className="eyebrow">{t(g.title)}</h3>
            {g.rows.map(([keys, label]) => (
              <div key={label} className="sc-row">
                <span>{t(label)}</span>
                <span className="sc-keys">
                  {keys.map((k) => (
                    <kbd key={k} className="kbd">{shortcut(k)}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}
