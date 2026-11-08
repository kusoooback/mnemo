import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/*
 * Les pages visitées restent en vie, simplement cachées, quand on change d'écran : ce qu'on était en train d'écrire
 * (texte de génération, discussion, filtres, quiz en cours…) est encore là au retour. Seules les pages qu'on a
 * annulées ou quittées volontairement repartent de zéro, car elles s'en chargent elles-mêmes.
 */

interface PageState {
  /** Vrai quand la page est celle qu'on voit. */
  active: boolean
  /** Augmente à chaque retour sur la page : sert à rafraîchir des données qui ont pu changer entre-temps. */
  shown: number
}

const PageContext = createContext<PageState>({ active: true, shown: 0 })

/** État de la page courante dans le système de pages gardées en vie. */
export const usePage = (): PageState => useContext(PageContext)

/** Les pages qu'on garde : au plus `max` écrans paramétrés (decks, documents) à la fois. */
export function pruneKept(keys: string[], activeKey: string, max = 4): string[] {
  const param = keys.filter((k) => k.includes(':'))
  const drop = new Set(param.slice(0, Math.max(0, param.length - max)).filter((k) => k !== activeKey))
  return keys.filter((k) => !drop.has(k))
}

export function KeptPage({ active, hidden, children }: { active: boolean; hidden?: boolean; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  const activeRef = useRef(active)
  const [shown, setShown] = useState(0)
  const was = useRef(active)

  useLayoutEffect(() => {
    activeRef.current = active
    if (active && !was.current) {
      setShown((n) => n + 1)
      // Retrouve la position de défilement d'avant le départ.
      if (ref.current) ref.current.scrollTop = scroll.current
    }
    was.current = active
  }, [active])

  return (
    <PageContext.Provider value={{ active, shown }}>
      <div
        ref={ref}
        className={active ? 'main-scroll' : 'main-kept'}
        hidden={active ? hidden : true}
        onScroll={(e) => {
          if (activeRef.current) scroll.current = e.currentTarget.scrollTop
        }}
      >
        {children}
      </div>
    </PageContext.Provider>
  )
}
