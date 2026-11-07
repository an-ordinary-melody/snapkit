import Foundation

/**
 * Current style choices shared by every tool (Style in model.ts), plus the helpers Overlay.tsx and
 * StyleBar.tsx use: the style a selected shape shows, restyling a shape, text looks.
 */
public struct Style: Equatable {
  /** Shapes, lines and arrows. */
  public var color: String
  /** Text has its own colour, so a background look can pick a readable one without changing the rest. */
  public var textColor: String
  public var highlighterColor: String
  public var stepColor: String
  /** Index into the stroke width presets. */
  public var widthIndex: Int
  public var blurMode: String
  public var blurStrength: Double
  public var fontSize: Double
  public var fontFamily: String
  /** Text shadow, 0–1. */
  public var shadow: Double
  /** Fill behind the text ("" = none) and outline ("" = none); only one is used at a time. */
  public var textBackground: String
  public var textStroke: String
  /** Remembered for switching back to these looks. */
  public var textStrokeColor: String
  public var textBgColor: String
  public var textStrokeWidth: Double

  /** initialStyle() in Overlay.tsx. */
  public static func initial(_ s: Settings) -> Style {
    let a = s.annotate
    let first = a.palette.first ?? "#ef4444"
    return Style(
      color: first, textColor: first, highlighterColor: a.highlighterColor, stepColor: a.stepColor, widthIndex: a.strokeWidth,
      blurMode: a.blurMode, blurStrength: a.blurStrength, fontSize: a.text.fontSize, fontFamily: a.text.fontFamily, shadow: a.text.shadow,
      textBackground: a.text.style == "background" ? a.text.background : "",
      textStroke: a.text.style == "stroke" ? a.text.strokeColor : "",
      textStrokeColor: a.text.strokeColor, textBgColor: a.text.background.isEmpty ? "#ffffff" : a.text.background, textStrokeWidth: a.text.strokeWidth
    )
  }
}

/** A partial Style (the fields a style bar control changes). */
public struct StylePatch: Equatable {
  public var color: String?
  public var textColor: String?
  public var highlighterColor: String?
  public var stepColor: String?
  public var widthIndex: Int?
  public var blurMode: String?
  public var blurStrength: Double?
  public var fontSize: Double?
  public var shadow: Double?
  public var textBackground: String?
  public var textStroke: String?
  public var textStrokeColor: String?
  public var textBgColor: String?

  public init(color: String? = nil, textColor: String? = nil, highlighterColor: String? = nil, stepColor: String? = nil, widthIndex: Int? = nil,
              blurMode: String? = nil, blurStrength: Double? = nil, fontSize: Double? = nil, shadow: Double? = nil, textBackground: String? = nil,
              textStroke: String? = nil, textStrokeColor: String? = nil, textBgColor: String? = nil) {
    self.color = color
    self.textColor = textColor
    self.highlighterColor = highlighterColor
    self.stepColor = stepColor
    self.widthIndex = widthIndex
    self.blurMode = blurMode
    self.blurStrength = blurStrength
    self.fontSize = fontSize
    self.shadow = shadow
    self.textBackground = textBackground
    self.textStroke = textStroke
    self.textStrokeColor = textStrokeColor
    self.textBgColor = textBgColor
  }

  /** Field names, for undo merge keys. */
  public var keys: String {
    var k: [String] = []
    if color != nil { k.append("color") }
    if textColor != nil { k.append("textColor") }
    if highlighterColor != nil { k.append("highlighterColor") }
    if stepColor != nil { k.append("stepColor") }
    if widthIndex != nil { k.append("widthIndex") }
    if blurMode != nil { k.append("blurMode") }
    if blurStrength != nil { k.append("blurStrength") }
    if fontSize != nil { k.append("fontSize") }
    if shadow != nil { k.append("shadow") }
    if textBackground != nil { k.append("textBackground") }
    if textStroke != nil { k.append("textStroke") }
    return k.joined(separator: ",")
  }
}

extension Style {
  public func applying(_ p: StylePatch) -> Style {
    var s = self
    if let v = p.color { s.color = v }
    if let v = p.textColor { s.textColor = v }
    if let v = p.highlighterColor { s.highlighterColor = v }
    if let v = p.stepColor { s.stepColor = v }
    if let v = p.widthIndex { s.widthIndex = v }
    if let v = p.blurMode { s.blurMode = v }
    if let v = p.blurStrength { s.blurStrength = v }
    if let v = p.fontSize { s.fontSize = v }
    if let v = p.shadow { s.shadow = v }
    if let v = p.textBackground { s.textBackground = v }
    if let v = p.textStroke { s.textStroke = v }
    if let v = p.textStrokeColor { s.textStrokeColor = v }
    if let v = p.textBgColor { s.textBgColor = v }
    return s
  }
}

