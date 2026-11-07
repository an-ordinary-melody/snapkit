import AppKit
import SnapkitCore

/** What the history panel asks the app to do with an entry. */
protocol HistoryActions: AnyObject {
  func historyCopy(_ png: Data, scale: CGFloat)
  func historySave(_ png: Data, scale: CGFloat)
  func historyPin(_ png: Data, image: CGImage)
  func historyEdit(_ doc: CaptureDoc)
  func historyCopyText(_ png: Data, done: @escaping (Int) -> Void)
  func historyOpenSettings()
}

/**
 * History (src/main/historyPanel.ts + History.tsx): a floating window of past captures, newest first.
 * Click or Enter copies; hover for text / edit / pin / save / delete; F stars; arrows move; Esc closes.
 * Clicking anywhere else closes it, like a clipboard manager.
 */
final class HistoryPanel: NSObject, NSWindowDelegate {
  let store: HistoryStore
  let settings: SettingsStore
  weak var actions: HistoryActions?
  private var window: NSPanel?
  private var view: HistoryView?
  private var sizeWork: DispatchWorkItem?
  static let minSize = CGSize(width: 480, height: 340)

  init(store: HistoryStore, settings: SettingsStore) {
    self.store = store
    self.settings = settings
    super.init()
    store.onChange { [weak self] _ in self?.view?.reload() }
  }

  var isVisible: Bool { window?.isVisible ?? false }
  private var frost: NSVisualEffectView?

  /** The window's light/dark (Gray is dark), its frosted material included, which keeps the old one unless told. */
  func applyAppearance() {
    let m = settings.current.appearance.mode
    let a = m == "light" ? NSAppearance(named: .aqua) : m == "system" ? nil : NSAppearance(named: .darkAqua)
    window?.appearance = a
    frost?.appearance = a ?? NSApp.effectiveAppearance
    frost?.needsDisplay = true
  }

