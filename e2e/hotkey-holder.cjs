// Stand-in for "another app" that holds a global shortcut (used by e2e/hotkeys.mjs).
// Usage: electron e2e/hotkey-holder.cjs <accelerator>
const { app, globalShortcut } = require('electron')
app.whenReady().then(() => {
  const ok = globalShortcut.register(process.argv.at(-1), () => {})
  console.log(ok ? 'holding' : 'could not hold')
})
app.on('window-all-closed', () => {})