/** What the style bar edits: the active tool, or the selected shape's type. */
public enum StyleTargets {
  public static let stroked: Set<String> = ["pen", "line", "arrow", "ruler", "rect", "ellipse"]
  public static let colored: Set<String> = ["pen", "line", "arrow", "ruler", "rect", "ellipse", "text", "step", "highlighter"]
  public static func hasOptions(_ t: String) -> Bool { colored.contains(t) || t == "blur" }

  /** Which Style field holds this target's colour. */
  public static func colorKey(_ t: String) -> String {
    t == "text" ? "textColor" : t == "highlighter" ? "highlighterColor" : t == "step" ? "stepColor" : "color"
  }
}

public enum TextLook: String, CaseIterable {
  case plain, stroke, light, dark

  public var label: String {
    switch self {
    case .plain: return "Plain"
    case .stroke: return "Stroke (outline)"
    case .light: return "Light background"
    case .dark: return "Dark background"
    }
  }

  public static func of(_ s: Style) -> TextLook {
    if !s.textBackground.isEmpty { return HexColor.isLight(s.textBackground) ? .light : .dark }
    return s.textStroke.isEmpty ? .plain : .stroke
  }

  /** lookPatch(): one look at a time; a background comes with readable black or white text. */
  public func patch(_ s: Style) -> StylePatch {
    // Leaving a background look: its black/white text would vanish on the screenshot, so use the drawing colour again.
    let restore: String? = s.textBackground.isEmpty ? nil : s.color
    switch self {
    case .plain: return StylePatch(textColor: restore, textBackground: "", textStroke: "")
    case .stroke: return StylePatch(textColor: restore, textBackground: "", textStroke: s.textStrokeColor)
    case .light:
      let bg = HexColor.isLight(s.textBgColor) ? s.textBgColor : "#ffffff"
      return StylePatch(textColor: HexColor.readableOn(bg), textBackground: bg, textStroke: "", textBgColor: bg)
    case .dark:
      let bg = HexColor.isLight(s.textBgColor) ? "#111111" : s.textBgColor
      return StylePatch(textColor: HexColor.readableOn(bg), textBackground: bg, textStroke: "", textBgColor: bg)
    }
  }
}

extension Shape {
  /** styleOf(): what the style bar shows for this shape, its own values over the current style. */
  public func style(over base: Style, widths: [Double]) -> Style {
    func index(_ w: Double) -> Int {
      widths.indices.reduce(0) { best, i in abs(widths[i] - w) < abs(widths[best] - w) ? i : best }
    }
    var s = base
    switch self {
    case let .stroke(v) where v.type == "highlighter": s.highlighterColor = v.color
    case let .stroke(v):
      s.color = v.color
      s.widthIndex = index(v.width)
    case let .line(v):
      s.color = v.color
      s.widthIndex = index(v.width)
    case let .box(v):
      s.color = v.color
      s.widthIndex = index(v.width)
    case let .step(v): s.stepColor = v.color
    case let .text(v):
      s.textColor = v.color
      s.fontSize = v.fontSize
      s.textBackground = v.background
      s.textStroke = v.stroke ?? ""
      s.shadow = v.shadow
    case let .blur(v):
      s.blurMode = v.mode
      s.blurStrength = v.strength
    }
    return s
  }

  /** restyle(): the parts of `p` that apply to this shape. */
  public func restyled(_ p: StylePatch, widths: [Double]) -> Shape {
    let width = { (w: Double) in p.widthIndex.flatMap { widths.indices.contains($0) ? widths[$0] : nil } ?? w }
    switch self {
    case var .stroke(v) where v.type == "highlighter":
      v.color = p.highlighterColor ?? v.color
      return .stroke(v)
    case var .stroke(v):
      v.color = p.color ?? v.color
      v.width = width(v.width)
      return .stroke(v)
    case var .line(v):
      v.color = p.color ?? v.color
      v.width = width(v.width)
      return .line(v)
    case var .box(v):
      v.color = p.color ?? v.color
      v.width = width(v.width)
      return .box(v)
    case var .step(v):
      v.color = p.stepColor ?? v.color
      return .step(v)
    case var .text(v):
      v.color = p.textColor ?? v.color
      v.fontSize = p.fontSize ?? v.fontSize
      v.shadow = p.shadow ?? v.shadow
      v.background = p.textBackground ?? v.background
      v.stroke = p.textStroke ?? v.stroke
      return .text(v)
    case var .blur(v):
      v.mode = p.blurMode ?? v.mode
      v.strength = p.blurStrength ?? v.strength
      return .blur(v)
    }
  }

