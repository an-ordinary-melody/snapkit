// Copies what the site shows from the app's own files into src/data/:
// release notes (for the changelog) and the background presets and gradients
// (from src/shared/settings.ts). The output is committed, so the site still
// builds when only site/ is uploaded (e.g. `vercel deploy` from this folder).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(site, '..')
const notesDir = join(repo, 'release-notes')
const settingsFile = join(repo, 'src/shared/settings.ts')

if (!existsSync(notesDir) || !existsSync(settingsFile)) {
  console.log('sync-data: app files not found, keeping the committed src/data')
  process.exit(0)
}

/** "0.2.0-beta.4" → [0, 2, 0, 4] for sorting; a final release sorts after its betas. */
const key = (v) => {
  const [main, pre] = v.split('-')
  const n = main.split('.').map(Number)
  const b = pre ? Number(pre.replace(/\D+/g, '')) : Infinity
  return [...n, b]
}
const cmp = (a, b) => {
  const x = key(a), y = key(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]
  return 0
}

const tagDate = (tag) => {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', tag], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

/** The release note's intro line and the bullets (with nested ones) of its first "What's new" or "Highlights" section. */
function parse(md) {
  const lines = md.split('\n')
  const intro = lines.find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? ''
  const start = lines.findIndex((l) => /^##\s+(What's new|Highlights)/i.test(l))
  const items = []
  if (start >= 0) {
    for (const l of lines.slice(start + 1)) {
      if (l.startsWith('## ')) break
      if (l.startsWith('- ')) items.push({ text: l.slice(2).trim(), sub: [] })
      else if (/^\s+- /.test(l) && items.length) items.at(-1).sub.push(l.trim().slice(2))
    }
  }
  return { intro, items }
}

// Shallow clones (Vercel) have no tags: keep the dates already recorded.
const known = (() => {
  try {
    return Object.fromEntries(JSON.parse(readFileSync(join(site, 'src/data/releases.json'), 'utf8')).map((r) => [r.version, r.date]))
  } catch {
    return {}
  }
})()

const releases = readdirSync(notesDir)
  .filter((f) => /^v.+\.md$/.test(f))
  .map((f) => f.slice(1, -3))
  .sort(cmp)
  .map((version) => ({ version, date: tagDate(`v${version}`) ?? known[version] ?? null, ...parse(readFileSync(join(notesDir, `v${version}.md`), 'utf8')) }))

const src = readFileSync(settingsFile, 'utf8')
const presets = [...src.matchAll(/\{ id: '(\w+)', name: '(\w+)', background: (\{[^}]+\}), padding: (\d+), radius: (\d+), shadow: ([\d.]+) \}/g)].map(
  ([, id, name, bg, padding, radius, shadow]) => ({
    id,
    name,
    background: JSON.parse(bg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')),
    padding: Number(padding),
    radius: Number(radius),
    shadow: Number(shadow)
  })
)
const gradientBlock = src.match(/gradients: \[\n([\s\S]*?)\n    \],/)?.[1] ?? ''
const gradients = [...gradientBlock.matchAll(/\['(#[0-9a-f]{6})', '(#[0-9a-f]{6})'\]/gi)].map(([, a, b]) => [a, b])

if (!releases.length || !presets.length || !gradients.length) {
  console.error(`sync-data: found ${releases.length} releases, ${presets.length} presets, ${gradients.length} gradients; expected some of each`)
  process.exit(1)
}

writeFileSync(join(site, 'src/data/releases.json'), JSON.stringify(releases, null, 2) + '\n')
writeFileSync(join(site, 'src/data/backgrounds.json'), JSON.stringify({ presets, gradients }, null, 2) + '\n')
console.log(`sync-data: ${releases.length} releases, ${presets.length} presets, ${gradients.length} gradients`)
