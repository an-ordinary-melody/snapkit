/**
 * Feature registry.
 *
 * Every tool and action in Snapkit is declared here. The UI never hard-codes
 * which buttons exist: it reads this list, filters it by the user's settings
 * (enabled flag + order), and renders what is left. Adding a feature means
 * adding an entry here and an implementation keyed by its id.
 */

export type FeatureKind = 'tool' | 'action'

export interface FeatureDef {
  id: string
  label: string
  kind: FeatureKind
  /** Shortcut shown in the tooltip (display only; handled by the overlay). */
  hint?: string
  /** False while the feature is planned but not built yet. */
  implemented: boolean
  /** Whether the feature is on for a fresh install. */
  defaultEnabled: boolean
}

export const FEATURES: FeatureDef[] = [
  // Annotation tools (vertical bar) — implemented in Phase 3
  { id: 'pen', label: 'Pen', kind: 'tool', hint: 'P', implemented: false, defaultEnabled: true },
  { id: 'line', label: 'Line', kind: 'tool', hint: 'L', implemented: false, defaultEnabled: true },
  { id: 'arrow', label: 'Arrow', kind: 'tool', hint: 'A', implemented: false, defaultEnabled: true },
  { id: 'rect', label: 'Rectangle', kind: 'tool', hint: 'R', implemented: false, defaultEnabled: true },
  { id: 'ellipse', label: 'Ellipse', kind: 'tool', hint: 'E', implemented: false, defaultEnabled: false },
  { id: 'highlighter', label: 'Highlighter', kind: 'tool', hint: 'H', implemented: false, defaultEnabled: true },
  { id: 'text', label: 'Text', kind: 'tool', hint: 'T', implemented: false, defaultEnabled: true },
  { id: 'step', label: 'Numbered step', kind: 'tool', hint: 'N', implemented: false, defaultEnabled: false },
  { id: 'blur', label: 'Blur', kind: 'tool', hint: 'B', implemented: false, defaultEnabled: true },
  { id: 'color', label: 'Color', kind: 'tool', implemented: false, defaultEnabled: true },
  { id: 'undo', label: 'Undo', kind: 'tool', hint: '⌘Z', implemented: false, defaultEnabled: true },

  // Actions (horizontal bar)
  { id: 'beautify', label: 'Background & padding', kind: 'action', implemented: false, defaultEnabled: true },
  { id: 'pin', label: 'Pin to screen', kind: 'action', implemented: false, defaultEnabled: true },
  { id: 'save', label: 'Save', kind: 'action', hint: '⌘S', implemented: true, defaultEnabled: true },
  { id: 'copy', label: 'Copy', kind: 'action', hint: '⌘C', implemented: true, defaultEnabled: true },
  { id: 'close', label: 'Close', kind: 'action', hint: 'Esc', implemented: true, defaultEnabled: true }
]

export const featureById = (id: string): FeatureDef | undefined => FEATURES.find((f) => f.id === id)
