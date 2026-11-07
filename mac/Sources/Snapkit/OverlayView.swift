import AppKit
import SnapkitCore

/** Style picks shared by every capture until Snapkit quits (as in Electron's Overlay.tsx). */
struct DrawStyle: Equatable {
  var color: String
  var textColor: String
  var widthIndex: Int
  /** The settings these picks were made under; new defaults from Settings reset them. */
  var basis: Settings.Annotate

  static func initial(_ s: Settings) -> DrawStyle {
    let first = s.annotate.palette.first ?? "#ef4444"
    return DrawStyle(color: first, textColor: first, widthIndex: s.annotate.strokeWidth, basis: s.annotate)
  }
}

/** What the capture controller does for a display's view. */
protocol OverlayViewDelegate: AnyObject {
  func overlaySelectionStarted(_ view: OverlayView)
  func overlayActivity(_ view: OverlayView)
  func overlayCopy(_ view: OverlayView)
  func overlaySave(_ view: OverlayView)
  func overlayCancel(_ view: OverlayView)
}

/**
 * Capture mode on one display (Overlay.tsx): the frozen screen, the dim with the selection cut out,
 * handles, size label, toolbars, and the drawing layer. Coordinates are points from the top-left.
 */
final class OverlayView: NSView, NSTextViewDelegate {
  weak var delegate: OverlayViewDelegate?

  private(set) var session = 0
  private(set) var settings = SettingsRules.defaults
  private(set) var image: CGImage?
  /** Image pixels per point. */
  var imageScale: CGFloat { image.map { CGFloat($0.width) / max(1, bounds.width) } ?? (window?.backingScaleFactor ?? 2) }

  private(set) var sel: LRect?
  private(set) var history = ShapeHistory()
  private var drawing: Shape?
  private(set) var tool: String?
  private var styleOpen = false
  static var style: DrawStyle?

  private enum Drag {
    case create(origin: CGPoint)
    case move(origin: CGPoint, start: LRect)
    case resize(origin: CGPoint, start: LRect, handle: Handle)
    case draw(origin: CGPoint)
  }
  private var drag: Drag?

