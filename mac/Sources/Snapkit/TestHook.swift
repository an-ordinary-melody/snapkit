#if DEBUG
import AppKit
import SnapkitCore

/**
 * Debug builds only: lets tests drive the app without real hotkeys or clicks (docs/native-mac-testing.md,
 * "test mode"). Commands arrive as a distributed notification `com.charios.snapkit.dev.test` whose
 * object is the command line; results are written to the file named by `-SnapkitTestOut` (default:
 * test-out.json in the data folder). Send them with `swift run snapkitctl <command>`.
 *
 *   capture                     open (or close) capture mode
 *   select x y w h              select an area on the main display (points from its top-left)
 *   tool <id>                   pick a tool (pen, arrow, rect, text) or run an action (copy, save, close, undo, redo)
 *   drag x1 y1 x2 y2 [shift]    drag with the current tool / on the selection, on the main display
 *   type <text>                 click at the selection's centre with the Text tool and type, then Esc
 *   key <name> [cmd] [shift]    esc, return, left/right/up/down, or a letter
 *   snapshot <png>              save what the main display's capture window shows
 *   state                       write the capture state as JSON
 */
enum TestHook {
  static let name = Notification.Name("com.charios.snapkit.dev.test")

  static func install(_ app: AppDelegate) {
    DistributedNotificationCenter.default().addObserver(forName: name, object: nil, queue: .main) { n in
      guard let line = n.object as? String else { return }
      log("[test] \(line)")
      run(line, app)
    }
  }

  private static var outFile: URL {
    if let p = UserDefaults.standard.string(forKey: "SnapkitTestOut") { return URL(fileURLWithPath: p) }
    return Paths.dataDir.appendingPathComponent("test-out.json")
  }

  private static func reply(_ v: JSON) {
    try? Data(v.serialized(indent: 2).utf8).write(to: outFile, options: .atomic)
  }

  private static var mainView: OverlayView? {
    guard let screen = NSScreen.screens.first else { return nil }
    return (NSApp.delegate as? AppDelegate)?.capture.pool.entries[screen.displayID]?.view
  }

  private static func event(_ type: NSEvent.EventType, _ p: CGPoint, in view: OverlayView, flags: NSEvent.ModifierFlags = []) -> NSEvent? {
    guard let window = view.window else { return nil }
    let wp = view.convert(p, to: nil)
    return NSEvent.mouseEvent(with: type, location: wp, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                              windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
  }

  private static func drag(_ view: OverlayView, from a: CGPoint, to b: CGPoint, flags: NSEvent.ModifierFlags = []) {
    if let e = event(.leftMouseDown, a, in: view, flags: flags) { view.mouseDown(with: e) }
    for k in 1...8 {
      let t = CGFloat(k) / 8
      let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
      if let e = event(.leftMouseDragged, p, in: view, flags: flags) { view.mouseDragged(with: e) }
    }
    if let e = event(.leftMouseUp, b, in: view, flags: flags) { view.mouseUp(with: e) } else { log("[test] couldn't make mouse events") }
    log("[test] after drag: selection \(view.sel.map { "\($0.x),\($0.y) \($0.w)×\($0.h)" } ?? "none"), shapes \(view.shapes.count)")
  }

  private static func key(_ view: NSView, _ name: String, _ flags: NSEvent.ModifierFlags) {
    let codes: [String: (UInt16, String)] = ["esc": (53, "\u{1b}"), "return": (36, "\r"), "left": (123, ""), "right": (124, ""), "down": (125, ""), "up": (126, "")]
    let (code, chars) = codes[name] ?? (UInt16(Accelerator.keyCodes[name.uppercased()] ?? 0), name)
    guard let window = view.window,
          let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)
    else { return }
    window.sendEvent(e)
  }

  /** The copied image's corners and centre have the test screen's pixels at the copied area (no drawings there). */
  private static func matches(_ out: NSBitmapImageRep, _ screen: CGImage, at r: LastArea.Rect) -> Bool {
    let src = NSBitmapImageRep(cgImage: screen)
    let scale = CGFloat(out.pixelsWide) / CGFloat(r.width)
    for (fx, fy) in [(0.02, 0.02), (0.98, 0.02), (0.5, 0.5), (0.02, 0.98), (0.98, 0.98)] {
      let ox = Int(CGFloat(out.pixelsWide) * fx), oy = Int(CGFloat(out.pixelsHigh) * fy)
      let sx = Int(CGFloat(r.x) * scale) + ox, sy = Int(CGFloat(r.y) * scale) + oy
      guard let a = out.colorAt(x: ox, y: oy)?.usingColorSpace(.sRGB), let b = src.colorAt(x: sx, y: sy)?.usingColorSpace(.sRGB) else { return false }
      if abs(a.redComponent - b.redComponent) > 0.02 || abs(a.greenComponent - b.greenComponent) > 0.02 || abs(a.blueComponent - b.blueComponent) > 0.02 { return false }
    }
    return true
  }

