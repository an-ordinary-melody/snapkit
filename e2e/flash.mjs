// Windows: capture mode must open straight to the dim, with no white flash first.
// Films the screen (Electron's screen capturer, ~5–10 frames a second) while capture mode opens and reports
// how much brighter than before the brightest frame got. The dim only ever makes it darker.
// Usage: npm run build && node e2e/flash.mjs <out-dir>   (macOS: skipped)
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
if (process.platform !== 'win32') {
  console.log('flash test: skipped (Windows only)')
  process.exit(0)
}
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', fullscreen: '', settings: '', history: '' } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))


const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])] })
try {
  await wait(3000)
  const results = []
  for (let round = 1; round <= 3; round++) {
    // Film with Electron's own screen capturer (it sees see-through windows like the dim; GDI-based grabs don't).
    await app.evaluate(({ desktopCapturer }, ms) => {
      globalThis.__film = []
      const t0 = Date.now()
      void (async () => {
        while (Date.now() - t0 < ms) {
          const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 160, height: 120 } })
          const bmp = src.thumbnail.toBitmap()
          let sum = 0
          for (let i = 0; i < bmp.length; i += 4) sum += (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3
          globalThis.__film.push(`${Date.now() - t0} ${(sum / (bmp.length / 4)).toFixed(1)}`)
        }
      })()
    }, 2200)
    await wait(700) // a few frames of the normal screen first
    await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
    await wait(1700)
    const text = (await app.evaluate(() => globalThis.__film)).join('\n')
    const frames = text.trim().split(/\r?\n/).map((l) => l.split(' ').map(Number)).filter((f) => f.length === 2 && !isNaN(f[1]))
    const before = frames.filter(([ms]) => ms < 600).map(([, v]) => v)
    const baseline = before.reduce((a, b) => a + b, 0) / Math.max(1, before.length)
    const after = frames.filter(([ms]) => ms >= 650)
    const brightest = Math.max(...after.map(([, v]) => v))
    const end = after.at(-1)?.[1]
    results.push({ round, baseline: Math.round(baseline), brightest: Math.round(brightest), end: Math.round(end), frames: frames.length })
    writeFileSync(join(out, `film-${round}.txt`), text)
    // Close capture mode and let things settle before the next round.
    await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
    await wait(1500)
    void t
  }
  // A flash: some frame clearly brighter than the screen before (the dim then makes it darker).
  const flash = results.some((r) => r.brightest > r.baseline + 12)
  console.log('capture opens without a white flash:', !flash, JSON.stringify(results))
  console.log('the dim shows:', results.every((r) => r.end < r.baseline - 10))
} finally {
  await app.close()
}
