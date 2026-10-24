// Runs after electron-builder packs the app, before the installer is made.
//  1. Electron fuses: harden the binary. It can't be run as plain Node or
//     debugged through Node flags, and only loads its code from app.asar.
//  2. macOS: drop Chromium's language packs except English (about 40 MB).
//     electron-builder's electronLanguages only trims them on Windows; on
//     macOS they live inside Electron Framework.framework.
//  3. macOS: ad-hoc sign. Without a Developer ID we can't notarize, but Apple
//     Silicon refuses to run binaries with a broken/missing signature, and
//     packaging (and the fuses) invalidate Electron's original one.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

exports.default = async function (context) {
  const name = context.packager.appInfo.productFilename
  const mac = context.electronPlatformName === 'darwin'
  const app = path.join(context.appOutDir, `${name}.app`)
  const binary = mac
    ? path.join(app, 'Contents', 'MacOS', name)
    : path.join(context.appOutDir, context.electronPlatformName === 'win32' ? `${name}.exe` : context.packager.executableName)

  console.log(`  • flipping fuses on ${binary}`)
  await flipFuses(binary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: mac, // re-signed below anyway
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })

  if (!mac) return
  const res = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources')
  const keep = new Set(['en.lproj', 'en_GB.lproj'])
  const drop = fs.readdirSync(res).filter((f) => f.endsWith('.lproj') && !keep.has(f))
  for (const f of drop) fs.rmSync(path.join(res, f), { recursive: true, force: true })
  console.log(`  • removed ${drop.length} language packs (kept ${[...keep].join(', ')})`)

  console.log(`  • ad-hoc signing ${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
