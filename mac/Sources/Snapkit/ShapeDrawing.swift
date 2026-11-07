import AppKit
import CoreImage
import SnapkitCore

/** What drawing needs besides the shapes (AnnotationLayer.tsx props). */
struct RenderEnv {
  /** The frozen screenshot: blur areas show it obscured. */
  var source: CGImage?
  /** Image pixels per overlay point. */
  var imageScale: CGFloat = 2
  /** Device pixels per point of the target context (shadows are set in device space). */
  var pixelScale: CGFloat = 2
  var stepStroke = Settings.Annotate.StepStroke(color: "#ffffff", width: 2)
  var stepShadow: Double = 0.3
  /** Number colour on steps; "" = black or white, whichever reads better. */
  var stepTextColor = ""
  /** A blur area being dragged shows what's under its live position. */
  var liveBlur: (id: String, rect: LRect)?

  init(settings: Settings, source: CGImage?, imageScale: CGFloat, pixelScale: CGFloat) {
    self.source = source
    self.imageScale = imageScale
    self.pixelScale = pixelScale
    stepStroke = settings.annotate.stepStroke
    stepShadow = settings.annotate.stepShadow
    stepTextColor = settings.annotate.stepTextColor
  }
}

/**
 * Draws annotation shapes into a context whose user space is overlay points with a top-left origin
 * (a flipped view, or an export context set up that way), the way AnnotationLayer.tsx draws them with
 * Konva. The same code draws capture mode and the output, so what you copy is what you saw.
 */
enum ShapeDrawing {
  static let textPad: Double = 6
  static let lineHeight: Double = 1.2
  static let textGrab: Double = 8

  static func draw(_ shapes: [Shape], in ctx: CGContext, env: RenderEnv) {
    let steps = Annotations.stepNumbers(shapes)
    for s in shapes { draw(s, in: ctx, env: env, stepNumber: steps[s.id] ?? 0) }
  }

