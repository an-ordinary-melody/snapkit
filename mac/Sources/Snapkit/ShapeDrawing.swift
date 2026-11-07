import AppKit
import SnapkitCore

/**
 * Draws annotation shapes into a context whose user space is overlay points with a top-left origin
 * (a flipped view, or an export context set up that way). The same code draws capture mode and the
 * output, so what you copy is what you saw.
 */
enum ShapeDrawing {
  /** `pixelScale`: device pixels per point; shadows are set in device space and need it. */
  static func draw(_ shapes: [Shape], in ctx: CGContext, pixelScale: CGFloat) {
    for s in shapes { draw(s, in: ctx, pixelScale: pixelScale) }
  }

  static func draw(_ shape: Shape, in ctx: CGContext, pixelScale: CGFloat) {
    ctx.saveGState()
    defer { ctx.restoreGState() }
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    switch shape {
    case let .stroke(s):
      ctx.setStrokeColor(NSColor(hex: s.color).cgColor)
      ctx.setLineWidth(s.width)
      ctx.addPath(smoothPath(s.points, tension: s.type == "pen" ? 0.4 : 0))
      ctx.strokePath()
    case let .line(s):
      drawLine(s, in: ctx)
    case let .box(s):
      let r = CGRect(x: s.x, y: s.y, width: s.w, height: s.h)
      if s.filled == true {
        ctx.setFillColor(NSColor(hex: s.color).cgColor)
        s.type == "ellipse" ? ctx.fillEllipse(in: r) : ctx.fill(r)
      } else {
        ctx.setStrokeColor(NSColor(hex: s.color).cgColor)
        ctx.setLineWidth(s.width)
        ctx.setLineJoin(.miter)
        s.type == "ellipse" ? ctx.strokeEllipse(in: r) : ctx.stroke(r)
      }
    case let .text(t):
      drawText(t, in: ctx, pixelScale: pixelScale)
    case .blur, .step:
      break // Phase 2
    }
  }

  private static func drawLine(_ s: Shape.Line, in ctx: CGContext) {
    let p = s.points
    guard p.count == 4 else { return }
    let color = NSColor(hex: s.color).cgColor
    ctx.setStrokeColor(color)
    ctx.setFillColor(color)
    ctx.setLineWidth(s.width)
    let a = CGPoint(x: p[0], y: p[1])
    let b = CGPoint(x: p[2], y: p[3])
    guard s.type == "arrow" else {
      ctx.move(to: a)
      ctx.addLine(to: b)
      ctx.strokePath()
      return
    }
    let head = Annotations.arrowHead(width: s.width)
    if s.head == "open" {
      ctx.move(to: a)
      ctx.addLine(to: b)
      let h = Annotations.openArrowHead(p, length: head * 1.1)
      ctx.move(to: CGPoint(x: h[0], y: h[1]))
      ctx.addLine(to: CGPoint(x: h[2], y: h[3]))
      ctx.addLine(to: CGPoint(x: h[4], y: h[5]))
      if s.bothEnds == true {
        let t = Annotations.openArrowHead([p[2], p[3], p[0], p[1]], length: head * 1.1)
        ctx.move(to: CGPoint(x: t[0], y: t[1]))
        ctx.addLine(to: CGPoint(x: t[2], y: t[3]))
        ctx.addLine(to: CGPoint(x: t[4], y: t[5]))
      }
      ctx.strokePath()
      return
    }
    // Filled head, as Konva's Arrow: a triangle `head` long and `head` wide at the tip, filled and
    // stroked; the line stops inside it so its round cap never pokes past the tip.
    let len = hypot(b.x - a.x, b.y - a.y)
    guard len > 0 else { return }
    let ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
    func triangle(at tip: CGPoint, dirX: CGFloat, dirY: CGFloat) {
      let base = CGPoint(x: tip.x - dirX * head, y: tip.y - dirY * head)
      ctx.move(to: tip)
      ctx.addLine(to: CGPoint(x: base.x - dirY * head / 2, y: base.y + dirX * head / 2))
      ctx.addLine(to: CGPoint(x: base.x + dirY * head / 2, y: base.y - dirX * head / 2))
      ctx.closePath()
      ctx.drawPath(using: .fillStroke)
    }
    let start = s.bothEnds == true ? CGPoint(x: a.x + ux * head / 2, y: a.y + uy * head / 2) : a
    ctx.move(to: start)
    ctx.addLine(to: CGPoint(x: b.x - ux * head / 2, y: b.y - uy * head / 2))
    ctx.strokePath()
    triangle(at: b, dirX: ux, dirY: uy)
    if s.bothEnds == true { triangle(at: a, dirX: -ux, dirY: -uy) }
  }

