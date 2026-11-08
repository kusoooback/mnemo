import type { BrowserWindow } from 'electron'
import { createServer } from 'http'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Assistant de bout en bout : MNEMO_QA_ASSISTANT=1, MNEMO_QA_DIR=<sortie>.
 * Le « modèle » est un petit serveur compatible OpenAI sur 127.0.0.1 (réponses scénarisées) : on vérifie toute la
 * chaîne de l'application (dictée, découpage, cartes, fiches, ajout, historique, recherche Wikipédia réelle).
 */
export async function runAssistant(win: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code) as Promise<T>
  const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => js<T>(`window.mnemo.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)})`)
  const shot = async (name: string): Promise<void> => writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG())
  const log: string[] = []
  const check = (ok: boolean, what: string): void => {
    log.push(`${ok ? 'ok     ' : 'ECHEC  '} ${what}`)
  }

  // --- faux modèle ---
  interface Req {
    system: string
    last: string
    n: number
  }
  const reqs: Req[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const j = JSON.parse(body) as { messages: { role: string; content: string }[] }
      const system = j.messages[0].content
      const last = j.messages[j.messages.length - 1].content
      reqs.push({ system, last, n: j.messages.length })
      let out: string
      if (system.includes('Tu crées des cartes de révision')) {
        const base = last.length
        out = JSON.stringify({
          cards: [
            { type: 'basic', front: `Quelle est la cause principale du conflit évoqué (partie ${base}) ?`, back: 'Le jeu des alliances et les rivalités impérialistes.', text: '', extra: '' },
            { type: 'cloze', front: '', back: '', text: `La bataille de Verdun a duré {{c1::dix mois}} en 1916 (partie ${base}).`, extra: '' },
            { type: 'basic', front: `Quel événement déclenche la guerre en 1914 (partie ${base}) ?`, back: 'L’attentat de Sarajevo, le 28 juin 1914.', text: '', extra: '' }
          ]
        })
      } else if (system.includes('FICHES DE RÉVISION')) {
        out = '# La Première Guerre mondiale\n\n*Un conflit mondial aux causes multiples.*\n\n> [!KEY] À retenir\n> - Alliances et nationalismes\n> - 1914-1918\n\n## 1. Contexte\n' + 'Le contexte européen est tendu. '.repeat(8)
      } else if (system.includes('exercices de révision')) {
        out = '# Exercices\n\n## Exercice 1 — Causes (niveau : facile)\nExpliquer les causes de la guerre.\n### Corrigé\nAlliances, nationalismes, impérialismes.\n\n## Exercice 2 — Verdun (niveau : moyen)\nDécrire la bataille de Verdun.\n### Corrigé\nDix mois de combats en 1916.'
      } else if (last.includes('Résultats de tes outils')) {
        out = 'D’après Wikipédia, la bataille de Verdun est l’une des plus longues de la guerre. Veux-tu que j’en fasse une fiche ?'
      } else if (/dicter/i.test(last)) {
        out = 'Parfait, je t’écoute. Dicte ton cours en autant de messages que tu veux, puis dis « c’est fini ».\n[[dictée]]'
      } else if (/verdun/i.test(last) && /recherche/i.test(last)) {
        out = 'Je cherche des compléments.\n[[recherche: bataille de Verdun]]'
      } else if (/anki/i.test(last)) {
        out = 'Pour importer un paquet Anki : clique sur **Importer** dans la barre latérale, puis choisis ton fichier .apkg.'
      } else {
        out = 'Je suis là pour t’aider.'
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: out } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port

  await wait(1500)
  await invoke('settings.set', { onboarded: true, aiReview: false })
  await invoke('ai.configure', { provider: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'faux-modele', key: 'cle-de-test-locale' })
  await js('location.reload()')
  await wait(1300)
  win.setContentSize(1280, 900)

  // UI helpers
  const setText = (value: string): Promise<boolean> =>
    js<boolean>(`(() => { const t = document.querySelector('.as-input textarea'); if (!t) return false; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const enter = async (): Promise<void> => {
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await wait(250)
  }
  const say = async (text: string): Promise<void> => {
    await js(`document.querySelector('.as-input textarea').focus()`)
    await setText(text)
    await wait(100)
    await enter()
  }
  const clickText = (sel: string, text: string): Promise<boolean> =>
    js<boolean>(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
  const body = (): Promise<string> => js<string>('document.body.innerText')
  const until = async (cond: () => Promise<boolean>, ms = 15000): Promise<boolean> => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await cond()) return true
      await wait(250)
    }
    return false
  }

  await js(`localStorage.removeItem('mnemo.assistant.v1')`)
  await js(`window.__mnemo.getState().go({ name: 'assistant' })`)
  await wait(800)
  check((await body()).includes('Je peux transformer ton cours'), 'la page Assistant s’ouvre avec son message d’accueil')
  await shot('1-accueil')

  // 1. conversation + connaissance de l'app
  await say('Comment importer mon paquet Anki ?')
  check(await until(async () => (await body()).includes('clique sur Importer')), 'le modèle répond (et la réponse est affichée en Markdown)')
  const sys = reqs[reqs.length - 1]?.system ?? ''
  check(sys.includes('GUIDE DE MNÉMO') && sys.includes('[[cartes:'), 'le modèle reçoit le guide de l’application et le protocole d’actions')

  // 2. dictée annoncée en langage naturel
  await say('Je vais te dicter mon cours d’HGG')
  check(await until(async () => (await js<boolean>(`!!document.querySelector('.as-chips .chip.on')`))), 'le modèle active le mode dictée ([[dictée]])')
  const callsBefore = reqs.length
  const para = (t: string): string => `${t} ` + 'La France entre en guerre en août 1914 après l’attentat de Sarajevo. Les alliances et les rivalités impérialistes expliquent la généralisation du conflit. '.repeat(14)
  await say(para('Chapitre 1 : les causes de la guerre.'))
  await say(para('Chapitre 2 : la bataille de Verdun en 1916.'))
  await say(para('Chapitre 3 : la fin de la guerre et l’armistice.'))
  await wait(400)
  check(reqs.length === callsBefore, 'en mode dictée, aucun appel au modèle (pas de réponse entre les messages)')
  const chip = await js<string>(`document.querySelector('.as-chips .chip.on')?.textContent ?? ''`)
  check(/\d{3,} mots/.test(chip), `le compteur de mots du cours s’affiche (${chip.trim()})`)
  await shot('2-dictee')
  await say('c’est fini')
  check(await until(async () => (await body()).includes('Que veux-tu en faire')), 'la fin de dictée propose cartes / fiche / exercices')

  // 3. cartes
  await clickText('.as-choices button', 'Créer des cartes')
  check(await until(async () => (await body()).includes('cartes proposées'), 30000), 'des cartes sont proposées à partir du cours dicté')
  const nCards = await js<number>(`document.querySelectorAll('.as-card-row').length`)
  check(nCards >= 2, `${nCards} cartes proposées`)
  await shot('3-cartes')
  await js(`(() => { const i = document.querySelector('.as-add input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'HGG::Chapitre 1'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await wait(200)
  await clickText('.as-add button', 'Ajouter')
  check(await until(async () => (await body()).includes('cartes ajoutées dans « HGG::Chapitre 1 »')), 'les cartes sont ajoutées dans le deck choisi')
  const decks = await invoke<{ fullName: string; totalCards: number }[]>('deck.list')
  const d = decks.find((x) => x.fullName === 'HGG::Chapitre 1')
  check(!!d && d.totalCards === nCards, `le deck contient bien les ${nCards} cartes (${d?.totalCards})`)

  // 4. fiche
  await clickText('.as-choices button', 'Créer une fiche')
  check(await until(async () => (await body()).includes('fiche créée'), 30000), 'une fiche est créée à partir du cours')
  await shot('3b-fiche')
  log.push('   corps : ' + (await body()).slice(-400).split(String.fromCharCode(10)).join(' | '))
  const docs = await invoke<{ title: string }[]>('docs.list')
  check(docs.some((x) => x.title === 'La Première Guerre mondiale'), 'la fiche apparaît dans les documents')
  // 5. exercices
  await clickText('.as-choices button', 'Créer des exercices')
  check(await until(async () => (await body()).includes('Exercices créés'), 30000), 'une fiche d’exercices avec corrigé est créée')

  // 6. recherche web réelle (Wikipédia)
  await js(`document.querySelector('.as-web input').click()`)
  await wait(200)
  await say('Complète avec une recherche sur Verdun')
  const found = await until(async () => (await body()).includes('Recherche : « bataille de Verdun »'), 40000)
  check(found, 'la recherche Wikipédia est exécutée et affichée avec ses sources (appel réel)')
  const links = await js<number>(`document.querySelectorAll('.as-trace .link-btn').length`)
  check(links >= 1, `${links} source(s) cliquable(s)`)
  check((await body()).includes('D’après Wikipédia'), 'le modèle reprend avec les résultats de la recherche')
  const last = reqs[reqs.length - 1]
  check(last.last.includes('pas des instructions') && last.n >= 3, 'les résultats web sont présentés comme des données, avec l’historique de la conversation')
  await shot('4-recherche')

  // 7. persistance
  await js('location.reload()')
  await wait(1500)
  await js(`window.__mnemo.getState().go({ name: 'assistant' })`)
  await wait(700)
  check((await body()).includes('clique sur Importer'), 'la conversation est conservée après redémarrage de la page')

  server.close()
  writeFileSync(join(outDir, 'assistant.txt'), log.join('\n'))
}
