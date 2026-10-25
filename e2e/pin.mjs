// Floating preview + pin test: turn the preview on, copy, then copy / edit /
// pin from the preview. Usage: npm run build && node e2e/pin.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, notifications: { onCopy: false } }))

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// SNAPKIT_E2E_ARGS: extra Chromium switches, e.g. --force-device-scale-factor=1.5 to act like 150% display scaling.
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])] })
const floating = (view) =>
  app.evaluate(
    ({ BrowserWindow, screen }, view) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('#' + view))
        .map((w) => ({ visible: w.isVisible(), bounds: w.getBounds(), workArea: screen.getDisplayMatching(w.getBounds()).workArea })),
    view
  )
const windowFor = (view) => app.windows().find((w) => w.url().endsWith('#' + view))
const overlayVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))
const clip = () => app.evaluate(({ clipboard }) => clipboard.readImage().getSize())
const drag = async (m, x1, y1, x2, y2) => {
  await m.move(x1, y1); await m.down(); await m.move(x2, y2, { steps: 5 }); await m.up(); await wait(80)
}
const capture = async () => {
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(900)
  const win = windowFor('overlay')
  await drag(win.mouse, 300, 200, 700, 500)
  await wait(200)
  return win
}

try {
  await wait(2500)
  const ov = await capture()
  await ov.keyboard.press('a')
  await drag(ov.mouse, 350, 250, 600, 420)
  console.log('preview toggle starts:', await ov.$eval('.toolbar button[data-id="pin"]', (b) => b.dataset.tip))
  await ov.click('.toolbar button[data-id="pin"]')
  console.log('after click:', await ov.$eval('.toolbar button[data-id="pin"]', (b) => b.dataset.tip), '| dot:', !!(await ov.$('.toolbar button[data-id="pin"] .on-dot')))
  await ov.keyboard.press(MOD + '+c')
  await wait(1200)
  let thumbs = await floating('thumb')
  const t = thumbs[0]
  const corner = t && Math.abs(t.bounds.x + t.bounds.width - (t.workArea.x + t.workArea.width)) <= 20 && Math.abs(t.bounds.y + t.bounds.height - (t.workArea.y + t.workArea.height)) <= 20
  console.log('preview after ⌘C:', thumbs.length, 'in the bottom-right corner:', corner, JSON.stringify(t?.bounds), '| clipboard:', JSON.stringify(await clip()))

  // Windows: the preview must stay above the app the user goes back to after copying.
  // (A real bug: it was shown but ended up behind that app's window until the user minimized it.)
  // Ask Windows itself, via PowerShell: is the preview marked topmost, and is it above a focused normal window?
  if (process.platform === 'win32') {
    const { execFileSync } = await import('child_process')
    const hwndOf = (url) =>
      app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(url)).getNativeWindowHandle().readBigUInt64LE(0).toString(), url)
    const zorder = (preview, other) => {
      const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
}
"@
$p = [IntPtr]::new([Int64]${preview}); $o = [IntPtr]::new([Int64]${other})
$top = ([W]::GetWindowLong($p, -20) -band 8) -ne 0
$h = [W]::GetTopWindow([IntPtr]::Zero); $i = 0; $ip = -1; $io = -1
while ($h -ne [IntPtr]::Zero -and $i -lt 10000) { if ($h -eq $p) { $ip = $i }; if ($h -eq $o) { $io = $i }; $h = [W]::GetWindow($h, 2); $i++ }
"topmost=$top above=$($ip -ge 0 -and $io -ge 0 -and $ip -lt $io)"
`
      return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim()
    }
    const preview = await hwndOf('#thumb')
    console.log('Windows: preview topmost right after the copy (info):', zorder(preview, await hwndOf('#overlay')))
    const other = await app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ x: 100, y: 50, width: 900, height: 700, show: true, title: 'Another app' })
      w.focus()
      globalThis.__otherApp = w
      return w.getNativeWindowHandle().readBigUInt64LE(0).toString()
    })
    await wait(800)
    console.log('Windows: preview stays above a focused app window:', zorder(preview, other))
    await app.evaluate(() => globalThis.__otherApp.close())
    await wait(300)
  }

  const thumb = windowFor('thumb')
  await thumb.hover('.thumb')
  await wait(200)
  writeFileSync(join(out, '1-thumb.png'), await thumb.screenshot())
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await thumb.click('.thumb-btn:has-text("Copy")')
  await wait(200)
  console.log('copy from preview:', JSON.stringify(await clip()))

  // Edit: reopens the editor with the arrow; draw a rectangle; Done updates the preview.
  await thumb.click('.thumb-btn:has-text("Edit")')
  await wait(1000)
  const ed = windowFor('overlay')
  console.log('editor open:', !!(await ed.$('.be-backdrop')), '| drawings restored (shape groups):', await ed.evaluate(() => window.Konva?.stages[0]?.getLayers()[0].getChildren().length))
  await ed.click('.be-dock .toolbar button[data-tip="Rectangle"]')
  const host = await ed.$eval('.be-ann .annotations', (e) => e.getBoundingClientRect().toJSON())
  await drag(ed.mouse, host.x + 20, host.y + 20, host.x + host.width / 2, host.y + host.height / 2)
  writeFileSync(join(out, '2-edit.png'), await ed.screenshot())
  await ed.click('.be-btn:has-text("Done")')
  await wait(800)
  console.log('Done closes the editor:', !(await overlayVisible()), '| preview still there:', (await floating('thumb')).length === 1)
  await thumb.hover('.thumb')
  writeFileSync(join(out, '3-thumb-after-edit.png'), await thumb.screenshot())

  // Move handle moves the preview (out of the corner stack).
  const before = (await floating('thumb'))[0].bounds
  const mh = await thumb.$eval('.thumb-move', (e) => e.getBoundingClientRect().toJSON())
  await thumb.hover('.thumb')
  await drag(thumb.mouse, mh.x + mh.width / 2, mh.y + mh.height / 2, mh.x + mh.width / 2 - 120, mh.y + mh.height / 2 - 80)
  await wait(200)
  const after = (await floating('thumb'))[0].bounds
  console.log('move handle moved the preview by', after.x - before.x, after.y - before.y)

  // Pin: turns the preview into a full-size pin where it was captured.
  await thumb.click('.thumb-pin')
  await wait(1000)
  console.log('pin from preview:', JSON.stringify((await floating('pin')).map((p) => p.bounds)), '| preview closed:', (await floating('thumb')).length === 0)

  // Next capture starts with the preview off (the setting's default).
  const ov2 = await capture()
  console.log('next capture starts:', await ov2.$eval('.toolbar button[data-id="pin"]', (b) => b.dataset.tip))
  await ov2.keyboard.press(MOD + '+c')
  await wait(800)
  console.log('no preview when off:', (await floating('thumb')).length === 0, '| pin still visible:', (await floating('pin'))[0]?.visible)

  await windowFor('pin').keyboard.press('Escape').catch(() => {})
  await wait(400)
  console.log('pin closed:', (await floating('pin')).length === 0)
} finally {
  await app.close()
}
