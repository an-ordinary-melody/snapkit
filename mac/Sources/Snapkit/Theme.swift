import AppKit
import CoreImage
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
 * light / dark / gray, Liquid Glass on or off, and the accent. With Liquid Glass, panels show what's
 * under them blurred (Theme.drawPanel), under a translucent gradient and a bright rim (--ui-bg, --ui-rim).
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
  /** appearance.accent when set. */
  var accentOverride: String?
  /** Liquid Glass: --ui-bg and --ui-bg-strong (top, bottom) and the rim (--ui-rim). */
  var glass = false
  var gray = false
  var glassTop: NSColor = .clear
  var glassBottom: NSColor = .clear
  var glassStrongTop: NSColor = .clear
  var glassStrongBottom: NSColor = .clear
  /** inset 0 1px 0 (top highlight), inset 0 -1px 0 (bottom), inset 0 0 0 .5px, inset 0 0 14px (glow), 0 0 0 .5px outside. */
  var rimTop: NSColor = .clear
  var rimBottom: NSColor = .clear
  var rimHairline: NSColor = .clear
  var rimGlow: NSColor = .clear
  var rimOutside: NSColor = .clear
  /** Background editor: card, backdrop, checkerboard, dimmer text. */
  var editorCard: NSColor = .black
  var editorBackdrop: NSColor = .black
  var checkA: NSColor = .black
  var checkB: NSColor = .black
  var foregroundDim: NSColor = .gray
  var foregroundFaint: NSColor = .gray

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
      t.editorCard = a.glass ? .rgba(30, 30, 34, 0.82) : NSColor(hex: gray ? "#3a3a3e" : "#1e1e21")
      t.editorBackdrop = .rgba(0, 0, 0, 0.55)
      t.checkA = NSColor(hex: "#26262a")
      t.checkB = NSColor(hex: "#2c2c31")
      // On dark glass, colour shows through: white at partial strength reads clearly where flat grays look washed out.
      t.foregroundDim = a.glass ? .rgba(255, 255, 255, 0.78) : NSColor(hex: "#a1a1aa")
      t.foregroundFaint = a.glass ? .rgba(255, 255, 255, 0.62) : NSColor(hex: "#8b8b93")
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
      t.editorCard = a.glass ? .rgba(246, 246, 248, 0.78) : NSColor(hex: "#f6f6f8")
      t.editorBackdrop = .rgba(0, 0, 0, 0.35)
      t.checkA = NSColor(hex: "#f1f1f3")
      t.checkB = NSColor(hex: "#e7e7ea")
      t.foregroundDim = NSColor(hex: "#5d5d66")
      t.foregroundFaint = NSColor(hex: "#8a8a93")
    }
    t.gray = gray
    if a.glass {
      // Electron uses 16; 12 sits closer to the solid panels' 10, and with the 4 pt padding the
      // buttons' 8 runs parallel to it.
      t.radius = 12
      t.buttonRadius = 8
      t.glass = true
      if gray {
        (t.glassTop, t.glassBottom) = (.rgba(84, 84, 90, 0.6), .rgba(60, 60, 66, 0.5))
        (t.glassStrongTop, t.glassStrongBottom) = (.rgba(74, 74, 80, 0.9), .rgba(58, 58, 64, 0.86))
      } else if dark {
        (t.glassTop, t.glassBottom) = (.rgba(58, 58, 64, 0.55), .rgba(28, 28, 32, 0.45))
        (t.glassStrongTop, t.glassStrongBottom) = (.rgba(48, 48, 54, 0.86), .rgba(30, 30, 34, 0.8))
      } else {
        (t.glassTop, t.glassBottom) = (.rgba(255, 255, 255, 0.52), .rgba(255, 255, 255, 0.3))
        (t.glassStrongTop, t.glassStrongBottom) = (.rgba(252, 252, 254, 0.8), .rgba(244, 244, 248, 0.66))
      }
      if dark {
        (t.rimTop, t.rimBottom, t.rimHairline, t.rimGlow, t.rimOutside) =
          (.rgba(255, 255, 255, 0.28), .rgba(255, 255, 255, 0.08), .rgba(255, 255, 255, 0.16), .rgba(255, 255, 255, 0.05), .rgba(0, 0, 0, 0.4))
        t.shadow = .rgba(0, 0, 0, 0.4)
      } else {
        (t.rimTop, t.rimBottom, t.rimHairline, t.rimGlow, t.rimOutside) =
          (.rgba(255, 255, 255, 0.95), .rgba(255, 255, 255, 0.4), .rgba(255, 255, 255, 0.7), .rgba(255, 255, 255, 0.28), .rgba(0, 0, 0, 0.14))
      }
    }
    if let accent = HexColor.parse(a.accent) {
      t.accentOverride = accent
      t.activeBackground = NSColor(hex: accent)
      t.activeForeground = NSColor(hex: HexColor.readableOn(accent))
    }
    return t
  }
}

