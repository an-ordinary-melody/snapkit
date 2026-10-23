import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings'

const file = () => join(app.getPath('userData'), 'settings.json')

/**
 * Only changed values are stored on disk, never the full defaults, so new
 * defaults in an update still apply to everything the user hasn't changed.
 */
let saved: Record<string, unknown> | null = null
let current: Settings | null = null

function readSaved(): Record<string, unknown> {
  if (saved) return saved
  try {
    saved = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}
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

/** Merge `patch` into the stored overrides (one level deep per section) and save. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Record<string, unknown> = { ...readSaved() }
  for (const [k, v] of Object.entries(patch)) {
    const prev = next[k]
    next[k] = v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object' ? { ...prev, ...v } : v
  }
  saved = next
  current = mergeSettings(DEFAULT_SETTINGS, next)
  const path = file()
  mkdirSync(dirname(path), { recursive: true })
  // Write atomically so a crash never leaves a half-written settings file.
  writeFileSync(path + '.tmp', JSON.stringify(next, null, 2))
  renameSync(path + '.tmp', path)
  return current
}
