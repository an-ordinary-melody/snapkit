import { describe, expect, it, vi } from 'vitest'

// docs/state-machines.md, "Screen permission": one explanation at a time.

let answer: (r: { response: number }) => void = () => {}
const showMessageBox = vi.fn(() => new Promise<{ response: number }>((r) => (answer = r)))

vi.mock('electron', () => ({
  desktopCapturer: { getSources: async () => [] },
  dialog: { showMessageBox },
  shell: { openExternal: async () => {} },
  systemPreferences: { getMediaAccessStatus: () => 'denied' }
}))
Object.defineProperty(process, 'platform', { value: 'darwin' })

const { ensureScreenPermission } = await import('./permissions')

describe('screen permission', () => {
  it('pressing the hotkey again while the explanation is open shows no second one', async () => {
    const first = ensureScreenPermission()
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1))
    expect(await ensureScreenPermission()).toBe(false)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    answer({ response: 1 })
    expect(await first).toBe(false)
    // Closed: the next press explains again.
    const again = ensureScreenPermission()
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(2))
    answer({ response: 1 })
    await again
  })
})
