import AppKit
import SnapkitCore

extension NSColor {
  /** "#rrggbb" (or "#rgb"); black for anything else. */
  convenience init(hex: String, alpha: CGFloat = 1) {
    let (r, g, b) = HexColor.rgb(hex)
    self.init(srgbRed: r, green: g, blue: b, alpha: alpha)
  }

  static func rgba(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat) -> NSColor {
    NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
  }
}

/**
 * Panel colours for the capture-mode toolbars, from the Electron CSS tokens (styles.css):
 * light / dark / gray, Liquid Glass on or off, and the accent. Liquid Glass panels are drawn solid
 * for now (real glass comes with the appearance work).
 */
struct Theme {
  var dark: Bool
  var background: NSColor
  var foreground: NSColor
  var hover: NSColor
  var separator: NSColor
  var rim: NSColor
  var rimWidth: CGFloat
  var shadow: NSColor
  var radius: CGFloat
  var buttonRadius: CGFloat
  var activeBackground: NSColor
  var activeForeground: NSColor
  var swatchEdge: NSColor

  static func from(_ a: Settings.Appearance) -> Theme {
    let systemDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    let dark = a.mode == "dark" || a.mode == "gray" || (a.mode == "system" && systemDark)
    let gray = a.mode == "gray"
    var t: Theme
    if dark {
      t = Theme(
        dark: true,
        background: gray ? .rgba(56, 56, 60, 0.97) : .rgba(30, 30, 32, 0.97),
        foreground: NSColor(hex: "#e7e7ea"),
        hover: .rgba(255, 255, 255, 0.17),
        separator: .rgba(255, 255, 255, 0.14),
        rim: .rgba(255, 255, 255, gray ? 0.1 : 0.08),
        rimWidth: 1,
        shadow: .rgba(0, 0, 0, 0.35),
        radius: 10,
        buttonRadius: 6,
        activeBackground: .rgba(255, 255, 255, 0.22),
        activeForeground: .white,
        swatchEdge: .rgba(255, 255, 255, 0.25)
      )
    } else {
      t = Theme(
        dark: false,
        background: .rgba(248, 248, 250, 0.98),
        foreground: NSColor(hex: "#1c1c1e"),
        hover: .rgba(0, 0, 0, 0.12),
        separator: .rgba(0, 0, 0, 0.12),
        rim: .rgba(0, 0, 0, 0.12),
        rimWidth: 0.5,
        shadow: .rgba(0, 0, 0, 0.18),
        radius: 10,
        buttonRadius: 6,
        activeBackground: .white,
        activeForeground: NSColor(hex: "#1c1c1e"),
        swatchEdge: .rgba(0, 0, 0, 0.18)
      )
    }
    if a.glass {
      t.radius = 16
      t.buttonRadius = 8
    }
    if let accent = HexColor.parse(a.accent) {
      t.activeBackground = NSColor(hex: accent)
      t.activeForeground = NSColor(hex: HexColor.readableOn(accent))
    }
    return t
  }
}
