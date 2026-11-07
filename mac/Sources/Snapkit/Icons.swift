import AppKit

/**
 * Toolbar icons: the same Lucide icons the Electron toolbar uses (lucide-react, ISC licence), drawn
 * from their SVG paths on a 24×24 grid with a 2 px round stroke, so both apps look alike.
 */
enum Icons {
  /** One stroke (and optionally filled) path of an icon. */
  struct Part {
    var d: String
    /** Fill opacity: 0 = outline only. */
    var fill: CGFloat = 0
    var stroke = true
  }

  static func circle(_ cx: Double, _ cy: Double, _ r: Double) -> String {
    "M\(cx - r) \(cy)a\(r) \(r) 0 1 0 \(2 * r) 0a\(r) \(r) 0 1 0 \(-2 * r) 0z"
  }

  static func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ rx: Double) -> String {
    "M\(x + rx) \(y)h\(w - 2 * rx)a\(rx) \(rx) 0 0 1 \(rx) \(rx)v\(h - 2 * rx)a\(rx) \(rx) 0 0 1 \(-rx) \(rx)h\(-(w - 2 * rx))a\(rx) \(rx) 0 0 1 \(-rx) \(-rx)v\(-(h - 2 * rx))a\(rx) \(rx) 0 0 1 \(rx) \(-rx)z"
  }

  /** Icons by feature or variant id (and a few extras), as in Toolbars.tsx FeatureIcon. */
  static let parts: [String: [Part]] = {
    func p(_ ds: String...) -> [Part] { ds.map { Part(d: $0) } }
    var m: [String: [Part]] = [
      "pen": p("M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"),
      // Snapkit's own arrow icon (ArrowIcon): a long diagonal with an open head.
      "arrow": p("M5 19 L19 5", "M11 5 H19 V13"),
      "arrow-both": p("M5 19 L19 5", "M11 5 H19 V13", "M13 19 H5 V11"),
      "rect": p(rect(3, 3, 18, 18, 2)),
      "rect-filled": [Part(d: rect(3, 3, 18, 18, 2), fill: 1)],
      "ellipse": p(circle(12, 12, 10)),
      "ellipse-filled": [Part(d: circle(12, 12, 10), fill: 1)],
      "line": p("M22 2 2 22"),
      "highlighter": p("m9 11-6 6v3h9l3-3", "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"),
      "text": p("M4 7 4 4 20 4 20 7", "M9 20h6", "M12 4v16"),
      "step": p("M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3 14 21"),
      "blur": p("M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z",
                "M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"),
      "ruler": p("M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",
                 "m14.5 12.5 2-2", "m11.5 9.5 2-2", "m8.5 6.5 2-2", "m17.5 15.5 2-2"),
      "undo": p("M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"),
      "redo": p("m15 14 5-5-5-5", "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"),
      "save": p("M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
                "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", "M7 3v4a1 1 0 0 0 1 1h7"),
      "copy": p(rect(8, 8, 14, 14, 2), "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"),
      "close": p("M18 6 6 18", "m6 6 12 12"),
      "check": p("M20 6 9 17l-5-5"),
      "waves": p("M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
                 "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
                 "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"),
      "grid": p(rect(3, 3, 18, 18, 2), "M3 9h18", "M3 15h18", "M9 3v18", "M15 3v18"),
      "minus": p("M5 12h14"),
      "plus": p("M5 12h14", "M12 5v14"),
      "ocr": p("M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", circle(12, 12, 1),
               "M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"),
      "beautifyEdit": p("m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",
                        "m14 7 3 3", "M5 6v4", "M19 14v4", "M10 2v2", "M7 8H3", "M21 16h-4", "M11 3H9"),
      "pin": p("M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"),
      // Background (BackgroundIcon): two stacked layers, the lower one faintly filled.
      "beautify": [
        Part(d: "M13 19.24a2 2 0 0 1-2 0L2.5 14.37a1 1 0 0 1 0-1.74L11 7.76a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z", fill: 0.35, stroke: false),
        Part(d: "m16.02 12 5.48 3.13a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74L7.98 12"),
        Part(d: "M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z")
      ]
    ]
    m["grip"] = p(circle(9, 12, 1), circle(9, 5, 1), circle(9, 19, 1), circle(15, 12, 1), circle(15, 5, 1), circle(15, 19, 1))
    m["move"] = p("M12 2v20", "m15 19-3 3-3-3", "m19 9 3 3-3 3", "M2 12h20", "m5 9-3 3 3 3", "m9 5 3-3 3 3")
    m["edit"] = p("M12 20h9", "M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z", "m15 5 3 3")
    m["trash"] = p("M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6")
    m["folder"] = p("m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2")
    m["settings"] = p("M20 7h-9", "M14 17H5", circle(17, 17, 3), circle(7, 7, 3))
    let star = "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
    m["star"] = p(star)
    m["star-filled"] = [Part(d: star, fill: 1)]
    m["ellipse-tool"] = m["ellipse"]
    return m
  }()

  private static var cache: [String: [(CGPath, Part)]] = [:]

  private static func paths(_ id: String) -> [(CGPath, Part)] {
    if let p = cache[id] { return p }
    let list = (parts[id] ?? parts["rect"]!).map { part -> (CGPath, Part) in
      let p = CGMutablePath()
      SVGPath.append(part.d, to: p)
      return (p, part)
    }
    cache[id] = list
    return list
  }

  /** Draw icon `id` centred in `rect` (a flipped context) at `size` points, Lucide style (2 px stroke on a 24 grid). */
  static func draw(_ id: String, in rect: CGRect, size: CGFloat = 17, color: NSColor, ctx: CGContext) {
    ctx.saveGState()
    ctx.translateBy(x: rect.midX - size / 2, y: rect.midY - size / 2)
    ctx.scaleBy(x: size / 24, y: size / 24)
    ctx.setLineWidth(2)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    for (path, part) in paths(id) {
      if part.fill > 0 {
        ctx.addPath(path)
        ctx.setFillColor(color.withAlphaComponent(color.alphaComponent * part.fill).cgColor)
        ctx.fillPath()
      }
      if part.stroke {
        ctx.addPath(path)
        ctx.setStrokeColor(color.cgColor)
        ctx.strokePath()
      }
    }
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