  static func run(_ line: String, _ app: AppDelegate) {
    var args = line.split(separator: " ").map(String.init)
    guard !args.isEmpty else { return }
    let cmd = args.removeFirst()
    let nums = args.compactMap { Double($0) }
    var flags: NSEvent.ModifierFlags = []
    if args.contains("shift") { flags.insert(.shift) }
    if args.contains("cmd") { flags.insert(.command) }
    if args.contains("option") { flags.insert(.option) }
    switch cmd {
    case "capture": app.capture.toggle()
    case "select":
      guard let v = mainView, nums.count == 4 else { return }
      drag(v, from: CGPoint(x: nums[0], y: nums[1]), to: CGPoint(x: nums[0] + nums[2], y: nums[1] + nums[3]))
    case "tool":
      if let id = args.first { mainView?.run(id) }
    case "drag":
      guard let v = mainView, nums.count >= 4 else { return }
      drag(v, from: CGPoint(x: nums[0], y: nums[1]), to: CGPoint(x: nums[2], y: nums[3]), flags: flags)
    case "type":
      guard let v = mainView, let sel = v.sel else { return }
      let p = CGPoint(x: sel.x + 20, y: sel.y + 20)
      if let e = event(.leftMouseDown, p, in: v) { v.mouseDown(with: e) }
      (v.window?.firstResponder as? NSTextView)?.insertText(args.joined(separator: " "), replacementRange: NSRange(location: NSNotFound, length: 0))
      if let tv = v.window?.firstResponder as? NSTextView { tv.doCommand(by: #selector(NSResponder.cancelOperation(_:))) }
    case "key":
      guard let v = mainView, let name = args.first else { return }
      key(v.window?.firstResponder as? NSView ?? v, name, flags)
    case "snapshot":
      guard let v = mainView, let path = args.first, let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { return }
      v.cacheDisplay(in: v.bounds, to: rep)
      // cacheDisplay skips layer contents (the frozen image): draw it underneath.
      let composed = NSImage(size: v.bounds.size)
      composed.lockFocus()
      if let img = v.image {
        NSGraphicsContext.current?.cgContext.draw(img, in: CGRect(origin: .zero, size: v.bounds.size))
      }
      rep.draw(in: CGRect(origin: .zero, size: v.bounds.size))
      composed.unlockFocus()
      if let tiff = composed.tiffRepresentation, let bmp = NSBitmapImageRep(data: tiff), let png = bmp.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: path))
      }
    case "state":
      let v = mainView
      var o = JSON.object([])
      o = o.setting("capturing", .bool(app.capture.active))
      o = o.setting("panels", .number(Double(app.capture.pool.entries.count)))
      o = o.setting("visiblePanels", .number(Double(app.capture.pool.entries.values.filter { $0.panel.isVisible }.count)))
      if let v {
        o = o.setting("hasImage", .bool(v.image != nil))
        o = o.setting("tool", v.tool.map { .string($0) } ?? .null)
        o = o.setting("shapes", .array(v.shapes.map { .string($0.type) }))
        o = o.setting("typing", .bool(v.isTyping))
        if let s = v.sel { o = o.setting("selection", .array([s.x, s.y, s.w, s.h].map { .number($0) })) }
        o = o.setting("isKeyWindow", .bool(v.window?.isKeyWindow ?? false))
      }
      let pb = Output.pasteboard.data(forType: .png)
      o = o.setting("clipboardPngBytes", .number(Double(pb?.count ?? 0)))
      if let pb, let rep = NSBitmapImageRep(data: pb) {
        o = o.setting("clipboardSize", .array([.number(Double(rep.pixelsWide)), .number(Double(rep.pixelsHigh))]))
      }
      if let pb, let out = NSBitmapImageRep(data: pb), let screen = app.capture.grabber.testImage, let area = LastArea.load(Paths.lastAreaFile) {
        o = o.setting("clipboardMatchesScreen", .bool(matches(out, screen, at: area.rect)))
      }
      o = o.setting("captureHotkeyRegistered", .bool(Hotkeys.shared.isRegistered("capture")))
      reply(o)
    default:
      log("[test] unknown command \(cmd)")
    }
  }
}
#endif
