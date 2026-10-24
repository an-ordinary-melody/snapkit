/** "v1.2.3" / "1.2.3-beta.1" -> [1, 2, 3, prerelease?]. */
function parse(v: string): [number, number, number, string] {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(v.trim())
  if (!m) return [0, 0, 0, '']
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0), m[4] ?? '']
}

/** Negative if a < b, 0 if equal, positive if a > b. A prerelease is older than its release. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] as number) - (pb[i] as number)
  if (pa[3] === pb[3]) return 0
  if (!pa[3]) return 1
  if (!pb[3]) return -1
  // Prerelease parts one by one: numbers as numbers (beta.10 > beta.2), words alphabetically.
  const xa = pa[3].split('.')
  const xb = pb[3].split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1
    if (xb[i] === undefined) return 1
    const na = /^\d+$/.test(xa[i]) ? Number(xa[i]) : NaN
    const nb = /^\d+$/.test(xb[i]) ? Number(xb[i]) : NaN
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb
    } else if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1
  }
  return 0
}

export interface ReleaseInfo {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
}

/**
 * The newest release to offer from GitHub's release list. Betas are offered
 * only to people already running a beta; everyone else gets stable releases.
 */
export function pickRelease<T extends ReleaseInfo>(list: T[], current: string): T | null {
  const onBeta = current.includes('-')
  let best: T | null = null
  for (const r of list) {
    if (r.draft || (r.prerelease && !onBeta)) continue
    if (!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r
  }
  return best
}
