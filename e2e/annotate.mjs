// Annotation test: start app (isolated profile), capture, draw with every tool, save.
// Usage: npm run build && node e2e/annotate.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
const saves = join(out, 'saved')
mkdirSync(profile, { recursive: true })
mkdirSync(saves, { recursive: true })
writeFileSync(
  join(profile, 'settings.json'),
  JSON.stringify({
    hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' },
    save: { folder: saves },
    notifications: { onSave: false },
    features: { ellipse: true, step: true, redo: true }
  })
)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
app.process().stdout.on('data', (d) => process.stdout.write('[main] ' + d))

try {
  await wait(2500)
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(1200)
  const win = app.windows()[0]
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const m = win.mouse
  const drag = async (x1, y1, x2, y2) => {
    await m.move(x1, y1)
    await m.down()
    await m.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 })
    await m.move(x2, y2, { steps: 4 })
    await m.up()
    await wait(80)
  }
  const tool = (label) => win.click(`.toolbar button[title^="${label}"]`)

  await drag(200, 150, 900, 650)
  await wait(300)

  await tool('Arrow'); await drag(250, 200, 450, 300)
  await tool('Rectangle'); await drag(500, 200, 700, 320)
  await tool('Ellipse'); await drag(500, 350, 650, 450)
  await tool('Pen'); await drag(250, 400, 400, 500)
  await tool('Highlighter'); await drag(250, 550, 450, 550)
  await tool('Blur'); await drag(700, 450, 850, 600)
  await tool('Numbered step'); await m.click(300, 600); await m.click(340, 600); await wait(80)
  await tool('Text'); await m.click(600, 560); await wait(150)
  await win.keyboard.type('Hello Snapkit')
  await win.keyboard.press('Enter')
  await wait(150)
  writeFileSync(join(out, '1-drawn.png'), await win.screenshot())

  // Style a selected shape: click the arrow (no tool) and make it thick + green.
  await tool('Text') // toggle the text tool off
  await m.click(350, 250); await wait(150)
  const styleBar = await win.$('.style-bar')
  console.log('style bar shown for selected arrow:', !!styleBar)
  await win.click('.style-bar button[title="#22c55e"]')
  await win.click('.style-bar button[title="Thick"]')
  await wait(100)
  writeFileSync(join(out, '2-selected-arrow.png'), await win.screenshot())

  // Move the rectangle by dragging it, then undo the move, then redo it.
  await drag(500, 260, 520, 280)
  await win.keyboard.press('Meta+z')
  await win.keyboard.press('Meta+Shift+z')
  // Delete the ellipse.
  await m.click(650, 400); await win.keyboard.press('Backspace')
  await wait(100)
  writeFileSync(join(out, '3-edited.png'), await win.screenshot())

  await win.keyboard.press('Meta+s')
  await wait(1200)
  console.log('saved files:', readdirSync(saves))
  console.log('renderer errors:', errors.length ? errors : 'none')
} finally {
  await app.close()
}
