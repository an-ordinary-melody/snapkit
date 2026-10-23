// Linux/Xvfb smoke test: start app, trigger capture, drag a selection, copy.
import { _electron as electron } from 'playwright-core'
import { writeFileSync } from 'fs'

const out = process.argv[2] ?? '.'
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } })
app.process().stdout.on('data', (d) => process.stdout.write('[main] ' + d))
app.process().stderr.on('data', (d) => { const s = String(d); if (!/dbus|Fontconfig|gpu|GLES|viz/i.test(s)) process.stdout.write('[main:err] ' + s) })

await new Promise((r) => setTimeout(r, 2500))
await app.evaluate(({ app }) => app.emit('second-instance'))
await new Promise((r) => setTimeout(r, 1500))

const win = app.windows()[0]
const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), bounds: w.getBounds() })))
console.log('windows', JSON.stringify(visible))
writeFileSync(`${out}/1-capture-mode.png`, await win.screenshot())

const m = win.mouse
await m.move(300, 200); await m.down(); await m.move(500, 350, { steps: 5 }); await m.move(700, 450, { steps: 5 }); await m.up()
await new Promise((r) => setTimeout(r, 300))
writeFileSync(`${out}/2-selected.png`, await win.screenshot())
const bars = await win.$$eval('.toolbar', (els) => els.map((e) => e.getBoundingClientRect().toJSON()))
console.log('toolbars', JSON.stringify(bars))
const label = await win.$eval('.size-label', (e) => e.textContent)
console.log('size label', label)

// full-screen-ish selection -> bars inside
await m.move(2, 2); await m.down(); await m.move(1270, 790, { steps: 8 }); await m.up()
await new Promise((r) => setTimeout(r, 300))
writeFileSync(`${out}/3-fullscreen-selection.png`, await win.screenshot())

await win.keyboard.press('Control+c')
await new Promise((r) => setTimeout(r, 800))
const result = await app.evaluate(({ clipboard, BrowserWindow }) => ({
  clip: clipboard.readImage().getSize(),
  visible: BrowserWindow.getAllWindows().map((w) => w.isVisible())
}))
console.log('after copy', JSON.stringify(result))
await app.close()
