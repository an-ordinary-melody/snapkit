// After `astro build`: give every page a Content-Security-Policy that allows only this site's own files
// and the exact inline scripts Astro wrote (by SHA-256 hash). Clickjacking and other headers are in vercel.json.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const pages = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? pages(join(dir, f)) : f.endsWith('.html') ? [join(dir, f)] : []))

for (const file of pages(dist)) {
  let html = readFileSync(file, 'utf8')
  const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`
  )
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${[...new Set(hashes)].join(' ')}`,
    "style-src 'self' 'unsafe-inline'", // the demos position things with style attributes
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  if (!/<meta charset="utf-8"\s*\/?>/i.test(html)) throw new Error(`csp: no <meta charset> in ${file}`)
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/(<meta charset="utf-8"\s*\/?>)/i, `$1${meta}`)
  writeFileSync(file, html)
  console.log(`csp: ${file.slice(dist.length + 1)} (${hashes.length} inline scripts)`)
}
