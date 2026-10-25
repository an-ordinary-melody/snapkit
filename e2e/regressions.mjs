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
    // The whole image, so it doesn't matter what was on screen (a plain window in the middle has few colors).
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const colors = new Set()
    for (let i = 0; i < d.length; i += 4 * 61) if (d[i + 3]) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
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
  // Scrolling up zooms in: on a Mac that's ⌘ + scroll with a positive delta (natural scrolling), on Windows Ctrl + scroll with a negative one.
  const mac = process.platform === 'darwin'
  await win.keyboard.down(mac ? 'Meta' : 'Control')
  for (let i = 0; i < 6; i++) { await m.wheel(0, mac ? 100 : -100); await wait(40) }
  await win.keyboard.up(mac ? 'Meta' : 'Control')
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

  // Hold Space: a hand that drags the zoomed preview around, without drawing.
  const shapesBefore = await win.evaluate(() => window.Konva.stages.at(-1).find('Group').filter((g) => g.id()).length)
  const scrollOf = () => win.$eval('.be-scroll', (e) => [Math.round(e.scrollLeft), Math.round(e.scrollTop)])
  const s0 = await scrollOf()
  await win.keyboard.down(' '); await wait(150)
  const handCursor = await win.$eval('.be-pan', (e) => getComputedStyle(e).cursor).catch(() => 'none')
  await m.move(px, py); await m.down(); await m.move(px + 150, py + 100, { steps: 6 }); await m.up(); await wait(150)
  const s1 = await scrollOf()
  await win.keyboard.up(' '); await wait(150)
  const shapesAfter = await win.evaluate(() => window.Konva.stages.at(-1).find('Group').filter((g) => g.id()).length)
  console.log('Space hand pans:', handCursor === 'grab' && s1[0] < s0[0] - 100 && s1[1] < s0[1] - 50, `(cursor ${handCursor}, scroll ${s0} -> ${s1})`,
    '| draws nothing:', shapesAfter === shapesBefore, '| hand gone on release:', !(await win.$('.be-pan')))

  await win.keyboard.press('Control+0'); await wait(500)
  const c2 = await win.$eval('.be-canvas canvas', (c) => c.getBoundingClientRect().toJSON())
  // A trackpad pinch (ctrlKey without the Control key) spreading zooms in on every OS.
  await win.keyboard.press('Control+0'); await wait(500)
  await win.$eval('.be-stage', (el) => {
    const r = el.getBoundingClientRect()
    for (let i = 0; i < 5; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
  })
  await wait(400)
  // Five quick steps of 8% each, sent faster than the screen redraws: they add up (about 149%).
  console.log('pinch zooms in:', (await win.$eval('.be-zoom', (b) => parseInt(b.textContent)).catch(() => 100)) > 140)
  await win.keyboard.press('Control+0'); await wait(500)
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
  // Back to full size for what follows.
  await app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#overlay')).setBounds(screen.getPrimaryDisplay().bounds))
  // Quick area capture: with it on, the first area drawn is copied right away and capture mode closes.
  // Leave whatever capture is still open (the small-screen check above ends inside one).
  for (let i = 0; i < 3 && (await capturing()); i++) { await win.keyboard.press('Escape'); await wait(400) }
  const quick = async (on) => {
    await win.evaluate((v) => window.snapkit.settingsUpdate({ capture: { quickCopy: v } }), on)
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
    await wait(1200)
    await m.move(300, 200); await m.down(); await m.move(500, 350, { steps: 5 }); await m.up()
    await wait(1200)
    return { capturing: await capturing(), clip: await app.evaluate(({ clipboard }) => clipboard.readImage().getSize()) }
  }
  const qOn = await quick(true)
  const scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor)
  console.log('quick area capture copies the drawn area:', !qOn.capturing && qOn.clip.width === Math.round(200 * scale) && qOn.clip.height === Math.round(150 * scale), JSON.stringify(qOn))
  // A click (no real area) doesn't copy.
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
  await wait(1200)
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await m.click(600, 400); await wait(800)
  console.log('a click does not quick-copy:', (await capturing()) && (await app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty())))
  await win.keyboard.press('Escape'); await wait(500)
  const qOff = await quick(false)
  console.log('off: drawing keeps capture mode open:', qOff.capturing && qOff.clip.width === 0)
  await win.keyboard.press('Escape'); await wait(500)

  // Scrollbars: thin and themed, with no track or background strip.
  console.log('scrollbars have no track:', await win.evaluate(() => [...document.styleSheets].flatMap((ss) => [...ss.cssRules]).some((r) => r.selectorText?.includes('::-webkit-scrollbar-track') && /transparent/.test(r.cssText))))
  console.log('renderer errors:', errors.length ? errors : 'none')
} finally {
  await app.close()
}
