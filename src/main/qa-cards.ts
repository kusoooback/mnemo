import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { aiCardsFromText, aiConfigure, aiStatus, aiSummarize, readDocument } from './ai'
import { triageDocument } from './triage'

/**
 * Qualité réelle du modèle sur un vrai document : MNEMO_QA_CARDS=1, MNEMO_QA_PDF=<fichier>, MNEMO_QA_MODEL=<light|balanced|best>.
 * Écrit le texte extrait, le tri, les cartes brutes et celles qui passent le contrôle.
 */
export async function runCards(_win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const file = process.env.MNEMO_QA_PDF as string
  const title = (file.split(/[\\/]/).pop() as string).replace(/\.[a-z]+$/i, '')
  const out: string[] = []
  const t0 = Date.now()
  const text = await readDocument(file)
  out.push(`== TEXTE EXTRAIT (${text.length} caractères, ${Date.now() - t0} ms)\n${text.slice(0, 1800)}\n`)
  aiConfigure({ provider: 'builtin', model: process.env.MNEMO_QA_MODEL || 'light' })
  out.push(`== IA prête : ${aiStatus().ready} (${aiStatus().model})`)
  try {
  if (aiStatus().ready) {
    const t1 = Date.now()
    const tr = await triageDocument({ title, subject: 'Mathématiques', folder: 'Distanciel', text }, [])
    out.push(`== TRI : ${JSON.stringify(tr)} (${Date.now() - t1} ms)`)
    const show = (label: string, cards: { kind: string; front: string; back: string; text: string }[], ms: number): void => {
      out.push(`== ${label} : ${cards.length} (${ms} ms)`)
      for (const c of cards) out.push(c.kind === 'cloze' ? `  [trou] ${c.text}` : `  ${c.front}  ->  ${c.back}`)
    }
    const t2 = Date.now()
    show('CARTES DU COURS (pipeline complet)', await aiCardsFromText(text.slice(0, 6000), 8, 'fr', `Document « ${title} » (Mathématiques).`), Date.now() - t2)
    const t3 = Date.now()
    show('CARTES SUR UN SUJET (sans document)', await aiCardsFromText('Sujet : les suites arithmétiques et géométriques', 6, 'fr', ''), Date.now() - t3)
    const t4 = Date.now()
    out.push(`
== FICHE (${Date.now() - t4} ms)
${await aiSummarize(title, text.slice(0, 8000))}`)
  }
  } catch (e) {
    out.push('ERREUR : ' + ((e as Error).stack ?? String(e)))
  }
  writeFileSync(join(outDir, 'cards.txt'), out.join('\n'))
}
