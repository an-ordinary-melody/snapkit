// "Capture last area": opens capture mode with the area last copied or saved (a full-screen capture counts
// as the whole screen), or copies it right away. Usage: npm run build && node e2e/lastarea.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
const out = process.argv[2] ?? 'e2e-out'; const profile = join(out, 'profile'); mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', lastArea: '' }, notifications: { onCopy: false } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const args = ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])]
const errors = []
let app = await electron.launch({ args })
const overlay = () => app.windows().find((w) => w.url().endsWith('#overlay'))
const capturing = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))
const lastArea = async () => {
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--last-area']))
  await wait(1300)
}
// The selection as capture mode shows it (CSS px), or null.
const selection = () =>
  overlay().evaluate(() => {
    const r = document.querySelector('.selection')
    return r ? [r.style.left, r.style.top, r.style.width, r.style.height].map((v) => Math.round(parseFloat(v))).join(',') : null
  })
const clip = () => app.evaluate(({ clipboard }) => clipboard.readImage().getSize())
const close = async () => { for (let i = 0; i < 3 && (await capturing()); i++) { await overlay().keyboard.press('Escape'); await wait(400) } }
try {
  await wait(2500)
  overlay().on('pageerror', (e) => errors.push(e.message))
  // First use: nothing remembered yet, so a normal capture (nothing selected).
  await lastArea()
  console.log('first use opens a normal capture:', (await capturing()) && (await selection()) === null)
  // Draw an area and copy it.
  const m = overlay().mouse
  await m.move(200, 150); await m.down(); await m.move(500, 350, { steps: 6 }); await m.up(); await wait(300)
  const drawn = await selection()
  await overlay().click('.toolbar button[data-tip="Copy"]'); await wait(1200)
  // Capture last area: the same area, selected, toolbar ready.
  await lastArea()
  const again = await selection()
  console.log('reopens the same area:', again === drawn, `${drawn} -> ${again}`, '| toolbar shown:', !!(await overlay().$('.toolbar button[data-tip="Copy"]')))
  await close()
  // Esc doesn't change it.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, [])); await wait(1200)
  await m.move(100, 100); await m.down(); await m.move(160, 140, { steps: 3 }); await m.up(); await wait(300)
  await close()
  await lastArea()
  console.log('a cancelled capture is not remembered:', (await selection()) === drawn)
  await close()

  // Full screen counts as the whole screen.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--fullscreen'])); await wait(1800)
  await lastArea()
  const whole = await overlay().evaluate(() => `0,0,${window.innerWidth},${window.innerHeight}`)
  const full = await selection()
  console.log('after full screen it selects the whole screen:', full === whole, full)
  await close()

  // Copy right away: no capture mode, the area goes to the clipboard.
  await overlay().evaluate(() => window.snapkit.settingsUpdate({ capture: { lastAreaInstant: true } })); await wait(300)
  // Back to the drawn area first.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, [])); await wait(1200)
  await m.move(200, 150); await m.down(); await m.move(500, 350, { steps: 6 }); await m.up(); await wait(300)
  await overlay().click('.toolbar button[data-tip="Copy"]'); await wait(1200)
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await lastArea(); await wait(800)
  const c = await clip()
  console.log('copy right away: no capture mode:', !(await capturing()), '| copied the area:', JSON.stringify(c), c.width > 0 && Math.abs(c.width / c.height - 300 / 200) < 0.05)

  // Remembered after a restart.
  await app.close()
  app = await electron.launch({ args })
  await wait(2500)
  await overlay().evaluate(() => window.snapkit.settingsUpdate({ capture: { lastAreaInstant: false } })); await wait(300)
  await lastArea()
  console.log('remembered after a restart:', (await selection()) === drawn)
  await close()
  console.log('renderer errors:', errors.length ? errors.join(' | ') : 'none')
} finally { await app.close() }
