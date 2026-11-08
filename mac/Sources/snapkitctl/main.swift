import AppKit
import Carbon

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

// `snapkitctl diff <a.png> <b.png> <out.png>` compares two renders: prints the share of pixels that
// differ noticeably (any channel by more than 24) and writes a, b and the differences side by side.
if args[0] == "diff", args.count == 4,
   let a = NSBitmapImageRep(data: (try? Data(contentsOf: URL(fileURLWithPath: args[1]))) ?? Data())?.cgImage,
   let b = NSBitmapImageRep(data: (try? Data(contentsOf: URL(fileURLWithPath: args[2]))) ?? Data())?.cgImage {
  let w = min(a.width, b.width), h = min(a.height, b.height)
  func pixels(_ img: CGImage) -> [UInt8] {
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: h - img.height, width: img.width, height: img.height))
    return buf
  }
  let pa = pixels(a), pb = pixels(b)
  var d = [UInt8](repeating: 0, count: w * h * 4)
  var n = 0
  for i in stride(from: 0, to: pa.count, by: 4) {
    let off = (0..<3).contains { abs(Int(pa[i + $0]) - Int(pb[i + $0])) > 24 }
    if off { n += 1 }
    let g = UInt8((Int(pa[i]) + Int(pa[i + 1]) + Int(pa[i + 2])) / 12)
    (d[i], d[i + 1], d[i + 2], d[i + 3]) = off ? (255, 0, 80, 255) : (g, g, g, 255)
  }
  let ctx = CGContext(data: nil, width: w * 3, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(a, in: CGRect(x: 0, y: h - a.height, width: a.width, height: a.height))
  ctx.draw(b, in: CGRect(x: w, y: h - b.height, width: b.width, height: b.height))
  let dctx = CGContext(data: &d, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                       bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(dctx.makeImage()!, in: CGRect(x: w * 2, y: 0, width: w, height: h))
  try? NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: args[3]))
  print(String(format: "%.2f %dx%d %dx%d", Double(n) * 100 / Double(w * h), a.width, a.height, b.width, b.height))
  exit(0)
}

// `snapkitctl hold-hotkey <seconds>` registers ⌥⇧Z (Snapkit's default capture shortcut) as another
// app would, holds it, then quits.
if args[0] == "hold-hotkey", args.count == 2 {
  var ref: EventHotKeyRef?
  let status = RegisterEventHotKey(UInt32(kVK_ANSI_Z), UInt32(optionKey | shiftKey), EventHotKeyID(signature: 0x484F4C44, id: 1), GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &ref)
  print(status == noErr ? "holding" : "failed \(status)")
  fflush(stdout)
  RunLoop.main.run(until: Date().addingTimeInterval(Double(args[1]) ?? 5))
  exit(0)
}

// `snapkitctl real-type <text>` presses the keys for <text> (letters, digits, space) through the system's
// event stream, as a keyboard would: they reach whichever window has the keyboard, through the selected
// input source (an input method such as Vietnamese Telex sees them too). Needs Accessibility for the app
// that runs it.
if args[0] == "real-type", args.count >= 2 {
  let codes: [Character: Int] = [
    "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F, "g": kVK_ANSI_G,
    "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L, "m": kVK_ANSI_M, "n": kVK_ANSI_N,
    "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U,
    "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X, "y": kVK_ANSI_Y, "z": kVK_ANSI_Z, " ": kVK_Space,
    "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
    "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
  ]
  let src = CGEventSource(stateID: .hidSystemState)
  for ch in args.dropFirst().joined(separator: " ") {
    guard let code = codes[Character(ch.lowercased())] else { continue }
    let shift = ch.isUppercase
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(code), keyDown: down)
      e?.flags = shift ? .maskShift : []
      e?.post(tap: .cghidEventTap)
    }
    usleep(30_000)
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
