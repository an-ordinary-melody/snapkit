// Sparkle end to end: an older build finds a newer one in a local appcast, downloads it, checks its
// EdDSA signature, and replaces itself when it quits. Uses a throwaway key (e2e/ed25519.swift) and
// copies of the debug app in a temp folder (never ~/Desktop: no folder-access prompts).
// Usage: node mac/e2e/sparkle-update.mjs
import { execFileSync, spawnSync } from 'child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const mac = resolve(import.meta.dirname, '..')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: mac, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const plist = (app, ...cmd) => run('/usr/libexec/PlistBuddy', ...cmd.map((c) => ['-c', c]), join(app, 'Contents/Info.plist'))
const set = (app, key, type, value) => {
  spawnSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, join(app, 'Contents/Info.plist')])
  run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, join(app, 'Contents/Info.plist')])
}
const version = (app) => run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', join(app, 'Contents/Info.plist')]).trim()

console.log('building…')
run('scripts/build-app.sh', [])
run('swift', ['build', '--product', 'snapkitctl'])
const ctl = join(run('swift', ['build', '--show-bin-path']).trim(), 'snapkitctl')

const root = mkdtempSync(join(tmpdir(), 'snapkit-sparkle-'))
const results = []
const check = (ok, label, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : `  (${detail})`}`)
}
const server = createServer((req, res) => {
  const f = join(root, 'feed', req.url.replace(/^\//, ''))
  if (!existsSync(f)) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Length': statSync(f).size }).end(readFileSync(f))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const feed = `http://127.0.0.1:${server.address().port}`

try {
  run('mkdir', ['-p', join(root, 'feed'), join(root, 'keys'), join(root, 'new')])
  run('swift', ['e2e/ed25519.swift', 'keygen', join(root, 'keys')])
  const pub = readFileSync(join(root, 'keys/public.b64'), 'utf8').trim()

  // The installed (old) app and the new one: the same build with versions 1.0.0 and 1.0.1.
  const make = (path, v) => {
    cpSync(join(mac, 'build/Snapkit Dev.app'), path, { recursive: true, verbatimSymlinks: true })
    set(path, 'CFBundleVersion', 'string', v)
    set(path, 'CFBundleShortVersionString', 'string', v)
    set(path, 'SUFeedURL', 'string', `${feed}/appcast.xml`)
    set(path, 'SUPublicEDKey', 'string', pub)
    set(path, 'SUEnableAutomaticChecks', 'bool', 'false')
    run('codesign', ['-f', '-s', '-', '-o', 'runtime', '--entitlements', join(mac, 'Snapkit.entitlements'), path])
  }
  const app = join(root, 'Snapkit Dev.app')
  make(app, '1.0.0')
  make(join(root, 'new/Snapkit Dev.app'), '1.0.1')
  const zip = join(root, 'feed/Snapkit.zip')
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', join(root, 'new/Snapkit Dev.app'), zip])
  const appcast = (signature) => writeFileSync(join(root, 'feed/appcast.xml'), `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Snapkit</title>
    <item>
      <title>1.0.1</title>
      <sparkle:version>1.0.1</sparkle:version>
      <sparkle:shortVersionString>1.0.1</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <enclosure url="${feed}/Snapkit.zip" length="${statSync(zip).size}" type="application/octet-stream" sparkle:edSignature="${signature}"/>
    </item>
  </channel>
</rss>
`)

  // Start the old one (isolated profile, test screen so nothing needs Screen Recording).
  const profile = join(root, 'profile')
  const state = join(root, 'state.json')
  run('mkdir', ['-p', profile])
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' } }))
  run(ctl, ['make-screen', join(root, 'screen.png')])
  const log = join(process.env.HOME, 'Library/Logs/Snapkit Dev/main.log')
  const launch = async () => {
    spawnSync('pkill', ['-f', 'Snapkit Dev.app/Contents/MacOS/Snapkit'])
    rmSync(state, { force: true })
    spawnSync('open', ['-n', app, '--args', '-SnapkitTestScreen', join(root, 'screen.png'), '-SnapkitProfile', profile, '-SnapkitTestOut', state,
      '-SnapkitTestPasteboard', 'com.charios.snapkit.dev.sparkle'])
    for (let i = 0; i < 30 && !existsSync(state); i++) {
      run(ctl, ['state', '--wait', '200'])
      await wait(200)
    }
  }
  /** Check in the background, let it download, quit; the version on disk afterwards. */
  const updateAndQuit = async (until) => {
    rmSync(state, { force: true })
    const mark = existsSync(log) ? readFileSync(log, 'utf8').length : 0
    run(ctl, ['sparkle-background', '--wait', '500'])
    const usesSparkle = existsSync(state) && JSON.parse(readFileSync(state, 'utf8')).sparkle === true
    let found = ''
    for (let i = 0; i < 60 && !found; i++) {
      await wait(500)
      found = (readFileSync(log, 'utf8').slice(mark).match(/\[updates\] Sparkle: .*/) ?? [''])[0]
    }
    await wait(4000) // download and signature check
    rmSync(state, { force: true })
    run(ctl, ['state', '--wait', '500'])
    const menu = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')).menu ?? [] : []
    run(ctl, ['quit', '--wait', '500'])
    let v = ''
    for (let i = 0; i < 20 && v !== until; i++) {
      await wait(500)
      try { v = version(app) } catch { v = '' }
    }
    return { usesSparkle, found, v, menu }
  }

  // A download whose signature doesn't match (signed with another key) is refused.
  run('mkdir', ['-p', join(root, 'other')])
  run('swift', ['e2e/ed25519.swift', 'keygen', join(root, 'other')])
  appcast(run('swift', ['e2e/ed25519.swift', 'sign', join(root, 'other/private.b64'), zip]).trim())
  await launch()
  check(version(app) === '1.0.0', 'the installed app is 1.0.0')
  let r = await updateAndQuit('1.0.1')
  check(r.usesSparkle, 'the app uses Sparkle when the build has a feed and key')
  check(r.v === '1.0.0', 'an update signed with another key is refused (still 1.0.0)', r.v)

  // Packaged by the release script (Sparkle's own sign_update) with the app's key: installed when
  // Snapkit quits.
  execFileSync(join(mac, 'scripts/sparkle-release.sh'), [join(root, 'new/Snapkit Dev.app'), join(root, 'feed'), feed], {
    cwd: mac, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SPARKLE_PRIVATE_KEY: readFileSync(join(root, 'keys/private.b64'), 'utf8').trim() }
  })
  check(/Snapkit-1\.0\.1\.zip/.test(readFileSync(join(root, 'feed/appcast.xml'), 'utf8')), 'the release script writes the zip and appcast')
  await launch()
  r = await updateAndQuit('1.0.1')
  check(/available 1\.0\.1/.test(r.found), 'Sparkle finds 1.0.1 in the appcast', r.found || 'nothing logged')
  check(r.menu.some((t) => /^Update available: 1\.0\.1/.test(t)), 'the menu bar menu shows "Update available: 1.0.1…"', JSON.stringify(r.menu))
  const v = r.v
  check(v === '1.0.1', 'quitting installs it: the app on disk is now 1.0.1', v)
  run('codesign', ['--verify', '--deep', '--strict', app])
  check(true, 'the updated app passes codesign --verify')
} catch (e) {
  check(false, 'update test', String(e.stderr ?? e.message).slice(0, 300))
} finally {
  spawnSync('pkill', ['-f', 'Snapkit Dev.app/Contents/MacOS/Snapkit'])
  server.close()
  rmSync(root, { recursive: true, force: true })
}
const failed = results.filter((r) => !r).length
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
