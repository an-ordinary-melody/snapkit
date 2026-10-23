import { app } from 'electron'
import { mkdirSync, renameSync, statSync } from 'fs'
import { appendFile } from 'fs/promises'
import { join } from 'path'

let file: string | null = null
let queue: Promise<void> = Promise.resolve()

/** Keep one previous log: past 1 MB, main.log becomes main.old.log. */
const MAX_BYTES = 1024 * 1024

function logFile() {
  if (file) return file
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'main.log')
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'main.old.log'))
  } catch {
    // no log yet
  }
  return file
}

/**
 * Console + ~/Library/Logs/Snapkit/main.log (or %APPDATA%\Snapkit\logs on Windows).
 * Written in the background, in order, so logging never holds up a capture.
 */
export function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`
  console.log(line)
  try {
    const path = logFile()
    queue = queue.then(() => appendFile(path, line + '\n')).catch(() => {}) // logging must never break capture
  } catch {
    // logging must never break capture
  }
}
