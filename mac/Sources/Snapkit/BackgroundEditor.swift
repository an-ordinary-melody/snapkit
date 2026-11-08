import AppKit
import SnapkitCore

/** What the background editor asks capture mode for. */
protocol BackgroundEditorOwner: AnyObject {
  var settings: Settings { get }
  var beautify: BeautifyState { get }
  var compressOn: Bool { get }
  var compressPreset: String { get }
  var sel: LRect? { get }
  var imageScale: CGFloat { get }
  /** The drawing tool on, if any (for the cursor over the preview). */
  var tool: String? { get }
  /** The selection without drawings, at the output's resolution. */
  func plainCrop() -> CGImage?
  func setBeautify(_ s: BeautifyState)
  func setCompress(on: Bool, preset: String)
  /** Draw the drawings (and their frames) in selection coordinates. */
  func paintDrawings(_ ctx: CGContext, pixelScale: CGFloat)
  func editorPointer(_ phase: Int, _ p: CGPoint, _ e: NSEvent)
  func editorCopy()
  func editorSave()
  func editorClose()
  /** Output bytes before and after compressing, for the estimate. */
  func compressedSizes(preset: String) -> (before: Int, after: Int)?
}

/**
 * BackgroundEditor.tsx: a card over capture mode with the output previewed on a checkerboard (drawing
 * tools docked above it, so drawings can still be added and changed), and a sidebar for the background,
 * size, padding, corners, shadow and compression. Ctrl/⌘ + scroll or a pinch zooms; Space + drag pans.
 */
final class BackgroundEditorView: NSView {
  static let sidebar: CGFloat = 300
  weak var owner: BackgroundEditorOwner?
  var theme: Theme { didSet { rebuildSidebar() } }

  private var preview: CGImage?
  private var previewKey = ""
  private var zoom: CGFloat = 1
  /** Kept in range like Electron's scroll container: a zoomed preview's edges never come inside the stage's. */
  private var pan: CGPoint = .zero {
    didSet {
      guard let full, let owner else { return }
      let k = fit * zoom / owner.imageScale
      let w = full.width * k, h = full.height * k
      let x = w <= stage.width ? 0 : min(0, max(stage.width - w, pan.x))
      // Room above the preview and 24 pt below it scroll with it (.be-canvas).
      let y = min(0, max(min(0, stage.height - room - h - 24), pan.y))
      if x != pan.x || y != pan.y { pan = CGPoint(x: x, y: y) }
    }
  }
  private(set) var hand = false
  private var panFrom: CGPoint?
  /** Height of the docked bars, for the room above the preview. */
  var dockHeight: CGFloat = 0 { didSet { if dockHeight != oldValue { needsDisplay = true } } }

  private var sidebarViews: [NSView] = []
  private var sidebarKey = ""
  private var picker: (view: ColorPickerView, which: String)?
  private var estimate: (before: Int, after: Int)?
  private var estimateWork: DispatchWorkItem?

