import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type CaptureStartPayload, type SnapkitApi } from '@shared/ipc'

const api: SnapkitApi = {
  platform: process.platform,
  onCaptureStart: (cb) => ipcRenderer.on(IPC.captureStart, (_e, p: CaptureStartPayload) => cb(p)),
  onClearSelection: (cb) => ipcRenderer.on(IPC.clearSelection, () => cb()),
  onReset: (cb) => ipcRenderer.on(IPC.reset, () => cb()),
  ready: (s) => ipcRenderer.send(IPC.ready, s),
  selectionStarted: (s) => ipcRenderer.send(IPC.selectionStarted, s),
  copy: (s, png) => ipcRenderer.send(IPC.copy, s, png),
  save: (s, png) => ipcRenderer.send(IPC.save, s, png),
  cancel: (s) => ipcRenderer.send(IPC.cancel, s)
}

contextBridge.exposeInMainWorld('snapkit', api)
