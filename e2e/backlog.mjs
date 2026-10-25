// Test backlog: end-to-end suites a change may have affected but that weren't run yet.
// A passing run of a suite takes it off; a full passing run (`npm run e2e`) clears it all.
// Usage: node e2e/backlog.mjs                      list it
//        node e2e/backlog.mjs add <suite> <why>    add a suite (e.g. add history "changed the thumbnail size")
//        node e2e/backlog.mjs clear                empty it
//        npm run e2e:backlog                       run just the suites on it
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const FILE = join(dir, '.backlog.json') // local, not in git

/** [{ suite, why, added }] */
export function loadBacklog() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}

export function saveBacklog(items) {
  writeFileSync(FILE, JSON.stringify(items, null, 2) + '\n')
}

/** After a run: suites that passed come off; a full passing run empties it. */
export function settleBacklog(passed, fullRunPassed) {
  const left = fullRunPassed ? [] : loadBacklog().filter((i) => !passed.includes(i.suite))
  saveBacklog(left)
  return left
}

export function describe(items) {
  if (!items.length) return 'Test backlog: empty.'
  const suites = [...new Set(items.map((i) => i.suite))]
  return `Test backlog (${suites.length} suite${suites.length > 1 ? 's' : ''}: ${suites.join(', ')}):\n` + items.map((i) => `  - ${i.suite}: ${i.why} (${i.added})`).join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd = 'list', suite, ...why] = process.argv.slice(2)
  if (cmd === 'add') {
    if (!suite || !existsSync(join(dir, `${suite}.mjs`))) {
      console.error(`Unknown suite "${suite ?? ''}". Suites are the e2e/<name>.mjs files run by e2e/run-all.mjs.`)
      process.exit(1)
    }
    const items = loadBacklog()
    items.push({ suite, why: why.join(' ') || 'may be affected by a change', added: new Date().toISOString().slice(0, 10) })
    saveBacklog(items)
    console.log(describe(items))
  } else if (cmd === 'clear') {
    saveBacklog([])
    console.log(describe([]))
  } else {
    console.log(describe(loadBacklog()))
  }
}
