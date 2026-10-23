import { describe, expect, it } from 'vitest'
import { compareVersions } from './version'

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('v1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2', 'v1.2.0')).toBe(0)
  })
  it('treats a prerelease as older than its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBeGreaterThan(0)
  })
  it('treats junk as 0.0.0', () => {
    expect(compareVersions('nightly', '0.0.1')).toBeLessThan(0)
  })
})
