// Feature registry: a Swift copy of src/shared/features.ts (same ids, order, letters, variants and
// defaults). The toolbars are built from this list filtered by the user's settings, as in Electron.
// `native` says whether the native app has built the feature yet; features it hasn't stay out of
// the toolbars until it has.

public struct FeatureVariant: Equatable {
  public let id: String
  public let label: String
}

public struct Feature: Equatable {
  public enum Kind: String { case tool, action }

  public let id: String
  public let label: String
  public let kind: Kind
  public var hint: String? = nil
  /** Drawing tools (one active at a time) vs buttons that act at once. */
  public var drawing: Bool = false
  public var variants: [FeatureVariant] = []
  public var groupLabel: String? = nil
  public var variantsHint: String? = nil
  public var tipNote: String? = nil
  public let defaultEnabled: Bool
  public var inGroup: Bool = false
  /** Built in the native app yet. */
  public var native: Bool = false
}

public enum Features {
  public static let all: [Feature] = [
    // Annotation tools (vertical bar)
    Feature(id: "pen", label: "Pencil", kind: .tool, hint: "P", drawing: true, tipNote: "Hold Shift for a straight line", defaultEnabled: true, native: true),
    Feature(
      id: "arrow", label: "Arrow", kind: .tool, hint: "A", drawing: true,
      variants: [FeatureVariant(id: "arrow", label: "Arrow"), FeatureVariant(id: "arrow-both", label: "Two-way arrow")],
      groupLabel: "Arrows", variantsHint: "Right-click for a two-way arrow", tipNote: "Hold Shift to snap to 45°", defaultEnabled: true, native: true
    ),
    Feature(
      id: "rect", label: "Rectangle", kind: .tool, hint: "R", drawing: true,
      variants: [
        FeatureVariant(id: "rect", label: "Rectangle"), FeatureVariant(id: "rect-filled", label: "Filled rectangle"),
        FeatureVariant(id: "ellipse", label: "Ellipse"), FeatureVariant(id: "ellipse-filled", label: "Filled ellipse"),
        FeatureVariant(id: "line", label: "Line")
      ],
      groupLabel: "Shapes", variantsHint: "Right-click for more shapes", tipNote: "Hold Shift for a square", defaultEnabled: true, native: true
    ),
    // Also the last shape in the rectangle tool's menu, so off by default.
    Feature(id: "line", label: "Line", kind: .tool, hint: "L", drawing: true, defaultEnabled: false, inGroup: true),
    Feature(
      id: "ellipse", label: "Ellipse", kind: .tool, hint: "E", drawing: true,
      variants: [FeatureVariant(id: "ellipse", label: "Ellipse"), FeatureVariant(id: "ellipse-filled", label: "Filled ellipse")],
      groupLabel: "Ellipses", variantsHint: "Right-click for more shapes", defaultEnabled: false, inGroup: true
    ),
    Feature(id: "highlighter", label: "Highlighter", kind: .tool, hint: "H", drawing: true, tipNote: "Hold Shift for a straight line", defaultEnabled: true),
    Feature(id: "text", label: "Text", kind: .tool, hint: "T", drawing: true, defaultEnabled: true, native: true),
    Feature(id: "step", label: "Numbered step", kind: .tool, hint: "N", drawing: true, defaultEnabled: true),
    Feature(id: "blur", label: "Blur", kind: .tool, hint: "B", drawing: true, defaultEnabled: true),
    Feature(id: "ruler", label: "Ruler", kind: .tool, hint: "M", drawing: true, tipNote: "Measures in pixels. Hold Shift for 45°", defaultEnabled: false),
    Feature(id: "color", label: "Color", kind: .tool, defaultEnabled: true, native: true),
    Feature(id: "undo", label: "Undo", kind: .tool, hint: "⌘Z", defaultEnabled: true, native: true),
    Feature(id: "redo", label: "Redo", kind: .tool, hint: "⇧⌘Z", defaultEnabled: false, native: true),

    // Actions (horizontal bar)
    Feature(id: "beautify", label: "Background", kind: .action, defaultEnabled: true),
    Feature(id: "beautifyEdit", label: "Edit background", kind: .action, defaultEnabled: true),
    Feature(id: "ocr", label: "Capture Text (OCR)", kind: .action, hint: "X", defaultEnabled: true),
    Feature(id: "pin", label: "Floating preview", kind: .action, defaultEnabled: true),
    Feature(id: "save", label: "Save", kind: .action, hint: "⌘S", defaultEnabled: true, native: true),
    Feature(id: "copy", label: "Copy", kind: .action, hint: "⌘C", defaultEnabled: true, native: true),
    Feature(id: "close", label: "Close", kind: .action, hint: "Esc", defaultEnabled: true, native: true)
  ]

  public static func byId(_ id: String) -> Feature? { all.first { $0.id == id } }
}
