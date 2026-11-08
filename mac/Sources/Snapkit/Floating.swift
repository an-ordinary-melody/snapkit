import AppKit
import SnapkitCore

/**
 * Pins (full-size floating screenshots) and floating previews (small, in a display's corner after a
 * copy): src/main/pin.ts with Pin.tsx and Thumb.tsx. Non-activating panels above other windows, on
 * every Space and over full-screen apps; they don't take focus from the app you're in until clicked.
 */
final class FloatingPanel: NSPanel {
  init(frame: CGRect) {
    super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    level = .floating
    isOpaque = false
    backgroundColor = .clear
    hasShadow = true
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    animationBehavior = .none
    isMovable = false
    acceptsMouseMovedEvents = true
  }
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

/** What the floating windows ask the app to do. */
protocol FloatingDelegate: AnyObject {
  func floatingCopy(_ png: Data, scale: CGFloat)
  func floatingSave(_ png: Data, scale: CGFloat)
  /** Read the text in the image and copy it: lines copied (0: none, -1: couldn't read). */
  func floatingCopyText(_ png: Data, done: @escaping (Int) -> Void)
  func floatingEdit(_ item: Floating.Item)
}

final class Floating {
  final class Item {
    enum Kind { case pin, thumb }
    let kind: Kind
    let panel: FloatingPanel
    var png: Data
    var image: CGImage
    /** Thumbs: what the editor reopens, where it was captured (global points, top-left origin), and its display. */
    var doc: CaptureDoc?
    var rect: CGRect?
    var displayId: CGDirectDisplayID?
    /** Thumbs: moved by hand, so no longer part of the corner stack. */
    var moved = false
    /** Size at 100% zoom, in points. */
    var base: CGSize
    var zoom: CGFloat = 1
    var opacity: CGFloat = 1
    /** Temp file for dragging the image into other apps. */
    var file: URL
    /** The capture session that made a thumb, until history links it to an entry. */
    var session: Int?

    init(kind: Kind, panel: FloatingPanel, png: Data, image: CGImage, base: CGSize, file: URL) {
      self.kind = kind
      self.panel = panel
      self.png = png
      self.image = image
      self.base = base
      self.file = file
    }
  }

  static let shared = Floating()
  weak var delegate: FloatingDelegate?
  var settings: () -> Settings = { SettingsRules.defaults }
  private(set) var items: [Item] = []
  private var tag = 0

  var hasPins: Bool { !items.isEmpty }

  static let zoomRange: ClosedRange<CGFloat> = 0.1...5
  static let minOpacity: CGFloat = 0.15

  private static let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("Snapkit", isDirectory: true)

  /** Drag-out files left by a previous run (pins are gone, so are their files). */
  static func cleanTemp() { try? FileManager.default.removeItem(at: tempDir) }

  private func tempFile(_ png: Data) -> URL {
    tag += 1
    try? FileManager.default.createDirectory(at: Floating.tempDir, withIntermediateDirectories: true)
    let url = Floating.tempDir.appendingPathComponent("Snapkit \(Naming.dateStamp(Date())) \(tag).png")
    try? png.write(to: url)
    return url
  }

  // MARK: Global geometry: AppKit screens are bottom-left; Snapkit's rects are top-left (like Electron).

  static var primaryHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }

  /** A top-left-origin rect (global points) as an AppKit frame. */
  static func appKitFrame(_ r: CGRect) -> CGRect { CGRect(x: r.minX, y: primaryHeight - r.maxY, width: r.width, height: r.height) }

  /** The display holding most of `r` (top-left global points), as screen.getDisplayMatching in pin.ts. */
  static func screen(for r: CGRect) -> NSScreen {
    let best = NSScreen.screens.max { a, b in
      let ia = topLeftRect(a.frame).intersection(r), ib = topLeftRect(b.frame).intersection(r)
      return (ia.isNull ? 0 : ia.width * ia.height) < (ib.isNull ? 0 : ib.width * ib.height)
    }
    if let best, !topLeftRect(best.frame).intersection(r).isNull { return best }
    return NSScreen.main ?? NSScreen.screens[0]
  }

  static func topLeftRect(_ f: CGRect) -> CGRect { CGRect(x: f.minX, y: primaryHeight - f.maxY, width: f.width, height: f.height) }

  // MARK: Pins

