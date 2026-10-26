import { FEATURES } from './features'
import { DEFAULT_NAME_RULE, type NameRule } from './naming'

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

/** 'standard': at most 256 colors, same size. 'smallest': also 1× size on Retina / HiDPI screens. */
export type CompressPreset = 'standard' | 'smallest'

/** Does this output get compressed? `on` is the switch for this capture (the setting, unless changed in the editor). */
export function compressesFor(applyTo: Settings['compress']['applyTo'], on: boolean, output: 'copy' | 'save') {
  return on && (applyTo === 'both' || applyTo === output)
}

export interface Settings {
  hotkeys: {
    capture: string
    /** Opens the history panel. '' = none. */
    history: string
    /** Captures the whole screen straight to the floating preview. '' = none. */
    fullscreen: string
    /** Opens the settings window from anywhere. '' = none. */
    settings: string
    /** Captures the last area copied or saved again. '' = none. */
    lastArea: string
    /** Capture text: drag an area and its text is copied. '' = none. */
    ocr: string
  }
  /** Update checks: notify and download; nothing installs by itself. */
  updates: {
    autoCheck: boolean
    /** GitHub "owner/repo" whose (public) releases are checked. */
    repo: string
    /** Set by Snapkit. */
    lastCheck: number
    /** Last version a notification was shown for, so each new version notifies once. */
    notified: string
  }
  /** Past captures (see docs/history.md). Limits are capped by HISTORY_LIMITS. */
  history: {
    /** How many to keep (starred ones don't count); 0 = keep none. */
    maxCount: number
    /** Disk limit in MB; the oldest go first. */
    maxMB: number
    /** Delete entries older than this many days; 0 = never. */
    maxAgeDays: number
    /** Record nothing while paused. */
    paused: boolean
    /** The history window's size, as last resized. */
    panel: { width: number; height: number }
  }
  /** Tool id -> letter key in capture mode. Missing ids use the tool's built-in letter. */
  toolKeys: Record<string, string>
  /** Tool id -> variant used at the start (e.g. arrow: 'arrow' for a filled head). Missing ids use the first variant. */
  toolVariants: Record<string, string>
  capture: {
    /** 0–1 darkness of the area outside the selection. */
    dimOpacity: number
    /** Color of that dim (#rrggbb). */
    dimColor: string
    showSizeLabel: boolean
    /** Selection outline color. */
    accentColor: string
    /** Screen capture engine: 'auto' (the fastest that works on this OS) or an engine id. */
    engine: string
    /** Full-screen capture also copies to the clipboard. */
    fullscreenCopy: boolean
    /** Quick area capture: the first area drawn is copied right away, with no adjusting or drawing step. */
    quickCopy: boolean
    /** "Capture last area" copies that area right away (no capture mode). Off: capture mode opens with it selected. */
    lastAreaInstant: boolean
  }
  save: {
    /** Empty string = default folder (Pictures/Snapkit). */
    folder: string
    /** Show a save dialog (starting in the last folder used) instead of saving straight to `folder`. */
    askLocation: boolean
    /** Folder picked in the last save dialog. Set by Snapkit. */
    lastFolder: string
    /** How files are named. */
    name: NameRule
    /** The number used in the next name (when the rule has a number). */
    nextNumber: number
  }
  /** Text recognition (OCR). */
  ocr: {
    /** 'auto' (this OS's own) or an engine id: vision (macOS), windows. */
    engine: string
    /** The Copy text button: open the text panel to check it first, or copy right away. */
    textButton: 'panel' | 'copy'
  }
  /** Smaller PNGs on the way out (copy / save); history and the floating preview keep the original. */
  compress: {
    /** Compress by default; the editor's Compress switch changes it for one capture. */
    enabled: boolean
    preset: CompressPreset
    /** Which outputs get compressed when it's on. */
    applyTo: 'both' | 'copy' | 'save'
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
    /** Colors offered for the highlighter. */
    highlighterPalette: string[]
    highlighterWidth: number
    /** 'pixelate' or 'blur'. */
    blurMode: 'pixelate' | 'blur'
    /** Pixel block size / blur radius in px (4–40). */
    blurStrength: number
    /** Step badge diameter in px. */
    stepSize: number
    /** Number color on step badges; '' = black or white, whichever reads better on the badge. */
    stepTextColor: string
    /** Badge color for new steps. */
    stepColor: string
    /** Outline around step badges: color and width in px (0 = none). Applies to every badge. */
    stepStroke: { color: string; width: number }
    /** Shadow under step badges, 0 (off) to 1. */
    stepShadow: number
    text: {
      fontFamily: string
      fontSize: number
      /** Starting style: 'plain', 'stroke' (outline), or 'background'. */
      style: 'plain' | 'stroke' | 'background'
      /** Outline around the letters. */
      strokeColor: string
      strokeWidth: number
      /** Fill behind the text in the 'background' style. */
      background: string
      /** Drop shadow strength under text, 0–1 (0 = none). Settings only. */
      shadow: number
    }
  }
  pin: {
    /** Start every capture with the floating preview on: after copy, the result stays in a corner with copy / edit / pin. */
    afterCopy: boolean
  }
  appearance: {
    /** Liquid Glass: frosted, refracting panels. Off: solid panels. */
    glass: boolean
    /** Light or dark panels; 'system' follows macOS / Windows. */
    /** Gray: the dark theme, a few shades lighter. */
    mode: 'system' | 'light' | 'dark' | 'gray'
    /** Highlight color for the selected tool, switches and primary buttons; '' = the theme's (white in glass, gray in dark). */
    accent: string
  }
  /** Background, padding, corner radius and shadow around the output image. */
  beautify: {
    /** Start every capture with beautify on, so copy (and save) add the preset automatically. */
    applyOnCopy: boolean
    /** Id of the preset used by default. */
    preset: string
    presets: BeautifyPreset[]
    /** Gradients offered in the background editor, as [start, end] colors. */
    gradients: [string, string][]
    /** Solid colors offered in the background editor. */
    solids: string[]
    /** Whatever background is copied or saved with becomes the default. */
    rememberLast: boolean
  }
  /** Feature id -> enabled. Missing ids fall back to the feature's default. */
  features: Record<string, boolean>
  /** Order of feature ids in their toolbar. Unknown/missing ids are appended. */
  toolbarOrder: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: {
    capture: 'Alt+Shift+Z',
    history: 'CommandOrControl+Shift+1',
    fullscreen: 'CommandOrControl+Shift+9',
    settings: 'CommandOrControl+Shift+2',
    lastArea: 'Alt+Shift+X',
    ocr: 'Alt+Shift+T'
  },
  updates: {
    autoCheck: true,
    repo: 'an-ordinary-melody/snapkit',
    lastCheck: 0,
    notified: ''
  },
  history: {
    maxCount: 10,
    maxMB: 300,
    maxAgeDays: 30,
    paused: false,
    panel: { width: 800, height: 520 }
  },
  toolKeys: {},
  toolVariants: {},
  capture: {
    dimOpacity: 0.75,
    dimColor: '#000000',
    showSizeLabel: true,
    accentColor: '#3b82f6',
    engine: 'auto',
    fullscreenCopy: false,
    quickCopy: false,
    lastAreaInstant: false
  },
  save: {
    folder: '',
    askLocation: true,
    lastFolder: '',
    name: DEFAULT_NAME_RULE,
    nextNumber: 1
  },
  ocr: {
    engine: 'auto',
    textButton: 'panel'
  },
  compress: {
    enabled: false,
    preset: 'standard',
    applyTo: 'both'
  },
  notifications: {
    onCopy: false,
    onSave: true
  },
  annotate: {
    palette: ['#ef4444', '#facc15', '#3b82f6', '#111111', '#ffffff'],
    strokeWidths: [3, 5, 8],
    strokeWidth: 0,
    highlighterColor: '#fde047',
    highlighterPalette: ['#fde047', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74'],
    highlighterWidth: 18,
    blurMode: 'blur',
    blurStrength: 12,
    stepSize: 34,
    stepTextColor: '',
    stepColor: '#ef4444',
    stepStroke: { color: '#ffffff', width: 2 },
    stepShadow: 0.3,
    text: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      fontSize: 20,
      style: 'stroke',
      strokeColor: '#ffffff',
      strokeWidth: 2,
      background: '#ffffff',
      shadow: 0.1
    }
  },
  pin: {
    afterCopy: false
  },
  appearance: {
    glass: false,
    mode: 'dark',
    accent: '#0a84ff'
  },
  beautify: {
    applyOnCopy: false,
    preset: 'ocean',
    presets: [
      { id: 'ocean', name: 'Ember', background: { type: 'gradient', from: '#f83600', to: '#f9d423', angle: 135 }, padding: 48, radius: 12, shadow: 0.35 },
      { id: 'sunset', name: 'Sunset', background: { type: 'gradient', from: '#fb923c', to: '#ec4899', angle: 135 }, padding: 48, radius: 12, shadow: 0.35 },
      { id: 'mint', name: 'Mint', background: { type: 'gradient', from: '#34d399', to: '#06b6d4', angle: 135 }, padding: 48, radius: 12, shadow: 0.35 },
      { id: 'light', name: 'Light', background: { type: 'solid', color: '#eef0f3' }, padding: 40, radius: 10, shadow: 0.2 },
      { id: 'dark', name: 'Dark', background: { type: 'solid', color: '#18181b' }, padding: 40, radius: 10, shadow: 0.5 }
    ],
    gradients: [
      ['#f5f7fa', '#c3cfe2'], ['#a1c4fd', '#c2e9fb'], ['#ffecd2', '#fcb69f'], ['#e0c3fc', '#8ec5fc'],
      ['#a8edea', '#fed6e3'], ['#d4fc79', '#96e6a1'], ['#f6d365', '#fda085'], ['#ee9ca7', '#ffdde1'],
      ['#ff5f6d', '#ffc371'], ['#f83600', '#f9d423'], ['#f093fb', '#f5576c'], ['#fc466b', '#3f5efb'],
      ['#4facfe', '#00f2fe'], ['#43cea2', '#185a9d'], ['#38ef7d', '#11998e'], ['#5ee7df', '#b490ca'],
      ['#4f8cff', '#a855f7'], ['#fb923c', '#ec4899'], ['#34d399', '#06b6d4'], ['#7f7fd5', '#86a8e7'],
      ['#667eea', '#764ba2'], ['#8e2de2', '#4a00e0'], ['#30cfd0', '#330867'], ['#bdc3c7', '#2c3e50'],
      ['#232526', '#414345'], ['#0f2027', '#2c5364'], ['#141e30', '#243b55'], ['#42275a', '#734b6d'],
      ['#870000', '#190a05'], ['#000428', '#004e92'], ['#3a1c71', '#d76d77'], ['#434343', '#000000']
    ],
    rememberLast: false,
    solids: ['#ffffff', '#e5e7eb', '#18181b', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7']
  },
  features: Object.fromEntries(FEATURES.map((f) => [f.id, f.defaultEnabled])),
  toolbarOrder: FEATURES.map((f) => f.id)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Per-OS differences from the defaults. Windows: bigger text, since its
 * screens usually run at 100–150% scaling, where 20 px text reads small.
 */
const PLATFORM_DEFAULTS: Partial<Record<NodeJS.Platform, SettingsPatch>> = {
  win32: { annotate: { text: { fontSize: 26 } } }
}

/** The defaults on this OS. */
export function defaultsFor(platform: NodeJS.Platform): Settings {
  const p = PLATFORM_DEFAULTS[platform]
  return p ? mergeSettings(DEFAULT_SETTINGS, p) : DEFAULT_SETTINGS
}

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

/**
 * Every feature id in the user's toolbar order. Ids missing from a saved order
 * (features added in an update) go right after the feature they follow in
 * FEATURES, e.g. a new tool after Blur, not at the end.
 */
export function toolbarOrder(settings: Settings): string[] {
  const order = settings.toolbarOrder.filter((id) => FEATURES.some((f) => f.id === id))
  FEATURES.forEach((f, i) => {
    if (order.includes(f.id)) return
    const after = i > 0 ? order.indexOf(FEATURES[i - 1].id) : -1
    order.splice(after + 1, 0, f.id)
  })
  return order
}

/** Enabled features of one kind, in the user's chosen order. */
export function visibleFeatures(settings: Settings, kind: 'tool' | 'action') {
  const order = toolbarOrder(settings)
  return order
    .map((id) => FEATURES.find((f) => f.id === id))
    .filter((f): f is (typeof FEATURES)[number] => !!f && f.kind === kind)
    .filter((f) => settings.features[f.id] ?? f.defaultEnabled)
}

/** A partial settings object: any nested field may be left out. Arrays are replaced whole. */
export type SettingsPatch = { [K in keyof Settings]?: DeepPartial<Settings[K]> }
type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

/**
 * Merge `patch` into the stored overrides (`saved`): objects merge key by key
 * at any depth; arrays and plain values replace. Returns a new object.
 */
export function applyPatch(saved: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...saved }
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k]
    out[k] = isObj(v) && isObj(prev) ? applyPatch(prev, v) : v
  }
  return out
}
