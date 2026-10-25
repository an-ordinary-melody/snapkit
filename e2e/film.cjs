// Helper for e2e/flash.mjs: films the primary screen with Snapkit's own capture engine (it sees what
// the user sees, including see-through windows) and prints "<ms> <mean brightness 0-255>" per frame.
// Usage: node e2e/film.cjs <milliseconds>
const { Monitor } = require('node-screenshots')
const ms = Number(process.argv[2] || 2000)
const monitor = Monitor.all().find((m) => m.isPrimary?.()) ?? Monitor.all()[0]
const t0 = Date.now()
while (Date.now() - t0 < ms) {
  const img = monitor.captureImageSync()
  const raw = img.toRawSync() // RGBA
  const w = img.width
  const h = img.height
  let sum = 0
  let n = 0
  for (let y = 8; y < h; y += 32) for (let x = 8; x < w; x += 32) {
    const i = (y * w + x) * 4
    sum += (raw[i] + raw[i + 1] + raw[i + 2]) / 3
    n++
  }
  process.stdout.write(`${Date.now() - t0} ${(sum / n).toFixed(1)}\n`)
}