  private func create() {
    let s = settings.current.history.panel
    let w = NSPanel(contentRect: CGRect(x: 0, y: 0, width: max(Self.minSize.width, s.width), height: max(Self.minSize.height, s.height)),
                    styleMask: [.titled, .closable, .resizable, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
    w.titlebarAppearsTransparent = true
    w.titleVisibility = .hidden
    w.title = "Snapkit History"
    w.standardWindowButton(.miniaturizeButton)?.isHidden = true
    w.standardWindowButton(.zoomButton)?.isHidden = true
    w.minSize = Self.minSize
    w.level = .floating
    w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    w.isReleasedWhenClosed = false
    w.hidesOnDeactivate = false
    w.becomesKeyOnlyIfNeeded = false
    w.animationBehavior = .none
    w.delegate = self
    w.isMovableByWindowBackground = true
    let v = HistoryView(panel: self)
    // Liquid Glass: the window is frosted (vibrancy "popover", as Electron's) under a translucent
    // background; without it the view's own solid background covers the material.
    let frost = NSVisualEffectView(frame: w.contentRect(forFrameRect: w.frame))
    frost.material = .popover
    frost.blendingMode = .behindWindow
    frost.state = .active
    v.frame = frost.bounds
    v.autoresizingMask = [.width, .height]
    frost.addSubview(v)
    w.contentView = frost
    w.isOpaque = false
    w.backgroundColor = .clear
    self.frost = frost
    applyAppearance()
    window = w
    view = v
  }

  /** Open (centred on the screen with the pointer) or close. */
  func toggle() {
    if isVisible { return hide(giveFocusBack: true) }
    if window == nil { create() }
    guard let w = window, let v = view else { return }
    let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
    if let area = screen?.visibleFrame {
      w.setFrameOrigin(CGPoint(x: (area.midX - w.frame.width / 2).rounded(), y: (area.midY - w.frame.height / 2).rounded()))
    }
    v.theme = Theme.from(settings.current.appearance)
    v.selected = 0
    v.reload()
    NSApp.activate(ignoringOtherApps: true)
    w.makeKeyAndOrderFront(nil)
    w.makeFirstResponder(v)
  }

  /** `giveFocusBack`: return focus to the app the user was in (after a copy, or Esc). */
  func hide(giveFocusBack: Bool) {
    guard let w = window, w.isVisible else { return }
    w.orderOut(nil)
    if giveFocusBack { NSApp.hide(nil) }
  }

  func windowDidResignKey(_ notification: Notification) {
    // Like a clipboard manager: clicking anywhere else closes it (not while a sheet or menu of ours is up).
    if TestOption.string("SnapkitTestPasteboard") == nil { hide(giveFocusBack: false) }
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    hide(giveFocusBack: true)
    return false
  }

  func windowDidResize(_ notification: Notification) {
    sizeWork?.cancel()
    let w = DispatchWorkItem { [weak self] in
      guard let self, let f = self.window?.frame else { return }
      self.settings.update(.object([("history", .object([("panel", .object([("width", .number(f.width)), ("height", .number(f.height))]))]))]))
    }
    sizeWork = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: w)
  }

  // MARK: Actions (historyPanel.ts)

  func act(_ id: String, _ action: String) {
    switch action {
    case "delete": store.delete(id)
    case "star": store.setStarred(id, true)
    case "unstar": store.setStarred(id, false)
    case "edit":
      guard let doc = store.doc(id) else { return }
      hide(giveFocusBack: false)
      // The editor records its outputs into this same entry (doc.historyId).
      actions?.historyEdit(doc)
    default:
      guard let png = store.data(id, "final.png") else { return }
      let scale = CGFloat(store.doc(id)?.scale ?? 1)
      switch action {
      case "copy":
        actions?.historyCopy(png, scale: scale)
        hide(giveFocusBack: true)
      case "save":
        hide(giveFocusBack: false)
        actions?.historySave(png, scale: scale)
      case "pin":
        hide(giveFocusBack: true)
        if let img = NSBitmapImageRep(data: png)?.cgImage { actions?.historyPin(png, image: img) }
      default: break
      }
    }
  }

  func copyText(_ id: String, done: @escaping (Int) -> Void) {
    guard let png = store.data(id, "final.png") else { return done(-1) }
    actions?.historyCopyText(png) { [weak self] n in
      if n > 0 { self?.hide(giveFocusBack: true) }
      done(n)
    }
  }

  func setRecording(_ on: Bool) {
    settings.update(.object([("history", .object([("paused", .bool(!on))]))]))
  }

  func reveal() { NSWorkspace.shared.open(store.dir) }

  /** Drag an entry into another app: a copy named like a capture ("Snapkit <date>.png"), not "final.png". */
  func dragFile(_ e: HistoryEntry) -> URL? {
    guard let src = store.file(e.id, "final.png") else { return nil }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Snapkit", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("Snapkit \(Naming.dateStamp(Date(timeIntervalSince1970: e.updatedAt / 1000))).png")
    try? FileManager.default.removeItem(at: url)
    try? FileManager.default.copyItem(at: src, to: url)
    return url
  }

  /** Test hooks. */
  var testView: HistoryView? { view }
  var frame: CGRect? { window?.frame }
}

/** The panel's content: header, grid of cards, footer. */
final class HistoryView: NSView, NSDraggingSource {
  weak var panel: HistoryPanel?
  var theme = Theme.from(SettingsRules.defaults.appearance) { didSet { needsDisplay = true; grid.needsDisplay = true } }
  var selected = 0 { didSet { grid.needsDisplay = true; scrollToSelected() } }
  private let scroll = NSScrollView()
  private let grid = HistoryGrid()
  private var thumbs: [String: (Double, CGImage)] = [:]
  private(set) var clearing: String? // nil, "menu", "confirm-all"
  private(set) var note: String?
  private var noteWork: DispatchWorkItem?
  private var hoverButton: String?

