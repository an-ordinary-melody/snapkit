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
  /** Whether the feature is on for a fresh install. */
  defaultEnabled: boolean
}

export const FEATURES: FeatureDef[] = [
  // Annotation tools (vertical bar)
  { id: 'pen', drawing: true, label: 'Pen', kind: 'tool', hint: 'P', implemented: true, defaultEnabled: true },
  { id: 'line', drawing: true, label: 'Line', kind: 'tool', hint: 'L', implemented: true, defaultEnabled: true },
  { id: 'arrow', drawing: true, label: 'Arrow', kind: 'tool', hint: 'A', implemented: true, defaultEnabled: true },
  {
    id: 'rect', drawing: true, label: 'Rectangle', kind: 'tool', hint: 'R', implemented: true, defaultEnabled: true,
    variants: [
      { id: 'rect', label: 'Rectangle' },
      { id: 'rect-filled', label: 'Filled rectangle' },
      { id: 'ellipse', label: 'Ellipse' },
      { id: 'ellipse-filled', label: 'Filled ellipse' }
    ]
  },
  {
    id: 'ellipse', drawing: true, label: 'Ellipse', kind: 'tool', hint: 'E', implemented: true, defaultEnabled: false,
    variants: [
      { id: 'ellipse', label: 'Ellipse' },
      { id: 'ellipse-filled', label: 'Filled ellipse' }
    ]
  },
  { id: 'highlighter', drawing: true, label: 'Highlighter', kind: 'tool', hint: 'H', implemented: true, defaultEnabled: true },
  { id: 'text', drawing: true, label: 'Text', kind: 'tool', hint: 'T', implemented: true, defaultEnabled: true },
  { id: 'step', drawing: true, label: 'Numbered step', kind: 'tool', hint: 'N', implemented: true, defaultEnabled: false },
  { id: 'blur', drawing: true, label: 'Blur', kind: 'tool', hint: 'B', implemented: true, defaultEnabled: true },
  { id: 'color', label: 'Color', kind: 'tool', implemented: true, defaultEnabled: true },
  { id: 'undo', label: 'Undo', kind: 'tool', hint: '⌘Z', implemented: true, defaultEnabled: true },
  { id: 'redo', label: 'Redo', kind: 'tool', hint: '⇧⌘Z', implemented: true, defaultEnabled: false },

  // Actions (horizontal bar)
  { id: 'beautify', label: 'Background & padding', kind: 'action', implemented: false, defaultEnabled: true },
  { id: 'pin', label: 'Pin to screen', kind: 'action', implemented: false, defaultEnabled: true },
  { id: 'save', label: 'Save', kind: 'action', hint: '⌘S', implemented: true, defaultEnabled: true },
  { id: 'copy', label: 'Copy', kind: 'action', hint: '⌘C', implemented: true, defaultEnabled: true },
  { id: 'close', label: 'Close', kind: 'action', hint: 'Esc', implemented: true, defaultEnabled: true }
]

export const featureById = (id: string): FeatureDef | undefined => FEATURES.find((f) => f.id === id)
