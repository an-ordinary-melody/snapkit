import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CaptureDoc, HistoryItem, HistoryRecord, HistoryUsage } from '@shared/ipc'
import { toPrune, type HistoryEntry } from '@shared/history'
import { log } from './log'
import { getSettings } from './settings'

/**
 * Past captures (plan: docs/history.md). Each entry is a folder:
 *   final.png  - the output as copied/saved, for "copy again"
 *   source.png - the plain crop, and doc.json - drawings + background, for re-editing
 *   thumb.jpg  - for the panel
 * plus history/index.json, kept in memory, newest first.
 */
export const historyDir = () => join(app.getPath('userData'), 'history')
const indexFile = () => join(historyDir(), 'index.json')
const entryDir = (id: string) => join(historyDir(), id)

let entries: HistoryEntry[] = []
const listeners = new Set<(items: HistoryItem[]) => void>()
let indexTimer: NodeJS.Timeout | null = null

const items = (): HistoryItem[] =>
  entries.map(({ id, updatedAt, width, height, bytes, starred }) => ({ id, updatedAt, width, height, bytes, starred }))

export const historyItems = items

export function onHistoryChange(fn: (items: HistoryItem[]) => void) {
  listeners.add(fn)
}

function changed() {
  entries.sort((a, b) => b.updatedAt - a.updatedAt)
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = setTimeout(saveIndex, 150)
  for (const fn of listeners) fn(items())
}

/** Write index.json now (atomically). */
export function saveIndex() {
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = null
  try {
    mkdirSync(historyDir(), { recursive: true })
    writeFileSync(indexFile() + '.tmp', JSON.stringify(entries))
    renameSync(indexFile() + '.tmp', indexFile())
  } catch (err) {
    log('[history] could not save the index', err)
  }
}

/**
 * Load the index and tidy up: remove half-written (.tmp) and orphan folders,
 * and entries whose files are gone. Then apply the limits.
 */
export function loadHistory() {
  const dir = historyDir()
  mkdirSync(dir, { recursive: true })
  try {
    entries = existsSync(indexFile()) ? JSON.parse(readFileSync(indexFile(), 'utf8')) : []
    if (!Array.isArray(entries)) entries = []
  } catch {
    entries = []
  }
  const known = new Set(entries.map((e) => e.id))
  for (const name of readdirSync(dir)) {
    if (name === 'index.json' || name === 'index.json.tmp') continue
    if (name.endsWith('.tmp') || !known.has(name)) rmSync(join(dir, name), { recursive: true, force: true })
  }
  const before = entries.length
  entries = entries.filter((e) => existsSync(join(entryDir(e.id), 'final.png')))
  if (entries.length !== before) log(`[history] dropped ${before - entries.length} entries with missing files`)
  void prune()
  changed()
}

/** Apply the count / size / age limits (starred entries are kept). */
export async function prune() {
  const drop = toPrune(entries, getSettings().history)
  if (!drop.length) return
  entries = entries.filter((e) => !drop.includes(e.id))
  changed()
  await Promise.all(drop.map((id) => rm(entryDir(id), { recursive: true, force: true })))
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Keep an output. Written to a .tmp folder and renamed when complete, so a
 * crash never leaves a half entry. An output from an entry being re-edited
 * replaces that entry (and moves it to the top).
 */
export async function addToHistory(r: HistoryRecord): Promise<string | null> {
  const settings = getSettings().history
  if (settings.paused || settings.maxCount <= 0) return null
  const replace = r.doc.historyId && entries.find((e) => e.id === r.doc.historyId)
  const id = replace ? replace.id : newId()
  const tmp = join(historyDir(), `${id}.tmp`)
  const t0 = Date.now()
  try {
    await mkdir(tmp, { recursive: true })
    const { png, ...doc } = r.doc
    await Promise.all([
      writeFile(join(tmp, 'final.png'), r.final),
      writeFile(join(tmp, 'source.png'), png),
      writeFile(join(tmp, 'thumb.jpg'), r.thumb),
      writeFile(join(tmp, 'doc.json'), JSON.stringify({ ...doc, historyId: id }))
    ])
    const bytes = r.final.byteLength + png.byteLength + r.thumb.byteLength
    await rm(entryDir(id), { recursive: true, force: true })
    await rename(tmp, entryDir(id))
    const size = await outputSize(r.final)
    const now = Date.now()
    entries = entries.filter((e) => e.id !== id)
    entries.unshift({ id, createdAt: replace ? replace.createdAt : now, updatedAt: now, ...size, bytes, starred: replace ? replace.starred : false })
    changed()
    await prune()
    log(`[history] ${replace ? 'updated' : 'added'} ${id} (${Math.round(bytes / 1024)} KB) in ${Date.now() - t0}ms`)
    return id
  } catch (err) {
    log('[history] could not save the capture', err)
    await rm(tmp, { recursive: true, force: true })
    return null
  }
}

/** PNG width/height from its header (no decoding). */
async function outputSize(png: Uint8Array) {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  return b.length > 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : { width: 0, height: 0 }
}

export const historyFile = (id: string, name: 'final.png' | 'thumb.jpg') => {
  if (!entries.some((e) => e.id === id)) return Promise.resolve(null)
  return readFile(join(entryDir(id), name)).catch(() => null)
}

/** The capture document to reopen an entry in the editor. */
export async function historyDoc(id: string): Promise<CaptureDoc | null> {
  if (!entries.some((e) => e.id === id)) return null
  try {
    const [png, doc] = await Promise.all([readFile(join(entryDir(id), 'source.png')), readFile(join(entryDir(id), 'doc.json'), 'utf8')])
    return { ...JSON.parse(doc), png: new Uint8Array(png), historyId: id }
  } catch {
    return null
  }
}

export function setStarred(id: string, starred: boolean) {
  const e = entries.find((x) => x.id === id)
  if (!e) return
  e.starred = starred
  changed()
  void prune() // unstarring may put it over a limit
}

export async function deleteEntry(id: string) {
  entries = entries.filter((e) => e.id !== id)
  changed()
  await rm(entryDir(id), { recursive: true, force: true })
}

/** Delete everything (or everything but starred entries). */
export async function clearHistory(keepStarred: boolean): Promise<HistoryUsage> {
  const drop = entries.filter((e) => !keepStarred || !e.starred).map((e) => e.id)
  entries = entries.filter((e) => !drop.includes(e.id))
  changed()
  await Promise.all(drop.map((id) => rm(entryDir(id), { recursive: true, force: true })))
  return usage()
}

export function usage(): HistoryUsage {
  return { count: entries.length, bytes: entries.reduce((n, e) => n + e.bytes, 0), folder: historyDir() }
}
