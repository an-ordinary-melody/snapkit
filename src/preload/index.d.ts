import type { SnapkitApi } from '../shared/ipc'

declare global {
  interface Window {
    snapkit: SnapkitApi
  }
}

export {}
