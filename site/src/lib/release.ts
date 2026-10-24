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

/** Release notes of versions that are out (on GitHub, or with a git tag if GitHub can't be reached), newest first. */
export function releaseNotes(): (Note & { url: string })[] {
  return (notes as Note[]).flatMap((n) => {
    const r = published?.find((x) => x.tag_name === `v${n.version}`)
    if (published ? !r : !n.date) return []
    return [{ ...n, date: n.date ?? r!.published_at.slice(0, 10), url: r?.html_url ?? `${GITHUB}/releases/tag/v${n.version}` }]
  })
}
