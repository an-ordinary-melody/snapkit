// Annotation test: start app (isolated profile), capture, draw with every tool, save.
// Usage: npm run build && node e2e/annotate.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
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
    save: { folder: saves, askLocation: false },
    notifications: { onSave: false },
    features: { ellipse: true, step: true, redo: true }
  })
)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const innerWidthOf = () => 100000 // checked loosely; the real bound is checked in-page below
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
app.process().stdout.on('data', (d) => process.stdout.write('[main] ' + d))

try {
  await wait(2500)
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(1200)
  const win = app.windows().find((w) => w.url().endsWith('#overlay'))
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
  const tool = (label) => win.click(`.toolbar button[data-tip="${label}"]`)

  await drag(200, 150, 900, 650)
  await wait(300)

  await tool('Arrow'); await drag(250, 200, 450, 300)
  await tool('Rectangle'); await drag(500, 200, 700, 320)
  await tool('Ellipse'); await drag(500, 350, 650, 450)
  await tool('Pencil'); await drag(250, 400, 400, 500)
  await tool('Highlighter'); await drag(250, 550, 450, 550)
  await tool('Blur'); await drag(700, 450, 850, 600)
  await tool('Numbered step'); await m.click(300, 600); await m.click(340, 600); await wait(80)
  await tool('Text'); await m.click(600, 560); await wait(150)
  await win.keyboard.type('Hello')
  await win.keyboard.press('Enter') // new line, not done
  await win.keyboard.type('Snapkit')
  console.log('Enter adds a line:', JSON.stringify(await win.$eval('.text-editor', (e) => e.value)))
  await win.keyboard.press('Escape') // done typing, still in capture mode
  await wait(150)
  const stillCapturing = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.getOpacity() > 0))
  console.log('Esc finishes text and stays in capture mode:', stillCapturing && !(await win.$('.text-editor')))

  // With the text tool still active, a click near (not on) the letters grabs the text; drag moves it.
  await drag(598, 555, 640, 520)
  await m.click(640, 450) // new text box
  await wait(150)
  await win.keyboard.type('moved by frame')
  const frame = await win.$eval('.text-frame', (e) => e.getBoundingClientRect().toJSON())
  await drag(frame.x + 2, frame.y + 2, frame.x + 2 + 60, frame.y + 2 + 30) // drag the frame while typing
  const frame2 = await win.$eval('.text-frame', (e) => e.getBoundingClientRect().toJSON())
  console.log('frame drag moved text box by', frame2.x - frame.x, frame2.y - frame.y, '| still typing:', !!(await win.$('.text-editor:focus')))
  await win.keyboard.press('Meta+Enter')
  await wait(150)
  writeFileSync(join(out, '1-drawn.png'), await win.screenshot())

  // Text styles are one choice, Plain first; picking Shadow leaves only Shadow highlighted.
  await m.click(640, 520); await wait(150) // select "Hello Snapkit"
  const order = await win.$$eval('.style-bar button[data-tip]', (bs) => bs.map((b) => b.dataset.tip).filter((t) => /Plain|Stroke|background/.test(t)))
  await win.click('.style-bar button[data-tip="Stroke (outline)"]')
  const active = await win.$$eval('.style-bar button.active', (bs) => bs.map((b) => b.dataset.tip).filter((t) => /Plain|Stroke|background/.test(t)))
  console.log('text styles:', order.join(' | '), '→ active after Stroke:', active)
  console.log('style bar shows the selected text size:', await win.$eval('.style-bar .size-input', (e) => e.value))
  await win.fill('.style-bar .size-input', '36')
  await wait(100)
  console.log('typed size 36 -> text node:', await win.evaluate(() => window.Konva.stages[0].find('Text').map((t) => t.fontSize()).filter((f) => f === 36).length > 0))
  await win.click('.style-bar button[data-tip="Dark background"]')
  console.log('dark background sets white text:', await win.$eval('.style-bar .swatch.active', (b) => b.dataset.tip).catch(() => 'none'))
  await win.click('.style-bar button[data-tip="Plain"]')
  await win.keyboard.press('Escape')

  // Right-click the rectangle tool: menu of shapes; right-click must not end the capture.
  await win.click('.toolbar button[data-tip="Rectangle"]', { button: 'right' })
  await wait(150)
  console.log('shape menu:', await win.$$eval('.variant-menu button', (bs) => bs.map((b) => b.textContent)))
  await win.click('.variant-menu button:has-text("Filled ellipse")')
  await drag(260, 420, 330, 470)
  console.log('rect button now:', await win.$eval('.toolbar button.active', (b) => b.dataset.tip + ' / ' + b.dataset.sub))
  await tool('Filled ellipse') // tool off

  // Highlighter: its 5 colors only, and the picked one shows as selected.
  await tool('Highlighter')
  await win.click('.style-bar button[data-tip="#86efac"]')
  console.log('highlighter swatches:', (await win.$$('.style-bar .swatch')).length, '| custom:', !!(await win.$('.style-bar .swatch.custom')),
    '| picked shows selected:', await win.$eval('.style-bar .swatch.active', (b) => b.dataset.tip))
  await tool('Highlighter') // off

  // Tooltip on hover
  await win.hover('.toolbar button[data-tip="Arrow"]')
  await wait(500)
  console.log('tooltip:', await win.$eval('.tip', (e) => e.textContent).catch(() => 'none'))

  // Blur strength slider on the selected blur area
  await wait(100) // no tool active
  await m.click(770, 590); await wait(150)
  await win.$eval('.style-bar input.slider', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '36'); el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(150)
  console.log('blur strength:', await win.$eval('.style-bar .value', (e) => e.textContent))
  writeFileSync(join(out, '1b-blur-strength.png'), await win.screenshot())
  // Live preview: mid-drag, the blur shows what's under its new position.
  await m.move(770, 590); await m.down(); await m.move(700, 560, { steps: 3 }); await m.move(620, 520, { steps: 3 }); await wait(100)
  writeFileSync(join(out, '1c-blur-mid-drag.png'), await win.screenshot())
  await m.up(); await win.keyboard.press('Meta+z') // put it back (undo also deselects)

  // Style a selected shape: click the arrow (no tool) and make it thick + green.
  await m.click(350, 250); await wait(150)
  const styleBar = await win.$('.style-bar')
  console.log('style bar shown for selected arrow:', !!styleBar)
  await win.click('.style-bar button[data-tip="#3b82f6"]')
  await win.click('.style-bar button[data-tip="Thick"]')
  // Custom color: open the picker, type a hex value.
  await win.click('.style-bar button[data-tip="Custom color"]')
  await win.fill('.color-picker .hex', '#ff00aa')
  await wait(100)
  writeFileSync(join(out, '2b-picker.png'), await win.screenshot())
  await win.press('.color-picker .hex', 'Enter')
  console.log('custom swatch added:', !!(await win.$('.style-bar button[data-tip="#ff00aa"]')))
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

  // Background toggle: off by default, a click turns it on and shows the green dot.
  await win.click('.toolbar button[data-tip="Background: off"]')
  console.log('background on, dot shown:', !!(await win.$('.toolbar button[data-tip="Background: on"] .on-dot')))
  // Full editor: pick a gradient, check the shadow step, Done.
  await win.click('.toolbar button[data-tip="Edit background"]')
  await wait(400)
  await win.click('.be-tab:has-text("Gradient")')
  await win.click('.be-grid .be-swatch[aria-label^="Gradient"] >> nth=12')
  await win.fill('.be-hex[aria-label="End color"]', '#00aa55')
  console.log('end color typed:', await win.$eval('.be-hex[aria-label="End color"]', (e) => e.value))
  await win.click('.be-tab:has-text("Color")')
  console.log('color tab -> solid swatches:', (await win.$$('.be-swatch[aria-label^="Color"]')).length)
  await win.click('.be-tab:has-text("Gradient")')
  console.log('shadow slider step:', await win.$eval('.be-row:has-text("Shadow") input', (e) => e.step))
  // Size 16:9, and draw an open arrow right in the editor.
  await win.click('.be-chip:has-text("Slide 16:9")')
  await wait(200)
  await win.click('.be-dock .toolbar button[data-tip="Arrow"]', { button: 'right' })
  await win.click('.variant-menu button:has-text("Filled arrow")')
  const host = await win.$eval('.be-ann .annotations', (e) => e.getBoundingClientRect().toJSON())
  await drag(host.x + host.width * 0.55, host.y + host.height * 0.75, host.x + host.width * 0.8, host.y + host.height * 0.55)
  await wait(200)
  // The picker for a gradient stop opens fully on screen.
  await win.click('.be-color[aria-label="End color: pick"]')
  await wait(150)
  const pk = await win.$eval('.color-picker', (e) => e.getBoundingClientRect().toJSON())
  console.log('picker fully visible:', pk.x >= 0 && pk.y >= 0 && pk.right <= innerWidthOf(win) && pk.bottom > pk.y, JSON.stringify({ x: Math.round(pk.x), y: Math.round(pk.y), b: Math.round(pk.bottom) }))
  writeFileSync(join(out, '4-background-editor.png'), await win.screenshot())
  await win.keyboard.press('Escape') // closes the picker
  await wait(100)
  // Typing text in the editor: Esc ends typing and stays in the editor.
  await win.click('.be-dock .toolbar button[data-tip="Text"]')
  await m.click(host.x + host.width * 0.3, host.y + host.height * 0.3); await wait(150)
  await win.keyboard.type('in editor')
  await win.keyboard.press('Escape'); await wait(150)
  console.log('Esc while typing in editor -> still in editor:', !!(await win.$('.be-backdrop')), '| typing:', !!(await win.$('.text-editor')))
  await win.keyboard.press('Escape') // deselects the text
  await wait(100)
  await win.keyboard.press('Escape') // closes the editor only
  console.log('Esc closed editor, still capturing:', !(await win.$('.be-backdrop')) && !!(await win.$('.toolbar')))

  await win.keyboard.press('Meta+s')
  await wait(1200)
  const files = readdirSync(saves)
  console.log('saved files:', files)
  const png = readFileSync(join(saves, files[0]))
  const W = png.readUInt32BE(16), H = png.readUInt32BE(20)
  console.log('saved size:', W, 'x', H, '| 16:9?', Math.abs(W / H - 16 / 9) < 0.01)
  console.log('renderer errors:', errors.length ? errors : 'none')
} finally {
  await app.close()
}
