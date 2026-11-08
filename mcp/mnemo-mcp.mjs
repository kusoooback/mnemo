#!/usr/bin/env node
/*
 * Serveur MCP de Mnémo : permet à Claude (Claude Code, Claude Desktop…) de créer des cartes et des fiches
 * directement dans Mnémo.
 *
 * - Aucune dépendance : un seul fichier, protocole MCP sur stdin/stdout.
 * - Il ne parle QU'À Mnémo, sur 127.0.0.1 (la « passerelle locale », à activer dans Mnémo :
 *   Réglages → Intégrations → Claude). Il ne contacte aucun serveur externe.
 * - Le port et le jeton sont lus dans le fichier bridge.json que Mnémo écrit dans son dossier de données.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const VERSION = '1.0.0'

function dataDirs() {
  if (process.env.MNEMO_DATA_DIR) return [process.env.MNEMO_DATA_DIR]
  if (process.platform === 'win32') return [join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Mnemo')]
  if (process.platform === 'darwin') return [join(homedir(), 'Library', 'Application Support', 'Mnemo')]
  return [join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Mnemo')]
}

function readBridge() {
  for (const dir of dataDirs()) {
    try {
      const b = JSON.parse(readFileSync(join(dir, 'bridge.json'), 'utf8'))
      if (b && b.port && b.token) return b
    } catch {
      /* fichier absent : Mnémo n'est pas lancé ou la connexion n'est pas activée */
    }
  }
  throw new Error(
    'Mnémo n’est pas joignable. Vérifie que l’application est ouverte et que la connexion est activée : Réglages → Intégrations → Claude → « Autoriser Claude à créer des cartes ».'
  )
}

