// Checks the parity map (docs/native-mac-testing.md §2): every Electron check row names native checks
// that exist, or says N/A. Usage: node mac/scripts/parity-coverage.mjs
//   suite › label   a check in mac/e2e/run.mjs (in that suite; "all" = the run-wide checks)
//   unit › name     a @Test("name") in mac/Tests/SnapkitCoreTests ("(…)" after it is a note)
//   scene `name`    fixtures/scenes/name.json, compared in mac/e2e/scene.mjs
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

const root = resolve(import.meta.dirname, '..', '..')
const doc = readFileSync(join(root, 'docs/native-mac-testing.md'), 'utf8')
const section = doc.slice(doc.indexOf('## 2. Parity'), doc.indexOf('### Not in `run-all.mjs`'))
const runner = readFileSync(join(root, 'mac/e2e/run.mjs'), 'utf8')
const testsDir = join(root, 'mac/Tests/SnapkitCoreTests')
const tests = readdirSync(testsDir).map((f) => readFileSync(join(testsDir, f), 'utf8')).join('\n')

// The runner's suites and the text of each (from "async name() {" to the next suite).
const suites = {}
const starts = [...runner.matchAll(/^  async (\w+)\(\) \{/gm)]
starts.forEach((m, i) => (suites[m[1]] = runner.slice(m.index, starts[i + 1]?.index ?? runner.indexOf('\nconst names'))))
suites.all = runner.slice(runner.indexOf('\nconst names'))

const problems = []
let rows = 0
for (const line of section.split('\n')) {
  const cells = line.split(/(?<!\\)\|/).map((c) => c.trim())
  if (cells.length < 4 || !cells[1] || cells[1].startsWith('---') || cells[1] === 'Electron check') continue
  rows++
  const native = cells[2].replace(/\\\|/g, '|')
  if (/^N\/A/.test(native) || /^Same as above/.test(native)) continue
  const refs = native.split(/;\s*(?=\w+ › |scene `)/)
  for (const ref of refs) {
    let m
    if ((m = ref.match(/^(\w+) › (.+)$/)) && m[1] !== 'unit') {
      const [, suite, label] = m
      // Labels in the runner are JS strings: compare without escapes.
      const body = (suites[suite] ?? '').replace(/\\(.)/g, '$1')
      if (!suites[suite]) problems.push(`no suite "${suite}" (${ref})`)
      else if (!body.includes(label)) problems.push(`no check "${label}" in ${suite}`)
    } else if ((m = ref.match(/^unit › ([^(]+?)(\s*\(.*\))?$/))) {
      if (!tests.includes(`@Test("${m[1]}`)) problems.push(`no unit test "${m[1]}"`)
    } else if ((m = ref.match(/^scene `([\w-]+)`/))) {
      if (!existsSync(join(root, 'fixtures/scenes', `${m[1]}.json`))) problems.push(`no scene ${m[1]}`)
    } else {
      problems.push(`can't read "${ref}"`)
    }
  }
}
if (problems.length) {
  console.log(problems.map((p) => '✗ ' + p).join('\n'))
  process.exit(1)
}
console.log(`✓ all ${rows} Electron checks mapped to native checks or N/A`)