  static func draw(_ shape: Shape, in ctx: CGContext, env: RenderEnv, stepNumber: Int = 1) {
    ctx.saveGState()
    defer { ctx.restoreGState() }
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    switch shape {
    case let .stroke(s):
      if s.type == "highlighter" { ctx.setAlpha(0.45) }
      ctx.setStrokeColor(NSColor(hex: s.color).cgColor)
      ctx.setLineWidth(s.width)
      ctx.addPath(smoothPath(s.points, tension: s.type == "pen" ? 0.4 : 0))
      // A transparency layer so overlapping parts of one highlighter stroke don't darken.
      if s.type == "highlighter" {
        ctx.beginTransparencyLayer(auxiliaryInfo: nil)
        ctx.setAlpha(1)
        ctx.strokePath()
        ctx.endTransparencyLayer()
      } else {
        ctx.strokePath()
      }
    case let .line(s):
      switch s.type {
      case "arrow": drawArrow(s, in: ctx)
      case "ruler": drawRuler(s, in: ctx, env: env)
      default:
        ctx.setStrokeColor(NSColor(hex: s.color).cgColor)
        ctx.setLineWidth(s.width)
        ctx.move(to: CGPoint(x: s.points[0], y: s.points[1]))
        ctx.addLine(to: CGPoint(x: s.points[2], y: s.points[3]))
        ctx.strokePath()
      }
    case let .box(s):
      let r = CGRect(x: s.x, y: s.y, width: s.w, height: s.h)
      let filled = s.filled == true
      let path: CGPath
      if s.type == "ellipse" {
        path = CGPath(ellipseIn: r, transform: nil)
      } else {
        let radius = min(filled ? 4 : 2, min(r.width, r.height) / 2)
        path = CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil)
      }
      ctx.addPath(path)
      if filled {
        ctx.setFillColor(NSColor(hex: s.color).cgColor)
        ctx.fillPath()
      } else {
        ctx.setStrokeColor(NSColor(hex: s.color).cgColor)
        ctx.setLineWidth(s.width)
        ctx.setLineJoin(.miter)
        ctx.strokePath()
      }
    case let .blur(b):
      let live = env.liveBlur?.id == b.id ? env.liveBlur!.rect : LRect(x: b.x, y: b.y, w: b.w, h: b.h)
      let r = CGRect(x: b.x, y: b.y, width: b.w, height: b.h)
      if let src = env.source, let img = BlurRenderer.obscure(src, rect: live, scale: env.imageScale, mode: b.mode, strength: b.strength) {
        drawImage(img, in: r, ctx: ctx)
      } else {
        ctx.setFillColor(NSColor(white: 0.5, alpha: 0.6).cgColor)
        ctx.fill(r)
      }
    case let .step(s):
      drawStep(s, number: stepNumber, in: ctx, env: env)
    case let .text(t):
      drawText(t, in: ctx, env: env)
    }
  }

  /** Draw an image upright in a flipped context. */
  static func drawImage(_ img: CGImage, in r: CGRect, ctx: CGContext) {
    ctx.saveGState()
    ctx.translateBy(x: r.minX, y: r.maxY)
    ctx.scaleBy(x: 1, y: -1)
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(origin: .zero, size: r.size))
    ctx.restoreGState()
  }

  // MARK: Lines

  private static func drawArrow(_ s: Shape.Line, in ctx: CGContext) {
    let p = s.points
    let color = NSColor(hex: s.color).cgColor
    ctx.setStrokeColor(color)
    ctx.setFillColor(color)
    ctx.setLineWidth(s.width)
    let a = CGPoint(x: p[0], y: p[1]), b = CGPoint(x: p[2], y: p[3])
    let head = Annotations.arrowHead(width: s.width)
    if s.head == "open" {
      ctx.move(to: a)
      ctx.addLine(to: b)
      ctx.strokePath()
      for h in [Annotations.openArrowHead(p, length: head * 1.1)] + (s.bothEnds == true ? [Annotations.openArrowHead([p[2], p[3], p[0], p[1]], length: head * 1.1)] : []) {
        ctx.move(to: CGPoint(x: h[0], y: h[1]))
        ctx.addLine(to: CGPoint(x: h[2], y: h[3]))
        ctx.addLine(to: CGPoint(x: h[4], y: h[5]))
        ctx.strokePath()
      }
      return
    }
    // Filled head (older captures), as Konva's Arrow: a `head`×`head` triangle at the tip, filled and stroked.
    let len = hypot(b.x - a.x, b.y - a.y)
    guard len > 0 else { return }
    let ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
    func triangle(at tip: CGPoint, _ dx: CGFloat, _ dy: CGFloat) {
      let base = CGPoint(x: tip.x - dx * head, y: tip.y - dy * head)
      ctx.move(to: tip)
      ctx.addLine(to: CGPoint(x: base.x - dy * head / 2, y: base.y + dx * head / 2))
      ctx.addLine(to: CGPoint(x: base.x + dy * head / 2, y: base.y - dx * head / 2))
      ctx.closePath()
      ctx.drawPath(using: .fillStroke)
    }
    let start = s.bothEnds == true ? CGPoint(x: a.x + ux * head / 2, y: a.y + uy * head / 2) : a
    ctx.move(to: start)
    ctx.addLine(to: CGPoint(x: b.x - ux * head / 2, y: b.y - uy * head / 2))
    ctx.strokePath()
    triangle(at: b, ux, uy)
    if s.bothEnds == true { triangle(at: a, -ux, -uy) }
  }

  /** Ruler: the line, a tick across each end, and its length in image pixels on a pill in the middle. */
  private static func drawRuler(_ s: Shape.Line, in ctx: CGContext, env: RenderEnv) {
    let p = s.points
    ctx.setStrokeColor(NSColor(hex: s.color).cgColor)
    ctx.setLineWidth(s.width)
    let (t1, t2) = Annotations.rulerTicks(p, length: s.width * 2 + 10)
    for seg in [p, t1, t2] {
      ctx.move(to: CGPoint(x: seg[0], y: seg[1]))
      ctx.addLine(to: CGPoint(x: seg[2], y: seg[3]))
    }
    ctx.strokePath()
    let pill = rulerPill(s, scale: env.imageScale)
    ctx.addPath(CGPath(roundedRect: pill.rect, cornerWidth: pill.rect.height / 2, cornerHeight: pill.rect.height / 2, transform: nil))
    ctx.setFillColor(NSColor(hex: s.color).cgColor)
    ctx.fillPath()
    drawCentered(pill.label, font: NSFont.systemFont(ofSize: pill.fontSize, weight: .semibold), color: NSColor(hex: HexColor.readableOn(s.color)), in: pill.rect, ctx: ctx)
  }

  static func rulerPill(_ s: Shape.Line, scale: CGFloat) -> (rect: CGRect, label: String, fontSize: CGFloat) {
    let p = s.points
    let label = Annotations.rulerLabel(p, scale: scale)
    let fontSize = CGFloat(jsRound(11 + s.width * 0.8))
    let w = CGFloat(label.count) * fontSize * 0.6 + fontSize
    let h = fontSize + 8
    let c = CGPoint(x: (p[0] + p[2]) / 2, y: (p[1] + p[3]) / 2)
    return (CGRect(x: c.x - w / 2, y: c.y - h / 2, width: w, height: h), label, fontSize)
  }

  // MARK: Steps

  private static func drawStep(_ s: Shape.Step, number: Int, in ctx: CGContext, env: RenderEnv) {
    let r = CGRect(x: s.x - s.size / 2, y: s.y - s.size / 2, width: s.size, height: s.size)
    ctx.saveGState()
    if env.stepShadow > 0 {
      ctx.setShadow(offset: CGSize(width: 0, height: -env.stepShadow * 2 * env.pixelScale), blur: (4 + env.stepShadow * 6) * env.pixelScale,
                    color: NSColor.black.withAlphaComponent(env.stepShadow).cgColor)
    }
    ctx.setFillColor(NSColor(hex: s.color).cgColor)
    ctx.fillEllipse(in: r)
    ctx.restoreGState()
    if env.stepStroke.width > 0 {
      ctx.setStrokeColor(NSColor(hex: env.stepStroke.color).cgColor)
      ctx.setLineWidth(env.stepStroke.width)
      ctx.strokeEllipse(in: r)
    }
    let color = env.stepTextColor.isEmpty ? HexColor.readableOn(s.color) : env.stepTextColor
    drawCentered(String(number), font: NSFont.systemFont(ofSize: s.size * 0.5, weight: .bold), color: NSColor(hex: color), in: r, ctx: ctx)
  }

  /** One line of text centred in `rect` (flipped context). */
  static func drawCentered(_ text: String, font: NSFont, color: NSColor, in rect: CGRect, ctx: CGContext) {
    let str = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
    let line = CTLineCreateWithAttributedString(str)
    let width = CTLineGetTypographicBounds(line, nil, nil, nil)
    let baseline = rect.midY + (font.ascender + font.descender) / 2
    ctx.saveGState()
    ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    ctx.textPosition = CGPoint(x: rect.midX - width / 2, y: baseline)
    CTLineDraw(line, ctx)
    ctx.restoreGState()
  }

  // MARK: Pen

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

  // MARK: Text (Konva Label + Text: line height 1.2, padding 6 with a background)

  static func font(size: Double, family: String) -> NSFont {
    // The first named family that exists; the CSS system names mean the system font.
    for raw in family.split(separator: ",") {
      let name = raw.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
      if ["-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif", "ui-sans-serif"].contains(name) { break }
      if let f = NSFont(name: name, size: size) ?? NSFontManager.shared.font(withFamily: name, traits: [], weight: 5, size: size) { return f }
    }
    return NSFont.systemFont(ofSize: size)
  }

  static func pad(_ t: Shape.Text) -> Double { t.background.isEmpty ? 0 : textPad }

  private static func lines(_ t: Shape.Text) -> [String] {
    (t.text.isEmpty ? " " : t.text).components(separatedBy: "\n")
  }

  /** The text box (background included), as Konva measures it. */
  static func textBox(_ t: Shape.Text) -> CGRect {
    let f = font(size: t.fontSize, family: t.fontFamily)
    let width = lines(t).map { lineWidth($0, f) }.max() ?? 0
    let p = pad(t)
    return CGRect(x: t.x, y: t.y, width: width + p * 2, height: Double(lines(t).count) * t.fontSize * lineHeight + p * 2)
  }

  static func lineWidth(_ s: String, _ f: NSFont) -> CGFloat {
    CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: [.font: f])), nil, nil, nil))
  }

  static func drawText(_ t: Shape.Text, in ctx: CGContext, env: RenderEnv) {
    let box = textBox(t)
    let f = font(size: t.fontSize, family: t.fontFamily)
    if !t.background.isEmpty {
      ctx.addPath(CGPath(roundedRect: box, cornerWidth: 6, cornerHeight: 6, transform: nil))
      ctx.setFillColor(NSColor(hex: t.background).cgColor)
      ctx.fillPath()
    }
    ctx.saveGState()
    if t.shadow > 0 {
      ctx.setShadow(offset: CGSize(width: 0, height: -max(1, t.fontSize * 0.06) * env.pixelScale), blur: t.fontSize * 0.18 * env.pixelScale,
                    color: NSColor.black.withAlphaComponent(t.shadow).cgColor)
    }
    ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    let p = pad(t)
    let lh = t.fontSize * lineHeight
    // Konva centres each line in its line box (textBaseline "middle").
    let baselineOffset = lh / 2 + (f.ascender + f.descender) / 2
    let stroke = (t.stroke ?? "").isEmpty ? nil : t.stroke
    // A transparency layer, so the shadow falls under outline and fill together.
    ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    for (i, text) in lines(t).enumerated() {
      let origin = CGPoint(x: t.x + p, y: t.y + p + Double(i) * lh + baselineOffset)
      if let stroke {
        // Outline outside the letters: stroke twice as wide, then fill over it.
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: f, .foregroundColor: NSColor(hex: stroke)]))
        ctx.saveGState()
        ctx.setTextDrawingMode(.stroke)
        ctx.setStrokeColor(NSColor(hex: stroke).cgColor)
        ctx.setLineWidth((t.strokeWidth ?? 3) * 2)
        ctx.setLineJoin(.round)
        ctx.textPosition = origin
        CTLineDraw(line, ctx)
        ctx.restoreGState()
      }
      let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: f, .foregroundColor: NSColor(hex: t.color)]))
      ctx.setTextDrawingMode(.fill)
      ctx.textPosition = origin
      CTLineDraw(line, ctx)
    }
    ctx.endTransparencyLayer()
    ctx.restoreGState()
  }

  // MARK: Geometry: bounds and hit testing

  /** The shape's box as Konva's getClientRect sees it (stroke included), for snapping and the selection frame. */
  static func bounds(_ s: Shape, scale: CGFloat = 2) -> CGRect {
    switch s {
    case let .stroke(v):
      return pointsBox(v.points).insetBy(dx: -v.width / 2, dy: -v.width / 2)
    case let .line(v):
      var r = pointsBox(v.points).insetBy(dx: -v.width / 2, dy: -v.width / 2)
      if v.type == "arrow" { r = r.insetBy(dx: -Annotations.arrowHead(width: v.width) / 2, dy: -Annotations.arrowHead(width: v.width) / 2) }
      if v.type == "ruler" { r = r.union(rulerPill(v, scale: scale).rect).insetBy(dx: -(v.width + 5), dy: -(v.width + 5)) }
      return r
    case let .box(v):
      let r = CGRect(x: v.x, y: v.y, width: v.w, height: v.h)
      return v.filled == true ? r : r.insetBy(dx: -v.width / 2, dy: -v.width / 2)
    case let .blur(v): return CGRect(x: v.x, y: v.y, width: v.w, height: v.h)
    case let .step(v):
      return CGRect(x: v.x - v.size / 2, y: v.y - v.size / 2, width: v.size, height: v.size)
    case let .text(v): return textBox(v)
    }
  }

  static func pointsBox(_ p: [Double]) -> CGRect {
    guard p.count >= 2 else { return .zero }
    var minX = p[0], maxX = p[0], minY = p[1], maxY = p[1]
    for i in stride(from: 0, to: p.count - 1, by: 2) {
      minX = min(minX, p[i]); maxX = max(maxX, p[i])
      minY = min(minY, p[i + 1]); maxY = max(maxY, p[i + 1])
    }
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  /** Does a click at `p` grab this shape? (Konva hit areas: strokes at least 12 pt wide, text with a margin.) */
  static func hits(_ s: Shape, _ p: CGPoint, scale: CGFloat = 2) -> Bool {
    func nearSegments(_ pts: [Double], _ w: Double) -> Bool {
      let tol = max(12, w) / 2
      if pts.count == 2 { return hypot(p.x - pts[0], p.y - pts[1]) <= tol }
      for i in stride(from: 0, to: pts.count - 3, by: 2) where distance(p, CGPoint(x: pts[i], y: pts[i + 1]), CGPoint(x: pts[i + 2], y: pts[i + 3])) <= tol { return true }
      return false
    }
    switch s {
    case let .stroke(v): return nearSegments(v.points, v.width)
    case let .line(v):
      if nearSegments(v.points, v.width) { return true }
      if v.type == "arrow" {
        let h = Annotations.openArrowHead(v.points, length: Annotations.arrowHead(width: v.width) * 1.1)
        if nearSegments([h[0], h[1], h[2], h[3], h[4], h[5]], v.width) { return true }
      }
      if v.type == "ruler" { return rulerPill(v, scale: scale).rect.contains(p) }
      return false
    case let .box(v):
      let r = CGRect(x: v.x, y: v.y, width: v.w, height: v.h)
      if v.filled == true { return v.type == "ellipse" ? CGPath(ellipseIn: r, transform: nil).contains(p) : r.contains(p) }
      let tol = max(12, v.width) / 2
      if v.type == "ellipse" {
        let outer = CGPath(ellipseIn: r.insetBy(dx: -tol, dy: -tol), transform: nil)
        let inner = r.width > tol * 2 && r.height > tol * 2 ? CGPath(ellipseIn: r.insetBy(dx: tol, dy: tol), transform: nil) : nil
        return outer.contains(p) && !(inner?.contains(p) ?? false)
      }
      return r.insetBy(dx: -tol, dy: -tol).contains(p) && !r.insetBy(dx: tol, dy: tol).contains(p)
    case let .blur(v): return CGRect(x: v.x, y: v.y, width: v.w, height: v.h).contains(p)
    case let .step(v): return hypot(p.x - v.x, p.y - v.y) <= v.size / 2
    case let .text(v): return textBox(v).insetBy(dx: -textGrab, dy: -textGrab).contains(p)
    }
  }

  static func distance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
    let dx = b.x - a.x, dy = b.y - a.y
    let len2 = dx * dx + dy * dy
    let t = len2 == 0 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }
}

