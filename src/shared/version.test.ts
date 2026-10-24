import { describe, expect, it } from 'vitest'
import { compareVersions, pickRelease } from './version'

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
  it('compares prerelease numbers as numbers', () => {
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.9')).toBeGreaterThan(0)
  })
  it('treats junk as 0.0.0', () => {
    expect(compareVersions('nightly', '0.0.1')).toBeLessThan(0)
  })
})

describe('pickRelease', () => {
  const list = [
    { tag_name: 'v0.2.0-beta.2', prerelease: true },
    { tag_name: 'v0.3.0', draft: true },
    { tag_name: 'v0.1.5' },
    { tag_name: 'v0.2.0-beta.1', prerelease: true }
  ]
  it('offers betas to beta users, never drafts', () => {
    expect(pickRelease(list, '0.2.0-beta.1')?.tag_name).toBe('v0.2.0-beta.2')
  })
  it('offers only stable releases to everyone else', () => {
    expect(pickRelease(list, '0.1.0')?.tag_name).toBe('v0.1.5')
    expect(pickRelease([{ tag_name: 'v0.2.0-beta.1', prerelease: true }], '0.1.0')).toBeNull()
  })
})