  /** Pin a screenshot; `at` is where it was captured (global points, top-left). It opens there at 100%. */
  func pin(png: Data, image: CGImage, at: CGRect) {
    let screen = Floating.screen(for: at)
    let scale = screen.backingScaleFactor
    // Background/padding can make the image larger than the selection: keep it centred on it.
    let w = max(16, (CGFloat(image.width) / scale).rounded()), h = max(16, (CGFloat(image.height) / scale).rounded())
    let r = CGRect(x: (at.midX - w / 2).rounded(), y: (at.midY - h / 2).rounded(), width: w, height: h)
    let panel = FloatingPanel(frame: Floating.appKitFrame(r))
    let item = Item(kind: .pin, panel: panel, png: png, image: image, base: CGSize(width: w, height: h), file: tempFile(png))
    panel.contentView = PinView(item: item, owner: self)
    items.append(item)
    panel.orderFrontRegardless()
    log("pinned \(image.width)x\(image.height) at \(Int(r.minX)),\(Int(r.minY))")
  }

  // MARK: Floating previews

  static let thumbMax = CGSize(width: 240, height: 160)

  private func thumbSize(_ image: CGImage) -> CGSize {
    let k = min(Floating.thumbMax.width / CGFloat(image.width), Floating.thumbMax.height / CGFloat(image.height), 1)
    return CGSize(width: max(60, (CGFloat(image.width) * k).rounded()), height: max(40, (CGFloat(image.height) * k).rounded()))
  }

  /** After a copy: a small preview in the corner of the display it was captured on. */
  func preview(png: Data, image: CGImage, doc: CaptureDoc?, rect: CGRect, session: Int?) {
    let screen = Floating.screen(for: rect)
    let size = thumbSize(image)
    let panel = FloatingPanel(frame: CGRect(origin: screen.visibleFrame.origin, size: size))
    let item = Item(kind: .thumb, panel: panel, png: png, image: image, base: size, file: tempFile(png))
    item.doc = doc
    item.rect = rect
    item.displayId = screen.displayID
    item.session = doc?.historyId == nil ? session : nil
    panel.contentView = ThumbView(item: item, owner: self)
    items.append(item)
    layoutThumbs(screen.displayID)
    panel.orderFrontRegardless()
    log("[pin] preview \(Int(size.width))x\(Int(size.height)) on display \(screen.displayID)")
  }

  /** Stack a display's previews in its bottom-right corner (of the area left by the Dock and menu bar), newest at the bottom. */
  func layoutThumbs(_ displayId: CGDirectDisplayID?) {
    let screen = NSScreen.screens.first { $0.displayID == displayId } ?? NSScreen.screens[0]
    let area = screen.visibleFrame
    var bottom = area.minY + 16
    for item in items.reversed() where item.kind == .thumb && !item.moved && item.displayId == screen.displayID {
      item.panel.setFrame(CGRect(x: area.maxX - 16 - item.base.width, y: bottom, width: item.base.width, height: item.base.height), display: true)
      bottom += item.base.height + 10
    }
  }

  /** The history entry for a preview's capture is known: editing the preview now updates that entry. */
  func link(session: Int, historyId: String) {
    for item in items where item.session == session {
      item.session = nil
      item.doc?.historyId = historyId
    }
  }

  /** New result for a preview (after editing it). */
  func update(_ item: Item, png: Data, image: CGImage, doc: CaptureDoc) {
    guard items.contains(where: { $0 === item }) else { return }
    item.png = png
    item.image = image
    item.doc = doc
    try? FileManager.default.removeItem(at: item.file)
    item.file = tempFile(png)
    item.base = thumbSize(image)
    if item.moved {
      var f = item.panel.frame
      f.origin.y += f.height - item.base.height
      f.size = item.base
      item.panel.setFrame(f, display: true)
    } else {
      layoutThumbs(item.displayId)
    }
    item.panel.contentView?.needsDisplay = true
  }

  func close(_ item: Item) {
    items.removeAll { $0 === item }
    item.panel.orderOut(nil)
    item.panel.close()
    try? FileManager.default.removeItem(at: item.file)
    if item.kind == .thumb { layoutThumbs(item.displayId) }
  }

  func closeAll() {
    for item in items { close(item) }
  }

  func moveBy(_ item: Item, dx: CGFloat, dy: CGFloat) {
    var o = item.panel.frame.origin
    o.x += dx
    o.y -= dy
    item.panel.setFrameOrigin(o)
    if item.kind == .thumb && !item.moved {
      item.moved = true
      layoutThumbs(item.displayId) // the others close the gap
    }
  }

