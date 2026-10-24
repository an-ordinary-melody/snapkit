// Published releases (betas included) and the newest one's installers, looked up once at build time.
// The release workflow redeploys the site after publishing, so the links stay current.
import notes from '../data/releases.json'

export const REPO = 'sonbq-fsc/snapkit'
export const GITHUB = `https://github.com/${REPO}`
const FALLBACK = `${GITHUB}/releases/latest`

export type Latest = { version: string; mac: string; win: string; page: string }
export type Note = { version: string; date: string | null; intro: string; items: { text: string; sub: string[] }[] }

type Asset = { name: string; browser_download_url: string }
type Release = { tag_name: string; html_url: string; draft: boolean; published_at: string; assets: Asset[] }

async function fetchReleases(): Promise<Release[] | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'snapkit-site' }
    })
    if (!res.ok) throw new Error(`GitHub ${res.status}`)
    return ((await res.json()) as Release[]).filter((r) => !r.draft)
  } catch (e) {
    console.warn(`release lookup failed, using ${FALLBACK}:`, (e as Error).message)
    return null
  }
}

const published = await fetchReleases()

export function latestRelease(): Latest {
  const r = published?.find((x) => x.assets.some((a) => a.name.endsWith('.dmg')))
  if (!r) {
    const known = (notes as Note[]).find((n) => n.date)?.version ?? ''
    return { version: known, mac: FALLBACK, win: FALLBACK, page: FALLBACK }
  }
  const url = (end: string) => r.assets.find((a) => a.name.endsWith(end))?.browser_download_url ?? r.html_url
  return { version: r.tag_name.replace(/^v/, ''), mac: url('.dmg'), win: url('-setup.exe'), page: r.html_url }
}

export type Entry = { title: string; label: string; upTo: string; date: string; items: string[]; url: string }

/**
 * The changelog: the hand-written summaries in changelog.json (newest first), plus, above them, any
 * published release newer than the newest summary, taken from its release notes.
 */
export function changelog(curated: { title: string; from: string; upTo: string; items: string[] }[]): Entry[] {
  const out = releaseNotes()
  const newest = curated[0]?.upTo
  const newer = out.slice(0, Math.max(0, out.findIndex((n) => n.version === newest)))
  const auto = newer.map((n) => ({
    title: n.intro.replace(/^\w+ beta of Snapkit, a fast screenshot tool for macOS and Windows\.\s*/, '') || 'What\'s new',
    label: label(n.version, n.version),
    upTo: n.version,
    date: n.date!,
    items: n.items.map((i) => i.text),
    url: n.url
  }))
  const date = (v: string) => out.find((n) => n.version === v)?.date ?? (notes as Note[]).find((n) => n.version === v)?.date ?? ''
  // "0.2.0-beta.2" → "2"; versions that aren't betas keep their number.
  const beta = (v: string) => v.match(/-beta\.(\d+)$/)?.[1]
  const label = (from: string, upTo: string) =>
    beta(from) && beta(upTo) ? `Beta ${beta(from)}${from === upTo ? '' : `–${beta(upTo)}`}` : from === upTo ? `v${upTo}` : `v${from} – v${upTo}`
  const mine = curated
    .filter((c) => !published || out.some((n) => n.version === c.upTo))
    .map((c) => ({
      title: c.title,
      label: label(c.from, c.upTo),
      upTo: c.upTo,
      date: date(c.upTo),
      items: c.items,
      url: out.find((n) => n.version === c.upTo)?.url ?? `${GITHUB}/releases`
    }))
  return [...auto, ...mine]
}

/** Release notes of versions that are out (on GitHub, or with a git tag if GitHub can't be reached), newest first. */
export function releaseNotes(): (Note & { url: string })[] {
  return (notes as Note[]).flatMap((n) => {
    const r = published?.find((x) => x.tag_name === `v${n.version}`)
    if (published ? !r : !n.date) return []
    return [{ ...n, date: n.date ?? r!.published_at.slice(0, 10), url: r?.html_url ?? `${GITHUB}/releases/tag/v${n.version}` }]
  })
}
