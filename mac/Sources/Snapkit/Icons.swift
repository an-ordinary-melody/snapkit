import AppKit

/**
 * Toolbar icons: the same Lucide icons the Electron toolbar uses (lucide-react, ISC licence), drawn
 * from their SVG paths on a 24×24 grid with a 2 px round stroke, so both apps look alike.
 */
enum Icons {
  /** SVG path data per icon id (feature ids, plus a few extras). */
  static let paths: [String: [String]] = [
    "pen": [
      "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      "m15 5 4 4"
    ],
    // Snapkit's own arrow icon (Toolbars.tsx ArrowIcon): a long diagonal with an open head.
    "arrow": ["M5 19 L19 5", "M11 5 H19 V13"],
    "arrow-both": ["M5 19 L19 5", "M11 5 H19 V13", "M13 19 H5 V11"],
    "rect": ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"],
    "text": ["M4 7 4 4 20 4 20 7", "M9 20h6", "M12 4v16"],
    "undo": ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"],
    "redo": ["m15 14 5-5-5-5", "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"],
    "save": [
      "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",
      "M7 3v4a1 1 0 0 0 1 1h7"
    ],
    "copy": ["M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],
    "close": ["M18 6 6 18", "m6 6 12 12"]
  ]

  private static var cache: [String: CGPath] = [:]

  static func path(_ id: String) -> CGPath? {
    if let p = cache[id] { return p }
    guard let list = paths[id] else { return nil }
    let p = CGMutablePath()
    for d in list { SVGPath.append(d, to: p) }
    cache[id] = p
    return p
  }

  /** Draw icon `id` centred in `rect` (a flipped context) at `size` points, Lucide style. */
  static func draw(_ id: String, in rect: CGRect, size: CGFloat, color: NSColor, ctx: CGContext) {
    guard let p = path(id) else { return }
    ctx.saveGState()
    ctx.translateBy(x: rect.midX - size / 2, y: rect.midY - size / 2)
    ctx.scaleBy(x: size / 24, y: size / 24)
    ctx.addPath(p)
    ctx.setStrokeColor(color.cgColor)
    ctx.setLineWidth(2)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
    ctx.restoreGState()
  }
}

/** A small SVG path-data parser: M L H V C S Q T A Z, absolute and relative. */
enum SVGPath {
  static func append(_ d: String, to path: CGMutablePath) {
    var tokens: [String] = []
    var num = ""
    func flush() {
      if !num.isEmpty { tokens.append(num); num = "" }
    }
    for ch in d {
      if ch.isLetter && ch != "e" && ch != "E" {
        flush()
        tokens.append(String(ch))
      } else if ch == "," || ch == " " || ch == "\n" {
        flush()
      } else if ch == "-" && !num.isEmpty && !num.hasSuffix("e") && !num.hasSuffix("E") {
        flush()
        num = "-"
      } else if ch == "." && num.contains(".") && !num.contains("e") {
        flush()
        num = "."
      } else {
        num.append(ch)
      }
    }
    flush()

    var i = 0
    var cmd: Character = "M"
    var cur = CGPoint.zero
    var start = CGPoint.zero
    var lastControl: CGPoint?
    func n() -> CGFloat {
      defer { i += 1 }
      return i < tokens.count ? CGFloat(Double(tokens[i]) ?? 0) : 0
    }
    func flag() -> Bool { n() != 0 }
    while i < tokens.count {
      if let c = tokens[i].first, c.isLetter {
        cmd = c
        i += 1
        if c == "Z" || c == "z" {
          path.closeSubpath()
          cur = start
          continue
        }
      }
      let rel = cmd.isLowercase
      let o = rel ? cur : .zero
      switch cmd.uppercased() {
      case "M":
        cur = CGPoint(x: o.x + n(), y: o.y + n())
        path.move(to: cur)
        start = cur
        cmd = rel ? "l" : "L" // further pairs are lines
        lastControl = nil
      case "L":
        cur = CGPoint(x: o.x + n(), y: o.y + n())
        path.addLine(to: cur)
        lastControl = nil
      case "H":
        cur = CGPoint(x: (rel ? cur.x : 0) + n(), y: cur.y)
        path.addLine(to: cur)
        lastControl = nil
      case "V":
        cur = CGPoint(x: cur.x, y: (rel ? cur.y : 0) + n())
        path.addLine(to: cur)
        lastControl = nil
      case "C":
        let c1 = CGPoint(x: o.x + n(), y: o.y + n())
        let c2 = CGPoint(x: o.x + n(), y: o.y + n())
        cur = CGPoint(x: o.x + n(), y: o.y + n())
        path.addCurve(to: cur, control1: c1, control2: c2)
        lastControl = c2
      case "S":
        let c1 = lastControl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
        let c2 = CGPoint(x: o.x + n(), y: o.y + n())
        cur = CGPoint(x: o.x + n(), y: o.y + n())
        path.addCurve(to: cur, control1: c1, control2: c2)
        lastControl = c2
      case "Q":
        let c = CGPoint(x: o.x + n(), y: o.y + n())
        cur = CGPoint(x: o.x + n(), y: o.y + n())
        path.addQuadCurve(to: cur, control: c)
        lastControl = c
      case "A":
        let rx = n(), ry = n(), rot = n(), large = flag(), sweep = flag()
        let end = CGPoint(x: o.x + n(), y: o.y + n())
        arc(path, from: cur, to: end, rx: rx, ry: ry, rotation: rot, large: large, sweep: sweep)
        cur = end
        lastControl = nil
      default:
        i += 1
      }
    }
  }

