// Writes the Electron defaults as JSON for the native Mac app (fixtures/), so both apps start from the same values.
// Run: npm run fixtures. A unit test fails when the files are out of date.
import { writeFileSync } from 'fs'
import { join } from 'path'
import { fixtures } from '../src/shared/fixtures'

const dir = join(__dirname, '..', 'fixtures')
for (const [name, data] of Object.entries(fixtures())) writeFileSync(join(dir, name), data)
