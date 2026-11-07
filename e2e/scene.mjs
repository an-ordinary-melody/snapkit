// Renders a scene (fixtures/scenes/*.json) in the Electron app to a PNG, to compare with the native Mac app.
// Usage: npm run build && node e2e/scene.mjs <scene.json> <out.png>
//    or: SNAPKIT_SCENE=<scene.json> SNAPKIT_SCENE_OUT=<out.png> node e2e/scene.mjs
// Several at once: node e2e/scene.mjs <scenes-dir> <out-dir> (one PNG per scene, same name).
//
// Scene fields (missing ones use the window's defaults):
//   window: overlay | editor | preview | pin | settings | history
//   screen: frozen screen relative to fixtures/ (overlay, editor, preview, pin), e.g. screens/bands-1470x956@2.png
//   settings: a settings patch (as in settings.json)
//   selection {x,y,w,h} (points), shapes (doc.json shapes), tool, selectedShape, beautify (editor)
//   open: colorPicker | variants:<tool> | textPanel (with ocr: {lines, engine, ms}) | null
//   section: settings section id (settings window)
//   historyDir: history folder relative to fixtures/ (history window)
// The PNG is the window's page content at the display's scale, without the OS window frame.
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'

const fixtures = resolve(import.meta.dirname, '..', 'fixtures')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function render(scenePath, outPath) {
  const scene = JSON.parse(readFileSync(scenePath, 'utf8'))
  const kind = scene.window ?? 'overlay'
  const profile = mkdtempSync(join(tmpdir(), 'snapkit-scene-'))
  const settings = {
    ...scene.settings,
    hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', ...scene.settings?.hotkeys },
    notifications: { onSave: false, ...scene.settings?.notifications },
    // The preview and pin come from a copy with the floating preview on.
    ...(kind === 'preview' || kind === 'pin' ? { pin: { ...scene.settings?.pin, afterCopy: true } } : {})
  }
  writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings))
  if (scene.historyDir) cpSync(join(fixtures, scene.historyDir), join(profile, 'history'), { recursive: true })

  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${profile}`],
    env: { ...process.env, SNAPKIT_SCENE: resolve(scenePath), SNAPKIT_FIXTURES: fixtures }
  })
  app.process().stderr.on('data', (d) => process.stderr.write('[main] ' + d))
  app.process().stdout.on('data', (d) => process.stdout.write('[main] ' + d))
  const windowFor = async (hash) => {
    for (let i = 0; i < 40; i++) {
      const w = app.windows().find((w) => w.url().endsWith('#' + hash))
      if (w) return w
      await wait(100)
    }
    throw new Error(`no ${hash} window`)
  }
  try {
    await wait(2000)
    let page
    if (kind === 'settings') {
      await app.evaluate(({ ipcMain }) => ipcMain.emit('settings:open', { senderFrame: { url: 'file:///app/out/renderer/index.html#overlay' } }))
      page = await windowFor('settings')
      await wait(500)
      if (scene.section) await page.locator('.st-nav').filter({ hasText: new RegExp(`^\\s*${scene.section}\\s*$`, 'i') }).click()
    } else if (kind === 'history') {
      await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--history']))
      page = await windowFor('history')
    } else {
      await app.evaluate(({ app }) => void setTimeout(() => app.emit('second-instance', {}, [])))
      page = await windowFor('overlay')
      await wait(1200)
      if (scene.open === 'colorPicker') await page.click('.toolbar button[data-id="color"]')
      else if (scene.open?.startsWith('variants:')) await page.click(`.toolbar button[data-id="${scene.open.slice(9)}"]`, { button: 'right' })
      await page.mouse.move(1, 1) // no hover tooltip on the button just clicked
      if (kind === 'preview' || kind === 'pin') {
        await page.keyboard.press(MOD + '+c')
        page = await windowFor('thumb')
        if (kind === 'pin') {
          await wait(500)
          await page.click('.thumb-pin')
          page = await windowFor('pin')
        }
      }
    }
    await wait(600) // fonts, images, transitions
    writeFileSync(outPath, await page.screenshot({ animations: 'disabled' }))
    console.log(`${basename(scenePath)} -> ${outPath}`)
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
}

const [src = process.env.SNAPKIT_SCENE, out = process.env.SNAPKIT_SCENE_OUT] = process.argv.slice(2)
if (!src || !out) {
  console.error('Usage: node e2e/scene.mjs <scene.json|scenes-dir> <out.png|out-dir>')
  process.exit(2)
}
if (statSync(src).isDirectory()) {
  mkdirSync(out, { recursive: true })
  for (const f of readdirSync(src).filter((f) => f.endsWith('.json')).sort()) await render(join(src, f), join(out, f.replace(/\.json$/, '.png')))
} else {
  if (!existsSync(dirname(resolve(out)))) mkdirSync(dirname(resolve(out)), { recursive: true })
  await render(src, out)
}