  /** SVG elliptical arc (endpoint form) as cubic curves. */
  static func arc(_ path: CGMutablePath, from p1: CGPoint, to p2: CGPoint, rx rx0: CGFloat, ry ry0: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool) {
    if p1 == p2 { return }
    var rx = abs(rx0), ry = abs(ry0)
    if rx == 0 || ry == 0 {
      path.addLine(to: p2)
      return
    }
    let phi = rotation * .pi / 180
    let cosP = cos(phi), sinP = sin(phi)
    let dx = (p1.x - p2.x) / 2, dy = (p1.y - p2.y) / 2
    let x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if lambda > 1 {
      rx *= sqrt(lambda)
      ry *= sqrt(lambda)
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
    var coef = sqrt(max(0, num / den))
    if large == sweep { coef = -coef }
    let cxp = coef * rx * y1 / ry, cyp = -coef * ry * x1 / rx
    let cx = cosP * cxp - sinP * cyp + (p1.x + p2.x) / 2
    let cy = sinP * cxp + cosP * cyp + (p1.y + p2.y) / 2
    func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
      let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
      return a
    }
    let t1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
    var dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
    if !sweep && dt > 0 { dt -= 2 * .pi } else if sweep && dt < 0 { dt += 2 * .pi }
    let segments = max(1, Int(ceil(abs(dt) / (.pi / 2))))
    let step = dt / CGFloat(segments)
    let k = 4 / 3 * tan(step / 4)
    func point(_ t: CGFloat) -> CGPoint {
      CGPoint(x: cx + rx * cos(t) * cosP - ry * sin(t) * sinP, y: cy + rx * cos(t) * sinP + ry * sin(t) * cosP)
    }
    func deriv(_ t: CGFloat) -> CGPoint {
      CGPoint(x: -rx * sin(t) * cosP - ry * cos(t) * sinP, y: -rx * sin(t) * sinP + ry * cos(t) * cosP)
    }
    var t = t1
    for _ in 0..<segments {
      let a = point(t), b = point(t + step), da = deriv(t), db = deriv(t + step)
      path.addCurve(to: b, control1: CGPoint(x: a.x + k * da.x, y: a.y + k * da.y), control2: CGPoint(x: b.x - k * db.x, y: b.y - k * db.y))
      t += step
    }
  }
}
