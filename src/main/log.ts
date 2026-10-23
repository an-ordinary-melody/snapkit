import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

let file: string | null = null

/** Console + ~/Library/Logs/Snapkit/main.log (or %APPDATA%\Snapkit\logs on Windows). */
export function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`
  console.log(line)
  try {
    if (!file) {
      const dir = app.getPath('logs')
      mkdirSync(dir, { recursive: true })
      file = join(dir, 'main.log')
    }
    appendFileSync(file, line + '\n')
  } catch {
    // logging must never break capture
  }
}
