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
  /** Focus/selection ring (--ui-ring), fields, slider track, tooltips, menus (--ui-bg-strong), text-look glyphs. */
  var ring: NSColor = .white
  var field: NSColor = .clear
  var track: NSColor = .gray
  var trackFill: NSColor = .white
  var tipBackground: NSColor = .black
  var tipForeground: NSColor = .white
  var strongBackground: NSColor = .black
  var glyphFill: NSColor = .white
  var glyphLine: NSColor = .black

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
      t.ring = .white
      t.field = .rgba(255, 255, 255, gray ? 0.1 : 0.08)
      t.track = NSColor(hex: "#71717a")
      t.trackFill = NSColor(hex: "#f4f4f5")
      t.tipBackground = gray ? .rgba(52, 52, 56, 0.96) : .rgba(20, 20, 22, 0.94)
      t.tipForeground = NSColor(hex: "#f4f4f5")
      t.strongBackground = NSColor(hex: gray ? "#3a3a3e" : "#1e1e21")
      t.glyphFill = NSColor(hex: "#111111")
      t.glyphLine = .white
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
      t.ring = NSColor(hex: "#1c1c1e")
      t.field = .rgba(0, 0, 0, 0.06)
      t.track = NSColor(hex: "#8e8e93")
      t.trackFill = NSColor(hex: "#1c1c1e")
      t.tipBackground = .rgba(30, 30, 32, 0.9)
      t.tipForeground = NSColor(hex: "#f4f4f5")
      t.strongBackground = NSColor(hex: "#fbfbfc")
      t.glyphFill = .white
      t.glyphLine = NSColor(hex: "#1c1c1e")
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