  init(panel: HistoryPanel) {
    self.panel = panel
    super.init(frame: .zero)
    wantsLayer = true
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    scroll.scrollerStyle = .overlay
    scroll.autohidesScrollers = true
    grid.owner = self
    scroll.documentView = grid
    addSubview(scroll)
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override var mouseDownCanMoveWindow: Bool { false }

  var entries: [HistoryEntry] { panel?.store.entries ?? [] }

  func reload() {
    if selected >= entries.count { selected = max(0, entries.count - 1) }
    layoutGrid()
    needsDisplay = true
    grid.needsDisplay = true
  }

  override func layout() {
    super.layout()
    layoutGrid()
  }

  private func layoutGrid() {
    scroll.frame = CGRect(x: 0, y: 48, width: bounds.width, height: max(0, bounds.height - 48 - 34))
    grid.frame = CGRect(x: 0, y: 0, width: scroll.contentSize.width, height: max(scroll.contentSize.height, grid.contentHeight(width: scroll.contentSize.width)))
  }

  /** As many 170 pt (min) columns as fit (grid-template-columns: repeat(auto-fill, minmax(170px, 1fr))). */
  var columns: Int { max(1, Int((grid.bounds.width - 32 + 12) / (170 + 12))) }

  func thumb(_ e: HistoryEntry) -> CGImage? {
    if let t = thumbs[e.id], t.0 == e.updatedAt { return t.1 }
    guard let data = panel?.store.data(e.id, "thumb.jpg"), let img = NSBitmapImageRep(data: data)?.cgImage else { return nil }
    thumbs[e.id] = (e.updatedAt, img)
    return img
  }

  private func scrollToSelected() {
    guard let r = grid.cardRect(selected) else { return }
    grid.scrollToVisible(r)
  }

  func setNote(_ text: String?, clearAfter: Double? = nil) {
    note = text
    noteWork?.cancel()
    if let clearAfter {
      let w = DispatchWorkItem { [weak self] in self?.setNote(nil) }
      noteWork = w
      DispatchQueue.main.asyncAfter(deadline: .now() + clearAfter, execute: w)
    }
    needsDisplay = true
  }

  func copyText(_ id: String?) {
    guard let id else { return }
    setNote("Reading text…")
    panel?.copyText(id) { [weak self] n in
      if n > 0 { self?.setNote(nil) } else { self?.setNote(n == 0 ? "No text found" : "Couldn't read the text", clearAfter: 1.8) }
    }
  }

  func act(_ action: String, _ id: String? = nil) {
    guard let id = id ?? (entries.indices.contains(selected) ? entries[selected].id : nil) else { return }
    panel?.act(id, action)
  }

  // MARK: Keys

  override func keyDown(with e: NSEvent) {
    let n = entries.count
    let k = e.charactersIgnoringModifiers?.lowercased() ?? ""
    let cmd = e.modifierFlags.contains(.command)
    if e.keyCode == 53 { return panel?.hide(giveFocusBack: true) ?? () }
    guard n > 0 else { return }
    switch e.keyCode {
    case 124: selected = min(n - 1, selected + 1)
    case 123: selected = max(0, selected - 1)
    case 125: selected = min(n - 1, selected + columns)
    case 126: selected = max(0, selected - columns)
    case 36, 76: act("copy")
    case 51, 117: act("delete")
    default:
      if cmd && k == "c" { act("copy") }
      else if k == "e" { act("edit") }
      else if k == "t" { copyText(entries[selected].id) }
      else if k == "p" { act("pin") }
      else if k == "s" { act("save") }
      else if k == "f" { act(entries[selected].starred ? "unstar" : "star") }
      else { super.keyDown(with: e) }
    }
  }

  // MARK: Header

  private var recording: Bool { !(panel?.settings.current.history.paused ?? false) }

  private var switchRect: CGRect { CGRect(x: headerX(afterMeta: true), y: 14, width: 34, height: 20) }
  private func headerX(afterMeta: Bool) -> CGFloat {
    let title = NSAttributedString(string: "History", attributes: [.font: NSFont.systemFont(ofSize: 14, weight: .semibold)]).size().width
    let meta = NSAttributedString(string: metaText, attributes: [.font: NSFont.systemFont(ofSize: 12)]).size().width
    return 82 + title + 10 + (metaText.isEmpty ? 0 : meta + 10) + 12
  }
  private var metaText: String {
    let u = panel?.store.usage ?? (0, 0)
    return u.0 > 0 ? "\(u.0) · \(Self.mb(u.1))" : ""
  }
  static func mb(_ b: Int) -> String { b < 1024 * 1024 ? "\(max(1, Int((Double(b) / 1024).rounded()))) KB" : String(format: "%.1f MB", Double(b) / 1024 / 1024) }

  private var settingsRect: CGRect { CGRect(x: bounds.maxX - 14 - 28, y: 10, width: 28, height: 28) }
  private var folderRect: CGRect { CGRect(x: settingsRect.minX - 2 - 28, y: 10, width: 28, height: 28) }
  private var clearRect: CGRect {
    let w = NSAttributedString(string: "Clear History", attributes: [.font: NSFont.systemFont(ofSize: 12.5)]).size().width + 20 + 14 + 6
    return CGRect(x: folderRect.minX - 2 - w, y: 10, width: w, height: 28)
  }
  private var menuRect: CGRect { CGRect(x: clearRect.maxX - 190, y: clearRect.maxY + 6, width: 190, height: 8 + 30 * 2 + 1) }
  private func menuItem(_ i: Int) -> CGRect { CGRect(x: menuRect.minX + 4, y: menuRect.minY + 4 + CGFloat(i) * 31, width: 182, height: 30) }

  override func mouseDown(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if clearing != nil {
      if menuItem(0).contains(p), entries.contains(where: { !$0.starred }) {
        panel?.store.clear(keepStarred: true)
        clearing = nil
      } else if menuItem(1).contains(p) {
        if clearing == "confirm-all" {
          panel?.store.clear(keepStarred: false)
          clearing = nil
        } else {
          clearing = "confirm-all"
        }
      } else if !clearRect.contains(p) {
        clearing = nil
      }
      needsDisplay = true
      if !clearRect.contains(p) { return }
    }
    if switchRect.contains(p) { panel?.setRecording(!recording); needsDisplay = true }
    else if clearRect.contains(p), !entries.isEmpty { clearing = clearing == nil ? "menu" : nil; needsDisplay = true }
    else if folderRect.contains(p) { panel?.reveal() }
    else if settingsRect.contains(p) { panel?.actions?.historyOpenSettings() }
    else if p.y < 48 { window?.performDrag(with: e) }
  }

  /** Test hooks. */
  func pressClear(_ which: String) {
    switch which {
    case "menu": clearing = clearing == nil ? "menu" : nil
    case "keep": panel?.store.clear(keepStarred: true); clearing = nil
    case "all":
      if clearing == "confirm-all" { panel?.store.clear(keepStarred: false); clearing = nil } else { clearing = "confirm-all" }
    default: break
    }
    needsDisplay = true
  }
  var clearAllLabel: String { clearing == "confirm-all" ? "Click again to delete all" : "Clear all…" }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    theme.historyBackground.setFill()
    bounds.fill()
    // Header
    let title = NSAttributedString(string: "History", attributes: [.font: NSFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: theme.foreground])
    title.draw(at: CGPoint(x: 82, y: 24 - title.size().height / 2))
    if !metaText.isEmpty {
      let m = NSAttributedString(string: metaText, attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular), .foregroundColor: theme.foregroundFaint])
      m.draw(at: CGPoint(x: 82 + title.size().width + 10, y: 24 - m.size().height / 2))
    }
    let sw = switchRect
    (recording ? theme.switchOn : theme.track).setFill()
    NSBezierPath(roundedRect: sw, xRadius: 10, yRadius: 10).fill()
    NSColor.white.setFill()
    NSBezierPath(ovalIn: CGRect(x: sw.minX + (recording ? 16 : 2), y: sw.minY + 2, width: 16, height: 16)).fill()
    let rec = NSAttributedString(string: recording ? "Recording" : "Paused", attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: theme.foregroundDim])
    rec.draw(at: CGPoint(x: sw.maxX + 7, y: 24 - rec.size().height / 2))
    let cr = clearRect
    let clearAlpha: CGFloat = entries.isEmpty ? 0.4 : 1
    Icons.draw("trash", in: CGRect(x: cr.minX + 10, y: cr.minY, width: 14, height: cr.height), size: 14, color: theme.foreground.withAlphaComponent(clearAlpha), ctx: ctx)
    let ct = NSAttributedString(string: "Clear History", attributes: [.font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: theme.foreground.withAlphaComponent(clearAlpha)])
    ct.draw(at: CGPoint(x: cr.minX + 30, y: cr.midY - ct.size().height / 2))
    Icons.draw("folder", in: folderRect, size: 15, color: theme.foreground, ctx: ctx)
    Icons.draw("settings", in: settingsRect, size: 15, color: theme.foreground, ctx: ctx)
    // Footer
    let foot = CGRect(x: 18, y: bounds.maxY - 34 + 8, width: bounds.width - 36, height: 18)
    if let note {
      NSAttributedString(string: note, attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: theme.foregroundFaint]).draw(at: foot.origin)
    } else {
      var x = foot.minX
      for (i, (key, label)) in [("↵", "copy"), ("T", "text"), ("E", "edit"), ("P", "pin"), ("S", "save"), ("F", "star"), ("⌫", "delete"), ("Esc", "close")].enumerated() {
        if i > 0 { x += 8 }
        let k = NSAttributedString(string: key, attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: theme.foregroundDim])
        let kr = CGRect(x: x, y: foot.minY, width: k.size().width + 10, height: k.size().height + 2)
        theme.field.setFill()
        NSBezierPath(roundedRect: kr, xRadius: 4, yRadius: 4).fill()
        k.draw(at: CGPoint(x: kr.minX + 5, y: kr.minY + 1))
        x = kr.maxX + 4
        let l = NSAttributedString(string: label, attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: theme.foregroundFaint])
        l.draw(at: CGPoint(x: x, y: foot.minY + 1))
        x += l.size().width
      }
    }
    if entries.isEmpty {
      for (i, (t, size, c)) in [("No captures yet.", 13.0, theme.foregroundDim), ("Copies and saves show up here to reuse.", 12.0, theme.foregroundFaint)].enumerated() {
        let s = NSAttributedString(string: t, attributes: [.font: NSFont.systemFont(ofSize: size), .foregroundColor: c])
        s.draw(at: CGPoint(x: bounds.midX - s.size().width / 2, y: bounds.midY - 20 + CGFloat(i) * 22))
      }
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    // The Clear menu is drawn above the grid.
    addSubview(menuOverlay)
  }

  private lazy var menuOverlay: MenuOverlay = {
    let m = MenuOverlay()
    m.owner = self
    return m
  }()

  fileprivate final class MenuOverlay: NSView {
    weak var owner: HistoryView?
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
      guard let o = owner, o.clearing != nil else { return }
      let r = o.menuRect
      let shadow = NSShadow()
      shadow.shadowColor = o.theme.shadow
      shadow.shadowBlurRadius = 24
      shadow.shadowOffset = NSSize(width: 0, height: -6)
      NSGraphicsContext.saveGraphicsState()
      shadow.set()
      o.theme.strongBackground.setFill()
      NSBezierPath(roundedRect: r, xRadius: 10, yRadius: 10).fill()
      NSGraphicsContext.restoreGraphicsState()
      let keepOn = o.entries.contains { !$0.starred }
      for (i, (t, c)) in [("Clear, keep starred", o.theme.foreground.withAlphaComponent(keepOn ? 1 : 0.4)), (o.clearAllLabel, NSColor(hex: "#e5484d"))].enumerated() {
        let s = NSAttributedString(string: t, attributes: [.font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: c])
        let ir = o.menuItem(i)
        s.draw(at: CGPoint(x: ir.minX + 10, y: ir.midY - s.size().height / 2))
      }
    }
  }

  override func setNeedsDisplay(_ invalidRect: NSRect) {
    super.setNeedsDisplay(invalidRect)
    menuOverlay.frame = bounds
    menuOverlay.needsDisplay = true
  }

  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
}

