// Signature « ad hoc » des builds Mac sans certificat Apple.
// Sans aucune signature, macOS sur puce Apple (M1 et suivantes) refuse d'ouvrir l'application (« est endommagée »).
// Avec une signature ad hoc elle s'ouvre après le geste habituel (clic droit › Ouvrir). Un vrai certificat
// (variables CSC_LINK / CSC_NAME) reprend la main : dans ce cas on ne fait rien ici.
const { execFileSync } = require('child_process')
const { join } = require('path')
const { existsSync, readdirSync, rmSync } = require('fs')

// better-sqlite3 embarque ses binaires pour toutes les plateformes (~17 Mo) : on ne garde que celle de ce paquet.
function prunePrebuilds(context) {
  const plat = context.electronPlatformName
  const res = plat === 'darwin' ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : join(context.appOutDir, 'resources')
  const dir = join(res, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds')
  if (!existsSync(dir)) return
  const keep = plat === 'win32' ? (n) => n === 'win32-x64.node' : plat === 'darwin' ? (n) => n.startsWith('darwin-') : (n) => n.startsWith('linux-')
  for (const n of readdirSync(dir)) if (!keep(n)) rmSync(join(dir, n), { force: true })
}

exports.default = async function afterPack(context) {
  prunePrebuilds(context)
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  console.log(`  • signature ad hoc appliquée : ${app}`)
}
