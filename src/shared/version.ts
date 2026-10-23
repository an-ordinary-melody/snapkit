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
  return pa[3] < pb[3] ? -1 : 1
}
