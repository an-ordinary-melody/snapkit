import { FEATURES } from './features'

export type BeautifyBackground =
  | { type: 'solid'; color: string }
  /** `angle` in degrees: 0 = left to right, 90 = top to bottom. */
  | { type: 'gradient'; from: string; to: string; angle: number }
  /** A local image file, scaled to cover the background. */
  | { type: 'image'; path: string }

export interface BeautifyPreset {
  id: string
  name: string
  background: BeautifyBackground
  /** Space around the screenshot, in screen px. */
  padding: number
  /** Corner radius of the screenshot, in screen px. */
  radius: number
  /** Drop shadow strength, 0–1. */
  shadow: number
}

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
    /** Show a save dialog (starting in the last folder used) instead of saving straight to `folder`. */
    askLocation: boolean
    /** Folder picked in the last save dialog. Set by Snapkit. */
    lastFolder: string
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
  pin: {
    /** Start every capture with the floating preview on: after copy, the result stays in a corner with copy / edit / pin. */
    afterCopy: boolean
  }
  /** Background, padding, corner radius and shadow around the output image. */
  beautify: {
    /** Start every capture with beautify on, so copy (and save) add the preset automatically. */
    applyOnCopy: boolean
    /** Id of the preset used by default. */
    preset: string
    presets: BeautifyPreset[]
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
    askLocation: true,
    lastFolder: ''
  },
  notifications: {
    onCopy: false,
    onSave: true
  },
  annotate: {
    palette: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#111111', '#ffffff'],
    strokeWidths: [3, 5, 8],
    strokeWidth: 0,
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
  pin: {
    afterCopy: false
  },
  beautify: {
    applyOnCopy: false,
    preset: 'ocean',
    presets: [
      { id: 'ocean', name: 'Ocean', background: { type: 'gradient', from: '#4f8cff', to: '#a855f7', angle: 135 }, padding: 48, radius: 12, shadow: 0.35 },
      { id: 'sunset', name: 'Sunset', background: { type: 'gradient', from: '#fb923c', to: '#ec4899', angle: 135 }, padding: 48, radius: 12, shadow: 0.35 },
      { id: 'mint', name: 'Mint', background: { type: 'gradient', from: '#34d399', to: '#06b6d4', angle: 135 }, padding: 48, radius: 12, shadow: 0.35 },
      { id: 'light', name: 'Light', background: { type: 'solid', color: '#eef0f3' }, padding: 40, radius: 10, shadow: 0.2 },
      { id: 'dark', name: 'Dark', background: { type: 'solid', color: '#18181b' }, padding: 40, radius: 10, shadow: 0.5 }
    ]
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
