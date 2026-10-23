import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ArmPayload, type PixelsPayload, type SnapkitApi } from '@shared/ipc'

const api: SnapkitApi = {
  platform: process.platform,
  onArm: (cb) => ipcRenderer.on(IPC.arm, (_e, p: ArmPayload) => cb(p)),
  onPixels: (cb) => ipcRenderer.on(IPC.pixels, (_e, p: PixelsPayload) => cb(p)),
  onClearSelection: (cb) => ipcRenderer.on(IPC.clearSelection, () => cb()),
  onReset: (cb) => ipcRenderer.on(IPC.reset, () => cb()),
  armed: (s) => ipcRenderer.send(IPC.armed, s),
  painted: (s) => ipcRenderer.send(IPC.painted, s),
  cleared: () => ipcRenderer.send(IPC.cleared),
  selectionStarted: (s) => ipcRenderer.send(IPC.selectionStarted, s),
  copy: (s, png) => ipcRenderer.send(IPC.copy, s, png),
  save: (s, png) => ipcRenderer.send(IPC.save, s, png),
  cancel: (s) => ipcRenderer.send(IPC.cancel, s),
  readImage: (path) => ipcRenderer.invoke(IPC.readImage, path)
}

contextBridge.exposeInMainWorld('snapkit', api)
