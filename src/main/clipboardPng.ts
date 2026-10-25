import { clipboard, nativeImage } from 'electron'
import { log } from './log'

type Win32 = {
  OpenClipboard(hwnd: bigint): number
  CloseClipboard(): number
  RegisterClipboardFormatW(name: string): number
  SetClipboardData(format: number, mem: bigint): bigint
  GlobalAlloc(flags: number, size: number): bigint
  GlobalLock(mem: bigint): bigint
  GlobalUnlock(mem: bigint): number
  GlobalFree(mem: bigint): bigint
  RtlMoveMemory(dest: bigint, src: Buffer, size: number): void
}
let win32: Win32 | null | undefined

function loadWin32(): Win32 | null {
  if (win32 !== undefined) return win32
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    win32 = {
      OpenClipboard: user32.func('int __stdcall OpenClipboard(intptr_t hwnd)'),
      CloseClipboard: user32.func('int __stdcall CloseClipboard()'),
      RegisterClipboardFormatW: user32.func('uint32_t __stdcall RegisterClipboardFormatW(str16 name)'),
      SetClipboardData: user32.func('intptr_t __stdcall SetClipboardData(uint32_t format, intptr_t mem)'),
      GlobalAlloc: kernel32.func('intptr_t __stdcall GlobalAlloc(uint32_t flags, size_t size)'),
      GlobalLock: kernel32.func('intptr_t __stdcall GlobalLock(intptr_t mem)'),
      GlobalUnlock: kernel32.func('int __stdcall GlobalUnlock(intptr_t mem)'),
      GlobalFree: kernel32.func('intptr_t __stdcall GlobalFree(intptr_t mem)'),
      RtlMoveMemory: kernel32.func('void __stdcall RtlMoveMemory(intptr_t dest, const uint8_t *src, size_t size)')
    }
  } catch (err) {
    log('[clipboard] couldn\'t load the Windows clipboard functions:', String(err))
    win32 = null
  }
  return win32
}

/** Windows: add (or replace) the "PNG" format next to what's already on the clipboard. */
function addPngFormat(png: Buffer) {
  const w = loadWin32()
  if (!w) return false
  if (!w.OpenClipboard(0n)) return false
  try {
    const mem = w.GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, png.length)
    if (!mem) return false
    const ptr = w.GlobalLock(mem)
    if (!ptr) {
      w.GlobalFree(mem)
      return false
    }
    w.RtlMoveMemory(ptr, png, png.length)
    w.GlobalUnlock(mem)
    if (w.SetClipboardData(w.RegisterClipboardFormatW('PNG'), mem)) return true // the clipboard owns it now
    w.GlobalFree(mem)
    return false
  } finally {
    w.CloseClipboard()
  }
}

/**
 * Put a PNG on the clipboard keeping its exact bytes, so a compressed PNG
 * stays compressed when pasted. (clipboard.writeImage decodes it, and the
 * OS encodes it again at full size.) Apps that paste PNG data (browsers,
 * Slack, Discord, Notion, Office) get these bytes; others get a bitmap.
 */
export function writePngExact(png: Buffer) {
  if (process.platform === 'darwin') {
    // macOS converts public.png to TIFF and the other image types when an app asks.
    clipboard.writeBuffer('public.png', png)
    return
  }
  clipboard.writeImage(nativeImage.createFromBuffer(png)) // a bitmap for every app
  if (process.platform === 'win32' && !addPngFormat(png)) log('[clipboard] couldn\'t add the compressed PNG; apps get the bitmap only')
}