  /** A stroke through the points, smoothed like Konva's Line `tension` (cardinal spline). */
  static func smoothPath(_ pts: [Double], tension: Double) -> CGPath {
    let path = CGMutablePath()
    let n = pts.count / 2
    guard n >= 1 else { return path }
    let p = (0..<n).map { CGPoint(x: pts[$0 * 2], y: pts[$0 * 2 + 1]) }
    path.move(to: p[0])
    if n == 1 {
      path.addLine(to: p[0])
      return path
    }
    if tension == 0 || n < 3 {
      for q in p.dropFirst() { path.addLine(to: q) }
      return path
    }
    let t = CGFloat(tension)
    for i in 0..<(n - 1) {
      let p0 = p[max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[min(n - 1, i + 2)]
      let c1 = CGPoint(x: p1.x + (p2.x - p0.x) * t / 3, y: p1.y + (p2.y - p0.y) * t / 3)
      let c2 = CGPoint(x: p2.x - (p3.x - p1.x) * t / 3, y: p2.y - (p3.y - p1.y) * t / 3)
      path.addCurve(to: p2, control1: c1, control2: c2)
    }
    return path
  }

  // MARK: Text

  static func font(_ t: Shape.Text) -> NSFont { NSFont.systemFont(ofSize: t.fontSize, weight: .regular) }

  static func attributes(_ t: Shape.Text) -> [NSAttributedString.Key: Any] {
    let para = NSMutableParagraphStyle()
    para.lineHeightMultiple = 1
    return [.font: font(t), .foregroundColor: NSColor(hex: t.color), .paragraphStyle: para]
  }

  /** Size of the text block at its font, in points. */
  static func textSize(_ t: Shape.Text) -> CGSize {
    let b = NSAttributedString(string: t.text.isEmpty ? " " : t.text, attributes: attributes(t))
      .boundingRect(with: CGSize(width: 10_000, height: 10_000), options: [.usesLineFragmentOrigin, .usesFontLeading])
    return CGSize(width: ceil(b.width), height: ceil(b.height))
  }

  static func drawText(_ t: Shape.Text, in ctx: CGContext, pixelScale: CGFloat) {
    let size = textSize(t)
    let rect = CGRect(origin: CGPoint(x: t.x, y: t.y), size: size)
    let gc = NSGraphicsContext(cgContext: ctx, flipped: true)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = gc
    defer { NSGraphicsContext.restoreGraphicsState() }

    if !t.background.isEmpty {
      let pad = t.fontSize * 0.25
      NSColor(hex: t.background).setFill()
      NSBezierPath(roundedRect: rect.insetBy(dx: -pad, dy: -pad * 0.6), xRadius: t.fontSize * 0.2, yRadius: t.fontSize * 0.2).fill()
    }
    if t.shadow > 0 {
      // Device-space offset: down on screen is -y.
      ctx.setShadow(offset: CGSize(width: 0, height: -max(1, t.fontSize * 0.06) * pixelScale), blur: t.fontSize * 0.18 * pixelScale,
                    color: NSColor.black.withAlphaComponent(t.shadow).cgColor)
    }
    if let stroke = t.stroke, !stroke.isEmpty {
      // Konva draws an outline twice the stroke width, behind the fill.
      let width = (t.strokeWidth ?? 3) * 2
      var a = attributes(t)
      a[.strokeColor] = NSColor(hex: stroke)
      a[.strokeWidth] = width / t.fontSize * 100
      NSAttributedString(string: t.text, attributes: a).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
      ctx.setShadow(offset: .zero, blur: 0, color: nil)
    }
    NSAttributedString(string: t.text, attributes: attributes(t)).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
  }
}
