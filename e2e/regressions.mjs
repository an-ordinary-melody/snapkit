// Checks for bugs fixed earlier that no other suite covers.
// Usage: npm run build && node e2e/regressions.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', fullscreen: '', settings: '', history: '' } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const capturing = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))

try {
  await wait(2500)
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
  await wait(1200)
  const win = app.windows().find((w) => w.url().endsWith('#overlay'))
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  const m = win.mouse
  await m.move(200, 150); await m.down(); await m.move(900, 650, { steps: 6 }); await m.up(); await wait(300)
  const tool = (t) => win.click(`.toolbar button[data-tip="${t}"]`)
  const swatch = () => win.$eval('.style-bar .swatch.active', (b) => b.dataset.tip).catch(() => 'none')

  // Esc with the color picker open closes just the picker, not capture mode.
  await tool('Rectangle'); await wait(100)
  const rectBefore = await swatch()
  await win.click('.toolbar button[data-tip="Color"]'); await wait(200)
  const pickerOpen = !!(await win.$('.color-picker'))
  await win.keyboard.press('Escape'); await wait(300)
  console.log('Esc closes only the color picker:', pickerOpen && !(await win.$('.color-picker')) && (await capturing()) && !!(await win.$('.toolbar')))

  // A text background style doesn't recolor the other tools.
  await tool('Text'); await m.click(500, 400); await wait(200); await win.keyboard.type('Label')
  await win.click('.style-bar button[data-tip="Dark background"]'); await wait(100)
  await win.keyboard.press('Escape'); await wait(150)
  await tool('Rectangle'); await wait(100)
  console.log('text style keeps the rectangle color:', rectBefore !== 'none' && (await swatch()) === rectBefore, `(${rectBefore})`)
  await win.keyboard.press('Escape'); await win.keyboard.press('Escape'); await wait(400)

  // Edit from the floating preview opens the editor with the image painted.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--fullscreen']))
  await wait(1500)
  const thumb = app.windows().find((w) => w.url().endsWith('#thumb'))
  await thumb.click('.thumb-btn:has-text("Edit")'); await wait(1500)
  const painted = await win.$eval('.be-canvas canvas', (c) => {
    const ctx = c.getContext('2d')
    const d = ctx.getImageData(Math.floor(c.width * 0.3), Math.floor(c.height * 0.3), Math.floor(c.width * 0.4), Math.floor(c.height * 0.4)).data
    const colors = new Set()
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3]) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    return colors.size
  }).catch(() => 0)
  console.log('edit from preview shows the image:', painted > 20, `(${painted} colors)`)
  writeFileSync(join(out, 'edit-from-preview.png'), await win.screenshot())
  await win.keyboard.press('Escape'); await wait(300); await win.keyboard.press('Escape'); await wait(500)

  // On a small or scaled screen (e.g. 150% on Windows) the editor's tools stay inside the editor, so they can be clicked.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
  await wait(1200)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#overlay')).setBounds({ x: 0, y: 0, width: 683, height: 512 }))
  await wait(500)
  await m.move(100, 100); await m.down(); await m.move(450, 380, { steps: 5 }); await m.up(); await wait(300)
  await win.click('.toolbar button[data-tip="Edit background"]'); await wait(800)
  const fits = await win.evaluate(() => {
    const card = document.querySelector('.be-card').getBoundingClientRect()
    return [...document.querySelectorAll('.be-dock .toolbar button')].every((b) => {
      const r = b.getBoundingClientRect()
      return r.left >= card.left && r.right <= card.right && r.top >= card.top && r.bottom <= card.bottom
    })
  })
  console.log('editor tools fit a small screen:', fits)
  console.log('renderer errors:', errors.length ? errors : 'none')
} finally {
  await app.close()
}
