import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings'

const file = () => join(app.getPath('userData'), 'settings.json')

let current: Settings | null = null

export function getSettings(): Settings {
  if (current) return current
  try {
    const raw = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}
    current = mergeSettings(DEFAULT_SETTINGS, raw)
  } catch (err) {
    console.error('[settings] failed to read, using defaults', err)
    current = structuredClone(DEFAULT_SETTINGS)
  }
  return current
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = mergeSettings(getSettings(), patch)
  const path = file()
  mkdirSync(dirname(path), { recursive: true })
  // Write atomically so a crash never leaves a half-written settings file.
  writeFileSync(path + '.tmp', JSON.stringify(current, null, 2))
  renameSync(path + '.tmp', path)
  return current
}