  /** Zoom, keeping the point at (ax, ay) (fractions of the window, top-left) where it is. */
  func setZoom(_ item: Item, _ zoom: CGFloat, ax: CGFloat = 0.5, ay: CGFloat = 0.5) {
    let z = min(Floating.zoomRange.upperBound, max(Floating.zoomRange.lowerBound, zoom))
    let f = item.panel.frame
    let w = max(16, (item.base.width * z).rounded()), h = max(16, (item.base.height * z).rounded())
    let x = (f.minX + ax * f.width - ax * w).rounded()
    let top = f.maxY - ay * f.height + ay * h
    item.panel.setFrame(CGRect(x: x, y: (top - h).rounded(), width: w, height: h), display: true)
    item.zoom = z
  }

  func setOpacity(_ item: Item, _ o: CGFloat) {
    item.opacity = min(1, max(Floating.minOpacity, o))
    item.panel.alphaValue = item.opacity
  }

  func copy(_ item: Item) { delegate?.floatingCopy(item.png, scale: CGFloat(item.doc?.scale ?? Double(item.panel.backingScaleFactor))) }
  /** One save at a time per window (a second ⌘S or menu Save while one runs does nothing). */
  private var saving: Set<ObjectIdentifier> = []
  func save(_ item: Item) {
    let id = ObjectIdentifier(item.panel)
    guard !saving.contains(id) else { return }
    saving.insert(id)
    defer { saving.remove(id) }
    delegate?.floatingSave(item.png, scale: CGFloat(item.doc?.scale ?? Double(item.panel.backingScaleFactor)))
  }
  func copyText(_ item: Item, done: @escaping (Int) -> Void) { delegate?.floatingCopyText(item.png, done: done) }
  func edit(_ item: Item) { delegate?.floatingEdit(item) }

  /** Turn a preview into a full-size pin where the capture was taken. */
  func pinFromThumb(_ item: Item) {
    guard let rect = item.rect else { return }
    pin(png: item.png, image: item.image, at: rect)
    close(item)
  }

  /** Right-click menu on a pin. */
  func menu(_ item: Item) -> NSMenu {
    let m = NSMenu()
    let pct = { (v: CGFloat) in "\(Int((v * 100).rounded()))%" }
    func add(_ title: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command], enabled: Bool = true, action: @escaping () -> Void) -> NSMenuItem {
      let i = ClosureMenuItem(title: title, action: action)
      i.keyEquivalent = key
      i.keyEquivalentModifierMask = mods
      i.isEnabled = enabled
      m.addItem(i)
      return i
    }
    _ = add("Copy", "c") { [weak self] in self?.copy(item) }
    _ = add("Save…", "s") { [weak self] in self?.save(item) }
    m.addItem(.separator())
    let zoom = NSMenuItem(title: "Zoom", action: nil, keyEquivalent: "")
    zoom.submenu = NSMenu()
    for z in [0.5, 1, 1.5, 2] as [CGFloat] {
      let i = ClosureMenuItem(title: pct(z)) { [weak self] in self?.setZoom(item, z) }
      i.state = abs(item.zoom - z) < 0.01 ? .on : .off
      zoom.submenu?.addItem(i)
    }
    m.addItem(zoom)
    let opacity = NSMenuItem(title: "Opacity", action: nil, keyEquivalent: "")
    opacity.submenu = NSMenu()
    for o in [1, 0.75, 0.5, 0.25] as [CGFloat] {
      let i = ClosureMenuItem(title: pct(o)) { [weak self] in self?.setOpacity(item, o) }
      i.state = abs(item.opacity - o) < 0.01 ? .on : .off
      opacity.submenu?.addItem(i)
    }
    m.addItem(opacity)
    m.addItem(.separator())
    _ = add("Close", "\u{1b}", []) { [weak self] in self?.close(item) }
    _ = add("Close All Pins", enabled: items.count > 1) { [weak self] in self?.closeAll() }
    return m
  }
}

/** An NSMenuItem that runs a closure. */
final class ClosureMenuItem: NSMenuItem {
  private let run: () -> Void
  init(title: String, action: @escaping () -> Void) {
    run = action
    super.init(title: title, action: #selector(fire), keyEquivalent: "")
    target = self
  }
  required init(coder: NSCoder) { fatalError() }
  @objc private func fire() { run() }
}

/** Start dragging a PNG file into another app, with a small image under the pointer. */
func dragOut(_ file: URL, image: CGImage, from view: NSView, event: NSEvent, maxWidth: CGFloat) {
  let w = min(160, maxWidth)
  let h = w * CGFloat(image.height) / CGFloat(image.width)
  let item = NSDraggingItem(pasteboardWriter: file as NSURL)
  let p = view.convert(event.locationInWindow, from: nil)
  item.setDraggingFrame(CGRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h), contents: NSImage(cgImage: image, size: CGSize(width: w, height: h)))
  view.beginDraggingSession(with: [item], event: event, source: view as? NSDraggingSource ?? DragSource.shared)
}

