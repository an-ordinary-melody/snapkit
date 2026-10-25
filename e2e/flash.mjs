// Windows: capture mode must open straight to the dim, with no white flash first.
// Films the screen (~20 frames a second, via PowerShell) while capture mode opens and reports
// how much brighter than before the brightest frame got. The dim only ever makes it darker.
// Usage: npm run build && node e2e/flash.mjs <out-dir>   (macOS: skipped)
import { _electron as electron } from 'playwright-core'
import { spawn } from 'child_process'
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

// Mean brightness (0–255) of each frame, sampled on a grid, for `ms` milliseconds.
const FILM = `
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$op = [System.Drawing.CopyPixelOperation]::SourceCopy -bor [System.Drawing.CopyPixelOperation]::CaptureBlt
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.ElapsedMilliseconds -lt [int]$env:FILM_MS) {
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size, $op)
  $sum = 0; $n = 0
  for ($y = 8; $y -lt $b.Height; $y += 48) { for ($x = 8; $x -lt $b.Width; $x += 48) { $c = $bmp.GetPixel($x, $y); $sum += ($c.R + $c.G + $c.B) / 3; $n++ } }
  "$($sw.ElapsedMilliseconds) $([math]::Round($sum / $n, 1))"
}
`

const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])] })
try {
  await wait(3000)
  const results = []
  for (let round = 1; round <= 3; round++) {
    const film = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', FILM], { env: { ...process.env, FILM_MS: '2200' } })
    let text = ''
    film.stdout.on('data', (d) => (text += d))
    const done = new Promise((r) => film.on('close', r))
    await wait(700) // a few frames of the normal screen first
    const t = Date.now()
    await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
    await done
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
