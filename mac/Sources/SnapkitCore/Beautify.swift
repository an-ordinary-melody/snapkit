import Foundation

/**
 * Background, padding, corners and shadow around the output (src/renderer/src/overlay/beautify/layout.ts).
 * Output size: `auto` follows the captured area; `ratio` widens or heightens the background to an aspect
 * ratio; `size` is an exact size in output pixels (the screenshot is scaled down to fit if needed).
 */
public enum Frame: Equatable, Codable {
  case auto
  case ratio(w: Double, h: Double)
  case size(w: Double, h: Double)

  private enum Keys: String, CodingKey { case kind, w, h }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "ratio": self = .ratio(w: try c.decode(Double.self, forKey: .w), h: try c.decode(Double.self, forKey: .h))
    case "size": self = .size(w: try c.decode(Double.self, forKey: .w), h: try c.decode(Double.self, forKey: .h))
    default: self = .auto
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    switch self {
    case .auto: try c.encode("auto", forKey: .kind)
    case let .ratio(w, h):
      try c.encode("ratio", forKey: .kind)
      try c.encode(w, forKey: .w)
      try c.encode(h, forKey: .h)
    case let .size(w, h):
      try c.encode("size", forKey: .kind)
      try c.encode(w, forKey: .w)
      try c.encode(h, forKey: .h)
    }
  }

  /** FRAMES: the size choices in the editor. */
  public static let presets: [(label: String, frame: Frame)] = [
    ("Auto", .auto), ("Square 1:1", .ratio(w: 1, h: 1)), ("Slide 16:9", .ratio(w: 16, h: 9)),
    ("Classic 4:3", .ratio(w: 4, h: 3)), ("Story 9:16", .ratio(w: 9, h: 16))
  ]
}

/** Per-capture choices: a preset plus the user's tweaks to it. */
public struct BeautifyState: Equatable, Codable {
  public var on: Bool
  public var presetId: String
  /** Background picked in the editor instead of the preset's. */
  public var background: BeautifyBackground?
  public var padding: Double
  public var radius: Double
  public var shadow: Double
  public var frame: Frame?

  public init(on: Bool, presetId: String, background: BeautifyBackground? = nil, padding: Double, radius: Double, shadow: Double, frame: Frame? = nil) {
    self.on = on
    self.presetId = presetId
    self.background = background
    self.padding = padding
    self.radius = radius
    self.shadow = shadow
    self.frame = frame
  }

  public static func from(_ p: BeautifyPreset, on: Bool, frame: Frame? = nil) -> BeautifyState {
    BeautifyState(on: on, presetId: p.id, padding: p.padding, radius: p.radius, shadow: p.shadow, frame: frame)
  }

  /** What the output looks like with the background off: just the screenshot. */
  public var plain: BeautifyState {
    var s = self
    (s.padding, s.radius, s.shadow, s.frame) = (0, 0, 0, .auto)
    return s
  }

  /** The background in effect: the editor's pick, else the preset's. */
  public func background(in presets: [BeautifyPreset]) -> BeautifyBackground? {
    background ?? presets.first { $0.id == presetId }?.background ?? presets.first?.background
  }

  /** initialBeautify(): the remembered state if its preset still exists, else the default preset; on per applyOnCopy. */
  public static func initial(_ s: Settings, last: BeautifyState?) -> BeautifyState {
    let presets = s.beautify.presets
    let on = s.beautify.applyOnCopy
    if var l = last, presets.contains(where: { $0.id == l.presetId }) {
      l.on = on
      return l
    }
    guard let p = presets.first(where: { $0.id == s.beautify.preset }) ?? presets.first else {
      return BeautifyState(on: false, presetId: "", padding: 0, radius: 0, shadow: 0)
    }
    return .from(p, on: on)
  }
}

public struct BeautifyLayout: Equatable {
  public var width, height: Double
  /** Where the screenshot goes on the output, and its drawn size. */
  public var x, y, drawW, drawH: Double
  public var radius: Double
  public var shadowBlur: Double
  public var shadowOffsetY: Double
  public var shadowAlpha: Double
}

