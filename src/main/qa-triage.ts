import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDb } from './db'
import { findDuplicate } from './dedupe'
import { triageDocument } from './triage'

/** Tri (règles uniquement) de tous les documents d'une base copiée : MNEMO_QA_TRIAGE=1, MNEMO_USER_DATA=<copie>. */
export async function runTriage(_win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const db = getDb()
  const rows = db.prepare('SELECT id, title, subject, folder, text, hash, added_at FROM document WHERE deleted_at IS NULL ORDER BY subject, folder, title').all() as {
    id: string
    title: string
    subject: string
    folder: string
    text: string
    hash: string
    added_at: number
  }[]
  const lines: string[] = []
  const count: Record<string, number> = {}
  for (const r of rows) {
    const t = await triageDocument({ title: r.title, subject: r.subject, folder: r.folder, text: r.text }, [])
    const dup = r.text.length > 250 ? findDuplicate(db, { id: r.id, subject: r.subject, hash: r.hash, text: r.text, before: r.added_at }) : null
    const cat = dup ? 'doublon' : t.category
    count[cat] = (count[cat] ?? 0) + 1
    lines.push(`${cat.padEnd(11)} ${r.subject} / ${r.folder || '-'} / ${r.title}  → chapitre « ${t.chapter} » (${t.by})${dup ? `  [copie de « ${dup.title} »]` : ''}`)
  }
  writeFileSync(join(outDir, 'triage.txt'), `${JSON.stringify(count)}\n${lines.join('\n')}`)
}
