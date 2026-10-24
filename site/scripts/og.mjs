// Renders /og from a running site (npm run dev or preview) into public/og.png.
// Usage: node scripts/og.mjs [http://localhost:4321]
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'

const base = process.argv[2] ?? 'http://localhost:4321'
const out = fileURLToPath(new URL('../public/og.png', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto(`${base}/og`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } })
await browser.close()
console.log(`wrote ${out}`)
