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
  // Editor zoom: Ctrl + scroll zooms in around the pointer (drawings redrawn sharp), Ctrl + 0 fits again.
  await win.click('.be-dock .toolbar button[data-tip="Rectangle"]')
  const c0 = await win.$eval('.be-canvas canvas', (c) => c.getBoundingClientRect().toJSON())
  await m.move(c0.x + c0.width * 0.3, c0.y + c0.height * 0.3); await m.down(); await m.move(c0.x + c0.width * 0.5, c0.y + c0.height * 0.5, { steps: 4 }); await m.up(); await wait(200)
  const px = c0.x + c0.width * 0.7, py = c0.y + c0.height * 0.6
  const u0 = [(px - c0.x) / c0.width, (py - c0.y) / c0.height]
  await m.move(px, py)
  await win.keyboard.down('Control')
  for (let i = 0; i < 6; i++) { await m.wheel(0, -100); await wait(40) }
  await win.keyboard.up('Control')
  await wait(500)
  const c1 = await win.$eval('.be-canvas canvas', (c) => c.getBoundingClientRect().toJSON())
  const u1 = [(px - c1.x) / c1.width, (py - c1.y) / c1.height]
  const badge = await win.$eval('.be-zoom', (b) => b.textContent).catch(() => 'none')
  // The drawing layer's resolution follows how big it's shown (never below normal).
  const sharp = await win.evaluate(() => {
    const ann = document.querySelector('.be-ann .annotations')
    const shownK = ann.getBoundingClientRect().width / ann.offsetWidth
    const ratio = window.Konva.stages.at(-1).getLayers()[0].getCanvas().getPixelRatio() / (window.devicePixelRatio || 1)
    return { shownK, ratio }
  })
  const layerOk = sharp.shownK > 1.2 && Math.abs(sharp.ratio - Math.max(1, sharp.shownK)) < 0.05
  console.log('editor zoom in:', c1.width > c0.width * 2, `(${Math.round((c1.width / c0.width) * 100)}%, badge ${badge})`,
    '| point stays under the pointer:', Math.abs(u1[0] - u0[0]) < 0.03 && Math.abs(u1[1] - u0[1]) < 0.03,
    '| drawings redrawn sharp:', layerOk, `(shown ${sharp.shownK.toFixed(2)}x, drawn ${sharp.ratio.toFixed(2)}x)`)
  writeFileSync(join(out, 'editor-zoomed.png'), await win.screenshot())
  await win.keyboard.press('Control+0'); await wait(500)
  const c2 = await win.$eval('.be-canvas canvas', (c) => c.getBoundingClientRect().toJSON())
  console.log('Ctrl+0 fits again:', Math.abs(c2.width - c0.width) < 2 && !(await win.$('.be-zoom')), '| still in editor:', !!(await win.$('.be-backdrop')))
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
