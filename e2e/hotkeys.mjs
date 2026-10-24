// Default hotkeys, the capture hotkey stepping aside in capture mode (⌘⇧Z is also Redo there), and the Gray theme.
// Usage: npm run build && node e2e/hotkeys.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), '{}') // all defaults
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const KEYS = ['Alt+Shift+Z', 'CommandOrControl+Shift+5', 'CommandOrControl+Shift+2', 'CommandOrControl+Shift+1']
const registered = () => app.evaluate(({ globalShortcut }, keys) => keys.map((k) => `${k.replace('CommandOrControl+Shift+', '⌘⇧').replace('Alt+Shift+', '⌥⇧')}:${globalShortcut.isRegistered(k)}`).join(' '), KEYS)

try {
  await wait(2500)
  console.log('defaults registered:', await registered())
  // A capture hotkey that's also a capture-mode shortcut (⌘⇧Z = Redo) steps aside while capturing.
  const hist = app.windows().find((w) => w.url().endsWith('#history'))
  console.log('set capture to ⌘⇧Z:', await hist.evaluate(() => window.snapkit.settingsSetHotkey('CommandOrControl+Shift+Z')) ?? 'ok')
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
  await wait(1200)
  const ov = app.windows().find((w) => w.url().endsWith('#overlay'))
  console.log('while capturing:', await registered(), '| ⌘⇧Z:', await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+Z')))
  await ov.mouse.move(300, 200); await ov.mouse.down(); await ov.mouse.move(800, 600, { steps: 4 }); await ov.mouse.up(); await wait(300)
  console.log('selection outline:', await ov.$eval('.selection', (e) => getComputedStyle(e).boxShadow.split('),')[0] + ')'))
  await ov.keyboard.press('Escape'); await wait(200); await ov.keyboard.press('Escape'); await wait(500)
  console.log('after capture: ⌘⇧Z registered again:', await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+Z')))

  // Gray theme: a dark theme with lighter surfaces, in every open window.
  await app.evaluate(({ ipcMain }) => ipcMain.emit('settings:open', { senderFrame: { url: 'file:///app/out/renderer/index.html#overlay' } }))
  await wait(1500)
  const st = app.windows().find((w) => w.url().endsWith('#settings'))
  await st.click('.st-nav:has-text("Appearance")')
  await st.click('.st-seg[aria-label="Appearance"] button:has-text("Gray")')
  await wait(400)
  const look = (w) => w.evaluate(() => `${document.documentElement.dataset.mode}/${document.documentElement.dataset.tone ?? '-'}`)
  console.log('gray: settings', await look(st), '| history', await look(app.windows().find((w) => w.url().endsWith('#history'))),
    '| card', await st.$eval('.st-card', (e) => getComputedStyle(e).backgroundColor), '| native', await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
  writeFileSync(join(out, 'gray-appearance.png'), await st.screenshot())
  // A switch held down: its knob stretches and turns to glass.
  const sw = await st.$eval('button[aria-label="Show the size label"]', (e) => e.getBoundingClientRect().toJSON())
  await st.mouse.move(sw.x + sw.width / 2, sw.y + sw.height / 2); await st.mouse.down(); await wait(250)
  const knob = () => st.$eval('button[aria-label="Show the size label"] span', (e) => getComputedStyle(e).width + ' ' + (getComputedStyle(e).backgroundImage === 'none' ? 'solid' : 'glass'))
  console.log('held switch knob, glass off:', await knob())
  await st.mouse.up()
  await st.click('button[aria-label="Liquid Glass"]'); await wait(300) // on
  await st.mouse.move(sw.x + sw.width / 2, sw.y + sw.height / 2); await st.mouse.down(); await wait(250)
  console.log('held switch knob, glass on:', await knob())
  writeFileSync(join(out, 'switch-held.png'), await st.screenshot({ clip: { x: sw.x - 20, y: sw.y - 15, width: sw.width + 40, height: sw.height + 30 } }))
  await st.mouse.up()
} finally {
  await app.close()
}