private final class DragSource: NSObject, NSDraggingSource {
  static let shared = DragSource()
  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
}

// MARK: - Views

/** Shared look for the floating windows' controls (--ui-bg-strong, rim, theme colours). */
private func floatingTheme(_ s: Settings) -> Theme { Theme.from(s.appearance) }

/** Pin.tsx: drag to move, scroll to zoom, ⌥ scroll for opacity, ⌥ drag (or the grip) to drag out, right-click menu, Esc closes. */
private final class PinView: NSView {
  let item: Floating.Item
  weak var owner: Floating?
  private var hover = false
  private var hud: String?
  private var hudWork: DispatchWorkItem?
  private var dragFrom: CGPoint?
  private let slider: SliderView
  private var theme: Theme

  init(item: Floating.Item, owner: Floating) {
    self.item = item
    self.owner = owner
    theme = floatingTheme(owner.settings())
    slider = SliderView(min: 15, max: 100, value: 100, theme: theme)
    super.init(frame: .zero)
    slider.onChange = { [weak self] v in self?.opacityTo(v / 100) }
    addSubview(slider)
    slider.isHidden = true
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override var acceptsFirstResponder: Bool { true }

  private var showBar: Bool { hover && bounds.width > 300 && bounds.height > 90 }
  private var showClose: Bool { hover && bounds.width > 70 && bounds.height > 50 }
  private var closeRect: CGRect { CGRect(x: bounds.maxX - 28, y: 6, width: 22, height: 22) }
  /** Bar: grip 22, −, zoom 40, +, sep, slider 64+12, sep, copy, save; buttons 26, gap 2, padding 3. */
  private var barItems: [(String, CGFloat)] { [("grip", 22), ("out", 26), ("zoom", 40), ("in", 26), ("sep", 7), ("opacity", 76), ("sep", 7), ("copy", 26), ("save", 26)] }
  private var barRect: CGRect {
    let w = barItems.reduce(0) { $0 + $1.1 } + CGFloat(barItems.count - 1) * 2 + 6
    return CGRect(x: bounds.midX - w / 2, y: bounds.maxY - 8 - 32, width: w, height: 32)
  }
  private func barFrame(_ id: String) -> CGRect {
    var x = barRect.minX + 3
    for (i, w) in barItems {
      if i == id { return CGRect(x: x, y: barRect.minY + 3, width: w, height: 26) }
      x += w + 2
    }
    return .zero
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self))
  }

  override func mouseEntered(with e: NSEvent) { hover = true; layoutSlider(); needsDisplay = true }
  /** Test hook: as if the pointer left (or came in). */
  func testUnhover(_ on: Bool = false) { hover = on; layoutSlider(); needsDisplay = true }
  override func mouseExited(with e: NSEvent) { hover = false; layoutSlider(); needsDisplay = true }
  override func mouseMoved(with e: NSEvent) {
    (e.modifierFlags.contains(.option) ? NSCursor.dragCopy : NSCursor.openHand).set()
  }
  /** ⌥ pressed or let go over the pin: the cursor follows at once, not on the next move (Pin.tsx setAlt). */
  override func flagsChanged(with e: NSEvent) {
    super.flagsChanged(with: e)
    guard hover else { return }
    (e.modifierFlags.contains(.option) ? NSCursor.dragCopy : NSCursor.openHand).set()
  }

  private func layoutSlider() {
    slider.isHidden = !showBar
    slider.theme = theme
    slider.value = Double(item.opacity * 100)
    slider.frame = barFrame("opacity").insetBy(dx: 6, dy: 4)
  }

  override func layout() {
    super.layout()
    layoutSlider()
  }

  private func flash(_ text: String) {
    hud = text
    hudWork?.cancel()
    let w = DispatchWorkItem { [weak self] in
      self?.hud = nil
      self?.needsDisplay = true
    }
    hudWork = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9, execute: w)
    needsDisplay = true
  }

  private func zoomTo(_ z: CGFloat, ax: CGFloat = 0.5, ay: CGFloat = 0.5) {
    owner?.setZoom(item, z, ax: ax, ay: ay)
    flash("\(Int((min(5, max(0.1, z)) * 100).rounded()))%")
    layoutSlider()
  }

  private func opacityTo(_ o: CGFloat) {
    owner?.setOpacity(item, o)
    flash("Opacity \(Int((min(1, max(0.15, o)) * 100).rounded()))%")
  }

  override func scrollWheel(with e: NSEvent) {
    let step = exp(e.scrollingDeltaY * (e.hasPreciseScrollingDeltas ? 1 : 40) * 0.0025)
    if e.modifierFlags.contains(.option) {
      opacityTo(item.opacity * step)
    } else {
      let p = convert(e.locationInWindow, from: nil)
      zoomTo(item.zoom * step, ax: p.x / bounds.width, ay: p.y / bounds.height)
    }
  }

  override func mouseDown(with e: NSEvent) {
    window?.makeKey()
    window?.makeFirstResponder(self)
    let p = convert(e.locationInWindow, from: nil)
    if showClose && closeRect.contains(p) { owner?.close(item); return }
    if showBar && barRect.contains(p) {
      if barFrame("grip").contains(p) { dragOut(item.file, image: item.image, from: self, event: e, maxWidth: item.base.width); return }
      if barFrame("out").contains(p) { zoomTo(item.zoom / 1.25) }
      if barFrame("zoom").contains(p) { zoomTo(1) }
      if barFrame("in").contains(p) { zoomTo(item.zoom * 1.25) }
      if barFrame("copy").contains(p) { owner?.copy(item) }
      if barFrame("save").contains(p) { owner?.save(item) }
      return
    }
    if e.modifierFlags.contains(.option) {
      dragOut(item.file, image: item.image, from: self, event: e, maxWidth: item.base.width)
      return
    }
    dragFrom = NSEvent.mouseLocation
  }

  override func mouseDragged(with e: NSEvent) {
    guard let from = dragFrom else { return }
    let m = NSEvent.mouseLocation
    owner?.moveBy(item, dx: m.x - from.x, dy: -(m.y - from.y))
    dragFrom = m
  }

  override func mouseUp(with e: NSEvent) { dragFrom = nil }

  override func rightMouseDown(with e: NSEvent) {
    guard let owner else { return }
    NSMenu.popUpContextMenu(owner.menu(item), with: e, for: self)
  }

  override func keyDown(with e: NSEvent) {
    let cmd = e.modifierFlags.contains(.command)
    let k = e.charactersIgnoringModifiers?.lowercased() ?? ""
    if e.keyCode == 53 { owner?.close(item) }
    // A held ⌘C / ⌘S repeats: one copy or save per press.
    else if cmd && k == "c" { if !e.isARepeat { owner?.copy(item) } }
    else if cmd && k == "s" { if !e.isARepeat { owner?.save(item) } }
    else if cmd && (k == "=" || k == "+") { zoomTo(item.zoom * 1.25) }
    else if cmd && k == "-" { zoomTo(item.zoom / 1.25) }
    else if cmd && k == "0" { zoomTo(1) }
    else { super.keyDown(with: e) }
  }

  /** Liquid Glass: the pinned image under a control, blurred (cached per size). */
  private var glassCache: [String: CGImage] = [:]
  private func glassUnder(_ r: CGRect) -> CGImage? {
    guard theme.glass else { return nil }
    let key = "\(r)|\(bounds.size)"
    if let c = glassCache[key] { return c }
    let img = Glass.backdrop(r, scale: window?.backingScaleFactor ?? 2) { ctx in ShapeDrawing.drawImage(self.item.image, in: self.bounds, ctx: ctx) }
    if glassCache.count > 12 { glassCache = [:] }
    glassCache[key] = img
    return img
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    ShapeDrawing.drawImage(item.image, in: bounds, ctx: ctx)
    // A faint edge so the pin stands apart from what's under it.
    NSColor(srgbRed: 0.5, green: 0.5, blue: 0.5, alpha: 0.35).setStroke()
    NSBezierPath(rect: bounds.insetBy(dx: 0.5, dy: 0.5)).stroke()
    if let hud {
      let s = NSAttributedString(string: hud, attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .regular), .foregroundColor: NSColor.white])
      let size = s.size()
      let box = CGRect(x: bounds.midX - size.width / 2 - 12, y: bounds.midY - size.height / 2 - 6, width: size.width + 24, height: size.height + 12)
      NSColor.rgba(20, 20, 22, 0.85).setFill()
      NSBezierPath(roundedRect: box, xRadius: 8, yRadius: 8).fill()
      s.draw(at: CGPoint(x: box.minX + 12, y: box.minY + 6))
    }
    if showClose {
      theme.drawPanel(closeRect, radius: closeRect.width / 2, strong: true, backdrop: glassUnder(closeRect), in: ctx)
      Icons.draw("close", in: closeRect, size: 13, color: theme.foreground, ctx: ctx)
    }
    if showBar {
      let shadow = NSShadow()
      shadow.shadowColor = theme.shadow
      shadow.shadowBlurRadius = 24
      shadow.shadowOffset = NSSize(width: 0, height: -6)
      NSGraphicsContext.saveGraphicsState()
      shadow.set()
      theme.strongBackground.setFill()
      NSBezierPath(roundedRect: barRect, xRadius: theme.radius, yRadius: theme.radius).fill()
      NSGraphicsContext.restoreGraphicsState()
      if theme.glass { theme.drawPanel(barRect, radius: theme.radius, strong: true, backdrop: glassUnder(barRect), in: ctx) }
      Icons.draw("grip", in: barFrame("grip"), size: 15, color: theme.foreground.withAlphaComponent(0.6), ctx: ctx)
      Icons.draw("minus", in: barFrame("out"), size: 14, color: theme.foreground, ctx: ctx)
      Icons.draw("plus", in: barFrame("in"), size: 14, color: theme.foreground, ctx: ctx)
      let z = NSAttributedString(string: "\(Int((item.zoom * 100).rounded()))%", attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 11.5, weight: .regular), .foregroundColor: theme.foreground])
      let zr = barFrame("zoom")
      z.draw(at: CGPoint(x: zr.midX - z.size().width / 2, y: zr.midY - z.size().height / 2))
      theme.separator.setFill()
      var x = barRect.minX + 3
      for (id, w) in barItems {
        if id == "sep" { NSBezierPath(rect: CGRect(x: x + 3, y: barRect.midY - 8, width: 1, height: 16)).fill() }
        x += w + 2
      }
      Icons.draw("copy", in: barFrame("copy"), size: 14, color: theme.foreground, ctx: ctx)
      Icons.draw("save", in: barFrame("save"), size: 14, color: theme.foreground, ctx: ctx)
    }
  }
}

