import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { applyPatch, defaultsFor, mergeSettings, type Settings, type SettingsPatch } from '@shared/settings'

/** The defaults on this OS (see defaultsFor). */
export const DEFAULTS = defaultsFor(process.platform)

export const settingsFile = () => join(app.getPath('userData'), 'settings.json')

/**
 * Only changed values are stored on disk, never the full defaults, so new
 * defaults in an update still apply to everything the user hasn't changed.
 */
let saved: Record<string, unknown> | null = null
let current: Settings | null = null
const listeners = new Set<(s: Settings, prev: Settings) => void>()

function readSaved(): Record<string, unknown> {
  if (saved) return saved
  try {
    saved = existsSync(settingsFile()) ? JSON.parse(readFileSync(settingsFile(), 'utf8')) : {}
  } catch (err) {
    console.error('[settings] failed to read, using defaults', err)
    saved = {}
  }
  return saved!
}

export function getSettings(): Settings {
  if (!current) current = mergeSettings(DEFAULTS, readSaved())
  return current
}

/** Called after every change, with the new and previous settings. */
export function onSettingsChange(fn: (s: Settings, prev: Settings) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let flushTimer: NodeJS.Timeout | null = null
let dirty = false

/** Write the stored overrides to disk now (atomically, so a crash never leaves a half-written file). */
export function flushSettings() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (!saved || !dirty) return
  dirty = false
  const path = settingsFile()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path + '.tmp', JSON.stringify(saved, null, 2))
  renameSync(path + '.tmp', path)
}

/**
 * Apply a change in memory right away and write it to disk shortly after:
 * dragging a slider makes many changes a second, and each one would
 * otherwise rewrite the file.
 */
function write(next: Record<string, unknown>) {
  const prev = getSettings()
  saved = next
  current = mergeSettings(DEFAULTS, next)
  dirty = true
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushSettings, 100)
  for (const fn of listeners) fn(current, prev)
  return current
}

/** Merge `patch` (any depth) into the stored overrides and save. */
export function updateSettings(patch: SettingsPatch): Settings {
  return write(applyPatch(readSaved(), patch as Record<string, unknown>))
}

/** Back to the defaults for these top-level sections (all of them if none are given). */
export function resetSettings(sections?: (keyof Settings)[]): Settings {
  if (!sections) return write({})
  const next = { ...readSaved() }
  for (const k of sections) delete next[k]
  return write(next)
}
