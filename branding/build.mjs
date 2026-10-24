// Snapkit brand assets: the snapping-hand glyph and the icon / lockup variants.
// The hand is drawn once here; every SVG is generated from it.
// Usage: node branding/build.mjs   (writes the .svg files next to this script)
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))

// ---- the glyph (100 × 100) ---------------------------------------------------
// A hand mid-snap: palm at the bottom left, thumb up, index finger pointing up
// to the right, middle finger tucked under it, and three snap lines between
// thumb and finger. Built from round strokes and one blob, so it reads as one
// soft silhouette at any size.
const HAND = [
  // palm
  '<path d="M23 66c0-11 8-19 19-20l14-1c7 0 12 5 12 12v4c0 13-11 24-24 24h-3C30 85 23 77 23 66Z"/>',
  // thumb
  '<path d="M33 62 27.5 38" fill="none" stroke-width="15" stroke-linecap="round"/>',
  // index finger
  '<path d="M45 58 74 35" fill="none" stroke-width="14.5" stroke-linecap="round"/>',
  // middle finger, tucked under the index
  '<path d="M52 70 70 57" fill="none" stroke-width="13" stroke-linecap="round"/>'
]
/** The crease between index and middle finger, drawn in the background color. */
const CREASE = '<path d="M50.5 63.8 64.5 53" fill="none" stroke-width="2.6" stroke-linecap="round"/>'
/** Snap lines. */
const RAYS = [
  '<path d="M36.5 26 33 18"/>',
  '<path d="M45 22.5 45.8 13"/>',
  '<path d="M53 27 59.5 20.5"/>'
]

/**
 * The glyph in `hand` color, with rays in `rays` color, placed in a box of
 * `size` at (x, y). `crease` is the color behind the hand (for the finger gap).
 */
function glyph({ hand, rays = hand, crease, x = 0, y = 0, size = 100, id = 'g' }) {
  const fill = hand
  return `<g transform="translate(${x} ${y}) scale(${size / 100})">
    <g fill="${fill}" stroke="${fill}">${HAND.join('')}</g>
    ${crease ? `<g stroke="${crease}">${CREASE}</g>` : ''}
    <g fill="none" stroke="${rays}" stroke-width="4.6" stroke-linecap="round">${RAYS.join('')}</g>
  </g>`.replace(/\n\s*/g, '')
}

// ---- shared pieces ------------------------------------------------------------
const C = {
  blue1: '#1E8BFF',
  blue2: '#4A2BEF',
  navy: '#0D1330',
  ink: '#0B1020',
  ink2: '#1A2238',
  paper: '#F4F6FA',
  purple1: '#8A63FF',
  purple2: '#5B3BE6',
  rayBlue: '#2F7BFF',
  /** Where the finger crease sits on the gradient tiles. */
  blueMid: '#3463F6',
  purpleMid: '#7550F3'
}
const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}">
<title>${title}</title>
${body}
</svg>
`
const grad = (id, a, b, x1 = 0, y1 = 0, x2 = 1, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
/** The app-icon tile: a rounded square (macOS-like corner radius). */
const tile = (fill, extra = '') => `<rect x="4" y="4" width="92" height="92" rx="22" fill="${fill}"${extra}/>`
/** Crop-corner brackets around the tile's content. */
const corners = (stroke, inset = 18, len = 12, w = 4.2) => {
  const a = inset
  const b = 100 - inset
  return `<g fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${a} ${a + len}V${a + 4}a4 4 0 0 1 4-4h${len - 4}"/>
    <path d="M${b - len} ${a}h${len - 4}a4 4 0 0 1 4 4v${len - 4}"/>
    <path d="M${a} ${b - len}v${len - 4}a4 4 0 0 0 4 4h${len - 4}"/>
    <path d="M${b - len} ${b}h${len - 4}a4 4 0 0 0 4-4v${-(len - 4)}"/>
  </g>`.replace(/\n\s*/g, '')
}
/** Wordmark. A rounded geometric sans; the first fonts in the list are the intended look. */
const WORD_FONT = `font-family="'Plus Jakarta Sans','Manrope','Inter','SF Pro Rounded','SF Pro Display',system-ui,sans-serif" font-weight="700" letter-spacing="-0.02em"`
const word = (x, y, size, fill = C.navy, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-size="${size}" ${WORD_FONT} fill="${fill}" text-anchor="${anchor}">snapkit</text>`

// ---- 1. The Snap: blue tile, white hand ------------------------------------------
const icons = {}
icons['icon-snap'] = svg(
  100,
  100,
  `<defs>${grad('bg', C.blue1, C.blue2)}${grad('hand', '#FFFFFF', '#E6EBFF', 0, 0, 0, 1)}</defs>
${tile('url(#bg)')}
${glyph({ hand: 'url(#hand)', crease: C.blueMid, x: 14, y: 14, size: 72 })}`,
  'Snapkit icon: The Snap'
)

