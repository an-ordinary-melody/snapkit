import Foundation

// Annotation data model: a port of src/renderer/src/overlay/annotate/model.ts. Coordinates are in
// overlay points (the selection's space); output scales them to image pixels. The Codable shape
// matches the JSON in history doc.json, so either app can reopen the other's drawings.

public enum Shape: Equatable {
  /** pen / highlighter: flat [x1, y1, x2, y2, …]. */
  case stroke(Stroke)
  /** line / arrow / ruler. */
  case line(Line)
  /** rect / ellipse. */
  case box(Box)
  case blur(Blur)
  case step(Step)
  case text(Text)

  public struct Stroke: Equatable, Codable {
    public init(id: String, type: String, points: [Double], color: String, width: Double) {
      self.id = id; self.type = type; self.points = points; self.color = color; self.width = width
    }

    public var id: String
    public var type: String
    public var points: [Double]
    public var color: String
    public var width: Double
  }

  public struct Line: Equatable, Codable {
    public init(id: String, type: String, points: [Double], color: String, width: Double, head: String? = nil, bothEnds: Bool? = nil) {
      self.id = id; self.type = type; self.points = points; self.color = color; self.width = width; self.head = head; self.bothEnds = bothEnds
    }

    public var id: String
    public var type: String
    public var points: [Double]
    public var color: String
    public var width: Double
    /** Arrows: "filled" (default) or "open". */
    public var head: String?
    /** Arrows: a head at the start too. */
    public var bothEnds: Bool?
  }

  public struct Box: Equatable, Codable {
    public init(id: String, type: String, x: Double, y: Double, w: Double, h: Double, color: String, width: Double, filled: Bool? = nil) {
      self.id = id; self.type = type; self.x = x; self.y = y; self.w = w; self.h = h; self.color = color; self.width = width; self.filled = filled
    }

    public var id: String
    public var type: String
    public var x, y, w, h: Double
    public var color: String
    public var width: Double
    public var filled: Bool?
  }

  public struct Blur: Equatable, Codable {
    public init(id: String, type: String = "blur", x: Double, y: Double, w: Double, h: Double, mode: String, strength: Double) {
      self.id = id; self.type = type; self.x = x; self.y = y; self.w = w; self.h = h; self.mode = mode; self.strength = strength
    }

    public var id: String
    public var type: String
    public var x, y, w, h: Double
    public var mode: String
    public var strength: Double

    private enum CodingKeys: String, CodingKey { case id, type, x, y, w, h, mode, strength }

    /** Older blurs may lack `mode` or `strength`: blur at 12, as Electron's BlurNode reads them. */
    public init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self)
      id = try c.decode(String.self, forKey: .id)
      type = try c.decodeIfPresent(String.self, forKey: .type) ?? "blur"
      x = try c.decode(Double.self, forKey: .x)
      y = try c.decode(Double.self, forKey: .y)
      w = try c.decode(Double.self, forKey: .w)
      h = try c.decode(Double.self, forKey: .h)
      mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "blur"
      strength = try c.decodeIfPresent(Double.self, forKey: .strength) ?? 12
    }
  }

  public struct Step: Equatable, Codable {
    public init(id: String, type: String = "step", x: Double, y: Double, size: Double, color: String) {
      self.id = id; self.type = type; self.x = x; self.y = y; self.size = size; self.color = color
    }

    public var id: String
    public var type: String
    public var x, y: Double
    public var size: Double
    public var color: String
  }

  public struct Text: Equatable, Codable {
    public init(id: String, type: String = "text", x: Double, y: Double, text: String, color: String, fontSize: Double, fontFamily: String,
                shadow: Double, background: String, stroke: String?, strokeWidth: Double?) {
      self.id = id; self.type = type; self.x = x; self.y = y; self.text = text; self.color = color; self.fontSize = fontSize
      self.fontFamily = fontFamily; self.shadow = shadow; self.background = background; self.stroke = stroke; self.strokeWidth = strokeWidth
    }

    public var id: String
    public var type: String
    public var x, y: Double
    public var text: String
    public var color: String
    public var fontSize: Double
    public var fontFamily: String
    public var shadow: Double
    /** Fill behind the text, or "" for none. */
    public var background: String
    /** Outline around the letters, or "" / nil for none. */
    public var stroke: String?
    public var strokeWidth: Double?
  }

  public var id: String {
    switch self {
    case let .stroke(s): return s.id
    case let .line(s): return s.id
    case let .box(s): return s.id
    case let .blur(s): return s.id
    case let .step(s): return s.id
    case let .text(s): return s.id
    }
  }

  public var type: String {
    switch self {
    case let .stroke(s): return s.type
    case let .line(s): return s.type
    case let .box(s): return s.type
    case let .blur(s): return s.type
    case let .step(s): return s.type
    case let .text(s): return s.type
    }
  }
}

extension Shape: Codable {
  private enum TypeKey: String, CodingKey { case type }

