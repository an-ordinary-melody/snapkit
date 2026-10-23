import { FEATURES } from './features'

export interface Settings {
  hotkeys: {
    capture: string
  }
  capture: {
    /** 0–1 darkness of the area outside the selection. */
    dimOpacity: number
    showSizeLabel: boolean
    /** Selection outline color. */
    accentColor: string
  }
  save: {
    /** Empty string = default folder (Pictures/Snapkit). */
    folder: string
    askLocation: boolean
  }
  notifications: {
    onCopy: boolean
    onSave: boolean
  }
  /** Defaults for the annotation tools. */
  annotate: {
    /** Colors offered in the style bar; the first is the starting color. */
    palette: string[]
    /** Stroke width presets in px (S / M / L). */
    strokeWidths: [number, number, number]
    /** Index into strokeWidths used at the start. */
    strokeWidth: number
    highlighterColor: string
    highlighterWidth: number
    /** 'pixelate' or 'blur'. */
    blurMode: 'pixelate' | 'blur'
    /** Pixel block size / blur radius in px (4–40). */
    blurStrength: number
    /** Step badge diameter in px. */
    stepSize: number
    text: {
      fontFamily: string
      fontSize: number
      shadow: boolean
      /** Fill behind the text, or '' for none. */
      background: string
    }
  }
  /** Feature id -> enabled. Missing ids fall back to the feature's default. */
  features: Record<string, boolean>
  /** Order of feature ids in their toolbar. Unknown/missing ids are appended. */
  toolbarOrder: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: {
    capture: 'CommandOrControl+Shift+2'
  },
  capture: {
    dimOpacity: 0.45,
    showSizeLabel: true,
    accentColor: '#3b82f6'
  },
  save: {
    folder: '',
    askLocation: false
  },
  notifications: {
    onCopy: false,
    onSave: true
  },
  annotate: {
    palette: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#111111', '#ffffff'],
    strokeWidths: [2, 4, 8],
    strokeWidth: 1,
    highlighterColor: '#fde047',
    highlighterWidth: 18,
    blurMode: 'blur',
    blurStrength: 12,
    stepSize: 28,
    text: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      fontSize: 20,
      shadow: false,
      background: ''
    }
  },
  features: Object.fromEntries(FEATURES.map((f) => [f.id, f.defaultEnabled])),
  toolbarOrder: FEATURES.map((f) => f.id)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep-merge saved settings over defaults so new settings get sane values after updates. */
export function mergeSettings(defaults: Settings, saved: unknown): Settings {
  const merge = (d: unknown, s: unknown): unknown => {
    if (isObj(d) && isObj(s)) {
      const out: Obj = { ...d }
      for (const k of Object.keys(s)) out[k] = k in d ? merge(d[k], s[k]) : s[k]
      return out
    }
    if (s === undefined || (d !== undefined && typeof d !== typeof s)) return d
    return s
  }
  return merge(defaults, saved) as Settings
}

/** Enabled features of one kind, in the user's chosen order. */
export function visibleFeatures(settings: Settings, kind: 'tool' | 'action') {
  const order = [...settings.toolbarOrder, ...FEATURES.map((f) => f.id).filter((id) => !settings.toolbarOrder.includes(id))]
  return order
    .map((id) => FEATURES.find((f) => f.id === id))
    .filter((f): f is (typeof FEATURES)[number] => !!f && f.kind === kind)
    .filter((f) => settings.features[f.id] ?? f.defaultEnabled)
}
