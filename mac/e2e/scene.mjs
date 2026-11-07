// Renders a scene (fixtures/scenes/*.json, same format as e2e/scene.mjs) in the native Mac app to a PNG.
// With --compare <electron-dir>, also diffs each render against the Electron one of the same name.
// Usage: node mac/e2e/scene.mjs <scenes-dir|scene.json> <out-dir> [--compare <electron-dir>]
//   Electron renders: npm run build && node e2e/scene.mjs fixtures/scenes <electron-dir>
// Writes <out-dir>/<scene>.png, and with --compare <out-dir>/compare/<scene>.png (Electron | native |
// differences in red) plus <out-dir>/compare/report.md.
import { execFileSync, spawnSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'

const mac = resolve(import.meta.dirname, '..')
const fixtures = resolve(mac, '..', 'fixtures')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: mac, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const argv = process.argv.slice(2)
const ci = argv.indexOf('--compare')
const electronDir = ci >= 0 ? resolve(argv.splice(ci, 2)[1]) : null
const [src, out] = argv
if (!src || !out) {
  console.error('Usage: node mac/e2e/scene.mjs <scenes-dir|scene.json> <out-dir> [--compare <electron-dir>]')
  process.exit(2)
}

console.log('building…')
run('scripts/build-app.sh', [])
run('swift', ['build', '--product', 'snapkitctl'])
const ctl = join(run('swift', ['build', '--show-bin-path']).trim(), 'snapkitctl')
// The app and every file it reads live in a temp folder, never under ~/Desktop (where the repo may
// be), so macOS doesn't ask for folder access after every (ad-hoc signed) build.
const work = mkdtempSync(join(tmpdir(), 'snapkit-native-scenes-'))
const app = join(work, 'Snapkit Dev.app')
cpSync(join(mac, 'build', 'Snapkit Dev.app'), app, { recursive: true, verbatimSymlinks: true })
cpSync(fixtures, join(work, 'fixtures'), { recursive: true })
const send = (...args) => run(ctl, [...args.map(String), '--wait', '300'])
const quit = () => {
  spawnSync('pkill', ['-f', 'Snapkit Dev.app/Contents/MacOS/Snapkit'])
  spawnSync('sleep', ['0.4'])
}
async function file(path, ms = 6000) {
  for (let t = 0; t < ms && !existsSync(path); t += 100) await wait(100)
  await wait(200)
  return existsSync(path)
}

async function render(scenePath, outPath) {
  const scene = JSON.parse(readFileSync(scenePath, 'utf8'))
  const kind = scene.window ?? 'overlay'
  const profile = mkdtempSync(join(tmpdir(), 'snapkit-native-scene-'))
  const stateFile = join(profile, 'state.json')
  const settings = {
    ...scene.settings,
    hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', ...scene.settings?.hotkeys },
    notifications: { onSave: false, ...scene.settings?.notifications },
    ...(kind === 'preview' || kind === 'pin' ? { pin: { ...scene.settings?.pin, afterCopy: true } } : {})
  }
  writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings))
  if (scene.historyDir) cpSync(join(work, 'fixtures', scene.historyDir), join(profile, 'history'), { recursive: true })
  const screen = join(work, 'fixtures', scene.screen ?? 'screens/bands-1470x956@2.png')
  quit()
  spawnSync('open', ['-n', app, '--args', '-SnapkitTestScreen', screen, '-SnapkitProfile', profile, '-SnapkitTestOut', stateFile,
    '-SnapkitTestPasteboard', 'com.charios.snapkit.dev.scene'])
  for (let i = 0; i < 30; i++) {
    rmSync(stateFile, { force: true })
    send('state')
    if (existsSync(stateFile)) break
    await wait(200)
  }
  rmSync(outPath, { force: true })
  try {
    if (kind === 'settings') {
      send('settings', scene.section ?? 'general')
      await wait(600)
      send('snapshot-settings', outPath)
    } else if (kind === 'history') {
      send('history')
      await wait(800)
      send('snapshot-view', 'history', outPath)
    } else {
      send('capture')
      await wait(400)
      const s = scene.selection
      if (s) send('select', s.x, s.y, s.w, s.h)
      if (scene.shapes) send('shapes', JSON.stringify(scene.shapes))
      if (scene.tool) send('tool', scene.tool)
      if (scene.open === 'colorPicker') send('tool', 'color')
      else if (scene.open?.startsWith('variants:')) send('variants', scene.open.slice(9))
      if (kind === 'editor') send('tool', 'beautifyEdit')
      await wait(400)
      if (kind === 'preview' || kind === 'pin') {
        send('key', 'c', 'cmd')
        await wait(800)
        if (kind === 'pin') {
          send('thumb', 'pin')
          await wait(600)
        }
        send('unhover') // as Electron's scene: the pointer is away
        send('snapshot-view', kind === 'pin' ? 'pin' : 'thumb', outPath)
      } else {
        send('snapshot', outPath)
      }
    }
    console.log(`${basename(scenePath)} -> ${(await file(outPath)) ? outPath : 'nothing rendered'}`)
  } finally {
    quit()
    rmSync(profile, { recursive: true, force: true })
  }
}

const scenes = statSync(src).isDirectory() ? readdirSync(src).filter((f) => f.endsWith('.json')).sort().map((f) => join(src, f)) : [src]
mkdirSync(out, { recursive: true })
for (const s of scenes) await render(s, join(out, basename(s).replace(/\.json$/, '.png')))

if (electronDir) {
  const dir = join(out, 'compare')
  mkdirSync(dir, { recursive: true })
  const rows = []
  for (const s of scenes) {
    const name = basename(s).replace(/\.json$/, '.png')
    const a = join(electronDir, name), b = join(out, name)
    if (!existsSync(a) || !existsSync(b)) {
      rows.push(`| ${name} | — | missing ${existsSync(a) ? 'native' : 'Electron'} render |`)
      continue
    }
    const [pct, sa, sb] = run(ctl, ['diff', a, b, join(dir, name)]).trim().split(' ')
    rows.push(`| ${name} | ${pct}% | Electron ${sa}, native ${sb} |`)
    console.log(`${name}: ${pct}% differ`)
  }
  writeFileSync(join(dir, 'report.md'), `# Electron vs native renders\n\nShare of pixels that differ noticeably (any channel by more than 24 of 255). Each image in this folder: Electron | native | differences in red.\n\n| Scene | Differ | Sizes |\n|---|---|---|\n${rows.join('\n')}\n`)
}

rmSync(work, { recursive: true, force: true })
