// Ad-hoc sign the macOS app. Without a Developer ID we can't notarize, but
// Apple Silicon refuses to run binaries with a broken/missing signature, and
// electron-builder's packaging invalidates Electron's original one.
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing ${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
