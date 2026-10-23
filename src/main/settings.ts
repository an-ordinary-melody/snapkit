import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { applyPatch, DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch } from '@shared/settings'

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
  if (!current) current = mergeSettings(DEFAULT_SETTINGS, readSaved())
  return current
}

/** Called after every change, with the new and previous settings. */
export function onSettingsChange(fn: (s: Settings, prev: Settings) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function write(next: Record<string, unknown>) {
  const prev = getSettings()
  saved = next
  current = mergeSettings(DEFAULT_SETTINGS, next)
  const path = settingsFile()
  mkdirSync(dirname(path), { recursive: true })
  // Write atomically so a crash never leaves a half-written settings file.
  writeFileSync(path + '.tmp', JSON.stringify(next, null, 2))
  renameSync(path + '.tmp', path)
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
