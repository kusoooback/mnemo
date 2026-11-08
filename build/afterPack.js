// Signature « ad hoc » des builds Mac sans certificat Apple.
// Sans aucune signature, macOS sur puce Apple (M1 et suivantes) refuse d'ouvrir l'application (« est endommagée »).
// Avec une signature ad hoc elle s'ouvre après le geste habituel (clic droit › Ouvrir). Un vrai certificat
// (variables CSC_LINK / CSC_NAME) reprend la main : dans ce cas on ne fait rien ici.
const { execFileSync } = require('child_process')
const { join } = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  console.log(`  • signature ad hoc appliquée : ${app}`)
}
