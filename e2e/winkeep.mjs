// Windows: the capture window is never hidden (Windows would animate it each time it appears).
// Between captures it stays shown but invisible, and after capture mode closes the keyboard must
// go back to the app the user was in. Usage: npm run build && node e2e/winkeep.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
if (process.platform !== 'win32') {
  console.log('winkeep test: skipped (Windows only)')
  process.exit(0)
}
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', fullscreen: '', settings: '', history: '' } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])] })
const overlayState = () =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('#overlay'))
    return { visible: w.isVisible(), opacity: w.getOpacity(), onTop: w.isAlwaysOnTop(), focused: w.isFocused() }
  })

try {
  await wait(3500)
  const idle = await overlayState()
  console.log('between captures: shown but invisible:', idle.visible && idle.opacity === 0 && !idle.onTop, JSON.stringify(idle))

  // "Another app": a normal window with the keyboard.
  await app.evaluate(({ BrowserWindow }) => {
    const w = new BrowserWindow({ x: 120, y: 80, width: 600, height: 400, show: true, title: 'Another app' })
    w.focus()
    globalThis.__other = w
  })
  await wait(600)
  for (let round = 1; round <= 3; round++) {
    await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
    let open = false
    for (let i = 0; i < 30 && !open; i++) {
      await wait(100)
      const s = await overlayState()
      open = s.visible && s.opacity > 0 && s.onTop
    }
    await wait(400)
    const ov = app.windows().find((w) => w.url().endsWith('#overlay'))
    await ov.keyboard.press('Escape')
    await wait(600)
    const after = await overlayState()
    const back = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle() ?? 'none')
    console.log(`round ${round}: opened ${open} | closed invisible ${after.opacity === 0 && !after.onTop} | keyboard back to: ${back}`)
  }
} finally {
  await app.close()
}
