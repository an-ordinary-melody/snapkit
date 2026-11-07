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
 *   type <text>                 type into the text box (with the Text tool, starts one first); \n = new line
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
    let codes: [String: (UInt16, String)] = ["esc": (53, "\u{1b}"), "return": (36, "\r"), "delete": (51, "\u{7f}"), "left": (123, ""), "right": (124, ""), "down": (125, ""), "up": (126, "")]
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
    case "text": app.capture.toggle(textOnly: true)
    case "fullscreen": app.capture.captureFullScreen()
    case "lastarea": app.capture.captureLastArea()
    case "ocr-panel":
      if let id = args.first { mainView?.ocrPanelPress(id) }
    case "thumb":
      // thumb <copy|edit|text|pin|close> [index]: a floating preview's buttons
      let thumbs = Floating.shared.items.filter { $0.kind == .thumb }
      let i = nums.first.map(Int.init) ?? thumbs.count - 1
      if let id = args.first, thumbs.indices.contains(i) { Floating.shared.thumbPress(thumbs[i], id) }
    case "pin-zoom":
      if let p = Floating.shared.items.last(where: { $0.kind == .pin }), let z = nums.first { Floating.shared.setZoom(p, z) }
    case "pin-opacity":
      if let p = Floating.shared.items.last(where: { $0.kind == .pin }), let o = nums.first { Floating.shared.setOpacity(p, o) }
    case "pin-move":
      if let p = Floating.shared.items.last, nums.count == 2 { Floating.shared.moveBy(p, dx: nums[0], dy: nums[1]) }
    case "closepins": Floating.shared.closeAll()
    case "clearclip": Output.pasteboard.clearContents()
    case "history": app.historyPanel.toggle()
    case "hist":
      // hist <copy|edit|pin|save|delete|star|unstar|text> [index]
      let entries = app.history.entries
      let i = nums.first.map(Int.init) ?? 0
      guard let a = args.first, entries.indices.contains(i) else { return }
      if a == "text" { app.historyPanel.testView?.copyText(entries[i].id) } else { app.historyPanel.act(entries[i].id, a) }
    case "hist-key":
      if let k = args.first, let v = app.historyPanel.testView { key(v, k, flags) }
    case "snapshot-view":
      // snapshot-view <history|pin|thumb> <png>: a window's content as it draws itself
      guard args.count >= 2 else { return }
      let v: NSView? = args[0] == "history" ? app.historyPanel.testView
        : Floating.shared.items.last(where: { ($0.kind == .pin) == (args[0] == "pin") })?.panel.contentView
      guard let v, let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { return }
      v.cacheDisplay(in: v.bounds, to: rep)
      try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: args[1]))
    case "hist-resize":
      if nums.count == 2, let w = app.historyPanel.testView?.window {
        var f = w.frame
        f.size = CGSize(width: nums[0], height: nums[1])
        w.setFrame(f, display: true)
        app.historyPanel.testView?.layoutSubtreeIfNeeded()
      }
    case "hist-dragfile":
      if let e = app.history.entries.first, let url = app.historyPanel.dragFile(e) {
        let n = (try? Data(contentsOf: url))?.count ?? 0
        reply(.object([("dragFile", .string(url.lastPathComponent)), ("bytes", .number(Double(n)))]))
      }
    case "hist-clear":
      if let w = args.first { app.historyPanel.testView?.pressClear(w) }
    case "editor":
      // editor press <id> | chip <group> <id> | swatch <i> | slider <id> <v> | zoom <z>
      guard let ed = mainView?.editorView, args.count >= 2 else { return }
      switch args[0] {
      case "press": ed.press(args[1])
      case "chip" where args.count >= 3: ed.pickChip(args[1], args[2...].joined(separator: " "))
      case "swatch": ed.pickSwatch(Int(args[1]) ?? 0)
      case "slider" where args.count >= 3: ed.setSlider(args[1], Double(args[2]) ?? 0)
      case "zoom": ed.zoomTo(CGFloat(Double(args[1]) ?? 1), at: nums.count >= 3 ? CGPoint(x: nums[1], y: nums[2]) : nil)
      case "space": ed.setHand(args[1] == "down")
      case "drag" where nums.count >= 4:
        // editor drag x1 y1 x2 y2: in the editor's own coordinates (stage), through its mouse handlers
        let a = CGPoint(x: nums[0], y: nums[1]), b = CGPoint(x: nums[2], y: nums[3])
        func ev(_ t: NSEvent.EventType, _ p: CGPoint) -> NSEvent? {
          NSEvent.mouseEvent(with: t, location: ed.convert(p, to: nil), modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                             windowNumber: ed.window?.windowNumber ?? 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        }
        if let e = ev(.leftMouseDown, a) { ed.mouseDown(with: e) }
        for k in 1...6 { if let e = ev(.leftMouseDragged, CGPoint(x: a.x + (b.x - a.x) * CGFloat(k) / 6, y: a.y + (b.y - a.y) * CGFloat(k) / 6)) { ed.mouseDragged(with: e) } }
        if let e = ev(.leftMouseUp, b) { ed.mouseUp(with: e) }
      default: break
      }
    case "setting":
      // setting <json patch>
      if let patch = try? JSON.parse(args.joined(separator: " ")) { app.store.update(patch) }
    case "select":
      guard let v = mainView, nums.count == 4 else { return }
      drag(v, from: CGPoint(x: nums[0], y: nums[1]), to: CGPoint(x: nums[0] + nums[2], y: nums[1] + nums[3]))
    case "tool":
      if let id = args.first { mainView?.run(id) }
    case "drag":
      guard let v = mainView, nums.count >= 4 else { return }
      drag(v, from: CGPoint(x: nums[0], y: nums[1]), to: CGPoint(x: nums[2], y: nums[3]), flags: flags)
    case "click", "dblclick":
      guard let v = mainView, nums.count >= 2 else { return }
      let p = CGPoint(x: nums[0], y: nums[1])
      for n in 1...(cmd == "dblclick" ? 2 : 1) {
        if let e = NSEvent.mouseEvent(with: .leftMouseDown, location: v.convert(p, to: nil), modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                      windowNumber: v.window!.windowNumber, context: nil, eventNumber: 0, clickCount: n, pressure: 1) { v.mouseDown(with: e) }
        if let e = event(.leftMouseUp, p, in: v, flags: flags) { v.mouseUp(with: e) }
      }
    case "rightclick":
      guard let v = mainView, nums.count >= 2, let e = event(.rightMouseDown, CGPoint(x: nums[0], y: nums[1]), in: v) else { return }
      v.rightMouseDown(with: e)
    case "variants":
      if let id = args.first { mainView?.openVariants(id) }
    case "variant":
      if args.count >= 2 { mainView?.pickVariant(args[0], args[1]) }
    case "style":
      if let id = args.first { mainView?.pressStyle(id) }
    case "pick":
      if let hex = args.first { mainView?.testPick(hex) }
    case "blur":
      if let n = nums.first { mainView?.testStyle(blur: n) }
    case "fontsize":
      if let n = nums.first { mainView?.testStyle(fontSize: n) }
    case "type":
      // Types into the text being edited; with none, clicks near the selection's top-left first (Text tool).
      guard let v = mainView, let sel = v.sel else { return }
      if !v.isTyping {
        let p = CGPoint(x: sel.x + 20, y: sel.y + 20)
        if let e = event(.leftMouseDown, p, in: v) { v.mouseDown(with: e) }
        if let e = event(.leftMouseUp, p, in: v) { v.mouseUp(with: e) }
      }
      v.typeText(args.joined(separator: " ").replacingOccurrences(of: "\\n", with: "\n"))
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
      o = o.setting("lastArea", (try? Data(contentsOf: Paths.lastAreaFile)).flatMap { try? JSON.parse($0) } ?? .null)
      o = o.setting("capturing", .bool(app.capture.active))
      o = o.setting("panels", .number(Double(app.capture.pool.entries.count)))
      o = o.setting("visiblePanels", .number(Double(app.capture.pool.entries.values.filter { $0.panel.isVisible }.count)))
      if let v {
        o = o.setting("hasImage", .bool(v.image != nil))
        o = o.setting("tool", v.tool.map { .string($0) } ?? .null)
        o = o.setting("shapes", .array(v.shapes.map { .string($0.type) }))
        o = o.setting("shapeData", (try? JSON.encode(v.shapes)) ?? .null)
        o = o.setting("selected", v.selectedId.map { .string($0) } ?? .null)
        o = o.setting("popover", v.openPopover.map { .string($0) } ?? .null)
        o = o.setting("guides", .number(Double(v.guideCount)))
        o = o.setting("styleBar", .array(v.styleBarIds.map { .string($0) }))
        o = o.setting("styleActive", .array(v.activeStyleIds.map { .string($0) }))
        if let f = v.popoverFrame { o = o.setting("popoverFrame", .array([f.minX, f.minY, f.width, f.height].map { .number($0) })) }
        o = o.setting("screen", .array([.number(v.bounds.width), .number(v.bounds.height)]))
        o = o.setting("toolbar", .array(v.toolIds.map { .string($0) }))
        o = o.setting("typing", .bool(v.isTyping))
        if let s = v.sel { o = o.setting("selection", .array([s.x, s.y, s.w, s.h].map { .number($0) })) }
        o = o.setting("editorOpen", .bool(v.editorOpen))
        o = o.setting("beautify", v.beautifyJSON)
        if let ed = v.editorView {
          let r = ed.previewRect
          o = o.setting("editorPreview", .array([r.minX, r.minY, r.width, r.height].map { .number(Double($0)) }))
          let st = ed.stage
          o = o.setting("editorStage", .array([st.minX, st.minY, st.width, st.height].map { .number(Double($0)) }))
          o = o.setting("editorHand", .bool(ed.hand))
          o = o.setting("editorOutput", .string(ed.outputLabel))
          o = o.setting("editorTab", .string(ed.currentTab))
          o = o.setting("editorZoom", .number(Double(ed.zoomLevel)))
        }
        o = o.setting("lit", .array(v.lit.sorted().map { .string($0) }))
        o = o.setting("toolbarsShown", .bool(v.toolbarsShown))
        o = o.setting("isKeyWindow", .bool(v.window?.isKeyWindow ?? false))
      }
      o = o.setting("ocr", .number(Double(v?.ocrLineCount ?? 0)))
      o = o.setting("ocrPanel", v?.ocrPanelText.map { .string($0) } ?? .null)
      o = o.setting("note", v?.note.map { .string($0) } ?? .null)
      o = o.setting("textOnly", .bool(v?.textOnly ?? false))
      o = o.setting("clipboardText", Output.pasteboard.string(forType: .string).map { .string($0) } ?? .null)
      o = o.setting("notifications", .array(Notifier.posted.map { .string("\($0.0): \($0.1)") }))
      o = o.setting("floating", .array(Floating.shared.items.map { item in
        let f = Floating.topLeftRect(item.panel.frame)
        var j = JSON.object([])
        j = j.setting("kind", .string(item.kind == .pin ? "pin" : "thumb"))
        j = j.setting("frame", .array([f.minX, f.minY, f.width, f.height].map { .number(Double($0)) }))
        j = j.setting("zoom", .number(Double(item.zoom)))
        j = j.setting("opacity", .number(Double(item.opacity)))
        j = j.setting("image", .array([.number(Double(item.image.width)), .number(Double(item.image.height))]))
        j = j.setting("shapes", .number(Double(item.doc?.shapes.count ?? 0)))
        j = j.setting("historyId", item.doc?.historyId.map { .string($0) } ?? .null)
        j = j.setting("labels", .array(item.kind == .thumb ? Floating.shared.thumbLabels(item).map { .string($0) } : []))
        j = j.setting("visible", .bool(item.panel.isVisible))
        if let s = item.panel.screen { j = j.setting("visibleFrame", .array([s.visibleFrame.maxX, Floating.primaryHeight - s.visibleFrame.minY].map { .number(Double($0)) })) }
        return j
      }))
      let entries = app.history.entries
      o = o.setting("history", .array(entries.map { e in
        var j = JSON.object([])
        j = j.setting("id", .string(e.id))
        j = j.setting("starred", .bool(e.starred))
        j = j.setting("size", .array([.number(Double(e.width)), .number(Double(e.height))]))
        return j
      }))
      o = o.setting("historyFolders", .number(Double(((try? FileManager.default.contentsOfDirectory(atPath: app.history.dir.path)) ?? []).filter { $0 != "index.json" && !$0.hasSuffix(".tmp") }.count)))
      o = o.setting("historyVisible", .bool(app.historyPanel.isVisible))
      o = o.setting("historyClearAll", .string(app.historyPanel.testView?.clearAllLabel ?? ""))
      o = o.setting("historyNote", app.historyPanel.testView?.note.map { .string($0) } ?? .null)
      o = o.setting("historySelected", .number(Double(app.historyPanel.testView?.selected ?? 0)))
      if let f = app.historyPanel.frame { o = o.setting("historyFrame", .array([f.width, f.height].map { .number(Double($0)) })) }
      o = o.setting("historyColumns", .number(Double(app.historyPanel.testView?.columns ?? 0)))
      let pb = Output.pasteboard.data(forType: .png)
      o = o.setting("clipboardPngBytes", .number(Double(pb?.count ?? 0)))
      if let pb, pb.count > 25 { o = o.setting("clipboardColorType", .number(Double(pb[25]))) }
      if let pb, let rep = NSBitmapImageRep(data: pb) {
        o = o.setting("clipboardSize", .array([.number(Double(rep.pixelsWide)), .number(Double(rep.pixelsHigh))]))
      }
      if let pb, let out = NSBitmapImageRep(data: pb), let screen = app.capture.grabber.testImage, let area = LastArea.load(Paths.lastAreaFile) {
        o = o.setting("clipboardMatchesScreen", .bool(matches(out, screen, at: area.rect)))
      }
      let session = CGSessionCopyCurrentDictionary() as? [String: Any]
      o = o.setting("screenLocked", .bool((session?["CGSSessionScreenIsLocked"] as? Bool) ?? false))
      o = o.setting("captureHotkeyRegistered", .bool(Hotkeys.shared.isRegistered("capture")))
      reply(o)
    default:
      log("[test] unknown command \(cmd)")
    }
  }
}
#endif
