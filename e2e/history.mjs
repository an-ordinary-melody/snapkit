// History test: copies land in history (limit 5), the panel copies / stars /
// edits / deletes, and clearing works. Usage: npm run build && node e2e/history.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', history: 'CommandOrControl+Alt+Shift+F11' }, notifications: { onCopy: false }, history: { maxCount: 5 } }))
const index = () => (existsSync(join(profile, 'history', 'index.json')) ? JSON.parse(readFileSync(join(profile, 'history', 'index.json'), 'utf8')) : [])
const folders = () => readdirSync(join(profile, 'history')).filter((n) => n !== 'index.json')

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const windowFor = (view) => app.windows().find((w) => w.url().endsWith('#' + view))
const visible = (view) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#' + v) && w.isVisible() && w.getOpacity() > 0), view)

async function copyCapture(i) {
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
  await wait(800)
  const ov = windowFor('overlay')
  const m = ov.mouse
  await m.move(200 + i * 20, 150); await m.down(); await m.move(600 + i * 20, 450, { steps: 3 }); await m.up(); await wait(150)
  if (i === 0) {
    await ov.keyboard.press('a')
    await m.move(250, 200); await m.down(); await m.move(450, 350, { steps: 3 }); await m.up()
  }
  await ov.keyboard.press(MOD + '+c')
  await wait(900)
}

try {
  await wait(2500)
  const t0 = Date.now()
  for (let i = 0; i < 7; i++) await copyCapture(i)
  await wait(500)
  console.log('7 copies -> kept:', index().length, '(limit 5) | folders on disk:', folders().length, '| took', Math.round((Date.now() - t0) / 1000), 's')
  const log = readFileSync(join(process.env.HOME, 'Library/Logs/Snapkit/main.log'), 'utf8').split('\n').filter((l) => l.includes('[history] added')).slice(-3)
  console.log('recent history writes:', log.map((l) => l.replace(/^.*\[history\] /, '')).join(' | '))

  // Open the panel.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--history']))
  await wait(900)
  const panel = windowFor('history')
  console.log('panel visible:', await visible('history'), '| cards:', await panel.$$eval('.hist-card', (c) => c.length))
  await wait(400)
  writeFileSync(join(out, '1-panel.png'), await panel.screenshot())

  // Star the second, then Enter copies the newest and closes the panel.
  await panel.hover('.hist-card >> nth=1')
  await panel.click('.hist-card >> nth=1 >> .hist-star')
  await wait(300)
  console.log('starred:', index().filter((e) => e.starred).length)
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await panel.hover('.hist-card >> nth=0')
  await panel.keyboard.press('Enter')
  await wait(500)
  console.log('Enter copied:', JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readImage().getSize())), '| panel closed:', !(await visible('history')))

  // Edit the newest: the editor opens with its drawing; Done updates that entry (no new one).
  const newest = index()[0].id
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--history']))
  await wait(800)
  await panel.hover('.hist-card >> nth=0')
  await panel.keyboard.press('e')
  await wait(1200)
  const ed = windowFor('overlay')
  console.log('editor open:', !!(await ed.$('.be-backdrop')))
  await ed.click('.be-btn:has-text("Done")')
  await wait(1200)
  console.log('after edit: count', index().length, '| same entry on top:', index()[0].id === newest)

  // Delete one from the panel.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--history']))
  await wait(800)
  await panel.hover('.hist-card >> nth=4')
  await panel.keyboard.press('Backspace')
  await wait(400)
  console.log('after delete:', index().length, '| folders:', folders().length)
  await panel.keyboard.press('Escape')
  await wait(300)

  // Clear, keeping starred.
  await app.evaluate(({ ipcMain }) => ipcMain.emit('settings:open', { senderFrame: { url: 'file:///app/out/renderer/index.html#overlay' } }))
  await wait(1500)
  const st = windowFor('settings')
  await st.click('.st-btn:has-text("Clear, keep starred")')
  await wait(500)
  console.log('after clear (keep starred):', index().length, 'starred:', index().filter((e) => e.starred).length, '| folders:', folders().length)
  writeFileSync(join(out, '2-settings.png'), await st.screenshot({ fullPage: true }))
} finally {
  await app.close()
}