/** The cards (.hist-card): thumbnail on a checkerboard, age and size, star, hover actions. */
final class HistoryGrid: NSView {
  weak var owner: HistoryView?
  private var hovered: Int?
  private var hoverAction: String?
  private var downAt: (CGPoint, Int)?
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override var mouseDownCanMoveWindow: Bool { false }

  private var entries: [HistoryEntry] { owner?.entries ?? [] }
  private var cols: Int { max(1, Int((bounds.width - 32 + 12) / (170 + 12))) }
  private var cardWidth: CGFloat { (bounds.width - 32 - CGFloat(cols - 1) * 12) / CGFloat(cols) }
  private var cardHeight: CGFloat { 6 + (cardWidth - 12) * 3 / 4 + 6 + 16 + 6 }

  func contentHeight(width: CGFloat) -> CGFloat {
    let c = max(1, Int((width - 32 + 12) / (170 + 12)))
    let cw = (width - 32 - CGFloat(c - 1) * 12) / CGFloat(c)
    let ch = 6 + (cw - 12) * 3 / 4 + 6 + 16 + 6
    let rows = (entries.count + c - 1) / c
    return 4 + CGFloat(rows) * ch + CGFloat(max(0, rows - 1)) * 12 + 12
  }

  func cardRect(_ i: Int) -> CGRect? {
    guard entries.indices.contains(i) else { return nil }
    return CGRect(x: 16 + CGFloat(i % cols) * (cardWidth + 12), y: 4 + CGFloat(i / cols) * (cardHeight + 12), width: cardWidth, height: cardHeight)
  }

