// Safeguard test: capture mode can always be closed. Usage: npm run build && node e2e/safety.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', history: '' } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`], env: { ...process.env, SNAPKIT_IDLE_MS: '4000' } })
const capturing = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))
const hotkey = () => app.evaluate(({ app }) => app.emit('second-instance', {}, []))
// Snapkit's log: ~/Library/Logs/Snapkit on macOS; elsewhere in the profile's logs folder.
const LOG = process.platform === 'darwin' ? join(process.env.HOME, 'Library/Logs/Snapkit/main.log') : join(profile, 'logs', 'main.log')
const lastLog = (n = 3) => readFileSync(LOG, 'utf8').trim().split('\n').slice(-n).map((l) => l.slice(25)).join(' | ')

try {
  await wait(2500)
  // 1. Hotkey again closes capture mode.
  // Wait for it to show (the first capture after launch can take longer on a slow machine).
  await hotkey()
  let open1 = false
  for (let i = 0; i < 30 && !open1; i++) { await wait(100); open1 = await capturing() }
  await wait(500) // let it finish drawing the frozen screenshot, as a person would
  await hotkey(); await wait(400)
  console.log('hotkey toggles:', open1, '->', await capturing(), '|', lastLog(1))

  // 2. Idle timeout (4 s in this test, 3 min normally).
  await hotkey(); await wait(5500)
  console.log('idle closes it:', !(await capturing()), '|', lastLog(1))

  // 3. A stuck overlay page: capture is cancelled (no dim left), the page replaced, the next capture works.
  const ov = app.windows().find((w) => w.url().endsWith('#overlay'))
  void ov.evaluate(() => { const end = Date.now() + 4000; while (Date.now() < end) {} }).catch(() => {})
  await wait(200)
  await hotkey(); await wait(1800)
  console.log('stuck page -> no dim left:', !(await capturing()), '|', lastLog(2))
  await wait(2500)
  await hotkey(); await wait(1200)
  console.log('next capture works:', await capturing())
  await hotkey(); await wait(400)

  // 4. No listener leak after many captures.
  for (let i = 0; i < 6; i++) { await hotkey(); await wait(700); await hotkey(); await wait(300) }
  console.log('leftover wait listeners:', await app.evaluate(({ ipcMain }) => ['overlay:armed', 'overlay:painted', 'overlay:cleared'].map((c) => ipcMain.listenerCount(c))))

  // 5. History panel: record switch, and the folder button leaves no dim behind.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--history'])); await wait(900)
  const panel = app.windows().find((w) => w.url().endsWith('#history'))
  await panel.click('button[aria-label="Record history"]'); await wait(300)
  const paused = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).history?.paused
  await panel.click('button[aria-label="Record history"]'); await wait(300)
  console.log('record switch pauses history:', paused, '| back on:', JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).history?.paused)
  await panel.click('button[aria-label="Show the history folder"]'); await wait(1500)
  console.log('after folder button: capture dim showing:', await capturing())
  await app.evaluate(({ app }) => app.focus({ steal: true })); await wait(300)
} finally {
  await app.close()
}
