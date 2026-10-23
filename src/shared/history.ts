/** One past capture, as listed in history/index.json (newest first). */
export interface HistoryEntry {
  id: string
  createdAt: number
  /** Last copied/saved/edited; the list is sorted by this. */
  updatedAt: number
  /** Output image size in px. */
  width: number
  height: number
  /** Disk use of the entry's files. */
  bytes: number
  /** Starred entries are never pruned. */
  starred: boolean
}

/** Hard ceilings, whatever the settings say: history must stay fast. */
export const HISTORY_LIMITS = { maxCount: 100, maxMB: 2000 }

export interface PruneRules {
  maxCount: number
  maxMB: number
  /** 0 = keep forever. */
  maxAgeDays: number
}

/**
 * Which entries to delete. Starred ones are never deleted (and don't count
 * toward the limits' "oldest first" choices). In order: keep at most
 * `maxCount` unstarred entries, then delete the oldest until under
 * `maxMB`, then delete anything older than `maxAgeDays`.
 */
export function toPrune(entries: HistoryEntry[], rules: PruneRules, now = Date.now()): string[] {
  const maxCount = Math.max(0, Math.min(HISTORY_LIMITS.maxCount, Math.floor(rules.maxCount)))
  const maxBytes = Math.max(0, Math.min(HISTORY_LIMITS.maxMB, rules.maxMB)) * 1024 * 1024
  const newestFirst = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
  const drop = new Set<string>()

  newestFirst.filter((e) => !e.starred).slice(maxCount).forEach((e) => drop.add(e.id))

  let total = newestFirst.filter((e) => !drop.has(e.id)).reduce((n, e) => n + e.bytes, 0)
  for (const e of [...newestFirst].reverse()) {
    if (total <= maxBytes) break
    if (e.starred || drop.has(e.id)) continue
    drop.add(e.id)
    total -= e.bytes
  }

  if (rules.maxAgeDays > 0) {
    const cutoff = now - rules.maxAgeDays * 86_400_000
    for (const e of newestFirst) if (!e.starred && e.updatedAt < cutoff) drop.add(e.id)
  }
  return newestFirst.filter((e) => drop.has(e.id)).map((e) => e.id)
}