  private func thumbRect(_ c: CGRect) -> CGRect { CGRect(x: c.minX + 6, y: c.minY + 6, width: c.width - 12, height: (c.width - 12) * 3 / 4) }
  private func starRect(_ c: CGRect) -> CGRect { CGRect(x: c.minX + 11, y: c.minY + 11, width: 24, height: 24) }
  private let actionIds = [("copy", "copy"), ("text", "ocr"), ("edit", "edit"), ("pin", "pin"), ("save", "save"), ("delete", "trash")]
  private func actionsRect(_ c: CGRect) -> CGRect {
    let w = CGFloat(actionIds.count) * 28 + CGFloat(actionIds.count - 1) + 6
    return CGRect(x: c.midX - w / 2, y: c.maxY - 34 - 34, width: w, height: 34)
  }
  private func actionRect(_ c: CGRect, _ i: Int) -> CGRect {
    let a = actionsRect(c)
    return CGRect(x: a.minX + 3 + CGFloat(i) * 29, y: a.minY + 3, width: 28, height: 28)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }

  private func index(_ p: CGPoint) -> Int? { entries.indices.first { cardRect($0)?.contains(p) ?? false } }

  override func mouseMoved(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    let h = index(p)
    if h != hovered {
      hovered = h
      if let h { owner?.selected = h } // hovering selects, as in Electron
    }
    needsDisplay = true
  }