/** Thumb.tsx: the preview after a copy. Hover for Copy / Edit / Text, pin, move and close; double-click edits; drag the image out. */
private final class ThumbView: NSView {
  let item: Floating.Item
  weak var owner: Floating?
  private var hover = false
  private var copied = false
  private var textState: String?
  private var textWork: DispatchWorkItem?
  private var moveFrom: CGPoint?
  private var downAt: CGPoint?
  private var theme: Theme

  init(item: Floating.Item, owner: Floating) {
    self.item = item
    self.owner = owner
    theme = floatingTheme(owner.settings())
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 10
    layer?.masksToBounds = true
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override var acceptsFirstResponder: Bool { true }

  // Sizes as styles.css "Floating preview after copy" (container queries on the preview's size):
  // labels on Copy and Edit only from 210 pt wide; under 120 pt wide the buttons stack and the move
  // handle goes to the bottom; under 100 pt tall (a strip) everything is one row.
  private var showLabels: Bool { bounds.width >= 210 && bounds.height >= 100 }
  private var stacked: Bool { bounds.width < 120 }
  private var strip: Bool { bounds.height < 100 }
  private var iconY: CGFloat { strip ? (bounds.midY - 12).rounded() : 6 }

  private var pinRect: CGRect { CGRect(x: 6, y: iconY, width: 24, height: 24) }
  private var moveRect: CGRect {
    if strip { return CGRect(x: bounds.maxX - 36 - 24, y: iconY, width: 24, height: 24) }
    if stacked { return CGRect(x: bounds.midX - 12, y: bounds.maxY - 30, width: 24, height: 24) }
    return CGRect(x: bounds.midX - 12, y: 6, width: 24, height: 24)
  }
  private var closeRect: CGRect { CGRect(x: bounds.maxX - 30, y: iconY, width: 24, height: 24) }

  /** Copy, Edit and Text; Text is always an icon (its result shows in the status pill). */
  private var buttons: [(id: String, icon: String, label: String?)] {
    let l = showLabels
    return [("copy", "copy", l ? (copied ? "Copied" : "Copy") : nil), ("edit", "edit", l ? "Edit" : nil), ("text", "ocr", nil)]
  }
  private var tips: [String] { [copied ? "Copied" : "Copy", "Edit", "Capture Text (OCR)"] }

  private let buttonFont = NSFont.systemFont(ofSize: 12.5, weight: .semibold)
  private let statusFont = NSFont.systemFont(ofSize: 12, weight: .semibold)

  /** The buttons' frames; they never shrink. */
  private func buttonRects() -> [CGRect] {
    let widths = buttons.map { b in b.label.map { 12 + 14 + 6 + NSAttributedString(string: $0, attributes: [.font: buttonFont]).size().width + 12 } ?? 30 }
    if stacked {
      let total = CGFloat(widths.count) * 30 + CGFloat(widths.count - 1) * 3
      var y = bounds.midY - total / 2
      return widths.map { w in
        defer { y += 33 }
        return CGRect(x: (bounds.midX - w / 2).rounded(), y: y.rounded(), width: w, height: 30)
      }
    }
    let gap: CGFloat = showLabels ? 8 : 6
    let total = widths.reduce(0, +) + CGFloat(widths.count - 1) * gap
    // A strip keeps clear of the pin (left) and the move and close icons (right).
    let mid = strip ? 36 + (bounds.width - 36 - 66) / 2 : bounds.midX
    var x = mid - total / 2
    return widths.map { w in
      defer { x += w + gap }
      return CGRect(x: x.rounded(), y: (bounds.midY - 15).rounded(), width: w, height: 30)
    }
  }

  /** Tooltips name the buttons (the icon-only ones especially). */
  private func updateToolTips() {
    removeAllToolTips()
    for (r, tip) in zip(buttonRects(), tips) { addToolTip(r, owner: tip as NSString, userData: nil) }
    addToolTip(pinRect, owner: "Pin to screen" as NSString, userData: nil)
    addToolTip(closeRect, owner: "Close" as NSString, userData: nil)
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    updateToolTips()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }

  override func mouseEntered(with e: NSEvent) { hover = true; needsDisplay = true }
  /** Test hook: as if the pointer left (or came in). */
  func testUnhover(_ on: Bool = false) { hover = on; needsDisplay = true }
  override func mouseExited(with e: NSEvent) { hover = false; needsDisplay = true }

  override func mouseDown(with e: NSEvent) {
    window?.makeKey()
    window?.makeFirstResponder(self)
    let p = convert(e.locationInWindow, from: nil)
    // Only a double-click on the image edits; on a button it's just two clicks.
    let onControl = hover && (closeRect.contains(p) || pinRect.contains(p) || moveRect.contains(p) || buttonRects().contains { $0.contains(p) })
    if e.clickCount == 2 && !onControl { owner?.edit(item); return }
    if closeRect.contains(p) { owner?.close(item); return }
    if pinRect.contains(p) { owner?.pinFromThumb(item); return }
    if moveRect.contains(p) { moveFrom = NSEvent.mouseLocation; return }
    for (i, r) in buttonRects().enumerated() where r.contains(p) {
      press(buttons[i].id)
      return
    }
    downAt = p
  }

  override func mouseDragged(with e: NSEvent) {
    if let from = moveFrom {
      let m = NSEvent.mouseLocation
      owner?.moveBy(item, dx: m.x - from.x, dy: -(m.y - from.y))
      moveFrom = m
    } else if let d = downAt, hypot(convert(e.locationInWindow, from: nil).x - d.x, convert(e.locationInWindow, from: nil).y - d.y) > 3 {
      downAt = nil
      // Dragging the image drops it into another app as a PNG file.
      dragOut(item.file, image: item.image, from: self, event: e, maxWidth: item.base.width)
    }
  }

  override func mouseUp(with e: NSEvent) {
    moveFrom = nil
    downAt = nil
  }

  func press(_ id: String) {
    switch id {
    case "copy":
      owner?.copy(item)
      copied = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.copied = false; self?.needsDisplay = true }
    case "edit": owner?.edit(item)
    case "text":
      textState = "Reading…"
      textWork?.cancel()
      owner?.copyText(item) { [weak self] n in
        self?.textState = n > 0 ? "Copied \(n) line\(n == 1 ? "" : "s")" : n == 0 ? "No text" : "Couldn't read"
        self?.needsDisplay = true
        let w = DispatchWorkItem { [weak self] in self?.textState = nil; self?.needsDisplay = true }
        self?.textWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: w)
      }
    case "pin": owner?.pinFromThumb(item)
    case "close": owner?.close(item)
    default: break
    }
    needsDisplay = true
  }

  /** Test hook: Copy's state, Edit, and Text's status (or "Text"). */
  var labels: [String] { [copied ? "Copied" : "Copy", "Edit", textState ?? "Text"] }
  /** Test hook: every button inside the preview. */
  var buttonsFit: Bool { (buttonRects() + [pinRect, moveRect, closeRect]).allSatisfy { bounds.contains($0) } }

  override func keyDown(with e: NSEvent) {
    if e.keyCode == 53 { owner?.close(item) } else { super.keyDown(with: e) }
  }

  var testButtonRects: [CGRect] { buttonRects() }

  /** The preview's image as drawn (object-fit: cover). */
  private var imageRect: CGRect {
    let iw = CGFloat(item.image.width), ih = CGFloat(item.image.height)
    let k = max(bounds.width / iw, bounds.height / ih)
    return CGRect(x: bounds.midX - iw * k / 2, y: bounds.midY - ih * k / 2, width: iw * k, height: ih * k)
  }

  /** Liquid Glass: the hovered preview (image and shade) under a button, blurred (cached per size). */
  private var glassCache: [String: CGImage] = [:]
  private func glassUnder(_ r: CGRect) -> CGImage? {
    guard theme.glass else { return nil }
    let key = "\(r)|\(bounds.size)"
    if let c = glassCache[key] { return c }
    let img = Glass.backdrop(r, scale: window?.backingScaleFactor ?? 2) { ctx in
      NSColor(hex: "#111111").setFill()
      self.bounds.fill()
      ShapeDrawing.drawImage(self.item.image, in: self.imageRect, ctx: ctx)
      NSColor.black.withAlphaComponent(0.42).setFill()
      self.bounds.fill()
    }
    if glassCache.count > 12 { glassCache = [:] }
    glassCache[key] = img
    return img
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    NSColor(hex: "#111111").setFill()
    bounds.fill()
    // object-fit: cover
    let r = imageRect
    ShapeDrawing.drawImage(item.image, in: r, ctx: ctx)
    NSColor.white.withAlphaComponent(0.18).setStroke()
    NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10).stroke()
    if hover {
      NSColor.black.withAlphaComponent(0.42).setFill()
      bounds.fill()
      for (i, r) in buttonRects().enumerated() {
        let b = buttons[i]
        theme.drawPanel(r, radius: 15, strong: true, backdrop: glassUnder(r), in: ctx)
        if let label = b.label {
          Icons.draw(b.icon, in: CGRect(x: r.minX + 12, y: r.minY, width: 14, height: r.height), size: 14, color: theme.foreground, ctx: ctx)
          let s = NSAttributedString(string: label, attributes: [.font: buttonFont, .foregroundColor: theme.foreground])
          s.draw(at: CGPoint(x: r.minX + 32, y: r.midY - s.size().height / 2))
        } else {
          Icons.draw(b.icon, in: r, size: 14, color: theme.foreground, ctx: ctx)
        }
      }
      for (rect, icon) in [(pinRect, "pin"), (moveRect, "move"), (closeRect, "close")] {
        theme.drawPanel(rect, radius: rect.width / 2, strong: true, backdrop: glassUnder(rect), in: ctx)
        Icons.draw(icon, in: rect, size: 13, color: theme.foreground, ctx: ctx)
      }
    }
    // Text's result, bottom centre for 1.5 s, hovered or not (.thumb-status).
    if let status = textState {
      let a: [NSAttributedString.Key: Any] = [.font: statusFont, .foregroundColor: theme.foreground]
      let size = NSAttributedString(string: status, attributes: a).size()
      let w = min(size.width + 20, bounds.width - 16), h = ceil(size.height) + 6
      let r = CGRect(x: (bounds.midX - w / 2).rounded(), y: bounds.maxY - 8 - h, width: w, height: h)
      theme.drawPanel(r, radius: 11, strong: true, backdrop: glassUnder(r), in: ctx)
      let para = NSMutableParagraphStyle()
      para.lineBreakMode = .byTruncatingTail
      para.alignment = .center
      NSAttributedString(string: status, attributes: a.merging([.paragraphStyle: para]) { $1 }).draw(in: CGRect(x: r.minX + 10, y: r.minY + 3, width: w - 20, height: size.height))
    }
  }
}