  public init(from decoder: Decoder) throws {
    let t = try decoder.container(keyedBy: TypeKey.self).decode(String.self, forKey: .type)
    switch t {
    case "pen", "highlighter": self = .stroke(try Stroke(from: decoder))
    case "line", "arrow", "ruler": self = .line(try Line(from: decoder))
    case "rect", "ellipse": self = .box(try Box(from: decoder))
    case "blur": self = .blur(try Blur(from: decoder))
    case "step": self = .step(try Step(from: decoder))
    case "text": self = .text(try Text(from: decoder))
    default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown shape type \(t)"))
    }
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case let .stroke(s): try s.encode(to: encoder)
    case let .line(s): try s.encode(to: encoder)
    case let .box(s): try s.encode(to: encoder)
    case let .blur(s): try s.encode(to: encoder)
    case let .step(s): try s.encode(to: encoder)
    case let .text(s): try s.encode(to: encoder)
    }
  }
}

public enum Annotations {
  private static var counter = 0

  public static func newId() -> String {
    counter += 1
    return "s\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))\(String(counter, radix: 36))"
  }

  /** Arrow head size for a stroke width (AnnotationLayer.tsx). */
  public static func arrowHead(width: Double) -> Double { width * 2.5 + 8 }

  /** Snap (dx, dy) to the nearest 45° direction, keeping its length. */
  public static func snap45(_ dx: Double, _ dy: Double) -> (Double, Double) {
    let len = hypot(dx, dy)
    let angle = (atan2(dy, dx) / (Double.pi / 4)).rounded() * (Double.pi / 4)
    let x = jsRound(cos(angle) * len)
    let y = jsRound(sin(angle) * len)
    return (x == 0 ? 0 : x, y == 0 ? 0 : y)
  }

  /** Box from a drag; with `square`, the shorter side grows to match the longer one. */
  public static func boxFromDrag(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double, square: Bool = false) -> (x: Double, y: Double, w: Double, h: Double) {
    var dx = x1 - x0
    var dy = y1 - y0
    if square {
      let m = max(abs(dx), abs(dy))
      dx = (dx < 0 ? -1 : 1) * m
      dy = (dy < 0 ? -1 : 1) * m
    }
    return (min(x0, x0 + dx), min(y0, y0 + dy), abs(dx), abs(dy))
  }

  /** Shapes too small to mean anything (a click without a drag) are dropped. */
  public static func isMeaningful(_ s: Shape) -> Bool {
    switch s {
    case let .stroke(v): return v.points.count >= 4
    case let .line(v): return hypot(v.points[2] - v.points[0], v.points[3] - v.points[1]) >= 4
    case let .box(v): return v.w >= 4 && v.h >= 4
    case let .blur(v): return v.w >= 4 && v.h >= 4
    case let .text(v): return !v.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    case .step: return true
    }
  }

  /** The two short strokes of an open arrow head, as [x1, y1, tipX, tipY, x2, y2]. */
  public static func openArrowHead(_ p: [Double], length: Double) -> [Double] {
    let a = atan2(p[3] - p[1], p[2] - p[0])
    let spread = Double.pi / 6.5
    return [p[2] - length * cos(a - spread), p[3] - length * sin(a - spread), p[2], p[3], p[2] - length * cos(a + spread), p[3] - length * sin(a + spread)]
  }

  /** A ruler's length in image pixels, e.g. "240 px". */
  public static func rulerLabel(_ p: [Double], scale: Double) -> String {
    "\(Int(jsRound(hypot(p[2] - p[0], p[3] - p[1]) * scale))) px"
  }

  /** Step numbers follow drawing order. */
  public static func stepNumbers(_ shapes: [Shape]) -> [String: Int] {
    var out: [String: Int] = [:]
    var n = 0
    for s in shapes { if case .step = s { n += 1; out[s.id] = n } }
    return out
  }
}

/** Undo / redo of the shape list (commit / undo / redo in model.ts). */
public struct ShapeHistory: Equatable {
  public private(set) var past: [[Shape]] = []
  public private(set) var present: [Shape] = []
  public private(set) var future: [[Shape]] = []
  /** Consecutive commits with the same key (e.g. dragging a slider) are one undo step. */
  private var mergeKey: String?

  public init() {}

  /** Start from these shapes with nothing to undo (a reopened capture). */
  public init(present: [Shape]) { self.present = present }

  public mutating func commit(_ next: [Shape], mergeKey: String? = nil) {
    if next == present { return }
    if let mergeKey, mergeKey == self.mergeKey {
      present = next
      future = []
      return
    }
    past.append(present)
    present = next
    future = []
    self.mergeKey = mergeKey
  }

  public mutating func undo() {
    guard let last = past.popLast() else { return }
    future.insert(present, at: 0)
    present = last
    mergeKey = nil
  }

  public mutating func redo() {
    guard !future.isEmpty else { return }
    past.append(present)
    present = future.removeFirst()
    mergeKey = nil
  }

  public var canUndo: Bool { !past.isEmpty }
  public var canRedo: Bool { !future.isEmpty }
}