  override func mouseExited(with e: NSEvent) {
    hovered = nil
    needsDisplay = true
  }

  override func mouseDown(with e: NSEvent) {
    window?.makeFirstResponder(owner)
    let p = convert(e.locationInWindow, from: nil)
    guard let i = index(p), let c = cardRect(i) else { return }
    let entry = entries[i]
    if starRect(c).contains(p) {
      owner?.act(entry.starred ? "unstar" : "star", entry.id)
      return
    }
    if hovered == i, actionsRect(c).contains(p) {
      for (k, (id, _)) in actionIds.enumerated() where actionRect(c, k).contains(p) {
        if id == "text" { owner?.copyText(entry.id) } else { owner?.act(id, entry.id) }
        return
      }
      return
    }
    downAt = (p, i)
  }

  override func mouseDragged(with e: NSEvent) {
    guard let (start, i) = downAt, entries.indices.contains(i) else { return }
    let p = convert(e.locationInWindow, from: nil)
    guard hypot(p.x - start.x, p.y - start.y) > 3 else { return }
    downAt = nil
    // Drag into another app as a PNG file.
    let entry = entries[i]
    guard let url = owner?.panel?.dragFile(entry), let thumb = owner?.thumb(entry), let owner else { return }
    let item = NSDraggingItem(pasteboardWriter: url as NSURL)
    let w: CGFloat = 120, h = w * CGFloat(thumb.height) / CGFloat(thumb.width)
    item.setDraggingFrame(CGRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h), contents: NSImage(cgImage: thumb, size: CGSize(width: w, height: h)))
    beginDraggingSession(with: [item], event: e, source: owner)
  }

  override func mouseUp(with e: NSEvent) {
    defer { downAt = nil }
    guard let (_, i) = downAt, entries.indices.contains(i) else { return }
    owner?.act("copy", entries[i].id)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext, let owner else { return }
    let theme = owner.theme
    for (i, e) in entries.enumerated() {
      guard let c = cardRect(i), c.intersects(dirtyRect) else { continue }
      let sel = i == owner.selected
      if sel {
        theme.activeBackground.setFill()
        NSBezierPath(roundedRect: c, xRadius: 12, yRadius: 12).fill()
      }
      let t = thumbRect(c)
      ctx.saveGState()
      ctx.addPath(CGPath(roundedRect: t, cornerWidth: 8, cornerHeight: 8, transform: nil))
      ctx.clip()
      theme.checkA.setFill()
      t.fill()
      theme.checkB.setFill()
      var y = t.minY, row = 0
      while y < t.maxY {
        var x = t.minX + (row % 2 == 0 ? 6 : 0)
        while x < t.maxX {
          CGRect(x: x, y: y, width: 6, height: 6).fill()
          x += 12
        }
        y += 6
        row += 1
      }
      if let img = owner.thumb(e) {
        let k = min(t.width / CGFloat(img.width), t.height / CGFloat(img.height), 1)
        let w = CGFloat(img.width) * k, h = CGFloat(img.height) * k
        ShapeDrawing.drawImage(img, in: CGRect(x: t.midX - w / 2, y: t.midY - h / 2, width: w, height: h), ctx: ctx)
      }
      ctx.restoreGState()
      let fg = sel ? theme.activeForeground : theme.foreground
      let age = NSAttributedString(string: HistoryGrid.ago(e.updatedAt), attributes: [.font: NSFont.systemFont(ofSize: 11.5), .foregroundColor: fg])
      age.draw(at: CGPoint(x: c.minX + 8, y: t.maxY + 6))
      let size = NSAttributedString(string: "\(e.width) × \(e.height)", attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 11.5, weight: .regular), .foregroundColor: sel ? fg : theme.foregroundFaint])
      size.draw(at: CGPoint(x: c.maxX - 8 - size.size().width, y: t.maxY + 6))
      if e.starred || sel || i == hovered {
        let sr = starRect(c)
        theme.strongBackground.setFill()
        NSBezierPath(ovalIn: sr).fill()
        Icons.draw(e.starred ? "star-filled" : "star", in: sr, size: 13, color: e.starred ? NSColor(hex: "#f5a524") : theme.foregroundDim, ctx: ctx)
      }
      if i == hovered {
        let a = actionsRect(c)
        let shadow = NSShadow()
        shadow.shadowColor = theme.shadow
        shadow.shadowBlurRadius = 24
        shadow.shadowOffset = NSSize(width: 0, height: -6)
        NSGraphicsContext.saveGraphicsState()
        shadow.set()
        theme.strongBackground.setFill()
        NSBezierPath(roundedRect: a, xRadius: 10, yRadius: 10).fill()
        NSGraphicsContext.restoreGraphicsState()
        for (k, (_, icon)) in actionIds.enumerated() { Icons.draw(icon, in: actionRect(c, k), size: 14, color: theme.foreground, ctx: ctx) }
      }
    }
  }

  static func ago(_ t: Double) -> String {
    let s = Int(((Date().timeIntervalSince1970 * 1000 - t) / 1000).rounded())
    if s < 60 { return "Just now" }
    if s < 3600 { return "\(s / 60) min ago" }
    if s < 86400 { return "\(s / 3600) h ago" }
    let f = DateFormatter()
    f.setLocalizedDateFormatFromTemplate("MMM d")
    return f.string(from: Date(timeIntervalSince1970: t / 1000))
  }
}

extension Theme {
  /** --hist-bg */
  /** --hist-bg: translucent over the window's frosted material with Liquid Glass, else solid. */
  var historyBackground: NSColor {
    if glass { return gray ? .rgba(64, 64, 70, 0.45) : dark ? .rgba(30, 30, 34, 0.4) : .rgba(250, 250, 252, 0.35) }
    return gray ? NSColor(hex: "#38383c") : dark ? NSColor(hex: "#1e1e21") : NSColor(hex: "#f6f6f8")
  }
}
