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

const OLD = '1.0.1-beta.1', NEW = '1.0.1-beta.2'
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

  // The installed (old) app and the new one: the same build with versions 1.0.1-beta.1 and 1.0.1-beta.2
  // (betas of one release: Sparkle's own comparator sees them as the same version).
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
  make(app, OLD)
  make(join(root, 'new/Snapkit Dev.app'), NEW)
  const zip = join(root, 'feed/Snapkit.zip')
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', join(root, 'new/Snapkit Dev.app'), zip])
  const appcast = (signature) => writeFileSync(join(root, 'feed/appcast.xml'), `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Snapkit</title>
    <item>
      <title>${NEW}</title>
      <sparkle:version>${NEW}</sparkle:version>
      <sparkle:shortVersionString>${NEW}</sparkle:shortVersionString>
      <sparkle:channel>beta</sparkle:channel>
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
  const launch = async (which = app) => {
    spawnSync('pkill', ['-f', 'Snapkit Dev.app/Contents/MacOS/Snapkit'])
    rmSync(state, { force: true })
    spawnSync('open', ['-n', which, '--args', '-SnapkitTestScreen', join(root, 'screen.png'), '-SnapkitProfile', profile, '-SnapkitTestOut', state,
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

  const settingsCheck = async (which, label) => {
    // Settings → Check now on the newest version: the answer shows in Settings, with no Sparkle
    // "You're up to date" box (app-modal; hidden behind another app it left Settings taking no clicks).
    await launch(which)
    run(ctl, ['settings', 'about', '--wait', '500'])
    run(ctl, ['settings-check', '--wait', '500'])
    let st = {}
    for (let i = 0; i < 20 && !st.updateStatus; i++) {
      await wait(300) // lets the feed server answer (the ctl calls block this process)
      rmSync(state, { force: true })
      run(ctl, ['state', '--wait', '500'])
      st = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : {}
    }
    check(st.updateStatus === 'latest', `${label}: Check now in Settings says this is the latest version`, JSON.stringify(st.updateStatus ?? 'no answer'))
    check(existsSync(state) && st.modalWindow === null, `${label}: no modal box is left running (Settings still takes clicks)`, JSON.stringify(st.modalWindow ?? 'the app did not answer'))
    run(ctl, ['quit', '--wait', '500'])
  }

  // A download whose signature doesn't match (signed with another key) is refused.
  run('mkdir', ['-p', join(root, 'other')])
  run('swift', ['e2e/ed25519.swift', 'keygen', join(root, 'other')])
  appcast(run('swift', ['e2e/ed25519.swift', 'sign', join(root, 'other/private.b64'), zip]).trim())
  await launch()
  check(version(app) === OLD, `the installed app is ${OLD}`)
  let r = await updateAndQuit(NEW)
  check(r.usesSparkle, 'the app uses Sparkle when the build has a feed and key')
  check(r.v === OLD, `an update signed with another key is refused (still ${OLD})`, r.v)

  // Packaged by the release script (Sparkle's own sign_update) with the app's key: installed when
  // Snapkit quits.
  execFileSync(join(mac, 'scripts/sparkle-release.sh'), [join(root, 'new/Snapkit Dev.app'), join(root, 'feed'), feed], {
    cwd: mac, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SPARKLE_PRIVATE_KEY: readFileSync(join(root, 'keys/private.b64'), 'utf8').trim() }
  })
  check(/Snapkit-1\.0\.1-beta\.2\.zip/.test(readFileSync(join(root, 'feed/appcast.xml'), 'utf8')), 'the release script writes the zip and appcast')
  await settingsCheck(join(root, 'new/Snapkit Dev.app'), 'on the newest version')
  await launch()
  r = await updateAndQuit(NEW)
  check(r.found.includes(`available ${NEW}`), `Sparkle finds ${NEW} in the appcast (newer than ${OLD})`, r.found || 'nothing logged')
  check(r.menu.some((t) => t.startsWith(`Update available: ${NEW}`)), `the menu bar menu shows "Update available: ${NEW}…"`, JSON.stringify(r.menu))
  const v = r.v
  check(v === NEW, `quitting installs it: the app on disk is now ${NEW}`, v)
  run('codesign', ['--verify', '--deep', '--strict', app])
  check(true, 'the updated app passes codesign --verify')
  await settingsCheck(app, 'after the update')

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
