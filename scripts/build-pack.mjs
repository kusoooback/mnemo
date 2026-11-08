#!/usr/bin/env node
/*
 * Construit les paquets du catalogue communautaire à partir des sources lisibles de community/src/*.json.
 *
 *   node scripts/build-pack.mjs            # (re)génère community/packs/*.mnemodeck et community/index.json
 *   node scripts/build-pack.mjs --check    # échoue si les paquets publiés ne correspondent pas aux sources
 *
 * Sans dépendance : seulement Node. Le résultat est reproductible (même source = même empreinte).
 * Format d'une source : voir community/README.md.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'community')
const src = join(root, 'src')
const out = join(root, 'packs')
const check = process.argv.includes('--check')
const KINDS = new Set(['basic', 'basic-reverse', 'cloze', 'typed'])
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function toNote(n, where) {
  const kind = n.k
  if (!KINDS.has(kind)) fail(`${where} : type de carte inconnu « ${kind} »`)
  const deck = typeof n.d === 'string' ? n.d.trim() : ''
  // Carte à trous : `t` est le texte, les étiquettes sont dans `tg`. Autres cartes : les étiquettes sont dans `t`.
  const tags = (kind === 'cloze' ? n.tg : n.t) ?? []
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) fail(`${where} : les étiquettes doivent être une liste de textes`)
  let fields
  if (kind === 'cloze') {
    if (typeof n.t !== 'string' || !/\{\{c\d+::/.test(n.t)) fail(`${where} : une carte à trous doit contenir {{c1::…}}`)
    fields = { text: n.t, extra: typeof n.e === 'string' ? n.e : '' }
  } else {
    if (typeof n.f !== 'string' || !n.f.trim() || typeof n.b !== 'string' || !n.b.trim()) fail(`${where} : recto (f) et verso (b) obligatoires`)
    fields = { front: n.f, back: n.b }
  }
  return { kind, fields, tags, deck }
}

mkdirSync(out, { recursive: true })
const index = []
let bad = 0
for (const file of readdirSync(src).filter((f) => f.endsWith('.json')).sort()) {
  const s = JSON.parse(readFileSync(join(src, file), 'utf8'))
  if (!ID_RE.test(s.id ?? '')) fail(`${file} : identifiant invalide (minuscules, chiffres et tirets)`)
  if (!Array.isArray(s.notes) || !s.notes.length) fail(`${file} : aucune carte`)
  const notes = s.notes.map((n, i) => toNote(n, `${file} carte ${i + 1}`))
  const seen = new Set()
  for (const n of notes) {
    const key = (n.kind === 'cloze' ? n.fields.text : n.fields.front).trim().toLowerCase()
    if (seen.has(key)) fail(`${file} : carte en double « ${key.slice(0, 50)} »`)
    seen.add(key)
  }
  const pack = { format: 1, app: 'mnemo', name: s.title, description: s.description ?? '', author: s.author ?? '', created: 0, notes, media: {} }
  const buf = Buffer.concat([Buffer.from('MNDK1\n'), gzipSync(Buffer.from(JSON.stringify(pack), 'utf8'), { level: 9 })])
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const target = join(out, `${s.id}.mnemodeck`)
  if (check) {
    if (!existsSync(target) || createHash('sha256').update(readFileSync(target)).digest('hex') !== sha256) {
      console.error(`✗ ${s.id} : le paquet publié ne correspond pas à sa source (relance « node scripts/build-pack.mjs »)`)
      bad++
    }
  } else {
    writeFileSync(target, buf)
  }
  index.push({ id: s.id, title: s.title, description: s.description ?? '', author: s.author ?? '', lang: s.lang === 'en' ? 'en' : 'fr', tags: s.tags ?? [], notes: notes.length, sha256 })
  console.log(`${check ? '·' : '✓'} ${s.id} : ${notes.length} cartes (${buf.length} octets)`)
}
const indexJson = `${JSON.stringify({ version: 1, packs: index }, null, 2)}\n`
const indexPath = join(root, 'index.json')
if (check) {
  if (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== indexJson) {
    console.error('✗ index.json n’est pas à jour')
    bad++
  }
  if (bad) process.exit(1)
  console.log('Catalogue cohérent.')
} else {
  writeFileSync(indexPath, indexJson)
}