// ---- 2. Screenshot Frame: dark tile, crop corners, white hand with blue rays -------
icons['icon-frame'] = svg(
  100,
  100,
  `<defs>${grad('bg', C.ink2, C.ink)}${grad('crop', '#3D8BFF', '#5A3CF0', 0, 0, 1, 1)}</defs>
${tile('url(#bg)')}
${corners('url(#crop)', 17, 13)}
${glyph({ hand: '#FFFFFF', rays: C.rayBlue, crease: '#121A2C', x: 23, y: 21, size: 56 })}`,
  'Snapkit icon: Screenshot Frame'
)

// ---- 3. Minimal Outline: light tile, two big brackets, navy hand ------------------
icons['icon-outline'] = svg(
  100,
  100,
  `<defs>${grad('brk', '#1E8BFF', '#4A2BEF')}</defs>
${tile('#FFFFFF', ` stroke="#E4E8F0" stroke-width="1.2"`)}
<g fill="none" stroke="url(#brk)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 46V24a8 8 0 0 1 8-8h22"/>
  <path d="M84 54v22a8 8 0 0 1-8 8H54"/>
</g>
${glyph({ hand: C.navy, rays: C.rayBlue, crease: '#FFFFFF', x: 22, y: 20, size: 58 })}`,
  'Snapkit icon: Minimal Outline'
)

// ---- 5. Edge Capture: dark tile, light edge bracket on the right ------------------
icons['icon-edge'] = svg(
  100,
  100,
  `<defs>${grad('bg', '#232B3D', '#05080F')}${grad('hand', '#FFFFFF', '#C9D1E3', 0, 0, 0.4, 1)}${grad('edge', '#9AA4B8', '#F2F4F8', 0, 0, 0, 1)}</defs>
${tile('url(#bg)')}
<path d="M62 16h12a6 6 0 0 1 6 6v56a6 6 0 0 1-6 6H62" fill="none" stroke="url(#edge)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
${glyph({ hand: 'url(#hand)', rays: C.rayBlue, crease: '#141A28', x: 14, y: 18, size: 62 })}`,
  'Snapkit icon: Edge Capture'
)

// ---- the glyph alone (currentColor, for UI / favicons) ------------------------------
icons['glyph'] = svg(100, 100, glyph({ hand: 'currentColor' }), 'Snapkit glyph')

// ---- 4. Horizontal lockup: blue tile with one corner bracket + wordmark ------------
icons['lockup-horizontal'] = svg(
  420,
  120,
  `<defs>${grad('bg', C.blue1, C.blue2)}</defs>
<g transform="translate(6 10)">
  <rect x="0" y="0" width="100" height="100" rx="22" fill="url(#bg)"/>
  <path d="M62 16h14a8 8 0 0 1 8 8v14" fill="none" stroke="#FFFFFF" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
  ${glyph({ hand: '#FFFFFF', crease: C.blueMid, x: 12, y: 16, size: 70 })}
</g>
${word(132, 84, 64)}`,
  'Snapkit'
)

// ---- 6. Color variations + stacked wordmark -----------------------------------------
const varTile = (x, bg, hand, rays, crease, defs = '') =>
  `<g transform="translate(${x} 0)">${defs}<rect x="0" y="0" width="100" height="100" rx="22" fill="${bg}"/>${glyph({ hand, rays, crease, x: 15, y: 15, size: 70 })}</g>`
icons['icon-variations'] = svg(
  460,
  170,
  `<defs>${grad('vb', C.blue1, C.blue2)}${grad('vp', C.purple1, C.purple2)}</defs>
${varTile(0, 'url(#vb)', '#FFFFFF', '#FFFFFF', C.blueMid)}
${varTile(120, C.ink, '#FFFFFF', '#59A0FF', C.ink)}
${varTile(240, '#EEF1F6', C.navy, C.rayBlue, '#EEF1F6')}
${varTile(360, 'url(#vp)', '#FFFFFF', '#FFFFFF', C.purpleMid)}
${word(230, 158, 44, C.navy, 'middle')}`,
  'Snapkit color variations'
)

// ---- stacked logo (icon above the wordmark), for README / about ---------------------
icons['logo-stacked'] = svg(
  300,
  300,
  `<defs>${grad('bg', C.blue1, C.blue2)}${grad('hand', '#FFFFFF', '#E6EBFF', 0, 0, 0, 1)}</defs>
<g transform="translate(75 20) scale(1.5)">
  <rect x="0" y="0" width="100" height="100" rx="22" fill="url(#bg)"/>
  ${glyph({ hand: 'url(#hand)', crease: C.blueMid, x: 14, y: 14, size: 72 })}
</g>
${word(150, 250, 62, C.navy, 'middle')}`,
  'Snapkit'
)

// Gradient ids get the file's name, so several of these SVGs can share one HTML page.
const scoped = (name, text) => text.replace(/id="([\w-]+)"/g, `id="${name}-$1"`).replace(/url\(#([\w-]+)\)/g, `url(#${name}-$1)`)
for (const [name, text] of Object.entries(icons)) writeFileSync(join(dir, `${name}.svg`), scoped(name, text))
console.log(`wrote ${Object.keys(icons).length} files: ${Object.keys(icons).map((n) => n + '.svg').join(', ')}`)