/**
 * Pixelated or blurred copy of part of the frozen screenshot (obscure.ts), at full image resolution.
 * `strength` is the block size / blur radius in points (0: the area as it is).
 */
enum BlurRenderer {
  private static let context = CIContext(options: [.cacheIntermediates: false])
  private static var cache: [String: CGImage] = [:]
  private static var cacheSource: ObjectIdentifier?

  static func obscure(_ src: CGImage, rect r: LRect, scale: CGFloat, mode: String, strength: Double) -> CGImage? {
    let key = "\(r.x),\(r.y),\(r.w),\(r.h),\(scale),\(mode),\(strength)"
    if cacheSource != ObjectIdentifier(src) {
      cache = [:]
      cacheSource = ObjectIdentifier(src)
    }
    if let c = cache[key] { return c }
    let sx = jsRound(r.x * scale), sy = jsRound(r.y * scale)
    let sw = max(1, jsRound(r.w * scale)), sh = max(1, jsRound(r.h * scale))
    let amount = jsRound(strength * scale)
    // Core Image has a bottom-left origin.
    let ci = CIImage(cgImage: src)
    let H = CGFloat(src.height)
    let area = CGRect(x: sx, y: H - sy - sh, width: sw, height: sh)
    var out: CIImage
    if amount <= 0 {
      out = ci.cropped(to: area)
    } else if mode == "pixelate" {
      // Average each block (shrink with area sampling), then scale back up without smoothing.
      let block = max(2, amount)
      let tw = max(1, ceil(sw / block)), th = max(1, ceil(sh / block))
      let shrunk = ci.cropped(to: area).transformed(by: CGAffineTransform(translationX: -area.minX, y: -area.minY))
        .applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: th / sh, kCIInputAspectRatioKey: (tw / sw) / (th / sh)])
      guard let small = context.createCGImage(shrunk, from: CGRect(x: 0, y: 0, width: tw, height: th)) else { return nil }
      let grid = CIImage(cgImage: small).samplingNearest()
        .transformed(by: CGAffineTransform(scaleX: block, y: block))
      // The block grid starts at the area's top-left (CI origin is bottom-left).
      out = grid.transformed(by: CGAffineTransform(translationX: 0, y: sh - th * block)).cropped(to: CGRect(x: 0, y: 0, width: sw, height: sh))
      guard let cg = context.createCGImage(out, from: CGRect(x: 0, y: 0, width: sw, height: sh)) else { return nil }
      cache[key] = cg
      return cg
    } else {
      // A margin around the area so the blur doesn't fade to transparent at its edges.
      let radius = max(1, jsRound(strength * 0.8 * scale))
      out = ci.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: radius]).cropped(to: area)
    }
    guard let cg = context.createCGImage(out, from: area) else { return nil }
    if cache.count > 64 { cache = [:] }
    cache[key] = cg
    return cg
  }
}