// MARK: - Panels (Liquid Glass or solid)

extension Theme {
  /**
   * A panel's background in `rect` (the view's own coordinates): with Liquid Glass, `backdrop` (what's
   * under the panel, already blurred; nil when there's nothing to blur, e.g. over the editor) under
   * the gradient and the rim; otherwise the solid colour and its 1 px rim. `strong`: --ui-bg-strong.
   */
  func drawPanel(_ rect: CGRect, radius: CGFloat, strong: Bool = false, backdrop: CGImage? = nil, flipped: Bool = true, in ctx: CGContext) {
    let shape = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    guard glass else {
      (strong ? strongBackground : background).setFill()
      shape.fill()
      let r = NSBezierPath(roundedRect: rect.insetBy(dx: rimWidth / 2, dy: rimWidth / 2), xRadius: radius, yRadius: radius)
      r.lineWidth = rimWidth
      rim.setStroke()
      r.stroke()
      return
    }
    ctx.saveGState()
    shape.addClip()
    if let backdrop {
      // Images draw bottom-up; in a flipped view, flip them back.
      ctx.saveGState()
      if flipped {
        ctx.translateBy(x: 0, y: rect.maxY + rect.minY)
        ctx.scaleBy(x: 1, y: -1)
      }
      ctx.interpolationQuality = .high
      ctx.draw(backdrop, in: rect)
      ctx.restoreGState()
    }
    let top = strong ? glassStrongTop : glassTop, bottom = strong ? glassStrongBottom : glassBottom
    // Angle 90 starts at the lowest y: the top in a flipped view.
    NSGradient(starting: top, ending: bottom)?.draw(in: shape, angle: flipped ? 90 : -90)
    // Inner glow: a soft light from the edges inward.
    ctx.saveGState()
    let ring = CGMutablePath()
    ring.addRect(rect.insetBy(dx: -40, dy: -40))
    ring.addPath(shape.cgPath)
    ctx.setShadow(offset: .zero, blur: 7, color: rimGlow.cgColor) // inset 0 0 14px (Core Graphics blurs twice as wide)
    ctx.addPath(ring)
    ctx.setFillColor(NSColor.black.cgColor)
    ctx.fillPath(using: .evenOdd)
    ctx.restoreGState()
    // Hairline inside, then the top highlight and the softer bottom edge.
    let hair = NSBezierPath(roundedRect: rect.insetBy(dx: 0.25, dy: 0.25), xRadius: radius, yRadius: radius)
    hair.lineWidth = 0.5
    rimHairline.setStroke()
    hair.stroke()
    let topY = flipped ? rect.minY : rect.maxY - 1, bottomY = flipped ? rect.maxY - 1 : rect.minY
    rimTop.setFill()
    NSBezierPath(rect: CGRect(x: rect.minX, y: topY, width: rect.width, height: 1)).fill()
    rimBottom.setFill()
    NSBezierPath(rect: CGRect(x: rect.minX, y: bottomY, width: rect.width, height: 1)).fill()
    ctx.restoreGState()
    // The hairline outside.
    let out = NSBezierPath(roundedRect: rect.insetBy(dx: -0.25, dy: -0.25), xRadius: radius + 0.25, yRadius: radius + 0.25)
    out.lineWidth = 0.5
    rimOutside.setStroke()
    out.stroke()
  }
}

/** What lies under a panel for Liquid Glass, blurred like --ui-blur; given the panel view. */
typealias GlassBackdrop = (NSView) -> CGImage?

extension NSBezierPath {
  /** A rectangle with its own radius per corner: top-left, top-right, bottom-right, bottom-left (flipped view coordinates). */
  static func rounded(_ r: CGRect, corners c: [CGFloat]) -> NSBezierPath {
    let m = min(r.width, r.height) / 2
    let (tl, tr, br, bl) = (min(c[0], m), min(c[1], m), min(c[2], m), min(c[3], m))
    let p = NSBezierPath()
    p.move(to: CGPoint(x: r.minX + tl, y: r.minY))
    p.line(to: CGPoint(x: r.maxX - tr, y: r.minY))
    p.appendArc(from: CGPoint(x: r.maxX, y: r.minY), to: CGPoint(x: r.maxX, y: r.minY + tr), radius: tr)
    p.line(to: CGPoint(x: r.maxX, y: r.maxY - br))
    p.appendArc(from: CGPoint(x: r.maxX, y: r.maxY), to: CGPoint(x: r.maxX - br, y: r.maxY), radius: br)
    p.line(to: CGPoint(x: r.minX + bl, y: r.maxY))
    p.appendArc(from: CGPoint(x: r.minX, y: r.maxY), to: CGPoint(x: r.minX, y: r.maxY - bl), radius: bl)
    p.line(to: CGPoint(x: r.minX, y: r.minY + tl))
    p.appendArc(from: CGPoint(x: r.minX, y: r.minY), to: CGPoint(x: r.minX + tl, y: r.minY), radius: tl)
    p.close()
    return p
  }
}