async function api(method, path, body) {
  const b = readBridge()
  let res
  try {
    res = await fetch(`http://127.0.0.1:${b.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${b.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000)
    })
  } catch {
    throw new Error('Mnémo ne répond pas. Ouvre l’application (ou relance-la), puis réessaie.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
  return data
}

const INSTRUCTIONS = `Mnémo est une application de cartes mémoire (répétition espacée FSRS) locale. Tu peux y créer des cartes et des fiches de révision.

Marche à suivre pour un cours (par ex. de l'histoire-géographie) :
1. mnemo_list_decks pour voir les decks existants ; utilise des noms hiérarchiques « Matière::Chapitre » (ex. « HGG::Chapitre 3 - La Guerre froide »).
2. Pour un long cours, travaille chapitre par chapitre : une fiche (mnemo_create_sheet) puis les cartes (mnemo_add_cards) par lots de 20 à 60 cartes.
3. Avant d'ajouter beaucoup de cartes sur un sujet déjà traité, vérifie avec mnemo_search_cards. Les doublons exacts sont ignorés automatiquement.

Qualité des cartes (règles de la répétition espacée) :
- UNE seule idée par carte, question précise, réponse courte (une phrase ou une liste de 3-4 éléments maximum).
- Type « basic » : front = vraie question (« Quelle est la cause principale de… ? », « Définis… »), back = réponse. N'écris pas un paragraphe en réponse.
- Type « cloze » : text contient des trous {{c1::réponse}} ; garde 1 à 3 trous par carte, jamais toute la phrase masquée. Idéal pour dates, définitions, formules.
- Type « basic-reverse » : crée aussi la carte inverse (vocabulaire, couples notion/définition, auteur/œuvre).
- Dates, acteurs, lieux, causes, conséquences, définitions : prévois des cartes pour chaque catégorie. N'invente RIEN : n'utilise que ce que l'élève t'a dicté ; si un point est ambigu, demande ou signale-le au lieu de deviner.
- Écris dans la langue du cours. Formules : LaTeX entre $...$ (en ligne) ou $$...$$ (bloc). Markdown autorisé (gras, listes).
- Ajoute 1 à 3 « tags » utiles (chapitre, thème) pour retrouver les cartes.

Fiches (mnemo_create_sheet) : Markdown structuré, un titre « # … », des sections « ## … », et des encadrés au format
> [!DEFINITION] Titre
> Texte…
Types d'encadrés : KEY (à retenir), DEFINITION, THEOREM, PROPERTY, METHOD, WARNING (piège), EXAMPLE, NOTE. Une bonne fiche tient sur 1 à 2 pages : plan, notions clés, dates/chiffres, mots de vocabulaire.

À la fin, résume à l'élève ce qui a été créé (nombre de cartes, decks, fiches).`

const cardSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['basic', 'basic-reverse', 'cloze'], description: 'basic (défaut), basic-reverse ou cloze (si « text » est fourni).' },
    front: { type: 'string', description: 'Question (basic / basic-reverse).' },
    back: { type: 'string', description: 'Réponse courte (basic / basic-reverse).' },
    text: { type: 'string', description: 'Phrase avec trous {{c1::mot}} (cloze).' },
    extra: { type: 'string', description: 'Complément affiché après la réponse (facultatif).' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Étiquettes (facultatif).' }
  }
}

const TOOLS = [
  {
    name: 'mnemo_status',
    description: 'Vérifie que Mnémo est ouvert et connecté ; renvoie la version et le nombre de decks.',
    inputSchema: { type: 'object', properties: {} },
    run: () => api('GET', '/v1/status')
  },
  {
    name: 'mnemo_list_decks',
    description: 'Liste les decks de Mnémo (nom complet « Matière::Chapitre », nombre de cartes).',
    inputSchema: { type: 'object', properties: {} },
    run: () => api('GET', '/v1/decks')
  },
  {
    name: 'mnemo_create_deck',
    description: 'Crée un deck (ou sous-deck avec « Parent::Enfant »). Sans effet s’il existe déjà.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: (a) => api('POST', '/v1/decks', { name: a.name })
  },
  {
    name: 'mnemo_add_cards',
    description:
      'Ajoute des cartes dans un deck (créé s’il n’existe pas). 500 cartes maximum par appel. Les doublons exacts sont ignorés. Renvoie le nombre ajouté et les erreurs éventuelles par carte.',
    inputSchema: {
      type: 'object',
      properties: {
        deck: { type: 'string', description: 'Nom complet du deck, ex. « HGG::Chapitre 2 ».' },
        cards: { type: 'array', items: cardSchema },
        skip_duplicates: { type: 'boolean', description: 'Ignorer les doublons exacts (défaut : oui).' }
      },
      required: ['deck', 'cards']
    },
    run: (a) => api('POST', '/v1/cards', { deck: a.deck, cards: a.cards, skip_duplicates: a.skip_duplicates })
  },
  {
    name: 'mnemo_create_sheet',
    description: 'Crée une fiche de révision (Markdown) dans « Fiches » de Mnémo. Syntaxe des encadrés : > [!KEY] Titre.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        markdown: { type: 'string', description: 'Contenu de la fiche en Markdown.' },
        subject: { type: 'string', description: 'Matière / dossier de rangement (défaut : Fiches).' }
      },
      required: ['title', 'markdown']
    },
    run: (a) => api('POST', '/v1/sheets', { title: a.title, markdown: a.markdown, subject: a.subject })
  },
  {
    name: 'mnemo_search_cards',
    description: 'Cherche des cartes existantes (texte libre, deck facultatif) pour éviter les doublons ou compléter un chapitre.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, deck: { type: 'string' }, limit: { type: 'number' } },
      required: ['query']
    },
    run: (a) => {
      const p = new URLSearchParams({ q: a.query })
      if (a.deck) p.set('deck', a.deck)
      if (a.limit) p.set('limit', String(a.limit))
      return api('GET', `/v1/search?${p}`)
    }
  }
]

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')

async function handle(req) {
  const { id, method, params } = req
  const reply = (result) => id !== undefined && send({ id, result })
  const fail = (code, message) => id !== undefined && send({ id, error: { code, message } })
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'mnemo', version: VERSION },
        instructions: INSTRUCTIONS
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name)
      if (!tool) return fail(-32602, `Outil inconnu : ${params?.name}`)
      try {
        const out = await tool.run(params.arguments || {})
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })
      } catch (e) {
        return reply({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] })
      }
    }
    default:
      if (method?.startsWith('notifications/')) return
      return fail(-32601, `Méthode inconnue : ${method}`)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return send({ id: null, error: { code: -32700, message: 'JSON invalide' } })
  }
  void handle(req)
})
rl.on('close', () => process.exit(0))
