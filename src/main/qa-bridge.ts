import { app, type BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Connexion de Claude de bout en bout : MNEMO_QA_BRIDGE=1, MNEMO_QA_DIR=<sortie>.
 * On active la passerelle depuis l'interface, puis un vrai serveur MCP (lancé comme dans l'application installée :
 * le binaire d'Electron en mode Node) crée des cartes et une fiche.
 */
export async function runBridge(win: BrowserWindow, outDir: string): Promise<void> {
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
  const bridgeFile = join(app.getPath('userData'), 'bridge.json')

  await wait(1500)
  await invoke('settings.set', { onboarded: true })
  await js('location.reload()')
  await wait(1300)
  win.setContentSize(1280, 1000)

  await js(`window.__mnemo.getState().go({ name: 'integrations' })`)
  await wait(800)
  check(!existsSync(bridgeFile), 'par défaut : la passerelle est fermée (aucun bridge.json)')
  const before = await invoke<{ enabled: boolean; running: boolean }>('bridge.status')
  check(!before.enabled && !before.running, 'par défaut : désactivée')

  // Le vrai interrupteur de l'interface.
  const clicked = await js<boolean>(`(() => { const sw = document.querySelector('[aria-label="Autoriser Claude à créer des cartes"]'); if (!sw) return false; sw.click(); return true })()`)
  check(clicked, 'l’interrupteur « Autoriser Claude à créer des cartes » existe et se clique')
  await wait(900)
  check(existsSync(bridgeFile), 'après activation : bridge.json existe')
  const text = await js<string>('document.body.innerText')
  check(text.includes('claude mcp add mnemo'), 'la commande à copier est affichée')
  check(text.includes('mcpServers'), 'la config Claude Desktop est affichée')
  await js(`[...document.querySelectorAll('.set-group h2')].find(h => h.textContent.includes('Claude'))?.scrollIntoView()`)
  await wait(300)
  await shot('integrations-claude')

  // Vrai serveur MCP, lancé comme le fera Claude.
  const script = join(app.getAppPath(), 'mcp', 'mnemo-mcp.mjs')
  const child = spawn(process.execPath, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MNEMO_DATA_DIR: app.getPath('userData') } })
  const lines: Record<string, any>[] = []
  let buf = ''
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    let i = buf.indexOf('\n')
    while (i >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)))
      buf = buf.slice(i + 1)
      i = buf.indexOf('\n')
    }
  })
  const rpc = async (id: number, method: string, params?: unknown): Promise<Record<string, any>> => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    for (let t = 0; t < 100; t++) {
      const hit = lines.find((l) => l.id === id)
      if (hit) return hit
      await wait(50)
    }
    throw new Error('pas de réponse du serveur MCP')
  }
  try {
    await rpc(1, 'initialize', { protocolVersion: '2025-06-18' })
    const st = await rpc(2, 'tools/call', { name: 'mnemo_status', arguments: {} })
    check(!st.result.isError, 'MCP : mnemo_status répond')
    const add = await rpc(3, 'tools/call', {
      name: 'mnemo_add_cards',
      arguments: {
        deck: 'HGG::Chapitre 1 - La Grande Guerre',
        cards: [
          { front: 'Quelle date marque l’entrée en guerre de la France en 1914 ?', back: 'Le 3 août 1914 (déclaration de guerre allemande).', tags: ['hgg', 'guerre'] },
          { text: 'La bataille de Verdun dure de février à {{c1::décembre 1916}}.' },
          { type: 'basic-reverse', front: 'Poilu', back: 'Surnom du soldat français de 14-18' }
        ]
      }
    })
    const added = JSON.parse(add.result.content[0].text).added
    check(added === 3, `MCP : 3 cartes ajoutées (${added})`)
    const sheet = await rpc(4, 'tools/call', {
      name: 'mnemo_create_sheet',
      arguments: { title: 'La Grande Guerre (1914-1918)', markdown: '## Causes\n> [!KEY] À retenir\n> Alliances, nationalismes, course aux armements.\n\n## Dates\n- 28 juin 1914 : attentat de Sarajevo\n- 11 novembre 1918 : armistice' }
    })
    check(!sheet.result.isError, 'MCP : fiche créée')
  } finally {
    child.kill()
  }

  await wait(700)
  const decks = await invoke<{ fullName: string; totalCards: number }[]>('deck.list')
  const d = decks.find((x) => x.fullName === 'HGG::Chapitre 1 - La Grande Guerre')
  check(!!d && d.totalCards === 4, `le deck existe dans l'application avec 4 cartes (${d?.totalCards})`)
  const docs = await invoke<{ title: string; subject: string; ext: string }[]>('docs.list')
  check(docs.some((x) => x.title === 'La Grande Guerre (1914-1918)' && x.subject === 'Fiches' && x.ext === 'md'), 'la fiche apparaît dans « Mes documents »')

  await js(`window.__mnemo.getState().go({ name: 'library' })`)
  await wait(900)
  await shot('library')
  await js(`window.__mnemo.getState().go({ name: 'sheets' })`)
  await wait(900)
  await shot('sheets')

  // Fermeture : plus de jeton sur le disque.
  await js(`window.__mnemo.getState().go({ name: 'integrations' })`)
  await wait(600)
  await js(`document.querySelector('[aria-label="Autoriser Claude à créer des cartes"]')?.click()`)
  await wait(700)
  check(!existsSync(bridgeFile), 'après désactivation : bridge.json supprimé')
  const after = await invoke<{ enabled: boolean; running: boolean }>('bridge.status')
  check(!after.enabled && !after.running, 'après désactivation : fermée')

  writeFileSync(join(outDir, 'bridge.txt'), log.join('\n'))
}
