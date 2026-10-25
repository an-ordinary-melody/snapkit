// Generate the app and tray icons from the logo SVGs in branding/ (kept out of the repo).
// Usage: npx electron scripts/make-icons.cjs
//
// Sources (vector, so every size is drawn sharp):
//   branding/Snapkit Black.svg     the hand and snap lines (its tile is dropped)
//   branding/Snapkit Mac Negative.svg  white tile with a bigger hand cut out (no snap lines): clearer in the menu bar
// Outputs:
//   build/icon.png                 macOS app icon for macOS 15 and older (tile inset to Apple's icon grid)
//   build/icon-win.png             Windows app icon (full-size tile)
//   resources/tray*.png            Windows tray: 16 / 24 / 32 px
//   resources/trayTemplate*.png    macOS menu bar: 18 / 36 px template (shape only)
//   build/AppIcon.icon/            Icon Composer document for the Liquid Glass icon (macOS 26+):
//                                  the blue gradient as the background, the hand as a glass layer.
//                                  Compiled to build/Assets.car on a Mac with Xcode 26+ (see the
//                                  "Mac icon" workflow); electron-builder ships that file.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (name) => fs.readFileSync(path.join(root, 'branding', name), 'utf8')

// The Original logo's gradient: lighter blue at the top right to indigo at the bottom left (sampled from its PNG).
const GRADIENT = { from: '#4888F6', to: '#3428EB' }

const black = read('Snapkit Black.svg')
const paths = black.match(/<path\b[^>]*\/>/g)
const tilePath = paths[0]
const tileD = tilePath.match(/\bd="([^"]+)"/)[1]
/** The hand and the three snap lines, in one color. */
const hand = (color) => paths.slice(1).map((p) => p.replace(/fill="[^"]*"/, `fill="${color}"`)).join('')

const original = `<svg xmlns="http://www.w3.org/2000/svg" width="843" height="843" viewBox="0 0 843 843">
<defs><linearGradient id="g" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GRADIENT.from}"/><stop offset="1" stop-color="${GRADIENT.to}"/></linearGradient></defs>
<path d="${tileD}" fill="url(#g)"/>${hand('#F8F9FB')}</svg>`
const negative = read('Snapkit Mac Negative.svg')

/** Runs in a hidden page: draws an SVG onto a size × size canvas (inset to `content`), optionally as one flat color. */
const draw = (svg, size, content, mono) => `
  new Promise((done) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = ${size}
      const g = c.getContext('2d')
      const box = ${size} * ${content}
      g.drawImage(img, (${size} - box) / 2, (${size} - box) / 2, box, box)
      if (${JSON.stringify(mono || '')}) {
        g.globalCompositeOperation = 'source-in'
        g.fillStyle = ${JSON.stringify(mono || '#000')}
        g.fillRect(0, 0, ${size}, ${size})
      }
      done(c.toDataURL('image/png').split(',')[1])
    }
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
  })`

/** Icon Composer document: the hand as one glass layer over the gradient background. */
function writeIconDocument() {
  const dir = path.join(root, 'build', 'AppIcon.icon')
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  // The layer fills the 1024-pt icon canvas the way the hand fills the logo's tile.
  fs.writeFileSync(
    path.join(dir, 'Assets', 'hand.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 843 843">${hand('#FFFFFF')}</svg>\n`
  )
  const p3 = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5))
    return `extended-srgb:${r},${g},${b},1.00000`
  }
  const doc = {
    fill: {
      'linear-gradient': [p3(GRADIENT.from), p3(GRADIENT.to)],
      orientation: { start: { x: 1, y: 0 }, stop: { x: 0, y: 1 } }
    },
    groups: [
      {
        // A frosted glass hand: white at the top fading to see-through light blue, with a light shadow.
        layers: [
          {
            glass: true,
            'image-name': 'hand.svg',
            name: 'hand',
            fill: { 'linear-gradient': ['extended-srgb:1,1,1,0.95', 'extended-srgb:0.80,0.86,1,0.75'] }
          }
        ],
        shadow: { kind: 'neutral', opacity: 0.2 },
        translucency: { enabled: true, value: 0.5 },
        specular: true,
        lighting: 'combined',
        'blur-material': 0.8
      }
    ],
    'supported-platforms': { squares: 'shared' }
  }
  fs.writeFileSync(path.join(dir, 'icon.json'), JSON.stringify(doc, null, 2) + '\n')
  console.log('wrote build/AppIcon.icon (icon.json, Assets/hand.svg)')
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const jobs = [
    // macOS 15 and older: the tile is 824 of 1024 px (Apple's icon grid), so it lines up with other apps.
    ['build/icon.png', original, 1024, 824 / 1024],
    ['build/icon-win.png', original, 1024, 1],
    // Windows tray: 16 px at 100%, 24 at 150%, 32 at 200%.
    ['resources/tray.png', original, 16, 1],
    ['resources/tray@1.5x.png', original, 24, 1],
    ['resources/tray@2x.png', original, 32, 1],
    // macOS menu bar: an 18 pt template image (shape only), the tile filling 16 of it.
    ['resources/trayTemplate.png', negative, 18, 16 / 18, '#000000'],
    ['resources/trayTemplate@2x.png', negative, 36, 32 / 36, '#000000']
  ]
  for (const [out, svg, size, content, mono] of jobs) {
    const b64 = await win.webContents.executeJavaScript(draw(svg, size, content, mono))
    fs.writeFileSync(path.join(root, out), Buffer.from(b64, 'base64'))
    console.log(`wrote ${out} (${size}x${size})`)
  }
  writeIconDocument()
  app.quit()
})
