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
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[1]))
  exit(0)
}

DistributedNotificationCenter.default().postNotificationName(Notification.Name("com.charios.snapkit.dev.test"), object: args.joined(separator: " "), userInfo: nil, deliverImmediately: true)
usleep(useconds_t(wait * 1000))