  init(owner: BackgroundEditorOwner, theme: Theme) {
    self.owner = owner
    self.theme = theme
    super.init(frame: .zero)
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Geometry

  var card: CGRect {
    let w = min(1180, bounds.width * 0.94), h = min(760, bounds.height * 0.9)
    return CGRect(x: ((bounds.width - w) / 2).rounded(), y: ((bounds.height - h) / 2).rounded(), width: w, height: h)
  }

  var stage: CGRect { CGRect(x: card.minX, y: card.minY, width: card.width - BackgroundEditorView.sidebar, height: card.height) }
  var side: CGRect { CGRect(x: stage.maxX, y: card.minY, width: BackgroundEditorView.sidebar, height: card.height) }
  private var room: CGFloat { max(112, dockHeight + 30) }

  /** The output's full layout at export scale (image px). */
  private var full: BeautifyLayout? {
    guard let owner, let sel = owner.sel else { return nil }
    let s = Double(owner.imageScale)
    let st = owner.beautify.on ? owner.beautify : owner.beautify.plain
    return BeautifyGeometry.layout(w: (sel.w * s).rounded(), h: (sel.h * s).rounded(), state: st, scale: s)
  }

  private var fit: CGFloat {
    guard let full, let owner else { return 0 }
    let s = owner.imageScale
    return min(1, (stage.width - 48) / (full.width / s), (stage.height - room - 24) / (full.height / s))
  }

  /** Where the whole output sits in the view (points). */
  var previewRect: CGRect {
    guard let full, let owner else { return .zero }
    let k = fit * zoom / owner.imageScale
    let w = full.width * k, h = full.height * k
    let x = w <= stage.width ? stage.midX - w / 2 : stage.minX
    return CGRect(x: (x + pan.x).rounded(), y: (stage.minY + room + pan.y).rounded(), width: w, height: h)
  }

  /** Selection coordinates → view: origin of the screenshot in the preview and points per selection point. */
  var transform: (origin: CGPoint, k: CGFloat) {
    guard let full, let owner, let sel = owner.sel, sel.w > 0 else { return (.zero, 1) }
    let pr = previewRect
    let f = pr.width / full.width
    return (CGPoint(x: pr.minX + full.x * f, y: pr.minY + full.y * f), full.drawW * f / sel.w)
  }

  func toSelection(_ p: CGPoint) -> CGPoint {
    guard let sel = owner?.sel else { return p }
    let t = transform
    return CGPoint(x: sel.x + (p.x - t.origin.x) / t.k, y: sel.y + (p.y - t.origin.y) / t.k)
  }

  private var maxZoom: CGFloat {
    guard let owner, fit > 0 else { return 1 }
    return max(1, min(8, 2 * owner.imageScale / (fit * (window?.backingScaleFactor ?? 2))))
  }

  func zoomTo(_ z: CGFloat, at p: CGPoint? = nil) {
    let next = min(maxZoom, max(1, z))
    let before = previewRect
    let anchor = p ?? CGPoint(x: before.midX, y: before.midY)
    let u = before.width > 0 ? (anchor.x - before.minX) / before.width : 0.5
    let v = before.height > 0 ? (anchor.y - before.minY) / before.height : 0.5
    zoom = next
    if zoom == 1 { pan = .zero } else {
      let after = previewRect
      pan.x += anchor.x - (after.minX + u * after.width)
      pan.y += anchor.y - (after.minY + v * after.height)
    }
    needsDisplay = true
    owner.map { _ in (superview as? OverlayView)?.editorMoved() }
  }

  var zoomLevel: CGFloat { zoom }

  // MARK: Rendering

  /** Re-render the preview when the state or the crop changes. */
  func refresh() {
    guard let owner else { return }
    let key = "\(owner.beautify)|\(owner.sel.map { "\($0)" } ?? "")"
    if key != previewKey || preview == nil {
      previewKey = key
      if let crop = owner.plainCrop() {
        let st = owner.beautify.on ? owner.beautify : owner.beautify.plain
        let bg = st.background(in: owner.settings.beautify.presets) ?? .solid(color: "#ffffff")
        preview = BeautifyRenderer.draw(crop, bg: bg, state: st, scale: owner.imageScale)
      }
      scheduleEstimate()
    }
    let k = sidebarStructureKey
    if k != sidebarKey { rebuildSidebar() } else { updateSidebarValues() }
    window?.invalidateCursorRects(for: self) // the tool or the preview may have changed
    needsDisplay = true
  }

  /** A new size (a display change while editing): lay the sidebar out again. */
  override func setFrameSize(_ size: NSSize) {
    super.setFrameSize(size)
    if owner != nil { refresh() }
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext, let owner else { return }
    theme.editorBackdrop.setFill()
    bounds.fill()
    let c = card
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.4)
    shadow.shadowBlurRadius = 80
    shadow.shadowOffset = NSSize(width: 0, height: -24)
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    theme.editorCard.setFill()
    NSBezierPath(roundedRect: c, xRadius: 14, yRadius: 14).fill()
    NSGraphicsContext.restoreGraphicsState()
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: c, cornerWidth: 14, cornerHeight: 14, transform: nil))
    ctx.clip()
    // Checkerboard stage.
    ctx.saveGState()
    ctx.clip(to: stage)
    theme.checkA.setFill()
    stage.fill()
    theme.checkB.setFill()
    var y = stage.minY
    var row = 0
    while y < stage.maxY {
      var x = stage.minX + (row % 2 == 0 ? 9 : 0)
      while x < stage.maxX {
        CGRect(x: x, y: y, width: 9, height: 9).fill()
        x += 18
      }
      y += 9
      row += 1
    }
    if let preview {
      ShapeDrawing.drawImage(preview, in: previewRect, ctx: ctx)
      // Drawings live on top, in the screenshot's place.
      let t = transform
      ctx.saveGState()
      let shot = CGRect(x: t.origin.x, y: t.origin.y, width: (owner.sel?.w ?? 0) * t.k, height: (owner.sel?.h ?? 0) * t.k)
      ctx.clip(to: shot)
      ctx.translateBy(x: t.origin.x, y: t.origin.y)
      ctx.scaleBy(x: t.k, y: t.k)
      if let sel = owner.sel { ctx.translateBy(x: -sel.x, y: -sel.y) }
      owner.paintDrawings(ctx, pixelScale: (window?.backingScaleFactor ?? 2) * t.k)
      ctx.restoreGState()
    }
    ctx.restoreGState()
    // Sidebar divider.
    theme.separator.setFill()
    CGRect(x: side.minX, y: side.minY, width: 1, height: side.height).fill()
    ctx.restoreGState()
    if zoom > 1 {
      let label = NSAttributedString(string: "\(Int((zoom * 100).rounded()))% · Fit", attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular), .foregroundColor: theme.foreground])
      let r = zoomButton(label.size().width)
      theme.strongBackground.setFill()
      NSBezierPath(roundedRect: r, xRadius: 13, yRadius: 13).fill()
      label.draw(at: CGPoint(x: r.minX + 10, y: r.midY - label.size().height / 2))
    }
  }

  private func zoomButton(_ textWidth: CGFloat) -> CGRect { CGRect(x: stage.minX + 12, y: stage.maxY - 12 - 26, width: textWidth + 20, height: 26) }

  // MARK: Mouse

  override func mouseDown(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if picker != nil { closePicker() }
    window?.makeFirstResponder(superview)
    if zoom > 1, zoomButton(60).contains(p) { zoomTo(1); return }
    guard stage.contains(p) else { return }
    if hand {
      panFrom = p
      NSCursor.closedHand.set()
      return
    }
    owner?.editorPointer(0, toSelection(p), e)
    needsDisplay = true
  }

  override func mouseDragged(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if let from = panFrom {
      pan.x += p.x - from.x
      pan.y += p.y - from.y
      panFrom = p
      needsDisplay = true
      (superview as? OverlayView)?.editorMoved()
      return
    }
    owner?.editorPointer(1, toSelection(p), e)
    needsDisplay = true
  }

  override func mouseUp(with e: NSEvent) {
    if panFrom != nil {
      panFrom = nil
      return
    }
    owner?.editorPointer(2, toSelection(convert(e.locationInWindow, from: nil)), e)
    needsDisplay = true
  }

  // A right-click in the editor must not cancel the capture behind it.
  override func rightMouseDown(with event: NSEvent) {}

  override func scrollWheel(with e: NSEvent) {
    guard e.modifierFlags.contains(.command) || e.modifierFlags.contains(.control) else {
      if zoom > 1 {
        pan.x += e.scrollingDeltaX
        pan.y += e.scrollingDeltaY
        needsDisplay = true
      }
      return
    }
    let d = e.scrollingDeltaY * (e.hasPreciseScrollingDeltas ? 1 : 40)
    zoomTo(zoom * min(1.25, max(0.8, exp(d * 0.002))), at: convert(e.locationInWindow, from: nil))
  }

  override func magnify(with e: NSEvent) { pinch(e.magnification, at: convert(e.locationInWindow, from: nil)) }

  /** A trackpad pinch: zoom by 1 + magnification around the fingers. */
  func pinch(_ magnification: CGFloat, at p: CGPoint) { zoomTo(zoom * (1 + magnification), at: p) }

  /** Space held: a hand over the preview instead of the drawing tools. */
  func setHand(_ on: Bool) {
    hand = on
    (on ? NSCursor.openHand : NSCursor.arrow).set()
    window?.invalidateCursorRects(for: self)
  }

  /** The arrow over the backdrop and sidebar; over the preview, the tool's cursor (or the hand). */
  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .arrow)
    if hand { return addCursorRect(stage, cursor: .openHand) }
    guard let tool = owner?.tool else { return }
    let c: NSCursor = tool == "text" ? .iBeam : tool == "step" ? Cursors.step : .crosshair
    addCursorRect(previewRect.intersection(stage), cursor: c)
  }

  /** Which cursor shows at a point (tests). */
  var testCursorName: (CGPoint) -> String {
    { p in
      if self.hand && self.stage.contains(p) { return "hand" }
      guard let tool = self.owner?.tool, self.previewRect.intersection(self.stage).contains(p) else { return "arrow" }
      return tool == "text" ? "ibeam" : tool == "step" ? "step" : "crosshair"
    }
  }

  // MARK: Sidebar

  private var bg: BeautifyBackground? { owner.flatMap { $0.beautify.background(in: $0.settings.beautify.presets) } }

  private var tab: String {
    switch bg {
    case .solid: return "solid"
    case .image: return "image"
    default: return "gradient"
    }
  }

  private var isCustomSize: Bool { if case .size = owner?.beautify.frame { return true }; return false }

  private var sidebarStructureKey: String { "\(tab)|\(isCustomSize)|\(owner?.compressOn ?? false)|\(theme.dark)|\(bounds.size)" }

  private func set(_ patch: (inout BeautifyState) -> Void) {
    guard let owner else { return }
    var s = owner.beautify
    patch(&s)
    s.on = true
    owner.setBeautify(s)
  }

  private func setBg(_ b: BeautifyBackground) { set { $0.background = b } }

  private static func randomGradient(_ angle: Double) -> BeautifyBackground {
    let h = Double.random(in: 0..<360)
    let from = HSV.hex(h: h, s: 0.45 + .random(in: 0..<0.3), v: 0.9 + .random(in: 0..<0.1))
    let to = HSV.hex(h: (h + 30 + .random(in: 0..<60)).truncatingRemainder(dividingBy: 360), s: 0.6 + .random(in: 0..<0.3), v: 0.65 + .random(in: 0..<0.3))
    return .gradient(from: from, to: to, angle: angle)
  }

  private static func randomColor() -> BeautifyBackground {
    .solid(color: HSV.hex(h: .random(in: 0..<360), s: 0.35 + .random(in: 0..<0.5), v: 0.6 + .random(in: 0..<0.4)))
  }

  /** Switching tabs carries the colour over, so the preview changes right away. */
  private func switchTab(_ t: String) {
    guard t != tab, t != "image" else { return }
    if t == "solid" {
      if case let .gradient(from, _, _) = bg { setBg(.solid(color: from)) } else { setBg(.solid(color: "#ffffff")) }
    } else if case let .solid(c) = bg {
      setBg(.gradient(from: c, to: HSV.shiftHue(c, 40), angle: 135))
    } else {
      setBg(Self.randomGradient(135))
    }
  }

  private var controls: [String: NSView] = [:]

  private func rebuildSidebar() {
    for v in sidebarViews { v.removeFromSuperview() }
    sidebarViews = []
    controls = [:]
    guard let owner else { return }
    sidebarKey = sidebarStructureKey
    let x = side.minX + 16
    let w = BackgroundEditorView.sidebar - 32
    var y = side.minY + 16
    func add(_ v: NSView, _ frame: CGRect, id: String? = nil) {
      v.frame = frame
      addSubview(v)
      sidebarViews.append(v)
      if let id { controls[id] = v }
    }
    func label(_ text: String, size: CGFloat = 12.5, weight: NSFont.Weight = .regular, color: NSColor? = nil, _ frame: CGRect, align: NSTextAlignment = .left, id: String? = nil) {
      let l = LabelView(text, font: .systemFont(ofSize: size, weight: weight), color: color ?? theme.foreground)
      l.align = align
      add(l, frame, id: id)
    }
    func section(_ text: String) {
      y += 14
      label(text.uppercased(), size: 11, weight: .semibold, color: theme.foregroundFaint, CGRect(x: x, y: y, width: w, height: 14))
      y += 14 + 10
    }

    // Head: Background + switch.
    label("Background", size: 14, weight: .semibold, CGRect(x: x, y: y, width: 160, height: 22))
    let sw = SwitchView(on: owner.beautify.on, theme: theme)
    sw.onToggle = { [weak self] on in
      guard let self, let o = self.owner else { return }
      var s = o.beautify
      s.on = on
      o.setBeautify(s)
    }
    add(sw, CGRect(x: x + w - 34 - 28, y: y + 1, width: 34, height: 20), id: "switch")
    y += 22 + 10 + 6

    // Tabs.
    let tabs = NSView(frame: CGRect(x: x, y: y, width: w, height: 34))
    tabs.wantsLayer = true
    tabs.layer?.cornerRadius = 9
    tabs.layer?.backgroundColor = theme.field.cgColor
    add(tabs, tabs.frame)
    let tw = (w - 6 - 8) / 3
    for (i, (id, title)) in [("gradient", "Gradient"), ("solid", "Color"), ("image", "Image")].enumerated() {
      let b = FlatButton(label: title, theme: theme)
      b.radius = 7
      b.tab = true
      b.onPress = { [weak self] in self?.switchTab(id) }
      b.frame = CGRect(x: 3 + CGFloat(i) * (tw + 4), y: 3, width: tw, height: 28)
      tabs.addSubview(b)
      controls["tab:\(id)"] = b
    }
    y += 34 + 10

    if tab == "gradient", case let .gradient(from, to, angle) = bg {
      colorField("from", "Start color", from, x: x, y: y, add: add)
      colorField("to", "End color", to, x: x + 116, y: y, add: add)
      let wand = FlatButton(label: "", icon: "beautifyEdit", theme: theme)
      wand.radius = 7
      wand.onPress = { [weak self] in
        guard let self, case let .gradient(_, _, a)? = self.bg else { return }
        self.setBg(Self.randomGradient(a))
      }
      add(wand, CGRect(x: x + w - 30, y: y, width: 30, height: 30), id: "wand")
      y += 30 + 10
      slider("hue", "Hue", 0, 359, HSV.from(from).h.rounded(), "\(Int(HSV.from(from).h.rounded()))°", x: x, y: y, w: w, rainbow: true, add: add, label: label) { [weak self] v in
        guard let self, case let .gradient(f, t, a)? = self.bg else { return }
        let d = v - HSV.from(f).h
        self.setBg(.gradient(from: HSV.shiftHue(f, d), to: HSV.shiftHue(t, d), angle: a))
      }
      y += 18 + 10
      slider("angle", "Angle", 0, 359, angle, "\(Int(angle))°", x: x, y: y, w: w, add: add, label: label) { [weak self] v in
        guard let self, case let .gradient(f, t, _)? = self.bg else { return }
        self.setBg(.gradient(from: f, to: t, angle: v))
      }
      y += 18 + 10
      let grid = SwatchGrid(swatches: owner.settings.beautify.gradients.map { .gradient($0.first ?? "#fff", $0.last ?? "#000", angle) }, width: w, theme: theme)
      grid.active = owner.settings.beautify.gradients.firstIndex { $0.first?.lowercased() == from.lowercased() && $0.last?.lowercased() == to.lowercased() }
      grid.onPick = { [weak self] i in
        guard let self, let o = self.owner, case let .gradient(_, _, a)? = self.bg else { return }
        let g = o.settings.beautify.gradients[i]
        self.setBg(.gradient(from: g.first ?? "#fff", to: g.last ?? "#000", angle: a))
      }
      add(grid, CGRect(x: x, y: y, width: w, height: grid.frame.height), id: "grid")
      y += grid.frame.height + 10
    } else if tab == "solid", case let .solid(color) = bg {
      colorField("solid", "Color", color, x: x, y: y, add: add)
      let wand = FlatButton(label: "", icon: "beautifyEdit", theme: theme)
      wand.radius = 7
      wand.onPress = { [weak self] in self?.setBg(Self.randomColor()) }
      add(wand, CGRect(x: x + w - 30, y: y, width: 30, height: 30), id: "wand")
      y += 30 + 10
      let grid = SwatchGrid(swatches: owner.settings.beautify.solids.map { .solid($0) }, width: w, theme: theme)
      grid.active = owner.settings.beautify.solids.firstIndex { $0.lowercased() == color.lowercased() }
      grid.onPick = { [weak self] i in
        guard let self, let o = self.owner else { return }
        self.setBg(.solid(color: o.settings.beautify.solids[i]))
      }
      add(grid, CGRect(x: x, y: y, width: w, height: grid.frame.height), id: "grid")
      y += grid.frame.height + 10
    }

    section("Size")
    let chips = ChipsView(items: Frame.presets.map { (id: $0.label, label: $0.label) } + [(id: "Custom", label: "Custom")], width: w, theme: theme)
    chips.active = activeFrameLabel
    chips.onPick = { [weak self] id in
      guard let self else { return }
      if id == "Custom" {
        guard !self.isCustomSize, let full = self.full else { return }
        self.set { $0.frame = .size(w: full.width.rounded(), h: full.height.rounded()) }
      } else if let f = Frame.presets.first(where: { $0.label == id }) {
        self.set { $0.frame = f.frame }
      }
    }
    add(chips, CGRect(x: x, y: y, width: w, height: chips.frame.height), id: "frames")
    y += chips.frame.height + 10
    if case let .size(fw, fh)? = owner.beautify.frame {
      for (i, (id, v)) in [("sizeW", fw), ("sizeH", fh)].enumerated() {
        let f = FieldView(text: String(Int(v)), monospace: false, theme: theme)
        f.onChange = { [weak self] t in
          guard let self, case let .size(cw, ch)? = self.owner?.beautify.frame else { return }
          let n = max(16, Double(t) ?? 16)
          self.set { $0.frame = i == 0 ? .size(w: n, h: ch) : .size(w: cw, h: n) }
        }
        add(f, CGRect(x: x + CGFloat(i) * 100, y: y, width: 80, height: 28), id: id)
      }
      label("×", color: theme.foregroundDim, CGRect(x: x + 86, y: y, width: 10, height: 28))
      label("px", color: theme.foregroundDim, CGRect(x: x + 186, y: y, width: 30, height: 28))
      y += 28 + 10
    }

    section("Layout")
    for (id, title, max, step) in [("padding", "Padding", 200.0, 1.0), ("radius", "Corners", 48.0, 1.0), ("shadow", "Shadow", 1.0, 0.01)] {
      let v = id == "padding" ? owner.beautify.padding : id == "radius" ? owner.beautify.radius : owner.beautify.shadow
      slider(id, title, 0, max, v, id == "shadow" ? "\(Int((v * 100).rounded()))%" : "\(Int(v))", x: x, y: y, w: w, step: step, add: add, label: label) { [weak self] v in
        self?.set { s in
          if id == "padding" { s.padding = v } else if id == "radius" { s.radius = v } else { s.shadow = v }
        }
      }
      y += 18 + 10
    }

    y += 14
    label("COMPRESS", size: 11, weight: .semibold, color: theme.foregroundFaint, CGRect(x: x, y: y + 3, width: 120, height: 14))
    let csw = SwitchView(on: owner.compressOn, theme: theme)
    csw.onToggle = { [weak self] on in
      guard let o = self?.owner else { return }
      o.setCompress(on: on, preset: o.compressPreset)
    }
    add(csw, CGRect(x: x + w - 34, y: y, width: 34, height: 20), id: "compress")
    y += 20 + 10
    if owner.compressOn {
      let presets = ChipsView(items: [(id: "standard", label: "Standard"), (id: "smallest", label: "Smallest")], width: w, theme: theme)
      presets.active = owner.compressPreset
      presets.onPick = { [weak self] id in
        guard let o = self?.owner else { return }
        o.setCompress(on: true, preset: id)
      }
      add(presets, CGRect(x: x, y: y, width: w, height: presets.frame.height), id: "compressPreset")
      y += presets.frame.height + 10
    }
    label(outputText, size: 11.5, color: theme.foregroundFaint, CGRect(x: x, y: y, width: w, height: 16), id: "output")

    // Actions at the bottom.
    let by = side.maxY - 16 - 32
    let bw = (w - 16) / 3
    for (i, (id, title, icon)) in [("save", "Save", "save"), ("copy", "Copy", "copy"), ("done", "Done", nil)].enumerated() {
      let b = FlatButton(label: title, icon: icon, theme: theme)
      b.primary = id == "done"
      b.onPress = { [weak self] in
        guard let o = self?.owner else { return }
        if id == "save" { o.editorSave() } else if id == "copy" { o.editorCopy() } else { o.editorClose() }
      }
      add(b, CGRect(x: x + CGFloat(i) * (bw + 8), y: by, width: bw, height: 32), id: id)
    }
    let close = FlatButton(label: "", icon: "close", theme: theme)
    close.radius = 6
    close.onPress = { [weak self] in self?.owner?.editorClose() }
    add(close, CGRect(x: card.maxX - 12 - 26, y: card.minY + 12, width: 26, height: 26), id: "close")
    updateSidebarValues()
  }

  private var activeFrameLabel: String {
    let f = owner?.beautify.frame ?? .auto
    if case .size = f { return "Custom" }
    return Frame.presets.first { $0.frame == f }?.label ?? "Auto"
  }

  private var outputText: String {
    guard let full, let owner else { return "" }
    let k = owner.compressOn && owner.compressPreset == "smallest" && owner.imageScale > 1 ? owner.imageScale : 1
    var t = "Output: \(Int((full.width / k).rounded())) × \(Int((full.height / k).rounded())) px"
    if owner.compressOn, let e = estimate { t += " · \(Self.bytes(e.after)) (was \(Self.bytes(e.before)))" }
    return t
  }

  static func bytes(_ n: Int) -> String { n >= 1024 * 1024 ? String(format: "%.1f MB", Double(n) / 1024 / 1024) : "\(max(1, Int((Double(n) / 1024).rounded()))) KB" }

  /** While Compress is on: the output's file size, worked out again shortly after anything changes. */
  private func scheduleEstimate() {
    estimate = nil
    estimateWork?.cancel()
    guard let owner, owner.compressOn else { return }
    let w = DispatchWorkItem { [weak self] in
      guard let self, let o = self.owner else { return }
      self.estimate = o.compressedSizes(preset: o.compressPreset)
      self.updateSidebarValues()
    }
    estimateWork = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: w)
  }

  func compressChanged() { scheduleEstimate(); refresh() }

  private func updateSidebarValues() {
    guard let owner else { return }
    (controls["switch"] as? SwitchView)?.on = owner.beautify.on
    (controls["compress"] as? SwitchView)?.on = owner.compressOn
    (controls["frames"] as? ChipsView)?.active = activeFrameLabel
    (controls["compressPreset"] as? ChipsView)?.active = owner.compressPreset
    (controls["output"] as? LabelView)?.text = outputText
    for (id, _) in [("gradient", 0), ("solid", 1), ("image", 2)] {
      guard let b = controls["tab:\(id)"] as? FlatButton else { continue }
      b.theme = theme
      b.alphaValue = id == "image" ? 0.6 : 1
      b.selected = id == tab
    }
    switch bg {
    case let .gradient(from, to, angle):
      (controls["from"] as? FlatButton)?.swatch = from
      (controls["to"] as? FlatButton)?.swatch = to
      if let f = controls["hex:from"] as? FieldView, f.currentEditor() == nil { f.stringValue = from.uppercased() }
      if let f = controls["hex:to"] as? FieldView, f.currentEditor() == nil { f.stringValue = to.uppercased() }
      (controls["slider:hue"] as? SliderView)?.value = HSV.from(from).h.rounded()
      (controls["value:hue"] as? LabelView)?.text = "\(Int(HSV.from(from).h.rounded()))°"
      (controls["slider:angle"] as? SliderView)?.value = angle
      (controls["value:angle"] as? LabelView)?.text = "\(Int(angle))°"
      if let g = controls["grid"] as? SwatchGrid {
        g.swatches = owner.settings.beautify.gradients.map { .gradient($0.first ?? "#fff", $0.last ?? "#000", angle) }
        g.active = owner.settings.beautify.gradients.firstIndex { $0.first?.lowercased() == from.lowercased() && $0.last?.lowercased() == to.lowercased() }
      }
    case let .solid(color):
      (controls["solid"] as? FlatButton)?.swatch = color
      if let f = controls["hex:solid"] as? FieldView, f.currentEditor() == nil { f.stringValue = color.uppercased() }
      (controls["grid"] as? SwatchGrid)?.active = owner.settings.beautify.solids.firstIndex { $0.lowercased() == color.lowercased() }
    default: break
    }
    for id in ["padding", "radius", "shadow"] {
      let v = id == "padding" ? owner.beautify.padding : id == "radius" ? owner.beautify.radius : owner.beautify.shadow
      (controls["slider:\(id)"] as? SliderView)?.value = v
      (controls["value:\(id)"] as? LabelView)?.text = id == "shadow" ? "\(Int((v * 100).rounded()))%" : "\(Int(v))"
    }
  }

  /** Swatch (opens the picker) + editable hex value. */
  private func colorField(_ which: String, _ title: String, _ color: String, x: CGFloat, y: CGFloat, add: (NSView, CGRect, String?) -> Void) {
    let b = FlatButton(label: "", theme: theme)
    b.swatch = color
    b.onPress = { [weak self] in self?.togglePicker(which) }
    add(b, CGRect(x: x, y: y, width: 30, height: 30), which)
    let f = FieldView(text: color.uppercased(), monospace: true, theme: theme)
    f.onChange = { [weak self] t in
      guard let c = HexColor.parse(t) else { return }
      self?.applyColor(which, c)
    }
    add(f, CGRect(x: x + 35, y: y, width: 74, height: 30), "hex:\(which)")
  }

  private func slider(_ id: String, _ title: String, _ min: Double, _ max: Double, _ value: Double, _ text: String, x: CGFloat, y: CGFloat, w: CGFloat,
                      step: Double = 1, rainbow: Bool = false, add: (NSView, CGRect, String?) -> Void,
                      label: (String, CGFloat, NSFont.Weight, NSColor?, CGRect, NSTextAlignment, String?) -> Void, onChange: @escaping (Double) -> Void) {
    label(title, 12.5, .regular, nil, CGRect(x: x, y: y, width: 62, height: 18), .left, nil)
    let s = SliderView(min: min, max: max, step: step, value: value, theme: theme)
    s.rainbow = rainbow
    s.onChange = onChange
    add(s, CGRect(x: x + 70, y: y, width: w - 70 - 48, height: 18), "slider:\(id)")
    label(text, 12.5, .regular, theme.foregroundDim, CGRect(x: x + w - 40, y: y, width: 40, height: 18), .right, "value:\(id)")
  }

  private func applyColor(_ which: String, _ c: String) {
    switch (which, bg) {
    case ("solid", _): setBg(.solid(color: c))
    case let ("from", .gradient(_, to, a)?): setBg(.gradient(from: c, to: to, angle: a))
    case let ("to", .gradient(from, _, a)?): setBg(.gradient(from: from, to: c, angle: a))
    default: break
    }
  }

  private func togglePicker(_ which: String) {
    if picker?.which == which { return closePicker() }
    closePicker()
    guard let anchor = controls[which] else { return }
    let color: String
    switch (which, bg) {
    case let ("solid", .solid(c)?): color = c
    case let ("from", .gradient(f, _, _)?): color = f
    case let ("to", .gradient(_, t, _)?): color = t
    default: color = "#ffffff"
    }
    let p = ColorPickerView(color: color, theme: theme)
    p.onChange = { [weak self] c in self?.applyColor(which, c) }
    p.onClose = { [weak self] in self?.closePicker() }
    let a = anchor.frame
    let below = a.maxY + 10 + p.frame.height <= bounds.height - 8
    p.setFrameOrigin(CGPoint(x: min(max(8, a.midX - p.frame.width / 2), bounds.width - p.frame.width - 8), y: below ? a.maxY + 10 : max(8, a.minY - 10 - p.frame.height)))
    addSubview(p)
    picker = (p, which)
  }

  func closePicker() {
    picker?.view.removeFromSuperview()
    picker = nil
  }

  var pickerOpen: Bool { picker != nil }

  /** Test hooks. */
  func press(_ id: String) {
    if let b = controls[id] as? FlatButton { b.onPress() }
    else if let s = controls[id] as? SwitchView { s.on.toggle(); s.onToggle(s.on) }
  }
  func pickChip(_ group: String, _ id: String) { (controls[group] as? ChipsView)?.onPick(id) }
  func pickSwatch(_ i: Int) { (controls["grid"] as? SwatchGrid)?.onPick(i) }
  func setSlider(_ id: String, _ v: Double) { (controls["slider:\(id)"] as? SliderView)?.onChange(v) }
  var outputLabel: String { (controls["output"] as? LabelView)?.text ?? "" }
  /** Sidebar controls shown, and whether each lies fully inside the editor (test hooks). */
  var controlIds: [String] { controls.filter { !$0.value.isHidden && $0.value.superview != nil }.keys.sorted() }
  var controlsOutside: [String] { controls.filter { !$0.value.isHidden && $0.value.superview != nil && !bounds.contains($0.value.convert($0.value.bounds, to: self)) }.keys.sorted() }
  var controlsInside: Bool { controls.values.filter { !$0.isHidden && $0.superview != nil }.allSatisfy { bounds.contains($0.convert($0.bounds, to: self)) } }
  var currentTab: String { tab }
}