  /** moveShape(). */
  public func moved(_ dx: Double, _ dy: Double) -> Shape {
    switch self {
    case var .stroke(v):
      v.points = v.points.enumerated().map { $0.offset % 2 == 1 ? $0.element + dy : $0.element + dx }
      return .stroke(v)
    case var .line(v):
      v.points = [v.points[0] + dx, v.points[1] + dy, v.points[2] + dx, v.points[3] + dy]
      return .line(v)
    case var .box(v):
      v.x += dx
      v.y += dy
      return .box(v)
    case var .blur(v):
      v.x += dx
      v.y += dy
      return .blur(v)
    case var .step(v):
      v.x += dx
      v.y += dy
      return .step(v)
    case var .text(v):
      v.x += dx
      v.y += dy
      return .text(v)
    }
  }

  /**
   * transformShape(): the result of a resize, as moving the shape's frame by (gx, gy) and scaling it
   * by (sx, sy) around the layer origin.
   */
  public func transformed(gx: Double, gy: Double, sx: Double, sy: Double) -> Shape {
    let px = { (x: Double) in gx + x * sx }
    let py = { (y: Double) in gy + y * sy }
    switch self {
    case var .box(v):
      (v.x, v.y, v.w, v.h) = (px(v.x), py(v.y), max(4, v.w * sx), max(4, v.h * sy))
      return .box(v)
    case var .blur(v):
      (v.x, v.y, v.w, v.h) = (px(v.x), py(v.y), max(4, v.w * sx), max(4, v.h * sy))
      return .blur(v)
    case var .text(v):
      (v.x, v.y) = (px(v.x), py(v.y))
      v.fontSize = max(8, jsRound(v.fontSize * sy))
      return .text(v)
    case var .step(v):
      (v.x, v.y) = (px(v.x), py(v.y))
      v.size = max(14, jsRound(v.size * sy))
      return .step(v)
    default:
      return moved(gx, gy)
    }
  }

  /** Resizable with the selection frame's handles (lines use their end points instead). */
  public var resizable: Bool {
    switch self {
    case .box, .blur, .text, .step: return true
    default: return false
    }
  }

  /** Text and steps resize from the corners only, keeping their proportions. */
  public var keepsRatio: Bool {
    switch self {
    case .text, .step: return true
    default: return false
    }
  }
}

extension Annotations {
  /** A ruler's end ticks: two short strokes across the line, as [x1, y1, x2, y2] each. */
  public static func rulerTicks(_ p: [Double], length: Double) -> ([Double], [Double]) {
    let len = hypot(p[2] - p[0], p[3] - p[1])
    let d1 = len == 0 ? 1 : len
    let nx = (-(p[3] - p[1]) / d1) * (length / 2)
    let ny = ((p[2] - p[0]) / d1) * (length / 2)
    return ([p[0] - nx, p[1] - ny, p[0] + nx, p[1] + ny], [p[2] - nx, p[3] - ny, p[2] + nx, p[3] + ny])
  }

  /** A guide line to show while snapped: vertical at `at` (from–to on y), or horizontal. */
  public struct Guide: Equatable {
    public var vertical: Bool
    public var at, from, to: Double
    public init(vertical: Bool, at: Double, from: Double, to: Double) {
      self.vertical = vertical
      self.at = at
      self.from = from
      self.to = to
    }
  }

  /** snapBox(): nudge a moving box so its edges/centres line up with another's within `threshold`. */
  public static func snapBox(_ box: LRect, targets: [LRect], threshold: Double) -> (dx: Double, dy: Double, guides: [Guide]) {
    let xs = { (b: LRect) in [b.x, b.x + b.w / 2, b.x + b.w] }
    let ys = { (b: LRect) in [b.y, b.y + b.h / 2, b.y + b.h] }
    var best = (d: Double.infinity, at: 0.0, t: nil as LRect?)
    var bestY = (d: Double.infinity, at: 0.0, t: nil as LRect?)
    for t in targets {
      for tx in xs(t) { for bx in xs(box) where abs(tx - bx) < abs(best.d) { best = (tx - bx, tx, t) } }
      for ty in ys(t) { for by in ys(box) where abs(ty - by) < abs(bestY.d) { bestY = (ty - by, ty, t) } }
    }
    let dx = abs(best.d) <= threshold ? best.d : 0
    let dy = abs(bestY.d) <= threshold ? bestY.d : 0
    let moved = LRect(x: box.x + dx, y: box.y + dy, w: box.w, h: box.h)
    var guides: [Guide] = []
    if let t = best.t, abs(best.d) <= threshold {
      guides.append(Guide(vertical: true, at: best.at, from: min(moved.y, t.y), to: max(moved.y + moved.h, t.y + t.h)))
    }
    if let t = bestY.t, abs(bestY.d) <= threshold {
      guides.append(Guide(vertical: false, at: bestY.at, from: min(moved.x, t.x), to: max(moved.x + moved.w, t.x + t.w)))
    }
    return (dx, dy, guides)
  }
}