public enum BeautifyGeometry {
  /**
   * beautifyLayout(): output geometry in image pixels for an image of w×h. `scale` converts the
   * preset's screen points to image pixels; `frameScale` shrinks a fixed size for a smaller preview.
   */
  public static func layout(w: Double, h: Double, padding: Double, radius: Double, shadow: Double, frame: Frame?, scale: Double, frameScale: Double = 1) -> BeautifyLayout {
    let pad = max(0, jsRound(padding * scale))
    var width = w + pad * 2, height = h + pad * 2
    var drawW = w, drawH = h
    switch frame ?? .auto {
    case let .ratio(fw, fh) where fw > 0 && fh > 0:
      let r = fw / fh
      if width / height < r { width = jsRound(height * r) } else { height = jsRound(width / r) }
    case let .size(fw, fh) where fw > 0 && fh > 0:
      width = jsRound(fw * frameScale)
      height = jsRound(fh * frameScale)
      let fit = min(1, max(1, width - pad * 2) / w, max(1, height - pad * 2) / h)
      drawW = jsRound(w * fit)
      drawH = jsRound(h * fit)
    default: break
    }
    // A corner can't be rounder than half the shorter side.
    let r = min(max(0, radius * scale), min(drawW, drawH) / 2)
    let alpha = min(1, max(0, shadow))
    // Keep the shadow inside the space around the screenshot so it isn't cut off.
    let room = min(width - drawW, height - drawH) / 2
    let blur = alpha > 0 ? max(0, min(room * 0.8, 30 * scale)) : 0
    return BeautifyLayout(width: width, height: height, x: jsRound((width - drawW) / 2), y: jsRound((height - drawH) / 2), drawW: drawW, drawH: drawH,
                          radius: r, shadowBlur: blur, shadowOffsetY: blur * 0.3, shadowAlpha: alpha)
  }

  public static func layout(w: Double, h: Double, state s: BeautifyState, scale: Double, frameScale: Double = 1) -> BeautifyLayout {
    layout(w: w, h: h, padding: s.padding, radius: s.radius, shadow: s.shadow, frame: s.frame, scale: scale, frameScale: frameScale)
  }

  /** Start and end of a CSS-style linear gradient at `angle` degrees across a w×h box (corner to corner). */
  public static func gradientLine(w: Double, h: Double, angle: Double) -> (Double, Double, Double, Double) {
    let a = angle * .pi / 180
    let dx = cos(a), dy = sin(a)
    let half = (abs(w * dx) + abs(h * dy)) / 2
    return (w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half)
  }
}

/** Colour helpers for the background editor (color.ts). */
public enum HSV {
  /** hexToHsv: h 0–360, s/v 0–1. */
  public static func from(_ hex: String) -> (h: Double, s: Double, v: Double) {
    let (r, g, b) = HexColor.rgb(hex)
    let mx = max(r, g, b), d = mx - min(r, g, b)
    var h = 0.0
    if d > 0 {
      if mx == r { h = ((g - b) / d).truncatingRemainder(dividingBy: 6) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
    }
    return ((h * 60 + 360).truncatingRemainder(dividingBy: 360), mx > 0 ? d / mx : 0, mx)
  }

  /** hsvToHex. */
  public static func hex(h: Double, s: Double, v: Double) -> String {
    func f(_ k: Double) -> Double {
      let x = (k + h / 60).truncatingRemainder(dividingBy: 6)
      return v - v * s * max(0, min(x, 4 - x, 1))
    }
    func to(_ c: Double) -> String { String(format: "%02x", Int(jsRound(c * 255))) }
    return "#" + to(f(5)) + to(f(3)) + to(f(1))
  }

  /** Rotate a colour's hue by `deg`. */
  public static func shiftHue(_ hex: String, _ deg: Double) -> String {
    let c = from(hex)
    return Self.hex(h: (c.h + deg + 360).truncatingRemainder(dividingBy: 360), s: c.s, v: c.v)
  }
}
