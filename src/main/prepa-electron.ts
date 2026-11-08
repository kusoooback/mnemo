import { BrowserWindow, session } from 'electron'
import { getSecret, hasSecret, setSecret } from './secrets'
import { fetchHttp, login, normalizeBase, type Http } from './prepa'

const PARTITION = 'persist:cdp'

/** Toutes les requêtes vers le site partagent la même session : la connexion de l'élève est conservée comme dans un navigateur. */
export function electronHttp(): Http {
  const ses = session.fromPartition(PARTITION)
  return fetchHttp((url, init) => ses.fetch(url, init))
}

export const hasSavedLogin = (): boolean => hasSecret('prepa.login') && hasSecret('prepa.password')

export async function doLogin(base: string, id: string, password: string, remember: boolean): Promise<{ ok: boolean; message: string }> {
  const r = await login(electronHttp(), normalizeBase(base), id, password)
  if (r.ok && remember) {
    setSecret('prepa.login', id)
    setSecret('prepa.password', password)
  }
  return r
}

/** Reconnexion silencieuse avec les identifiants enregistrés (chiffrés par le système). */
export async function autoLogin(base: string): Promise<boolean> {
  const id = getSecret('prepa.login')
  const pw = getSecret('prepa.password')
  if (!id || !pw) return false
  try {
    return (await login(electronHttp(), normalizeBase(base), id, pw)).ok
  } catch {
    return false
  }
}

export async function logout(base: string): Promise<void> {
  setSecret('prepa.login', null)
  setSecret('prepa.password', null)
  try {
    await electronHttp().post(`${normalizeBase(base)}ajax.php`, { action: 'deconnexion' })
  } catch {
    /* hors ligne */
  }
  await session.fromPartition(PARTITION).clearStorageData()
}

/** Fenêtre de connexion sur le site lui-même : l'élève saisit ses identifiants chez le site, jamais chez nous. */
export function openLoginWindow(parent: BrowserWindow | null, base: string): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 980,
      height: 760,
      parent: parent ?? undefined,
      modal: !!parent,
      title: 'Connexion au Cahier de Prépa — ferme la fenêtre quand tu es connecté',
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true }
    })
    win.on('closed', () => resolve())
    void win.loadURL(normalizeBase(base))
  })
}