extension ThumbView: NSDraggingSource {
  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
}

extension PinView: NSDraggingSource {
  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
}

/** Test hooks. */
extension Floating {
  func thumbLabels(_ item: Item) -> [String] { (item.panel.contentView as? ThumbView)?.labels ?? [] }
  func thumbButtonsFit(_ item: Item) -> Bool { (item.panel.contentView as? ThumbView)?.buttonsFit ?? true }
  func thumbPress(_ item: Item, _ id: String) { (item.panel.contentView as? ThumbView)?.press(id) }
}

extension Floating {
  /** Test hook: the middle of a preview's button (by index) or of its image. */
  func testThumbPoint(_ item: Item, _ which: String) -> CGPoint {
    guard let v = item.panel.contentView as? ThumbView else { return .zero }
    if let i = Int(which), v.testButtonRects.indices.contains(i) { let r = v.testButtonRects[i]; return CGPoint(x: r.midX, y: r.midY) }
    return CGPoint(x: v.bounds.midX, y: v.bounds.maxY - 12)
  }

  /** Test hook: no floating window shows its hover controls. */
  func testUnhoverAll(hover: Bool = false) {
    for i in items {
      (i.panel.contentView as? PinView)?.testUnhover(hover)
      (i.panel.contentView as? ThumbView)?.testUnhover(hover)
    }
  }
}
