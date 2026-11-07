import AppKit

// Sends a test command to a running debug build of Snapkit (see TestHook.swift), e.g.
//   swift run snapkitctl capture
//   swift run snapkitctl select 100 100 400 300
// With `--wait <ms>`, waits that long after sending (the app handles commands asynchronously).
// `snapkitctl make-screen <png>` writes a test screen (colour bands) at the main display's pixel size.
var args = Array(CommandLine.arguments.dropFirst())
var wait = 300
if let i = args.firstIndex(of: "--wait"), i + 1 < args.count {
  wait = Int(args[i + 1]) ?? wait
  args.removeSubrange(i...(i + 1))
}
guard !args.isEmpty else {
  FileHandle.standardError.write(Data("usage: snapkitctl <command> [args…] [--wait ms]\n".utf8))
  exit(2)
}

// `snapkitctl pixel <png> <x> <y> [<x> <y>…]` prints the colour at each point (in the image's points) as #rrggbb.
if args[0] == "pixel", args.count >= 4, let rep = NSBitmapImageRep(data: (try? Data(contentsOf: URL(fileURLWithPath: args[1]))) ?? Data()) {
  let k = Double(rep.pixelsWide) / rep.size.width
  let nums = args.dropFirst(2).compactMap(Double.init)
  for i in stride(from: 0, to: nums.count - 1, by: 2) {
    let c = rep.colorAt(x: Int(nums[i] * k), y: Int(nums[i + 1] * k))?.usingColorSpace(.sRGB) ?? .black
    print(String(format: "#%02x%02x%02x", Int((c.redComponent * 255).rounded()), Int((c.greenComponent * 255).rounded()), Int((c.blueComponent * 255).rounded())))
  }
  exit(0)
}

if args[0] == "make-screen", args.count == 2 {
  let s = NSScreen.screens[0]
  let w = Int(s.frame.width * s.backingScaleFactor), h = Int(s.frame.height * s.backingScaleFactor)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  for (i, c) in [NSColor.systemTeal, .systemIndigo, .systemOrange, .systemPink, .systemGreen].enumerated() {
    c.setFill()
    NSRect(x: 0, y: CGFloat(i * h / 5), width: CGFloat(w), height: CGFloat(h / 5) + 1).fill()
  }
  // Known text for the text-recognition checks: a white card at (100, 100)–(700, 260) points, top-left origin.
  let k = s.backingScaleFactor
  let card = NSRect(x: 100 * k, y: CGFloat(h) - 260 * k, width: 600 * k, height: 160 * k)
  NSColor.white.setFill()
  card.fill()
  let font = NSFont.systemFont(ofSize: 36 * k, weight: .medium)
  for (i, line) in ["Snapkit reads text", "Xin chào thế giới"].enumerated() {
    NSAttributedString(string: line, attributes: [.font: font, .foregroundColor: NSColor.black])
      .draw(at: NSPoint(x: 130 * k, y: CGFloat(h) - (130 + CGFloat(i) * 60) * k - font.ascender))
  }
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[1]))
  exit(0)
}

DistributedNotificationCenter.default().postNotificationName(Notification.Name("com.charios.snapkit.dev.test"), object: args.joined(separator: " "), userInfo: nil, deliverImmediately: true)
usleep(useconds_t(wait * 1000))
