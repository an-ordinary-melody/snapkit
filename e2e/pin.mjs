// Pin test: capture, draw, pin; then move, zoom, change opacity; check the pin
// survives another capture; close it. Usage: npm run build && node e2e/pin.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, notifications: { onCopy: false } }))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const pinInfo = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().includes('#pin'))
      .map((w) => ({ visible: w.isVisible(), bounds: w.getBounds(), opacity: Math.round(w.getOpacity() * 100) / 100, top: w.isAlwaysOnTop() }))
  )
const capture = async () => {
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(900)
  const win = app.windows().find((w) => w.url().includes('#overlay'))
  const m = win.mouse
  await m.move(300, 200); await m.down(); await m.move(700, 500, { steps: 4 }); await m.up()
  await wait(200)
  return win
}

try {
  await wait(2500)
  const overlay = await capture()
  await overlay.keyboard.press('a')
  await overlay.mouse.move(350, 250); await overlay.mouse.down(); await overlay.mouse.move(600, 420, { steps: 4 }); await overlay.mouse.up()
  await overlay.click('.toolbar button[data-tip="Pin to screen"]')
  await wait(1200)
  let pins = await pinInfo()
  console.log('pin created where captured (400x300 at 300,200):', JSON.stringify(pins))

  const pinWin = app.windows().find((w) => w.url().includes('#pin'))
  const errors = []
  pinWin.on('pageerror', (e) => errors.push(String(e)))
  writeFileSync(join(out, '1-pin.png'), await pinWin.screenshot())
  const pm = pinWin.mouse

  // Move by dragging
  await pm.move(100, 100); await pm.down(); await pm.move(140, 130, { steps: 4 }); await pm.up()
  await wait(200)
  console.log('after drag (+40,+30):', JSON.stringify((await pinInfo())[0].bounds))

  // Zoom with the wheel, opacity with ⌥+wheel
  await pm.move(200, 150)
  await pm.wheel(0, -200)
  await wait(300)
  console.log('after zoom in:', JSON.stringify((await pinInfo())[0].bounds))
  await pinWin.keyboard.down('Alt'); await pm.wheel(0, 200); await pinWin.keyboard.up('Alt')
  await wait(300)
  console.log('opacity after ⌥+scroll:', (await pinInfo())[0].opacity)
  await pinWin.hover('.pin')
  await wait(200)
  writeFileSync(join(out, '2-pin-hover.png'), await pinWin.screenshot())

  // Another capture + copy: the pin must still be there afterwards.
  const ov = await capture()
  await ov.keyboard.press('Meta+c')
  await wait(1000)
  pins = await pinInfo()
  console.log('pin still visible after another capture + copy:', pins.length === 1 && pins[0].visible)

  // Copy from the pin
  await pinWin.click('.pin-bar button[aria-label="Copy"]', { force: true })
  await wait(300)
  console.log('clipboard image from pin:', JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readImage().getSize())))

  await pinWin.keyboard.press('Escape').catch(() => {}) // the window closes mid-press
  await wait(500)
  console.log('closed with Esc:', (await pinInfo()).length === 0)
  console.log('pin errors:', errors.length ? errors : 'none')
} finally {
  await app.close()
}
