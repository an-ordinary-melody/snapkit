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
  copy: (s, png, extra) => ipcRenderer.send(IPC.copy, s, png, extra),
  save: (s, png) => ipcRenderer.send(IPC.save, s, png),
  cancel: (s) => ipcRenderer.send(IPC.cancel, s),
  editDone: (s, png, doc) => ipcRenderer.send(IPC.editDone, s, png, doc),
  readImage: (path) => ipcRenderer.invoke(IPC.readImage, path),

  onPinImage: (cb) => ipcRenderer.on(IPC.pinImage, (_e, p) => cb(p)),
  onPinState: (cb) => ipcRenderer.on(IPC.pinState, (_e, p) => cb(p)),
  pinReady: () => ipcRenderer.send(IPC.pinReady),
  pinMoveBy: (dx, dy) => ipcRenderer.send(IPC.pinMoveBy, dx, dy),
  pinZoom: (z, ax, ay) => ipcRenderer.send(IPC.pinZoom, z, ax, ay),
  pinOpacity: (o) => ipcRenderer.send(IPC.pinOpacity, o),
  pinCopy: () => ipcRenderer.send(IPC.pinCopy),
  pinSave: () => ipcRenderer.send(IPC.pinSave),
  pinClose: () => ipcRenderer.send(IPC.pinClose),
  pinDragOut: () => ipcRenderer.send(IPC.pinDragOut),
  pinMenu: () => ipcRenderer.send(IPC.pinMenu),
  thumbEdit: () => ipcRenderer.send(IPC.thumbEdit),
  thumbPin: () => ipcRenderer.send(IPC.thumbPin),

  historyAdd: (r) => ipcRenderer.send(IPC.historyAdd, r),
  historyList: () => ipcRenderer.invoke(IPC.historyList),
  onHistoryChanged: (cb) => ipcRenderer.on(IPC.historyChanged, (_e, items) => cb(items)),
  historyThumb: (id) => ipcRenderer.invoke(IPC.historyThumb, id),
  historyAction: (id, action) => ipcRenderer.send(IPC.historyAction, id, action),
  historyClear: (keepStarred) => ipcRenderer.invoke(IPC.historyClear, keepStarred),
  historyUsage: () => ipcRenderer.invoke(IPC.historyUsage),
  historyReveal: () => ipcRenderer.send(IPC.historyReveal),
  historyClose: () => ipcRenderer.send(IPC.historyClose),

  openSettings: () => ipcRenderer.send(IPC.openSettings),
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsUpdate: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  settingsReset: (sections) => ipcRenderer.invoke(IPC.settingsReset, sections),
  onSettingsChanged: (cb) => ipcRenderer.on(IPC.settingsChanged, (_e, s) => cb(s)),
  settingsSetHotkey: (acc, name) => ipcRenderer.invoke(IPC.settingsSetHotkey, acc, name),
  settingsChooseFolder: () => ipcRenderer.invoke(IPC.settingsChooseFolder),
  settingsReveal: (what) => ipcRenderer.send(IPC.settingsReveal, what)
}

contextBridge.exposeInMainWorld('snapkit', api)
