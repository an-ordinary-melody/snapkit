/**
 * Feature registry.
 *
 * Every tool and action in Snapkit is declared here. The UI never hard-codes
 * which buttons exist: it reads this list, filters it by the user's settings
 * (enabled flag + order), and renders what is left. Adding a feature means
 * adding an entry here and an implementation keyed by its id.
 */

export type FeatureKind = 'tool' | 'action'

export interface FeatureVariant {
  id: string
  label: string
}

export interface FeatureDef {
  id: string
  label: string
  kind: FeatureKind
  /** Shortcut shown in the tooltip (display only; handled by the overlay). */
  hint?: string
  /** False while the feature is planned but not built yet. */
  implemented: boolean
  /**
   * Tools only: true for drawing tools (one is active at a time), false for
   * buttons that act immediately (color, undo, redo).
   */
  drawing?: boolean
  /** Alternative forms, chosen by right-clicking the button. The first is the default. */
  variants?: FeatureVariant[]
  /** Name of the whole group in settings when the tool has variants, e.g. "Shapes". */
  groupLabel?: string
  /** Tooltip hint for the right-click menu, e.g. "Right-click for arrow styles". */
  variantsHint?: string
  /** Extra tooltip line, e.g. a modifier key tip. */
  tipNote?: string
  /** Whether the feature is on for a fresh install. */
  defaultEnabled: boolean
  /** Already part of another tool's menu (the Shapes group), so not listed in Settings → Toolbar. */
  inGroup?: boolean
}

export const FEATURES: FeatureDef[] = [
  // Annotation tools (vertical bar)
  { id: 'pen', drawing: true, label: 'Pencil', kind: 'tool', hint: 'P', implemented: true, defaultEnabled: true, tipNote: 'Hold Shift for a straight line' },
  {
    id: 'arrow', drawing: true, label: 'Arrow', kind: 'tool', hint: 'A', implemented: true, defaultEnabled: true,
    variants: [
      { id: 'arrow', label: 'Arrow' },
      { id: 'arrow-both', label: 'Two-way arrow' }
    ],
    groupLabel: 'Arrows',
    variantsHint: 'Right-click for a two-way arrow',
    tipNote: 'Hold Shift to snap to 45°'
  },
  {
    id: 'rect', drawing: true, label: 'Rectangle', kind: 'tool', hint: 'R', implemented: true, defaultEnabled: true,
    variants: [
      { id: 'rect', label: 'Rectangle' },
      { id: 'rect-filled', label: 'Filled rectangle' },
      { id: 'ellipse', label: 'Ellipse' },
      { id: 'ellipse-filled', label: 'Filled ellipse' },
      { id: 'line', label: 'Line' }
    ],
    groupLabel: 'Shapes',
    variantsHint: 'Right-click for more shapes',
    tipNote: 'Hold Shift for a square'
  },
  // Also the last shape in the rectangle tool's menu, so off by default.
  { id: 'line', drawing: true, label: 'Line', kind: 'tool', hint: 'L', implemented: true, defaultEnabled: false, inGroup: true },
  {
    id: 'ellipse', drawing: true, label: 'Ellipse', kind: 'tool', hint: 'E', implemented: true, defaultEnabled: false, inGroup: true,
    variants: [
      { id: 'ellipse', label: 'Ellipse' },
      { id: 'ellipse-filled', label: 'Filled ellipse' }
    ],
    groupLabel: 'Ellipses',
    variantsHint: 'Right-click for more shapes'
  },
  { id: 'highlighter', drawing: true, label: 'Highlighter', kind: 'tool', hint: 'H', implemented: true, defaultEnabled: true, tipNote: 'Hold Shift for a straight line' },
  { id: 'text', drawing: true, label: 'Text', kind: 'tool', hint: 'T', implemented: true, defaultEnabled: true },
  { id: 'step', drawing: true, label: 'Numbered step', kind: 'tool', hint: 'N', implemented: true, defaultEnabled: true },
  { id: 'blur', drawing: true, label: 'Blur', kind: 'tool', hint: 'B', implemented: true, defaultEnabled: true },
  { id: 'color', label: 'Color', kind: 'tool', implemented: true, defaultEnabled: true },
  { id: 'undo', label: 'Undo', kind: 'tool', hint: '⌘Z', implemented: true, defaultEnabled: true },
  { id: 'redo', label: 'Redo', kind: 'tool', hint: '⇧⌘Z', implemented: true, defaultEnabled: false },

  // Actions (horizontal bar)
  { id: 'beautify', label: 'Background', kind: 'action', implemented: true, defaultEnabled: true },
  { id: 'beautifyEdit', label: 'Edit background', kind: 'action', implemented: true, defaultEnabled: true },
  { id: 'pin', label: 'Floating preview', kind: 'action', implemented: true, defaultEnabled: true },
  { id: 'save', label: 'Save', kind: 'action', hint: '⌘S', implemented: true, defaultEnabled: true },
  { id: 'copy', label: 'Copy', kind: 'action', hint: '⌘C', implemented: true, defaultEnabled: true },
  { id: 'close', label: 'Close', kind: 'action', hint: 'Esc', implemented: true, defaultEnabled: true }
]

export const featureById = (id: string): FeatureDef | undefined => FEATURES.find((f) => f.id === id)
