// Checks the built site in Chrome: run `npm run build`, then `npm run check`.
// Serves dist/ itself (or checks a URL given as the first argument, e.g. a Vercel preview).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml' }

let server
let base = process.argv[2]
if (!base) {
  server = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (p.endsWith('/')) p += 'index.html'
    try {
      const body = await readFile(join(dist, p))
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise((r) => server.listen(0, r))
  base = `http://localhost:${server.address().port}`
}

const results = []
// A demo's React island is interactive once Astro drops its `ssr` attribute.
const hydrated = (page, sel) => page.waitForFunction((s) => !!document.querySelector(s)?.closest('astro-island:not([ssr])'), sel, { timeout: 15000 })

const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 375, height: 812 }]]) {
    // Playwright's waiting helpers evaluate strings, which the site's CSP forbids; the strict pass below runs with CSP on.
    const page = await browser.newPage({ viewport, bypassCSP: true })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto(base + '/', { waitUntil: 'networkidle' })

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    check(`${name}: no sideways scroll`, overflow <= 0, `${overflow}px wider than the window`)

    const links = await page.$$eval('[data-dl] a', (as) => as.map((a) => [a.dataset.os, a.href]))
    check(`${name}: macOS buttons link to a .dmg`, links.filter(([os]) => os === 'mac').every(([, h]) => h.endsWith('.dmg')))
    check(`${name}: Windows buttons link to a -setup.exe`, links.filter(([os]) => os === 'win').every(([, h]) => h.endsWith('-setup.exe')))

    // The hero loops through capture mode and ends with the copy into the corner preview.
    await page.locator('[data-stage]').scrollIntoViewIfNeeded()
    const reached = await page.waitForFunction(() => document.querySelector('[data-stage]').classList.contains('m-copy'), null, { timeout: 12000 }).then(() => true, () => false)
    check(`${name}: hero demo plays to the copy`, reached)

    // Annotate demo draws its shapes; background demo reacts to a preset.
    await page.locator('.an').scrollIntoViewIfNeeded()
    const drawn = await page.waitForFunction(() => document.querySelectorAll('.an .on').length >= 4, null, { timeout: 8000 }).then(() => true, () => false)
    check(`${name}: annotate demo draws`, drawn)
    await page.locator('.bgd').scrollIntoViewIfNeeded()
    await hydrated(page, '.bgd')
    const before = await page.$eval('.bgd-frame', (el) => el.style.background)
    await page.getByRole('button', { name: 'Mint' }).click()
    const after = await page.$eval('.bgd-frame', (el) => el.style.background)
    check(`${name}: background preset changes the frame`, before !== after && after.includes('rgb(52, 211, 153)'))

    // Workflow switch changes the flow.
    await page.locator('.wf').scrollIntoViewIfNeeded()
    await hydrated(page, '.wf')
    const stepsBefore = await page.$$eval('.wf-flow li', (l) => l.length)
    await page.locator('.wf-row', { hasText: 'Quick area capture' }).click()
    const stepsAfter = await page.$$eval('.wf-flow li', (l) => l.length)
    check(`${name}: quick area capture drops the drawing step`, stepsAfter === stepsBefore - 1)

    // History demo: star, delete and copy act on the selected capture.
    await page.locator('.hs').scrollIntoViewIfNeeded()
    await hydrated(page, '.hs')
    const firstStarred = () => page.$eval('.hs-item[aria-selected="true"]', (el) => !!el.querySelector('[aria-label="Starred"]'))
    const starBefore = await firstStarred()
    await page.locator('.hs-actions button', { hasText: 'Star' }).click()
    const starAfter = await firstStarred()
    const itemsBefore = await page.$$eval('.hs-item', (l) => l.length)
    await page.locator('.hs-actions button', { hasText: 'Delete' }).click()
    const itemsAfter = await page.$$eval('.hs-item', (l) => l.length)
    await page.locator('.hs-item').nth(1).click()
    await page.keyboard.press('Enter')
    const toast = await page.locator('.hs-toast').textContent()
    check(`${name}: history demo stars, deletes and copies`, starBefore !== starAfter && itemsAfter === itemsBefore - 1 && /Copied/.test(toast ?? ''), toast ?? '')

    // Every features tab shows its panel.
    await page.locator('.fx').scrollIntoViewIfNeeded()
    await hydrated(page, '.fx')
    const tabs = page.getByRole('tab')
    const count = await tabs.count()
    let shown = 0
    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click()
      const title = await page.locator('.fx-panel h3').textContent()
      const demo = await page.locator('.fx-demo > *').count()
      if (title && demo) shown++
    }
    check(`${name}: all ${count} feature tabs show a demo`, count === 7 && shown === count, `${shown}/${count}`)

    const entries = await page.$$eval('.timeline > li', (l) => l.length)
    const latest = await page.$eval('.timeline > li', (el) => `v${el.dataset.upto}`)
    const note = await page.$eval('.dl-note a', (el) => el.textContent.trim())
    check(`${name}: changelog is up to the downloaded version`, entries > 0 && latest === note, `${latest} vs ${note}`)

    // The theme switch overrides the system theme and survives a reload.
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.getByRole('radio', { name: 'Dark theme' }).click()
    const dark = await bg()
    await page.reload({ waitUntil: 'networkidle' })
    const kept = await bg()
    await page.getByRole('radio', { name: 'Light theme' }).click()
    const light = await bg()
    await page.getByRole('radio', { name: 'System theme' }).click()
    check(`${name}: theme switch sets dark and light, and remembers it`, dark === 'rgb(11, 11, 13)' && kept === dark && light === 'rgb(255, 255, 255)', `${dark} / ${kept} / ${light}`)

    check(`${name}: no console errors`, errors.length === 0, errors.join(' | '))
    await page.close()
  }

  // Strict pass: the real Content-Security-Policy, nothing blocked, demos still running.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '')
    check('CSP meta allows only this site and hashed inline scripts', /script-src 'self'( 'sha256-[^']+')+;/.test(csp) && !csp.includes('unsafe-eval'))
    await page.evaluate(() => document.querySelector('[data-stage]').scrollIntoView())
    await page.waitForTimeout(9000)
    check('with CSP on: hero demo plays', await page.evaluate(() => document.querySelector('[data-stage]').classList.contains('m-copy')))
    await page.evaluate(() => document.querySelector('.an').scrollIntoView())
    await page.waitForTimeout(5000)
    check('with CSP on: annotate demo draws', await page.evaluate(() => document.querySelectorAll('.an .on').length >= 4))
    await page.evaluate(() => document.querySelector('.hs').scrollIntoView())
    await page.waitForTimeout(1500)
    await page.locator('.hs-actions button', { hasText: 'Save' }).click()
    check('with CSP on: history demo responds', (await page.locator('.hs-toast').count()) === 1)
    await page.locator('[data-set="dark"]').click()
    check('with CSP on: theme switch works', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'))
    check('with CSP on: nothing blocked, no console errors', errors.length === 0, errors.join(' | '))
    await page.close()
  }

  if (process.argv[2]) {
    const h = (await fetch(base + '/')).headers
    check(
      'security headers are sent',
      h.get('x-frame-options') === 'DENY' && h.get('x-content-type-options') === 'nosniff' && /frame-ancestors 'none'/.test(h.get('content-security-policy') ?? '') && !!h.get('referrer-policy') && !!h.get('strict-transport-security')
    )
  }

  const og = await (await fetch(base + '/og.png')).arrayBuffer().catch(() => new ArrayBuffer(0))
  check('share image is served', og.byteLength > 10000)
} finally {
  await browser.close()
  server?.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
