import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { fixtures } from './fixtures'

describe('shared fixtures', () => {
  it.each(Object.entries(fixtures()))('%s matches the Electron defaults (run npm run fixtures)', (name, data) => {
    expect(readFileSync(join(__dirname, '../../fixtures', name), 'utf8')).toBe(data)
  })
})
