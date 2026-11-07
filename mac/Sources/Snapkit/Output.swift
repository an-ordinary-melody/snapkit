import AppKit
import ImageIO
import SnapkitCore
import UniformTypeIdentifiers

/** Turning a selection into a PNG, and copying or saving it (src/main/output.ts). */
enum Output {
  /**
   * The selection `sel` (points) of `image` with `shapes` drawn on top, at `scale` image px per point.
   */
  static func render(image: CGImage, sel: LRect, scale: CGFloat, shapes: [Shape], env: RenderEnv) -> CGImage? {
    let crop = CGRect(x: (sel.x * scale).rounded(), y: (sel.y * scale).rounded(), width: (sel.w * scale).rounded(), height: (sel.h * scale).rounded())
      .intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard crop.width >= 1, crop.height >= 1, let part = image.cropping(to: crop) else { return nil }
    let w = Int(crop.width), h = Int(crop.height)
    let space = image.colorSpace.flatMap { $0.model == .rgb ? $0 : nil } ?? CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                              bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(part, in: CGRect(x: 0, y: 0, width: w, height: h))
    if !shapes.isEmpty {
      // Overlay points, top-left origin: the same space capture mode draws in.
      ctx.translateBy(x: 0, y: CGFloat(h))
      ctx.scaleBy(x: scale, y: -scale)
      ctx.translateBy(x: -crop.minX / scale, y: -crop.minY / scale)
      ctx.clip(to: CGRect(x: sel.x, y: sel.y, width: sel.w, height: sel.h))
      var env = env
      env.pixelScale = scale
      ShapeDrawing.draw(shapes, in: ctx, env: env)
    }
    return ctx.makeImage()
  }

  static func png(_ image: CGImage) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, nil)
    return CGImageDestinationFinalize(dest) ? data as Data : nil
  }

  /** RGBA bytes (straight alpha) of an image. */
  static func rgba(_ img: CGImage) -> [UInt8] {
    let w = img.width, h = img.height
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    buf.withUnsafeMutableBytes { p in
      let ctx = CGContext(data: p.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                          space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    // Un-premultiply (screenshots are opaque, so this rarely changes anything).
    for i in stride(from: 0, to: buf.count, by: 4) where buf[i + 3] != 255 && buf[i + 3] != 0 {
      let a = Double(buf[i + 3]) / 255
      for c in 0..<3 { buf[i + c] = UInt8(min(255, (Double(buf[i + c]) / a).rounded())) }
    }
    return buf
  }

  /** The image at `w`×`h`, resampled with high quality. */
  static func resized(_ img: CGImage, _ w: Int, _ h: Int) -> CGImage? {
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: img.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()
  }

  /**
   * compressPng(): at most 256 colours; "smallest" also brings HiDPI captures (`scale` > 1) back to
   * 1×. The original when compressing doesn't make it smaller (unless it was resized).
   */
  static func compressed(_ img: CGImage, png: Data, scale: CGFloat, preset: String) -> Data {
    let t0 = Date()
    var src = img
    let resize = preset == "smallest" && scale > 1
    if resize, let r = resized(img, max(1, Int(jsRound(Double(img.width) / scale))), max(1, Int(jsRound(Double(img.height) / scale)))) { src = r }
    let q = Quantizer.quantize(rgba(src))
    let out = PNGWriter.indexed(width: src.width, height: src.height, palette: q.palette, indices: q.indices)
    log("[compress] \(preset) (scale \(scale)) \(img.width)×\(img.height) → \(src.width)×\(src.height): \(png.count / 1024) KB → \(out.count / 1024) KB in \(ms(t0)) ms")
    return out.count < png.count || resize ? out : png
  }

  /** The PNG to write for this output: compressed when the setting (or the editor's switch) says so. */
  static func outputPNG(_ img: CGImage, kind: String, settings: Settings, compress: Bool? = nil, preset: String? = nil, scale: CGFloat) -> Data? {
    guard let png = png(img) else { return nil }
    let c = settings.compress
    guard compressesFor(c.applyTo, compress ?? c.enabled, kind) else { return png }
    return compressed(img, png: png, scale: scale, preset: preset ?? c.preset)
  }

  static func jpeg(_ image: CGImage, quality: Double) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(dest) ? data as Data : nil
  }

  /** The exact PNG bytes on the clipboard; macOS converts for apps that ask for another type. */
  static func copy(_ png: Data) {
    let pb = pasteboard
    pb.clearContents()
    pb.setData(png, forType: .png)
  }

  /** The general pasteboard; tests name a private one (`-SnapkitTestPasteboard`) so they never touch the user's clipboard. */
  static var pasteboard: NSPasteboard {
    if let name = UserDefaults.standard.string(forKey: "SnapkitTestPasteboard") { return NSPasteboard(name: NSPasteboard.Name(name)) }
    return .general
  }


  static func saveFolder(_ s: Settings) -> URL {
    s.save.folder.isEmpty ? Paths.defaultSaveFolder : URL(fileURLWithPath: (s.save.folder as NSString).expandingTildeInPath, isDirectory: true)
  }

  /**
   * Save `png`: straight into the screenshots folder, or through a save dialog starting in the last
   * folder used. Returns the file written (nil if cancelled or failed).
   */
  static func save(_ png: Data, store: SettingsStore) -> URL? {
    let s = store.current
    let folder = saveFolder(s)
    let fm = FileManager.default
    let named = { (dir: URL) in
      dir.appendingPathComponent(Naming.uniqueName(Naming.fileName(s.save.name, now: Date(), n: s.save.nextNumber)) { fm.fileExists(atPath: dir.appendingPathComponent($0).path) })
    }
    var target = named(folder)
    if s.save.askLocation {
      let last = s.save.lastFolder.isEmpty ? nil : URL(fileURLWithPath: s.save.lastFolder, isDirectory: true)
      let start = last.flatMap { fm.fileExists(atPath: $0.path) ? $0 : nil } ?? folder
      try? fm.createDirectory(at: start, withIntermediateDirectories: true)
      // A menu-bar app with no window up: come forward so the dialog gets the keyboard.
      NSApp.activate(ignoringOtherApps: true)
      let panel = NSSavePanel()
      panel.directoryURL = start
      panel.nameFieldStringValue = named(start).lastPathComponent
      panel.allowedContentTypes = [.png]
      panel.level = .modalPanel
      guard panel.runModal() == .OK, let url = panel.url else { return nil }
      target = url
      if url.deletingLastPathComponent().path != s.save.lastFolder {
        store.update(.object([("save", .object([("lastFolder", .string(url.deletingLastPathComponent().path))]))]))
      }
    } else {
      try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
    }
    do {
      try png.write(to: target, options: .atomic)
    } catch {
      log("[save] couldn't write \(target.path): \(error.localizedDescription)")
      return nil
    }
    if s.save.name.number != "none" {
      store.update(.object([("save", .object([("nextNumber", .number(Double(s.save.nextNumber + 1)))]))]))
    }
    log("[save] \(target.path)")
    return target
  }
}