  private let frozen = NSView()
  private let chrome = ChromeView()
  private var actionsBar: ToolbarView!
  private var toolsBar: ToolbarView!
  private var styleBar: ToolbarView!
  private var textView: NSTextView?
  private var textOrigin: CGPoint = .zero

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    frozen.wantsLayer = true
    frozen.layer?.contentsGravity = .resize
    frozen.frame = bounds
    frozen.autoresizingMask = [.width, .height]
    addSubview(frozen)
    chrome.owner = self
    chrome.frame = bounds
    chrome.autoresizingMask = [.width, .height]
    addSubview(chrome)
    let theme = Theme.from(settings.appearance)
    actionsBar = ToolbarView(vertical: false, theme: theme)
    toolsBar = ToolbarView(vertical: true, theme: theme)
    styleBar = ToolbarView(vertical: false, theme: theme)
    for bar in [actionsBar!, toolsBar!, styleBar!] {
      bar.isHidden = true
      bar.onPress = { [weak self] id in self?.press(id) }
      addSubview(bar)
    }
  }

  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  var screenSize: LSize { LSize(w: bounds.width, h: bounds.height) }
  var shapes: [Shape] { history.present }
  var style: DrawStyle { OverlayView.style ?? DrawStyle.initial(settings) }

  // MARK: - Lifecycle (called by CaptureController)

  /** A new capture: dim over the live screen until the image arrives. */
  func arm(session: Int, settings: Settings, preset: LRect? = nil) {
    self.session = session
    self.settings = settings
    if OverlayView.style == nil || OverlayView.style?.basis != settings.annotate { OverlayView.style = DrawStyle.initial(settings) }
    image = nil
    frozen.layer?.contents = nil
    sel = preset
    history = ShapeHistory()
    drawing = nil
    drag = nil
    tool = nil
    styleOpen = false
    endText(commit: false)
    let theme = Theme.from(settings.appearance)
    for bar in [actionsBar!, toolsBar!, styleBar!] { bar.theme = theme }
    refreshToolbars()
    chrome.needsDisplay = true
  }

  func setImage(_ img: CGImage?) {
    image = img
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    frozen.layer?.contents = img
    CATransaction.commit()
    chrome.needsDisplay = true
  }

  /** Capture mode closed: drop everything so the next show can't flash this one. */
  func clear() {
    endText(commit: false)
    image = nil
    frozen.layer?.contents = nil
    sel = nil
    history = ShapeHistory()
    drawing = nil
    drag = nil
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /** Another display started a selection. */
  func clearSelection() {
    guard sel != nil else { return }
    endText(commit: false)
    sel = nil
    history = ShapeHistory()
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /** The output for this selection, or nil when there's nothing to output yet. */
  func renderOutput() -> CGImage? {
    endText(commit: true)
    guard let image, let sel, sel.w >= 1, sel.h >= 1 else { return nil }
    return Output.render(image: image, sel: sel, scale: imageScale, shapes: shapes)
  }

  // MARK: - Toolbars

  private func visible(_ kind: Feature.Kind) -> [Feature] {
    settings.visibleFeatures(kind).filter(\.native)
  }

  private func refreshToolbars() {
    let show = sel != nil && image != nil && !isCreating
    actionsBar.isHidden = !show
    toolsBar.isHidden = !show
    styleBar.isHidden = !(show && (styleOpen || tool != nil))
    guard show, let sel else { return }

    actionsBar.items = visible(.action).map { .button(id: $0.id, icon: $0.id, tip: tip($0)) }
    toolsBar.items = visible(.tool).map { f in
      f.id == "color" ? .swatch(id: f.id, color: tool == "text" ? style.textColor : style.color, tip: f.label) : .button(id: f.id, icon: f.id, tip: tip(f))
    }
    toolsBar.active = Set([tool, styleOpen ? "color" : nil].compactMap { $0 })
    toolsBar.disabled = Set([history.canUndo ? nil : "undo", history.canRedo ? nil : "redo"].compactMap { $0 })

    let colors = settings.annotate.palette
    let current = tool == "text" ? style.textColor : style.color
    var items: [ToolbarView.Item] = colors.map { .swatch(id: "color:\($0)", color: $0, tip: $0) }
    if tool != "text" {
      items.append(.separator)
      let widths = settings.annotate.strokeWidths
      for (k, w) in widths.enumerated() {
        items.append(.width(id: "width:\(k)", dot: CGFloat(4 + k * 3), tip: "\(["Thin", "Medium", "Thick"][min(k, 2)]) (\(Int(w)) px)"))
      }
    }
    styleBar.items = items
    styleBar.active = Set(["color:\(current)", "width:\(style.widthIndex)"])

    let l = OverlayLayout.placeToolbars(sel: sel, screen: screenSize, actions: LSize(actionsBar.size), tools: LSize(toolsBar.size))
    actionsBar.setFrameOrigin(l.actions)
    toolsBar.setFrameOrigin(l.tools)
    let p = OverlayLayout.placeStyleBar(actions: LRect(actionsBar.frame), tools: LRect(toolsBar.frame), bar: LSize(styleBar.size), screen: screenSize)
    styleBar.setFrameOrigin(p)
  }

  private func tip(_ f: Feature) -> String {
    let key = f.drawing ? (settings.toolKeys[f.id] ?? f.hint)?.uppercased() : f.hint
    var t = key.map { "\(f.label) (\($0))" } ?? f.label
    if let note = f.tipNote { t += "\n\(note)" }
    return t
  }

  private func press(_ id: String) {
    delegate?.overlayActivity(self)
    if id.hasPrefix("color:") {
      let c = String(id.dropFirst(6))
      if tool == "text" { OverlayView.style?.textColor = c } else { OverlayView.style?.color = c }
      if let tv = textView { tv.textColor = NSColor(hex: c) }
    } else if id.hasPrefix("width:") {
      OverlayView.style?.widthIndex = Int(id.dropFirst(6)) ?? 0
    } else {
      run(id)
    }
    refreshToolbars()
  }

  /** A toolbar action or tool, by feature id. */
  func run(_ id: String) {
    switch id {
    case "copy": delegate?.overlayCopy(self)
    case "save": delegate?.overlaySave(self)
    case "close": delegate?.overlayCancel(self)
    case "undo":
      endText(commit: true)
      history.undo()
    case "redo": history.redo()
    case "color": styleOpen.toggle()
    default:
      guard Features.byId(id)?.drawing == true else { return }
      endText(commit: true)
      tool = tool == id ? nil : id
    }
    refreshToolbars()
    chrome.needsDisplay = true
    window?.invalidateCursorRects(for: self)
  }

  // MARK: - Mouse

  private var isCreating: Bool { if case .create = drag { return true }; return false }

  private func point(_ e: NSEvent) -> CGPoint { convert(e.locationInWindow, from: nil) }

  private func handle(at p: CGPoint) -> Handle? {
    guard let sel else { return nil }
    return Handle.allCases.first {
      let h = OverlayLayout.handlePoint(sel, $0)
      return abs(h.x - p.x) <= 8 && abs(h.y - p.y) <= 8
    }
  }

  override func mouseDown(with e: NSEvent) {
    delegate?.overlayActivity(self)
    window?.makeFirstResponder(self)
    let p = point(e)
    guard image != nil else { return }
    if textView != nil {
      endText(commit: true)
      return
    }
    if let sel, let h = handle(at: p) {
      drag = .resize(origin: p, start: sel, handle: h)
    } else if let sel, let tool, sel.contains(p) {
      if tool == "text" {
        beginText(at: p)
        return
      }
      drag = .draw(origin: p)
      drawing = newShape(tool, at: p)
    } else if let sel, !sel.contains(p), !shapes.isEmpty {
      // Once something is drawn, a click outside keeps the selection (and the drawing).
      return
    } else if let sel, sel.contains(p) {
      drag = .move(origin: p, start: sel)
    } else {
      drag = .create(origin: p)
      sel = LRect(x: p.x, y: p.y, w: 0, h: 0)
      history = ShapeHistory()
      delegate?.overlaySelectionStarted(self)
    }
    refreshToolbars()
    chrome.needsDisplay = true
  }

  override func mouseDragged(with e: NSEvent) {
    delegate?.overlayActivity(self)
    let p = point(e)
    let shift = e.modifierFlags.contains(.shift)
    switch drag {
    case let .create(origin): sel = OverlayLayout.rectFromPoints(origin, p, screen: screenSize)
    case let .move(origin, start): sel = OverlayLayout.moveRect(start, dx: p.x - origin.x, dy: p.y - origin.y, screen: screenSize)
    case let .resize(origin, start, h): sel = OverlayLayout.resizeRect(start, handle: h, dx: p.x - origin.x, dy: p.y - origin.y, screen: screenSize)
    case let .draw(origin): if let d = drawing { drawing = extend(d, from: origin, to: p, shift: shift) }
    case nil: return
    }
    refreshToolbars()
    chrome.needsDisplay = true
  }

  override func mouseUp(with e: NSEvent) {
    defer {
      drag = nil
      refreshToolbars()
      chrome.needsDisplay = true
    }
    switch drag {
    case .create:
      // A click without a drag selects nothing.
      if let s = sel, s.w < 3 || s.h < 3 { sel = nil }
      if sel != nil {
        window?.makeFirstResponder(self)
        if settings.capture.quickCopy { DispatchQueue.main.async { self.delegate?.overlayCopy(self) } }
      }
    case .draw:
      if let d = drawing, Annotations.isMeaningful(d) { history.commit(shapes + [d]) }
      drawing = nil
    default: break
    }
  }

  override func rightMouseDown(with e: NSEvent) { delegate?.overlayActivity(self) }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .crosshair)
    guard let sel, image != nil else { return }
    if tool == nil {
      addCursorRect(sel.cg.insetBy(dx: 8, dy: 8), cursor: .openHand)
    }
    for h in Handle.allCases {
      let p = OverlayLayout.handlePoint(sel, h)
      let c: NSCursor = h == .n || h == .s ? .resizeUpDown : h == .e || h == .w ? .resizeLeftRight : .crosshair
      addCursorRect(CGRect(x: p.x - 8, y: p.y - 8, width: 16, height: 16), cursor: c)
    }
  }

  // MARK: - Drawing tools

  private var strokeWidth: Double {
    let w = settings.annotate.strokeWidths
    return w.indices.contains(style.widthIndex) ? w[style.widthIndex] : (w.first ?? 3)
  }

  private func newShape(_ tool: String, at p: CGPoint) -> Shape? {
    let id = Annotations.newId()
    switch tool {
    case "pen": return .stroke(.init(id: id, type: "pen", points: [p.x, p.y], color: style.color, width: strokeWidth))
    case "arrow":
      let both = settings.toolVariants["arrow"] == "arrow-both"
      return .line(.init(id: id, type: "arrow", points: [p.x, p.y, p.x, p.y], color: style.color, width: strokeWidth, bothEnds: both ? true : nil))
    case "rect": return .box(.init(id: id, type: "rect", x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: strokeWidth))
    default: return nil
    }
  }

  /** The shape being drawn, extended to `p` (Shift: straight line, 45°, square). */
  private func extend(_ s: Shape, from o: CGPoint, to p: CGPoint, shift: Bool) -> Shape {
    switch s {
    case var .stroke(v):
      if shift {
        v.points = [o.x, o.y, p.x, p.y]
      } else if v.points.count < 2 || v.points[v.points.count - 2] != p.x || v.points[v.points.count - 1] != p.y {
        v.points += [p.x, p.y] // only when the pointer moved, so a click stays a click
      }
      return .stroke(v)
    case var .line(v):
      let (dx, dy) = shift ? Annotations.snap45(p.x - o.x, p.y - o.y) : (p.x - o.x, p.y - o.y)
      v.points = [o.x, o.y, o.x + dx, o.y + dy]
      return .line(v)
    case var .box(v):
      let b = Annotations.boxFromDrag(o.x, o.y, p.x, p.y, square: shift)
      (v.x, v.y, v.w, v.h) = (b.x, b.y, b.w, b.h)
      return .box(v)
    default: return s
    }
  }

  // MARK: - Text

  private func textShape(_ text: String, at p: CGPoint) -> Shape.Text {
    let t = settings.annotate.text
    return Shape.Text(id: Annotations.newId(), x: p.x, y: p.y, text: text, color: style.textColor, fontSize: t.fontSize, fontFamily: t.fontFamily,
                      shadow: t.shadow, background: t.style == "background" ? t.background : "",
                      stroke: t.style == "stroke" ? t.strokeColor : "", strokeWidth: t.strokeWidth)
  }

  private func beginText(at p: CGPoint) {
    let probe = textShape("", at: p)
    let tv = NSTextView(frame: CGRect(x: p.x, y: p.y, width: 40, height: ceil(probe.fontSize * 1.3)))
    tv.font = ShapeDrawing.font(probe)
    tv.textColor = NSColor(hex: probe.color)
    tv.insertionPointColor = NSColor(hex: probe.color)
    tv.drawsBackground = false
    tv.isRichText = false
    tv.textContainerInset = .zero
    tv.textContainer?.lineFragmentPadding = 0
    tv.textContainer?.widthTracksTextView = false
    tv.textContainer?.containerSize = CGSize(width: 10_000, height: 10_000)
    tv.isHorizontallyResizable = true
    tv.isVerticallyResizable = true
    tv.delegate = self
    textOrigin = p
    textView = tv
    addSubview(tv)
    window?.makeFirstResponder(tv)
  }

  func textDidChange(_ notification: Notification) {
    guard let tv = textView else { return }
    tv.sizeToFit()
    tv.setFrameSize(CGSize(width: max(40, tv.frame.width + 4), height: tv.frame.height))
  }

  func textView(_ tv: NSTextView, doCommandBy selector: Selector) -> Bool {
    if selector == #selector(cancelOperation(_:)) {
      // Esc ends the text, not the capture.
      endText(commit: true)
      return true
    }
    return false
  }

  private func endText(commit: Bool) {
    guard let tv = textView else { return }
    textView = nil
    tv.removeFromSuperview()
    if commit {
      let s = Shape.text(textShape(tv.string, at: textOrigin))
      if Annotations.isMeaningful(s) { history.commit(shapes + [s]) }
    }
    window?.makeFirstResponder(self)
    refreshToolbars()
    chrome.needsDisplay = true
  }

  var isTyping: Bool { textView != nil }

  // MARK: - Keys

  override func keyDown(with e: NSEvent) {
    delegate?.overlayActivity(self)
    let mods = e.modifierFlags.intersection([.command, .shift, .option, .control])
    let key = e.charactersIgnoringModifiers?.lowercased() ?? ""
    let cmd = mods.contains(.command) || mods.contains(.control)
    switch e.keyCode {
    case 53: // Esc
      if styleOpen {
        styleOpen = false
        refreshToolbars()
      } else {
        delegate?.overlayCancel(self)
      }
      return
    case 36, 76: // Return, Enter
      delegate?.overlayCopy(self)
      return
    case 123, 124, 125, 126: // arrows: nudge the selection; Shift = 10 pt; Option = resize
      guard let s = sel else { return }
      let step: Double = mods.contains(.shift) ? 10 : 1
      let dx = e.keyCode == 123 ? -step : e.keyCode == 124 ? step : 0
      let dy = e.keyCode == 126 ? -step : e.keyCode == 125 ? step : 0
      sel = mods.contains(.option) ? OverlayLayout.resizeRect(s, handle: .se, dx: dx, dy: dy, screen: screenSize) : OverlayLayout.moveRect(s, dx: dx, dy: dy, screen: screenSize)
      refreshToolbars()
      chrome.needsDisplay = true
      return
    default: break
    }
    if cmd && key == "z" { run(mods.contains(.shift) ? "redo" : "undo"); return }
    if cmd && key == "y" { run("redo"); return }
    if cmd && key == "c" { delegate?.overlayCopy(self); return }
    if cmd && key == "s" { delegate?.overlaySave(self); return }
    if !cmd && !mods.contains(.option), sel != nil, let id = toolForKey(key) { run(id); return }
  }

  /** Letter → drawing tool, for the tools switched on (custom letters from Settings → Shortcuts first). */
  private func toolForKey(_ key: String) -> String? {
    guard key.count == 1 else { return nil }
    let tools = visible(.tool).filter(\.drawing)
    return tools.first { (settings.toolKeys[$0.id] ?? $0.hint ?? "").lowercased() == key }?.id
  }

  // MARK: - Painting (the chrome layer above the frozen image)

  fileprivate func paint(_ ctx: CGContext) {
    let s = settings.capture
    let dim = NSColor(hex: s.dimColor, alpha: s.dimOpacity)
    let full = bounds
    ctx.setFillColor(dim.cgColor)
    if let sel, sel.w > 0 || sel.h > 0 {
      let path = CGMutablePath()
      path.addRect(full)
      path.addRect(sel.cg)
      ctx.addPath(path)
      ctx.fillPath(using: .evenOdd)
    } else {
      ctx.fill(full)
    }
    guard let sel else { return }

    // Drawings, clipped to the selection.
    ctx.saveGState()
    ctx.clip(to: sel.cg)
    ShapeDrawing.draw(shapes + (drawing.map { [$0] } ?? []), in: ctx, pixelScale: window?.backingScaleFactor ?? 2)
    ctx.restoreGState()

    // Outline: 1.5 pt outside the selection (box-shadow 0 0 0 1.5px accent).
    ctx.setStrokeColor(NSColor(hex: s.accentColor).cgColor)
    ctx.setLineWidth(1.5)
    ctx.stroke(sel.cg.insetBy(dx: -0.75, dy: -0.75))

    do {
      for h in Handle.allCases {
        let p = OverlayLayout.handlePoint(sel, h)
        let r = CGRect(x: p.x - 6.5, y: p.y - 6.5, width: 13, height: 13)
        let path = CGPath(roundedRect: r, cornerWidth: 3, cornerHeight: 3, transform: nil)
        ctx.addPath(path)
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.fillPath()
        ctx.addPath(CGPath(roundedRect: r.insetBy(dx: -0.5, dy: -0.5), cornerWidth: 3.5, cornerHeight: 3.5, transform: nil))
        ctx.setStrokeColor(NSColor.black.withAlphaComponent(0.35).cgColor)
        ctx.setLineWidth(1)
        ctx.strokePath()
      }
    }

    if s.showSizeLabel {
      let scale = imageScale
      let text = "\(Int(jsRound(sel.w * scale))) × \(Int(jsRound(sel.h * scale)))"
      let font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
      let str = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white])
      let size = str.size()
      let box = CGRect(x: sel.x, y: sel.y >= 26 ? sel.y - 24 : sel.y + 6, width: ceil(size.width) + 12, height: ceil(size.height) + 6)
      ctx.addPath(CGPath(roundedRect: box, cornerWidth: 4, cornerHeight: 4, transform: nil))
      ctx.setFillColor(NSColor.rgba(20, 20, 22, 0.85).cgColor)
      ctx.fillPath()
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
      str.draw(at: CGPoint(x: box.minX + 6, y: box.minY + 3))
      NSGraphicsContext.restoreGraphicsState()
    }
  }
}

/** The dim, selection and drawings, above the frozen image. Clicks go through to the overlay view. */
private final class ChromeView: NSView {
  weak var owner: OverlayView?
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    owner?.paint(ctx)
  }
}

extension LSize {
  init(_ s: CGSize) { self.init(w: s.width, h: s.height) }
}
