import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { log } from './log'

/**
 * Only Snapkit's own pages may talk to the main process: the packaged
 * renderer (file://…/renderer/index.html) or, in development, the dev server.
 */
function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  const dev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  const ok = (dev && url.startsWith(dev)) || (url.startsWith('file://') && url.includes('/renderer/index.html'))
  if (!ok) log(`[security] ignored IPC from ${url || 'unknown sender'}`)
  return !!ok
}

/** `ipcMain.on`, but only for messages from Snapkit's own pages. */
export function ipcOn(channel: string, handler: (e: IpcMainEvent, ...args: any[]) => void) {
  ipcMain.on(channel, (e, ...args) => trusted(e) && handler(e, ...args))
}

/** `ipcMain.handle`, but only for requests from Snapkit's own pages. */
export function ipcHandle(channel: string, handler: (e: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (e, ...args) => (trusted(e) ? handler(e, ...args) : null))
}

/** No window may navigate away, open new windows or embed webviews. */
export function lockDownWebContents() {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (ev) => ev.preventDefault())
    contents.on('will-redirect', (ev) => ev.preventDefault())
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
