import AppKit
import SnapkitCore

/** The screenshot on its background with padding, rounded corners and a shadow (render.ts). */
enum BeautifyRenderer {
  private static var images: [String: CGImage] = [:]

  /** Image backgrounds are local files; cached per path. Large files (> 40 MB) aren't read. */
  static func backgroundImage(_ path: String) -> CGImage? {
    if let i = images[path] { return i }
    let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path), (attrs[.size] as? Int ?? 0) < 40_000_000,
          let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    images[path] = img
    return img
  }

  /** Paint `bg` over a w×h area of a context with a top-left origin. */
  static func paint(_ bg: BeautifyBackground, w: CGFloat, h: CGFloat, ctx: CGContext) {
    switch bg {
    case let .solid(color):
      ctx.setFillColor(NSColor(hex: color).cgColor)
      ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    case let .gradient(from, to, angle):
      let (x0, y0, x1, y1) = BeautifyGeometry.gradientLine(w: w, h: h, angle: angle)
      let g = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [NSColor(hex: from).cgColor, NSColor(hex: to).cgColor] as CFArray, locations: [0, 1])!
      ctx.saveGState()
      ctx.clip(to: CGRect(x: 0, y: 0, width: w, height: h))
      ctx.drawLinearGradient(g, start: CGPoint(x: x0, y: y0), end: CGPoint(x: x1, y: y1), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
      ctx.restoreGState()
    case let .image(path):
      if let img = backgroundImage(path) {
        // Cover: fill the whole area, cropping the image's overflow.
        let s = max(w / CGFloat(img.width), h / CGFloat(img.height))
        let iw = CGFloat(img.width) * s, ih = CGFloat(img.height) * s
        ShapeDrawing.drawImage(img, in: CGRect(x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih), ctx: ctx)
      } else {
        ctx.setFillColor(NSColor(hex: "#e5e7eb").cgColor) // image missing
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
      }
    }
  }

  /**
   * drawBeautified(): `src` (image px) on `bg` with `state`'s padding, corners and shadow. `scale`:
   * image px per point of `src`. With no padding, only the corners are rounded (transparent outside).
   */
  static func draw(_ src: CGImage, bg: BeautifyBackground, state: BeautifyState, scale: CGFloat, frameScale: CGFloat = 1) -> CGImage? {
    let l = BeautifyGeometry.layout(w: Double(src.width), h: Double(src.height), state: state, scale: scale, frameScale: frameScale)
    let W = Int(l.width), H = Int(l.height)
    guard W > 0, H > 0, let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: src.colorSpace?.model == .rgb ? src.colorSpace! : CGColorSpace(name: CGColorSpace.sRGB)!,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return nil }
    // Top-left origin, like the canvas.
    ctx.translateBy(x: 0, y: CGFloat(H))
    ctx.scaleBy(x: 1, y: -1)
    ctx.interpolationQuality = .high
    if l.x > 0 || l.y > 0 { paint(bg, w: CGFloat(W), h: CGFloat(H), ctx: ctx) }
    let rect = CGRect(x: l.x, y: l.y, width: l.drawW, height: l.drawH)
    let shape = CGPath(roundedRect: rect, cornerWidth: l.radius, cornerHeight: l.radius, transform: nil)
    if l.shadowBlur > 0 {
      ctx.saveGState()
      // Canvas shadowBlur is twice the Gaussian deviation Core Graphics' blur uses, in device pixels (y down → -y).
      ctx.setShadow(offset: CGSize(width: 0, height: -l.shadowOffsetY), blur: l.shadowBlur, color: NSColor.black.withAlphaComponent(l.shadowAlpha).cgColor)
      ctx.addPath(shape)
      ctx.setFillColor(NSColor.black.cgColor)
      ctx.fillPath()
      ctx.restoreGState()
    }
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    ShapeDrawing.drawImage(src, in: rect, ctx: ctx)
    ctx.restoreGState()
    return ctx.makeImage()
  }
}
