/** Minimal engine shape the ordering needs (kept free of Electron so it can be unit tested). */
export interface Orderable {
  id: string
  platforms: string[]
}

/** Preferred order per OS: fastest first, the always-available one last. */
export const ORDER: Record<string, string[]> = {
  darwin: ['node-screenshots', 'desktop-capturer'],
  win32: ['node-screenshots', 'desktop-capturer'],
  linux: ['node-screenshots', 'desktop-capturer']
}

/**
 * Engines to try for `platform`, in order. `choice` ('auto' or an engine id)
 * moves that engine to the front; the others stay as fallbacks.
 */
export function orderEngines<E extends Orderable>(engines: E[], platform: string, choice: string): E[] {
  const ids = ORDER[platform] ?? engines.map((e) => e.id)
  const ordered = ids.map((id) => engines.find((e) => e.id === id)).filter((e): e is E => !!e && e.platforms.includes(platform))
  const forced = ordered.find((e) => e.id === choice)
  return forced ? [forced, ...ordered.filter((e) => e !== forced)] : ordered
}
