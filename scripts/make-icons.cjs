// Generate the app and tray icons from the logo PNGs in branding/ (kept out of the repo).
// Usage: npx electron scripts/make-icons.cjs
//   branding/Snapkit Original.png  -> build/icon.png (macOS app icon, inset to Apple's icon grid)
//                                     build/icon-win.png (Windows app icon, full size)
//                                     resources/tray.png, tray@1.5x.png, tray@2x.png (Windows tray)
//   branding/Snapkit Negative.png  -> resources/trayTemplate.png, trayTemplate@2x.png (macOS menu bar)
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const src = (name) => path.join(root, 'branding', name)
const dataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64')

/**
 * Runs in a hidden page: draws `image` onto a size × size canvas.
 * fit: 'inset' puts the whole image in the middle `content` fraction;
 *      'trim' crops to the opaque pixels first, then fits them into `content`.
 * mono: paint every opaque pixel this color (macOS template images use only the shape).
 */
const draw = (url, size, fit, content, mono) => `
  new Promise((done) => {
    const img = new Image()
    img.onload = () => {
      let sx = 0, sy = 0, sw = img.width, sh = img.height
      if (${JSON.stringify(fit)} === 'trim') {
        const probe = document.createElement('canvas')
        probe.width = img.width; probe.height = img.height
        const p = probe.getContext('2d'); p.drawImage(img, 0, 0)
        const d = p.getImageData(0, 0, img.width, img.height).data
        let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          if (d[(y * img.width + x) * 4 + 3] > 16) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
        }
        sx = x0; sy = y0; sw = x1 - x0 + 1; sh = y1 - y0 + 1
      }
      const c = document.createElement('canvas')
      c.width = c.height = ${size}
      const g = c.getContext('2d')
      g.imageSmoothingQuality = 'high'
      const box = ${size} * ${content}
      const k = Math.min(box / sw, box / sh)
      const w = sw * k, h = sh * k
      g.drawImage(img, sx, sy, sw, sh, (${size} - w) / 2, (${size} - h) / 2, w, h)
      if (${JSON.stringify(mono || '')}) {
        g.globalCompositeOperation = 'source-in'
        g.fillStyle = ${JSON.stringify(mono || '#000')}
        g.fillRect(0, 0, ${size}, ${size})
      }
      done(c.toDataURL('image/png').split(',')[1])
    }
    img.src = ${JSON.stringify(url)}
  })`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const original = dataUrl(src('Snapkit Original.png'))
  const negative = dataUrl(src('Snapkit Negative.png'))
  const jobs = [
    // macOS: the tile is 824 of 1024 px (Apple's app icon grid), so it lines up with other apps.
    ['build/icon.png', original, 1024, 'inset', 824 / 1024],
    ['build/icon-win.png', original, 1024, 'inset', 1],
    // Windows tray: 16 px at 100%, 24 at 150%, 32 at 200%.
    ['resources/tray.png', original, 16, 'inset', 1],
    ['resources/tray@1.5x.png', original, 24, 'inset', 1],
    ['resources/tray@2x.png', original, 32, 'inset', 1],
    // macOS menu bar: an 18 pt template image (shape only), the hand filling 16 of it.
    ['resources/trayTemplate.png', negative, 18, 'trim', 16 / 18, '#000000'],
    ['resources/trayTemplate@2x.png', negative, 36, 'trim', 32 / 36, '#000000']
  ]
  for (const [out, url, size, fit, content, mono] of jobs) {
    const b64 = await win.webContents.executeJavaScript(draw(url, size, fit, content, mono))
    fs.writeFileSync(path.join(root, out), Buffer.from(b64, 'base64'))
    console.log(`wrote ${out} (${size}x${size})`)
  }
  app.quit()
})