extension Theme {
  /** --ui-shadow: 0 12px 36px with Liquid Glass, 0 6px 24px for solid panels (Core Graphics blurs about twice as wide as CSS for the same number, hence half). */
  var panelShadow: NSShadow {
    let s = NSShadow()
    s.shadowColor = shadow
    s.shadowBlurRadius = glass ? 18 : 12
    s.shadowOffset = NSSize(width: 0, height: glass ? 12 : 6)
    return s
  }
}

/** --ui-blur for native panels: what's under a panel, refracted at the rim, blurred and brightened. */
enum Glass {
  private static let ciContext = CIContext(options: [.cacheIntermediates: false])

  /**
   * `ctx` holds what's under a panel (w×h pixels, `scale` pixels per point). Bent outward near the
   * edges (#liquid-glass), blurred 10 pt, saturation ×1.9, brightness ×1.06, as one image.
   */
  static func filter(_ ctx: CGContext, _ w: Int, _ h: Int, scale k: CGFloat) -> CGImage? {
    guard let composed = refract(ctx, w, h, scale: k).makeImage() else { return nil }
    var ci = CIImage(cgImage: composed).clampedToExtent()
    ci = ci.applyingGaussianBlur(sigma: 10 * k)
    ci = ci.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.9])
    ci = ci.applyingFilter("CIColorMatrix", parameters: ["inputRVector": CIVector(x: 1.06, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 1.06, z: 0, w: 0),
                                                         "inputBVector": CIVector(x: 0, y: 0, z: 1.06, w: 0)])
    return ciContext.createCGImage(ci, from: CGRect(x: 0, y: 0, width: w, height: h))
  }

  /**
   * A panel's backdrop in a view whose content can be painted again off-screen: `paint` draws the
   * view's content under the panel in the view's (flipped) points; `rect` is the panel.
   */
  static func backdrop(_ rect: CGRect, scale k: CGFloat, paint: (CGContext) -> Void) -> CGImage? {
    let w = Int((rect.width * k).rounded()), h = Int((rect.height * k).rounded())
    guard w > 0, h > 0, let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    // Flipped points, the panel's top-left at the origin.
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: k, y: -k)
    ctx.translateBy(x: -rect.minX, y: -rect.minY)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
    paint(ctx)
    NSGraphicsContext.restoreGraphicsState()
    ctx.resetClip()
    return filter(ctx, w, h, scale: k)
  }

  /**
   * #liquid-glass in index.html: feDisplacementMap, scale 22 px, with a map that is neutral in the
   * middle and ramps over the outer 14% (left/right) and 22% (top/bottom): near the rim each pixel
   * shows what's up to 11 px further out, so the edge looks bent. Pixels from beyond the panel are
   * clamped to its edge. Returns `ctx`, rewritten.
   */
  private static func refract(_ ctx: CGContext, _ w: Int, _ h: Int, scale k: CGFloat) -> CGContext {
    guard let data = ctx.data else { return ctx }
    let px = data.bindMemory(to: UInt32.self, capacity: w * h)
    let src = Array(UnsafeBufferPointer(start: px, count: w * h))
    let reach = 11 * k
    func shift(_ u: CGFloat, _ edge: CGFloat) -> CGFloat {
      u < edge ? -reach * (1 - u / edge) : u > 1 - edge ? reach * ((u - (1 - edge)) / edge) : 0
    }
    let dx = (0..<w).map { Int(shift((CGFloat($0) + 0.5) / CGFloat(w), 0.14).rounded()) }
    // Rows in memory go top to bottom.
    let dy = (0..<h).map { Int(shift((CGFloat($0) + 0.5) / CGFloat(h), 0.22).rounded()) }
    for y in 0..<h {
      let sy = min(max(y + dy[y], 0), h - 1) * w
      let row = y * w
      for x in 0..<w { px[row + x] = src[sy + min(max(x + dx[x], 0), w - 1)] }
    }
    return ctx
  }
}
