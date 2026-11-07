// Writes the shared test screen for scene renders (fixtures/screens/bands-1470x956@2.png):
// five fixed colour bands, the same pixels on every machine, so Electron and native renders compare.
// Usage: node scripts/make-test-screen.mjs [width height scale]
import { writeFileSync } from 'fs'
import { join } from 'path'
import { deflateSync } from 'zlib'

const [w = 1470, h = 956, scale = 2] = process.argv.slice(2).map(Number)
const W = w * scale
const H = h * scale
const BANDS = [[0x2d, 0xd4, 0xbf], [0x63, 0x66, 0xf1], [0xf9, 0x73, 0x16], [0xec, 0x48, 0x99], [0x22, 0xc5, 0x5e]]

const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y++) {
  const row = y * (W * 3 + 1) // filter byte 0
  for (let x = 0; x < W; x++) BANDS[Math.min(4, Math.floor((x / W) * 5))].forEach((v, i) => (raw[row + 1 + x * 3 + i] = v))
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (b) => {
  let c = 0xffffffff
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
const out = join(import.meta.dirname, '..', 'fixtures', 'screens', `bands-${w}x${h}@${scale}.png`)
writeFileSync(out, png)
console.log(out, `${W}x${H}`, png.length, 'bytes')
