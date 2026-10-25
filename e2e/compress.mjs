// Compress: copies are smaller PNGs (the exact bytes stay on the clipboard), the editor's Compress switch
// follows the setting, and "Smallest" brings HiDPI captures back to 1×. Usage: npm run build && node e2e/compress.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
const out = process.argv[2] ?? 'e2e-out'; const profile = join(out, 'profile'); mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, compress: { enabled: true } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])] })
const errors = []
// The PNG bytes on the clipboard (what browsers, Slack etc. paste), the image size, and the same pixels as a plain PNG.
const clip = () =>
  app.evaluate(({ clipboard }) => {
    const raw = clipboard.readBuffer(process.platform === 'darwin' ? 'public.png' : 'PNG')
    const img = clipboard.readImage()
    return { bytes: raw.length, plain: img.toPNG().length, ...img.getSize() }
  })
const capture = async (setup) => {
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
  await wait(1200)
  const win = app.windows().find((w) => w.url().endsWith('#overlay'))
  win.on('pageerror', (e) => errors.push(e.message))
  const m = win.mouse
  await m.move(150, 120); await m.down(); await m.move(750, 520, { steps: 6 }); await m.up(); await wait(300)
  await setup?.(win)
  return win
}
try {
  await wait(2500)
  const scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor)
  const win0 = await capture()
  console.log('screen (info):', JSON.stringify(await app.evaluate(({ screen }) => ({ ...screen.getPrimaryDisplay().bounds, scale: screen.getPrimaryDisplay().scaleFactor }))), '| overlay css width:', await win0.evaluate(() => [window.innerWidth, window.devicePixelRatio]))
  await win0.keyboard.press('Escape'); await wait(500)

  let win = await capture()
  await win.click('.toolbar button[data-tip="Copy"]'); await wait(1500)
  const std = await clip()
  console.log('standard copy: exact PNG on the clipboard:', std.bytes > 0, '| smaller than a plain PNG:', std.bytes < std.plain, '| full size:', std.width === Math.round(600 * scale), JSON.stringify(std))

  // The editor starts with Compress on (the setting) and shows the size; switching it off copies the original.
  win = await capture(async (w) => { await w.click('.toolbar button[data-tip="Edit background"]'); await wait(1500) })
  const sw = () => win.$eval('button[aria-label="Compress"]', (b) => b.getAttribute('aria-pressed'))
  console.log('editor Compress switch follows the setting:', await sw(), '| size shown:', /\(was \d/.test(await win.$eval('.be-output', (e) => e.textContent)))
  await win.click('button[aria-label="Compress"]'); await wait(200)
  console.log('switched off:', await sw(), '| chips hidden:', !(await win.$('.be-chip[title^="Fewer colors"]')))
  await win.click('.be-btn:has-text("Copy")'); await wait(1500)
  const off = await clip()
  console.log('copy with Compress off is the original:', off.bytes === 0 || off.bytes >= std.bytes, JSON.stringify(off))

  // Smallest: 1× size.
  await win.evaluate(() => window.snapkit.settingsUpdate({ compress: { preset: 'smallest' } })); await wait(500)
  win = await capture()
  await win.click('.toolbar button[data-tip="Copy"]'); await wait(1500)
  const small = await clip()
  console.log('smallest copy is 1× size:', small.width === 600, JSON.stringify(small))
  console.log('renderer errors:', errors.length ? errors.join(' | ') : 'none')
} finally { await app.close() }
