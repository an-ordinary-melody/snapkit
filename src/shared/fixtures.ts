import { FEATURES } from './features'
import { defaultsFor } from './settings'

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

/** Shared fixture files (macOS defaults) (name -> contents) the native Mac app reads its defaults from. */
export const fixtures = (): Record<string, string> => ({
  'default-settings.json': json(defaultsFor('darwin')),
  'features.json': json(FEATURES)
})
