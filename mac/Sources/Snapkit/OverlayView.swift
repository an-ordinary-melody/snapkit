import AppKit
import SnapkitCore

/** What the capture controller does for a display's view. */
protocol OverlayViewDelegate: AnyObject {
  func overlaySelectionStarted(_ view: OverlayView)
  func overlayActivity(_ view: OverlayView)
  func overlayCopy(_ view: OverlayView)
  func overlaySave(_ view: OverlayView)
  func overlayCancel(_ view: OverlayView)
  /** A toolbar action the view doesn't handle itself (pin, beautify, beautifyEdit). */
  func overlayAction(_ view: OverlayView, _ id: String)
  /** Copy recognized text, then close capture mode after `closeAfter` seconds (so a message can show first). */
  func overlayCopyText(_ view: OverlayView, _ text: String, closeAfter: Double)
  /** Leaving the editor of a stored capture (preview or history): keep the edits there. */
  func overlayEditDone(_ view: OverlayView)
  /** "Remember the last background used": this look becomes the default preset's. */
  func overlayRememberBackground(_ view: OverlayView, _ state: BeautifyState, _ bg: BeautifyBackground)
}

/**
 * Capture mode on one display (Overlay.tsx + AnnotationLayer.tsx): the frozen screen, the dim with the
 * selection cut out, handles and size label, the toolbars, and the drawings, which can be selected,
 * moved, resized and restyled. Coordinates are points from the display's top-left corner.
 */
final class OverlayView: NSView {
  weak var delegate: OverlayViewDelegate?

  private(set) var session = 0
  private(set) var settings = SettingsRules.defaults
  private(set) var image: CGImage?
  /** Image pixels per point. */
  var imageScale: CGFloat { scaleOverride ?? image.map { CGFloat($0.width) / max(1, bounds.width) } ?? (window?.backingScaleFactor ?? 2) }
  /** Editing a stored capture: its own image px per point (the crop isn't the screen). */
  private var scaleOverride: CGFloat?

  /** Background for this capture (starts from the settings; the toolbar button and the editor change it). */
  private(set) var beautify = BeautifyState(on: false, presetId: "", padding: 0, radius: 0, shadow: 0)
  private static var lastBeautify: BeautifyState?
  private static var beautifyBasis: Settings.Beautify?
  /** Compress for this capture (the editor's switch; starts from the setting). */
  private(set) var compressOn = false
  private(set) var compressPreset = "standard"
  /** Floating preview after copy for this capture (the pin button; the controller owns it). */
  var floating = false { didSet { if floating != oldValue { refreshToolbars() } } }
  private(set) var editorOpen = false
  /** Editing a floating preview or a history entry: the editor is all there is. */
  private(set) var editMode = false
  private var editor: BackgroundEditorView?
  private var dockBar: ToolbarView!

  private(set) var sel: LRect?
  private(set) var history = ShapeHistory()
  private var draft: Shape?
  private(set) var tool: String?
  private(set) var selectedId: String?
  private var guides: [Annotations.Guide] = []
  private var liveBlur: (id: String, rect: LRect)?
  /** Text being typed (new, or an existing text shape being edited). */
  private(set) var editing: Shape.Text?
  private var textEditor: TextEditorView?
  /** "Capture text": the area drawn is read right away (no editing step). */
  private(set) var textOnly = false
  enum OcrState {
    case reading
    case result([TextRecognition.Line], ms: Int)
  }
  /** Text recognition: reading, or the lines found (shown over the selection, with the text panel). */
  private(set) var ocr: OcrState?
  private var ocrPanel: OcrPanelView?
  /** A short message over the screen (e.g. "Copied 3 lines of text"). */
  private(set) var note: String?
  private var noteWork: DispatchWorkItem?
  /** Buttons showing an "on" dot (and highlighted): Background on, floating preview on. */
  var lit: Set<String> { Set([beautify.on ? "beautify" : nil, floating ? "pin" : nil].compactMap { $0 }) }
  var tips: [String: (text: String, sub: String?)] {
    ["pin": (floating ? "Floating preview: on" : "Floating preview: off", "Keep the result in a corner after copying"),
     "beautify": (beautify.on ? "Background: on" : "Background: off", "Automatically add background")]
  }

  /** Style and tool variant picks survive between captures until Snapkit quits (Overlay.tsx lastStyle / lastVariants). */
  private static var lastStyle: Style?
  private static var lastStyleBasis: Settings?
  private static var lastVariants: [String: String]?
  /** Custom colours picked this session, newest first. */
  private static var recentCustom: [String] = []

  private(set) var style = Style.initial(SettingsRules.defaults)
  private(set) var variants: [String: String] = [:]

  private enum Drag {
    case create(origin: CGPoint)
    case move(origin: CGPoint, start: LRect)
    case resize(origin: CGPoint, start: LRect, handle: Handle)
    case draw(origin: CGPoint)
    case shapeMove(id: String, origin: CGPoint, start: Shape, moved: Bool, clickEdits: Bool)
    case shapeResize(id: String, origin: CGPoint, start: Shape, box: CGRect, handle: Handle)
    case lineEnd(id: String, index: Int, start: Shape)
  }
  private var drag: Drag?

  private let frozen = NSView()
  private let chrome = ChromeView()
  private var actionsBar: ToolbarView!
  private var toolsBar: ToolbarView!
  private var styleBar: ToolbarView!
  private var theme = Theme.from(SettingsRules.defaults.appearance)
  private var tooltip: TooltipView?
  private var tooltipWork: DispatchWorkItem?
  private var variantMenu: (view: VariantMenuView, feature: String)?
  private var picker: (view: ColorPickerView, kind: String)?
  private var sizeField: SizeField?
  private var blurSlider: SliderView?
  private let blurValue = ValueLabel()

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
    actionsBar = ToolbarView(vertical: false, theme: theme)
    toolsBar = ToolbarView(vertical: true, theme: theme)
    styleBar = ToolbarView(vertical: false, button: 28, theme: theme)
    dockBar = ToolbarView(vertical: false, theme: theme)
    for bar in [actionsBar!, toolsBar!, styleBar!, dockBar!] {
      bar.isHidden = true
      bar.onPress = { [weak self, weak bar] id in self?.press(id, in: bar) }
      bar.onRightClick = { [weak self, weak bar] id in self?.rightClick(id, in: bar) }
      bar.onHover = { [weak self, weak bar] id in self?.hover(id, in: bar) }
      bar.backdrop = { [weak self] v in self?.glassBackdrop(for: v) }
      addSubview(bar)
    }
  }

  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  var screenSize: LSize { LSize(w: bounds.width, h: bounds.height) }
  var shapes: [Shape] { history.present }
  var selectedShape: Shape? { shapes.first { $0.id == selectedId } }
  var isTyping: Bool { editing != nil }
  /** The box shown while typing (test hooks drag its frame). */
  var textEditorView: NSView? { textEditor }

  var renderEnv: RenderEnv {
    var env = RenderEnv(settings: settings, source: image, imageScale: imageScale, pixelScale: window?.backingScaleFactor ?? 2)
    env.liveBlur = liveBlur
    return env
  }

  // MARK: - Lifecycle (called by CaptureController)

  /** A new capture: dim over the live screen until the image arrives. */
  func arm(session: Int, settings: Settings, preset: LRect? = nil, textOnly: Bool = false) {
    self.session = session
    self.settings = settings
    self.textOnly = textOnly
    clearOcr()
    setNote(nil)
    // New defaults from the settings window win over this session's picks.
    if OverlayView.lastStyle == nil || OverlayView.lastStyleBasis?.annotate != settings.annotate {
      OverlayView.lastStyle = Style.initial(settings)
    }
    if OverlayView.lastVariants == nil || OverlayView.lastStyleBasis?.toolVariants != settings.toolVariants {
      OverlayView.lastVariants = settings.toolVariants
    }
    OverlayView.lastStyleBasis = settings
    if OverlayView.beautifyBasis != settings.beautify {
      OverlayView.beautifyBasis = settings.beautify
      OverlayView.lastBeautify = nil
    }
    beautify = BeautifyState.initial(settings, last: OverlayView.lastBeautify)
    compressOn = settings.compress.enabled
    compressPreset = settings.compress.preset
    floating = settings.pin.afterCopy
    scaleOverride = nil
    editMode = false
    closeEditorView()
    style = OverlayView.lastStyle!
    variants = OverlayView.lastVariants!
    image = nil
    frozen.layer?.contents = nil
    sel = preset
    history = ShapeHistory()
    draft = nil
    drag = nil
    tool = nil
    selectedId = nil
    guides = []
    finishEditing(commit: false)
    closePopovers()
    theme = Theme.from(settings.appearance)
    for bar in [actionsBar!, toolsBar!, styleBar!, dockBar!] { bar.theme = theme }
    refreshToolbars()
    chrome.needsDisplay = true
    invalidateCursors()
  }

  func setImage(_ img: CGImage?) {
    image = img
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    frozen.layer?.contents = img
    CATransaction.commit()
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /**
   * Reopen a stored capture (floating preview or history) straight into the background editor: the
   * crop is the whole "screen", selected.
   */
  func armEdit(session: Int, settings: Settings, doc: CaptureDoc, crop: CGImage) {
    arm(session: session, settings: settings)
    scaleOverride = CGFloat(doc.scale)
    editMode = true
    floating = true
    if let b = try? doc.beautify.decode(BeautifyState.self) { beautify = b }
    setImage(crop)
    sel = LRect(x: 0, y: 0, w: Double(doc.width) / doc.scale, h: Double(doc.height) / doc.scale)
    history = ShapeHistory(present: doc.shapes)
    openEditor()
  }

  /** Capture mode closed: drop everything so the next show can't flash this one. */
  func clear() {
    closeEditorView()
    editMode = false
    clearOcr()
    setNote(nil)
    finishEditing(commit: false)
    closePopovers()
    image = nil
    frozen.layer?.contents = nil
    sel = nil
    history = ShapeHistory()
    draft = nil
    drag = nil
    selectedId = nil
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /** Another display started a selection. */
  /** Another display took the area: everything that belonged to it here goes (drawings, undo, tool, text read, editor). */
  func clearSelection() {
    guard sel != nil else { return }
    finishEditing(commit: false)
    closePopovers()
    closeEditorView()
    clearOcr()
    setNote(nil)
    sel = nil
    history = ShapeHistory()
    selectedId = nil
    tool = nil
    draft = nil
    drag = nil
    refreshToolbars()
    chrome.needsDisplay = true
    invalidateCursors()
  }

  /** Select an area programmatically (Capture last area, tests). */
  func setSelection(_ r: LRect?) {
    sel = r
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /** Replace the drawings (reopening a capture document). */
  func setShapes(_ list: [Shape]) {
    history = ShapeHistory(present: list)
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /** The output for this selection, or nil when there's nothing to output yet. */
  func renderOutput() -> CGImage? {
    finishEditing(commit: true)
    selectedId = nil
    guard let image, let sel, sel.w >= 1, sel.h >= 1 else { return nil }
    var env = renderEnv
    env.liveBlur = nil
    guard let out = Output.render(image: image, sel: sel, scale: imageScale, shapes: shapes, env: env) else { return nil }
    guard beautify.on, let bg = beautify.background(in: settings.beautify.presets) else { return out }
    // "Remember the last background used": this one becomes the default.
    if settings.beautify.rememberLast { delegate?.overlayRememberBackground(self, beautify, bg) }
    return BeautifyRenderer.draw(out, bg: bg, state: beautify, scale: imageScale)
  }

  /** The background state as stored in a capture document. */
  var beautifyJSON: JSON { (try? JSON.encode(beautify)) ?? .null }

  /** The plain screenshot crop (no drawings), for text recognition and re-editing. */
  func renderPlain() -> CGImage? {
    guard let image, let sel, sel.w >= 1, sel.h >= 1 else { return nil }
    return Output.render(image: image, sel: sel, scale: imageScale, shapes: [], env: renderEnv)
  }

  // MARK: - Shapes

  private func commit(_ next: [Shape], mergeKey: String? = nil) {
    history.commit(next, mergeKey: mergeKey)
    refreshToolbars()
    chrome.needsDisplay = true
  }

  private func upsert(_ s: Shape) -> [Shape] {
    shapes.contains { $0.id == s.id } ? shapes.map { $0.id == s.id ? s : $0 } : shapes + [s]
  }

  private func select(_ id: String?) {
    selectedId = id
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /** Shapes drawn now: the history, with the text being typed shown live, and the shape being drawn. */
  fileprivate var visibleShapes: [Shape] {
    var list = shapes
    if let e = editing {
      if let i = list.firstIndex(where: { $0.id == e.id }) { list[i] = .text(e) } else { list.append(.text(e)) }
    }
    if let d = draft { list.append(d) }
    return list
  }

  // MARK: - Toolbars

  private func visible(_ kind: Feature.Kind) -> [Feature] {
    settings.visibleFeatures(kind).filter(\.native)
  }

  private var showToolbars: Bool {
    guard let sel, image != nil, sel.w >= 4, sel.h >= 4, !textOnly else { return false }
    // The text panel takes the toolbars' place while it's open.
    if ocrPanel != nil { return false }
    switch drag {
    case .create, .move, .resize: return false
    default: return true
    }
  }

  /** The style bar edits the selected shape, else the text being typed, else the active tool. */
  private var styleTarget: String? {
    if let s = selectedShape { return s.type }
    if let e = editing { return e.type }
    return tool
  }

  private var targetFilled: Bool {
    if let s = selectedShape, case let .box(b) = s { return b.filled == true }
    return tool.flatMap { variants[$0] }?.hasSuffix("-filled") ?? false
  }

  /** The style the bar shows: a selected shape's own values over the current style. */
  private var shownStyle: Style {
    selectedShape?.style(over: style, widths: settings.annotate.strokeWidths) ?? style
  }

  func refreshToolbars() {
    if editorOpen {
      refreshDock()
      return
    }
    dockBar.isHidden = true
    let show = showToolbars
    actionsBar.isHidden = !show
    toolsBar.isHidden = !show
    guard show, let sel else {
      styleBar.isHidden = true
      if variantMenu != nil || picker != nil { closePopovers() }
      return
    }
    actionsBar.items = visible(.action).map { f in
      let t = tips[f.id]
      return .button(id: f.id, icon: f.id, tip: t?.text ?? f.label, hint: f.hint, sub: t?.sub, dot: lit.contains(f.id))
    }
    actionsBar.active = lit
    let tools = visible(.tool)
    toolsBar.items = toolItems(tools)
    toolsBar.isHidden = tools.isEmpty
    toolsBar.active = Set([tool].compactMap { $0 })
    toolsBar.disabled = Set([history.canUndo ? nil : "undo", history.canRedo ? nil : "redo"].compactMap { $0 })

    buildStyleBar()

    let tSize = tools.isEmpty ? LSize(w: 0, h: 0) : LSize(toolsBar.size)
    let l = OverlayLayout.placeToolbars(sel: sel, screen: screenSize, actions: LSize(actionsBar.size), tools: tSize)
    actionsBar.setFrameOrigin(l.actions)
    toolsBar.setFrameOrigin(l.tools)
    if !styleBar.isHidden {
      let p = OverlayLayout.placeStyleBar(actions: LRect(actionsBar.frame), tools: LRect(x: l.tools.x, y: l.tools.y, w: tSize.w, h: tSize.h),
                                          bar: LSize(styleBar.size), screen: screenSize)
      styleBar.setFrameOrigin(p)
    }
    if let picker { placePicker(picker.view, kind: picker.kind) }
  }

  private func toolItems(_ tools: [Feature]) -> [ToolbarView.Item] {
    tools.map { f in
      if f.id == "color" {
        let s = shownStyle
        let c = styleTarget == "text" ? s.textColor : styleTarget == "highlighter" ? s.highlighterColor : styleTarget == "step" ? s.stepColor : s.color
        return .swatch(id: f.id, color: c, tip: f.label, round: false)
      }
      let variant = f.variants.first { $0.id == variants[f.id] } ?? f.variants.first
      let key = f.drawing ? (settings.toolKeys[f.id]?.uppercased() ?? f.hint) : f.hint
      let sub = [f.tipNote, f.variants.isEmpty ? nil : (f.variantsHint ?? "Right-click for more options")].compactMap { $0 }.joined(separator: " · ")
      return .button(id: f.id, icon: variant?.id ?? f.id, tip: variant?.label ?? f.label, hint: key, sub: sub.isEmpty ? nil : sub, more: !f.variants.isEmpty)
    }
  }

  /** In the editor: the drawing tools in a row with Copy, and the style bar under it, docked above the preview. */
  private func refreshDock() {
    guard let editor else { return }
    actionsBar.isHidden = true
    toolsBar.isHidden = true
    var items = toolItems(visible(.tool))
    if visible(.action).contains(where: { $0.id == "copy" }) {
      items += [.separator, .button(id: "copy", icon: "copy", tip: "Copy", hint: "⌘C")]
    }
    dockBar.items = items
    dockBar.active = Set([tool].compactMap { $0 })
    dockBar.disabled = Set([history.canUndo ? nil : "undo", history.canRedo ? nil : "redo"].compactMap { $0 })
    dockBar.isHidden = false
    buildStyleBar()
    let stage = editor.stage
    // Above the editor (and in front of it).
    for bar in [dockBar!, styleBar!] where bar.superview === self && subviews.last !== bar { addSubview(bar) }
    dockBar.setFrameOrigin(CGPoint(x: (stage.midX - dockBar.frame.width / 2).rounded(), y: stage.minY + 14))
    styleBar.setFrameOrigin(CGPoint(x: (stage.midX - styleBar.frame.width / 2).rounded(), y: dockBar.frame.maxY + 8))
    editor.dockHeight = dockBar.frame.height + (styleBar.isHidden ? 0 : styleBar.frame.height + 8)
    if let picker { placePicker(picker.view, kind: picker.kind); addSubview(picker.view) }
    if let t = textEditor { addSubview(t) }
    editor.needsDisplay = true
  }

  private func buildStyleBar() {
    guard let target = styleTarget, StyleTargets.hasOptions(target) else {
      styleBar.isHidden = true
      if picker != nil { closePicker() }
      return
    }
    styleBar.isHidden = false
    let s = shownStyle
    let a = settings.annotate
    var items: [ToolbarView.Item] = []
    var active: Set<String> = []
    if StyleTargets.colored.contains(target) {
      let palette = target == "highlighter" ? a.highlighterPalette : a.palette
      let current = colorOf(target, s).lowercased()
      let lower = palette.map { $0.lowercased() }
      var customs = OverlayView.recentCustom.filter { !lower.contains($0) }
      // A custom colour in use that isn't in the list yet still gets a swatch.
      if !lower.contains(current) && !customs.contains(current) { customs.insert(current, at: 0) }
      for c in palette { items.append(.swatch(id: "color:\(c.lowercased())", color: c, tip: c)) }
      // The highlighter keeps to its own few light colours: no custom ones.
      if target != "highlighter" {
        for c in customs { items.append(.swatch(id: "color:\(c)", color: c, tip: c)) }
        items.append(.customSwatch(id: "custom", tip: "Custom color"))
        if picker?.kind == "custom" { active.insert("custom") }
      }
      active.insert("color:\(current)")
    }
    if StyleTargets.stroked.contains(target) && !targetFilled {
      items.append(.separator)
      for i in 0..<3 { items.append(.width(id: "width:\(i)", dot: CGFloat(4 + i * 4), tip: ["Thin", "Medium", "Thick"][i])) }
      active.insert("width:\(s.widthIndex)")
    }
    if target == "text" {
      items.append(.separator)
      items.append(.button(id: "smaller", icon: "minus", tip: "Smaller text"))
      let field = sizeField ?? SizeField(value: s.fontSize, theme: theme)
      field.theme = theme
      if field.currentEditor() == nil { field.stringValue = String(Int(s.fontSize)) }
      field.onValue = { [weak self] v in self?.styleChange(StylePatch(fontSize: v)) }
      sizeField = field
      items.append(.view(id: "size", view: wrapped(field, CGSize(width: 38, height: 26)), width: 38))
      items.append(.button(id: "larger", icon: "plus", tip: "Larger text"))
      items.append(.separator)
      let look = TextLook.of(s)
      for l in TextLook.allCases { items.append(.glyph(id: "look:\(l.rawValue)", look: l, tip: l.label)) }
      active.insert("look:\(look.rawValue)")
      if look != .plain {
        items.append(.swatch(id: "textExtra", color: look == .stroke ? s.textStroke : s.textBackground, tip: look == .stroke ? "Stroke color" : "Background color"))
        if picker?.kind == "textExtra" { active.insert("textExtra") }
      }
    }
    if target == "blur" {
      items.append(.button(id: "blurMode:blur", icon: "waves", tip: "Blur"))
      items.append(.button(id: "blurMode:pixelate", icon: "grid", tip: "Pixelate"))
      active.insert("blurMode:\(s.blurMode)")
      items.append(.separator)
      let slider = blurSlider ?? SliderView(min: 0, max: 40, value: s.blurStrength, theme: theme)
      slider.theme = theme
      slider.value = s.blurStrength
      slider.onChange = { [weak self] v in self?.styleChange(StylePatch(blurStrength: v), continuous: true) }
      blurSlider = slider
      items.append(.view(id: "strength", view: wrapped(slider, CGSize(width: 96, height: 18)), width: 108))
      blurValue.text = String(Int(s.blurStrength))
      blurValue.color = theme.foreground
      items.append(.view(id: "strengthValue", view: blurValue, width: 22))
    }
    styleBar.items = items
    styleBar.active = active
  }

  private var wrappers: [ObjectIdentifier: Wrapped] = [:]
  private func wrapped(_ v: NSView, _ size: CGSize) -> Wrapped {
    if let w = wrappers[ObjectIdentifier(v)] { return w }
    let w = Wrapped(v, size: size)
    wrappers[ObjectIdentifier(v)] = w
    return w
  }

  private func colorOf(_ target: String, _ s: Style) -> String {
    switch StyleTargets.colorKey(target) {
    case "textColor": return s.textColor
    case "highlighterColor": return s.highlighterColor
    case "stepColor": return s.stepColor
    default: return s.color
    }
  }

  private func colorPatch(_ target: String, _ c: String) -> StylePatch {
    switch StyleTargets.colorKey(target) {
    case "textColor": return StylePatch(textColor: c)
    case "highlighterColor": return StylePatch(highlighterColor: c)
    case "stepColor": return StylePatch(stepColor: c)
    default: return StylePatch(color: c)
    }
  }

  /** A style bar change: the current style, the selected shape and the text being typed all follow it. */
  private func styleChange(_ patch: StylePatch, continuous: Bool = false) {
    style = style.applying(patch)
    OverlayView.lastStyle = style
    if var e = editing {
      e.color = patch.textColor ?? e.color
      e.fontSize = patch.fontSize ?? e.fontSize
      e.shadow = patch.shadow ?? e.shadow
      e.background = patch.textBackground ?? e.background
      e.stroke = patch.textStroke ?? e.stroke
      editing = e
      textEditor?.update(e)
    } else if let target = selectedShape {
      // A slider or picker drag is one undo step.
      let key = continuous ? "style:\(target.id):\(patch.keys)" : nil
      history.commit(upsert(target.restyled(patch, widths: settings.annotate.strokeWidths)), mergeKey: key)
    }
    refreshToolbars()
    chrome.needsDisplay = true
  }

  private func press(_ id: String, in bar: ToolbarView?) {
    delegate?.overlayActivity(self)
    if bar === styleBar {
      stylePress(id)
    } else {
      run(id)
    }
  }

  private func stylePress(_ id: String) {
    let target = styleTarget ?? ""
    if id.hasPrefix("color:") {
      styleChange(colorPatch(target, String(id.dropFirst(6))))
    } else if id.hasPrefix("width:") {
      styleChange(StylePatch(widthIndex: Int(id.dropFirst(6)) ?? 0))
    } else if id.hasPrefix("look:"), let look = TextLook(rawValue: String(id.dropFirst(5))) {
      styleChange(look.patch(shownStyle))
    } else if id.hasPrefix("blurMode:") {
      styleChange(StylePatch(blurMode: String(id.dropFirst(9))))
    } else if id == "smaller" {
      styleChange(StylePatch(fontSize: max(10, shownStyle.fontSize - 4)))
    } else if id == "larger" {
      styleChange(StylePatch(fontSize: min(200, shownStyle.fontSize + 4)))
    } else if id == "custom" || id == "textExtra" {
      picker?.kind == id ? closePicker() : openPicker(id)
    }
  }

  /** A toolbar action or tool, by feature id (also the tool letter keys and tests). */
  func run(_ id: String) {
    switch id {
    case "copy": delegate?.overlayCopy(self)
    case "save": delegate?.overlaySave(self)
    case "close": delegate?.overlayCancel(self)
    case "undo", "redo":
      finishEditing(commit: true)
      selectedId = nil
      if id == "undo" { history.undo() } else { history.redo() }
    case "ocr":
      readText()
    case "beautify":
      beautify.on.toggle()
      OverlayView.lastBeautify = beautify
    case "beautifyEdit":
      finishEditing(commit: true)
      selectedId = nil
      beautify.on = true
      OverlayView.lastBeautify = beautify
      openEditor()
    case "color":
      // The colour button opens the style bar's colour picker (when there's something to colour).
      if let t = styleTarget, StyleTargets.colored.contains(t), t != "highlighter" { openPicker("custom") }
    default:
      if Features.byId(id)?.drawing == true {
        finishEditing(commit: true)
        selectedId = nil
        tool = tool == id ? nil : id
      } else {
        delegate?.overlayAction(self, id)
      }
    }
    refreshToolbars()
    chrome.needsDisplay = true
    invalidateCursors()
  }

  // MARK: Popovers and tooltips

  private func rightClick(_ id: String, in bar: ToolbarView?) {
    guard let bar, bar === toolsBar || bar === dockBar, let f = Features.byId(id), !f.variants.isEmpty, let r = bar.frame(of: id) else { return }
    closePopovers()
    let menu = VariantMenuView(variants: f.variants, current: variants[id] ?? f.variants[0].id, theme: theme)
    menu.onPick = { [weak self] v in self?.pickVariant(id, v) }
    menu.backdrop = { [weak self] v in self?.glassBackdrop(for: v) }
    let anchor = bar.convert(r, to: self)
    menu.setFrameOrigin(popoverOrigin(anchor: anchor, vertical: bar.vertical, size: menu.frame.size, screen: bounds.size))
    addSubview(menu)
    variantMenu = (menu, id)
  }

  /** Pick a variant from a tool's right-click menu (also selects the tool). */
  func pickVariant(_ feature: String, _ variant: String) {
    closePopovers()
    finishEditing(commit: true)
    selectedId = nil
    tool = feature
    variants[feature] = variant
    OverlayView.lastVariants = variants
    refreshToolbars()
    invalidateCursors()
  }

  private func openPicker(_ kind: String) {
    if picker != nil { closePicker() }
    let s = shownStyle
    let target = styleTarget ?? ""
    let color = kind == "textExtra" ? (TextLook.of(s) == .stroke ? s.textStroke : s.textBackground) : colorOf(target, s)
    let p = ColorPickerView(color: color, theme: theme)
    p.backdrop = { [weak self] v in self?.glassBackdrop(for: v) }
    p.onChange = { [weak self] c in
      guard let self else { return }
      if kind == "textExtra" {
        let stroke = TextLook.of(self.shownStyle) == .stroke
        self.styleChange(stroke ? StylePatch(textStroke: c, textStrokeColor: c) : StylePatch(textColor: HexColor.readableOn(c), textBackground: c, textBgColor: c), continuous: true)
      } else {
        self.styleChange(self.colorPatch(target, c), continuous: true)
      }
    }
    p.onClose = { [weak self] in self?.closePicker() }
    addSubview(p)
    picker = (p, kind)
    refreshToolbars()
  }

  private func placePicker(_ p: ColorPickerView, kind: String) {
    guard let r = styleBar.frame(of: kind) else { return }
    let anchor = styleBar.convert(r, to: self)
    let gap: CGFloat = 10, m: CGFloat = 8
    let below = anchor.maxY + gap + p.frame.height <= bounds.height - m
    let y = below ? anchor.maxY + gap : max(m, anchor.minY - gap - p.frame.height)
    let x = min(max(m, anchor.midX - p.frame.width / 2), bounds.width - p.frame.width - m)
    p.setFrameOrigin(CGPoint(x: x, y: y))
  }

  private func closePicker() {
    guard let p = picker else { return }
    picker = nil
    p.view.removeFromSuperview()
    // A custom colour picked becomes a swatch for the rest of the session.
    if p.kind == "custom", let c = HexColor.parse(colorOf(styleTarget ?? "", shownStyle)), !settings.annotate.palette.map({ $0.lowercased() }).contains(c) {
      OverlayView.recentCustom = Array(([c] + OverlayView.recentCustom.filter { $0 != c }).prefix(4))
    }
    window?.makeFirstResponder(editing != nil ? textEditor : self)
    refreshToolbars()
  }

  private func closePopovers() {
    variantMenu?.view.removeFromSuperview()
    variantMenu = nil
    if picker != nil { closePicker() }
    hover(nil, in: nil)
  }

  var hasPopover: Bool { variantMenu != nil || picker != nil }
  var openPopover: String? { variantMenu.map { "variants:\($0.feature)" } ?? picker.map { "picker:\($0.kind)" } }

  private func hover(_ id: String?, in bar: ToolbarView?) {
    tooltipWork?.cancel()
    tooltip?.removeFromSuperview()
    tooltip = nil
    guard let id, let bar, variantMenu == nil, let item = bar.item(id), let tip = item.tip, let r = bar.frame(of: id) else { return }
    let work = DispatchWorkItem { [weak self, weak bar] in
      guard let self, let bar, !bar.isHidden else { return }
      let v = TooltipView(text: tip.text, hint: tip.hint, sub: tip.sub, theme: self.theme)
      let anchor = bar.convert(r, to: self)
      let gap: CGFloat = 8
      if bar.vertical {
        let right = anchor.maxX + gap + 200 < self.bounds.width
        v.setFrameOrigin(CGPoint(x: right ? anchor.maxX + gap : anchor.minX - gap - v.frame.width, y: anchor.midY - v.frame.height / 2))
      } else {
        let below = anchor.maxY + gap + 30 < self.bounds.height
        let cx = min(max(anchor.midX, 100), self.bounds.width - 100)
        v.setFrameOrigin(CGPoint(x: cx - v.frame.width / 2, y: below ? anchor.maxY + gap : anchor.minY - gap - v.frame.height))
      }
      self.addSubview(v)
      self.tooltip = v
    }
    tooltipWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
  }

  // MARK: - Mouse

  private func point(_ e: NSEvent) -> CGPoint { convert(e.locationInWindow, from: nil) }

  private func selectionHandle(at p: CGPoint) -> Handle? {
    guard let sel else { return nil }
    return Handle.allCases.first {
      let h = OverlayLayout.handlePoint(sel, $0)
      return abs(h.x - p.x) <= 8 && abs(h.y - p.y) <= 8
    }
  }

  /** The box the selection frame works on (Konva Transformer, strokes not included). */
  private func innerBox(_ s: Shape) -> CGRect {
    switch s {
    case let .box(b): return CGRect(x: b.x, y: b.y, width: b.w, height: b.h)
    default: return ShapeDrawing.bounds(s, scale: imageScale)
    }
  }

  /** The selected shape's frame: its box plus 6 pt padding. */
  private func frameBox(_ s: Shape) -> CGRect { innerBox(s).insetBy(dx: -6, dy: -6) }

  private func anchors(_ s: Shape) -> [(Handle, CGPoint)] {
    guard s.resizable else { return [] }
    let r = LRect(frameBox(s))
    let list: [Handle] = s.keepsRatio ? [.nw, .ne, .sw, .se] : Handle.allCases
    return list.map { ($0, OverlayLayout.handlePoint(r, $0)) }
  }

  private func lineEnds(_ s: Shape) -> [CGPoint] {
    guard case let .line(l) = s else { return [] }
    return [CGPoint(x: l.points[0], y: l.points[1]), CGPoint(x: l.points[2], y: l.points[3])]
  }

  /** Topmost shape under `p`. Blur areas only take clicks with no other drawing tool active. */
  private func shape(at p: CGPoint) -> Shape? {
    shapes.reversed().first { s in
      if case .blur = s, let tool, tool != "blur" { return false }
      return ShapeDrawing.hits(s, p, scale: imageScale)
    }
  }

  override func mouseDown(with e: NSEvent) { pointerDown(point(e), e) }
  override func mouseDragged(with e: NSEvent) {
    pointerDragged(point(e), e)
    updateCursor()
  }
  override func mouseUp(with e: NSEvent) { pointerUp(point(e), e) }

  private func pointerDown(_ p: CGPoint, _ e: NSEvent) {
    delegate?.overlayActivity(self)
    guard image != nil else { return }
    if hasPopover {
      closePopovers()
      refreshToolbars()
    }
    window?.makeFirstResponder(self)
    if editing != nil {
      // A click away from the text box finishes it rather than starting something new.
      finishEditing(commit: true)
      return
    }
    defer {
      refreshToolbars()
      chrome.needsDisplay = true
    }
    // "Capture text" has no adjusting step: every drag reads a new area.
    if textOnly {
      clearOcr()
      drag = .create(origin: p)
      sel = LRect(x: p.x, y: p.y, w: 0, h: 0)
      delegate?.overlaySelectionStarted(self)
      return
    }
    if ocr != nil { clearOcr() }
    let nearSelected = selectedShape.map { frameBox($0).insetBy(dx: -8, dy: -8).contains(p) } ?? false
    if editorOpen {
      // In the editor the screenshot is all there is: drawings only, the capture area stays.
      guard let sel, sel.contains(p) || nearSelected else {
        selectedId = nil
        return
      }
    }
    if let sel, sel.contains(p) || nearSelected {
      // The selected shape's own handles, then its frame.
      if let s = selectedShape {
        if let i = lineEnds(s).firstIndex(where: { hypot($0.x - p.x, $0.y - p.y) <= 9 }) {
          drag = .lineEnd(id: s.id, index: i, start: s)
          return
        }
        if let a = anchors(s).first(where: { abs($0.1.x - p.x) <= 7 && abs($0.1.y - p.y) <= 7 }) {
          drag = .shapeResize(id: s.id, origin: p, start: s, box: innerBox(s), handle: a.0)
          return
        }
        if frameBox(s).contains(p) {
          if e.clickCount >= 2, case let .text(t) = s {
            startEditing(t)
            return
          }
          drag = .shapeMove(id: s.id, origin: p, start: s, moved: false, clickEdits: s.type == "text")
          return
        }
      }
      if sel.contains(p), let s = shape(at: p) {
        if e.clickCount >= 2, case let .text(t) = s {
          startEditing(t)
          return
        }
        let wasSelected = selectedId == s.id
        selectedId = s.id
        // A click (not a drag) on text with the Text tool, or on text that's already selected, edits it.
        drag = .shapeMove(id: s.id, origin: p, start: s, moved: false, clickEdits: s.type == "text" && (tool == "text" || wasSelected))
        return
      }
      if sel.contains(p), selectionHandle(at: p) == nil, let tool {
        selectedId = nil
        startDraw(tool, at: p)
        return
      }
    }
    selectedId = nil
    if editorOpen { return }
    if let sel, let h = selectionHandle(at: p) {
      drag = .resize(origin: p, start: sel, handle: h)
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
  }

  private func pointerDragged(_ p: CGPoint, _ e: NSEvent) {
    delegate?.overlayActivity(self)
    let shift = e.modifierFlags.contains(.shift)
    switch drag {
    case let .create(origin): sel = OverlayLayout.rectFromPoints(origin, p, screen: screenSize)
    case let .move(origin, start): sel = OverlayLayout.moveRect(start, dx: p.x - origin.x, dy: p.y - origin.y, screen: screenSize)
    case let .resize(origin, start, h): sel = OverlayLayout.resizeRect(start, handle: h, dx: p.x - origin.x, dy: p.y - origin.y, screen: screenSize)
    case let .draw(origin): if let d = draft { draft = extend(d, from: origin, to: p, shift: shift) }
    case let .shapeMove(id, origin, start, _, clickEdits):
      var moved = start.moved(p.x - origin.x, p.y - origin.y)
      // Smart snap: edges and centres line up with other shapes and the capture area. ⌘ places freely.
      if !e.modifierFlags.contains(.command), let sel {
        let others = shapes.filter { $0.id != id }.map { LRect(ShapeDrawing.bounds($0, scale: imageScale)) }
        let r = Annotations.snapBox(LRect(ShapeDrawing.bounds(moved, scale: imageScale)), targets: others + [sel], threshold: 6)
        moved = moved.moved(r.dx, r.dy)
        guides = r.guides
      } else {
        guides = []
      }
      if case let .blur(b) = moved { liveBlur = (id, LRect(x: b.x, y: b.y, w: b.w, h: b.h)) }
      history.commit(upsert(moved), mergeKey: "move:\(id):\(origin)")
      drag = .shapeMove(id: id, origin: origin, start: start, moved: true, clickEdits: clickEdits)
    case let .shapeResize(id, origin, start, box, handle):
      var r = OverlayLayout.resizeRect(LRect(box), handle: handle, dx: p.x - origin.x, dy: p.y - origin.y, screen: LSize(w: 1e6, h: 1e6))
      r.w = max(1, r.w)
      r.h = max(1, r.h)
      var sx = r.w / max(1, box.width), sy = r.h / max(1, box.height)
      if start.keepsRatio {
        let k = max(sx, sy)
        (sx, sy) = (k, k)
        r.x = handle.rawValue.contains("w") ? box.maxX - box.width * k : box.minX
        r.y = handle.rawValue.contains("n") ? box.maxY - box.height * k : box.minY
      }
      let next = start.transformed(gx: r.x - box.minX * sx, gy: r.y - box.minY * sy, sx: sx, sy: sy)
      if case let .blur(b) = next { liveBlur = (id, LRect(x: b.x, y: b.y, w: b.w, h: b.h)) }
      history.commit(upsert(next), mergeKey: "resize:\(id):\(origin)")
    case let .lineEnd(_, index, start):
      if case var .line(l) = start {
        l.points[index * 2] = p.x
        l.points[index * 2 + 1] = p.y
        history.commit(upsert(.line(l)), mergeKey: "end:\(l.id):\(index):\(start)")
      }
    case nil: return
    }
    refreshToolbars()
    chrome.needsDisplay = true
  }

  private func pointerUp(_ p: CGPoint, _ e: NSEvent) {
    defer {
      drag = nil
      guides = []
      liveBlur = nil
      refreshToolbars()
      chrome.needsDisplay = true
      invalidateCursors()
    }
    switch drag {
    case .create:
      if let s = sel, s.w < 4 || s.h < 4 { sel = nil }
      if sel != nil, textOnly { DispatchQueue.main.async { self.readText() } }
      else if sel != nil, settings.capture.quickCopy { DispatchQueue.main.async { self.delegate?.overlayCopy(self) } }
    case .draw:
      if let d = draft, Annotations.isMeaningful(d) { history.commit(shapes + [d]) }
      draft = nil
    case let .shapeMove(id, _, _, moved, clickEdits):
      if !moved, clickEdits, case let .text(t)? = shapes.first(where: { $0.id == id }) { startEditing(t) }
    default: break
    }
  }

  override func rightMouseDown(with e: NSEvent) {
    // A right-click anywhere but the toolbars cancels the capture (as in Electron).
    if hasPopover {
      closePopovers()
      refreshToolbars()
      return
    }
    delegate?.overlayCancel(self)
  }

  /** New cursors for capture mode and, when it's open, the background editor. */
  func invalidateCursors() {
    window?.invalidateCursorRects(for: self)
    if let editor { window?.invalidateCursorRects(for: editor) }
    updateCursor()
  }

  /**
   * Capture mode's cursor at `p`, as Electron's: crosshair to make an area and to draw; the move
   * arrows inside the area with no tool, over drawings and while moving; resize arrows on the handles;
   * the I-beam for Text and the pin for Steps.
   */
  func cursorName(at p: CGPoint) -> String {
    switch drag {
    case .move?, .shapeMove?: return "move"
    case let .resize(_, _, h)?, let .shapeResize(_, _, _, _, h)?: return Cursors.resizeName(h)
    case .some: return "crosshair"
    case nil: break
    }
    guard let sel, image != nil, !textOnly else { return "crosshair" }
    for h in Handle.allCases {
      let c = OverlayLayout.handlePoint(sel, h)
      if abs(c.x - p.x) <= 8 && abs(c.y - p.y) <= 8 { return Cursors.resizeName(h) }
    }
    guard sel.contains(p) else { return "crosshair" }
    if editing == nil, shape(at: p) != nil { return "move" }
    return tool == "text" ? "ibeam" : tool == "step" ? "step" : tool != nil ? "crosshair" : "move"
  }

  override func resetCursorRects() {
    // The background editor covers capture mode and sets its own cursors.
    if editorOpen { return }
    addCursorRect(bounds, cursor: Cursors.named(cursorName(at: mouseInView)))
  }

  private var mouseInView: CGPoint {
    guard let window else { return .zero }
    return convert(window.mouseLocationOutsideOfEventStream, from: nil)
  }

  /**
   * Set as the pointer moves, not only through cursor rects: those only apply while Snapkit is the
   * active app, and capture mode's panel takes the keyboard without activating it.
   */
  private func updateCursor() {
    guard !editorOpen, let window, window.isVisible else { return }
    let hit = window.contentView?.hitTest(window.mouseLocationOutsideOfEventStream)
    guard hit === self || hit === frozen || hit === chrome else { return }
    Cursors.named(cursorName(at: mouseInView)).set()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for a in trackingAreas where a.owner === self { removeTrackingArea(a) }
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .cursorUpdate, .activeAlways, .inVisibleRect], owner: self))
  }

  override func mouseMoved(with e: NSEvent) { updateCursor() }
  override func cursorUpdate(with e: NSEvent) { updateCursor() }

  // MARK: - Drawing tools

  private var strokeWidth: Double {
    let w = settings.annotate.strokeWidths
    return w.indices.contains(style.widthIndex) ? w[style.widthIndex] : (w.count > 1 ? w[1] : 3)
  }

  private func startDraw(_ tool: String, at p: CGPoint) {
    let id = Annotations.newId()
    switch tool {
    case "step":
      commit(shapes + [.step(.init(id: id, x: p.x, y: p.y, size: settings.annotate.stepSize, color: style.stepColor))])
      return
    case "text":
      let pad = style.textBackground.isEmpty ? 0 : ShapeDrawing.textPad
      // The click is the middle of the first line, so the caret lands where you clicked.
      beginEditing(Shape.Text(id: id, x: p.x - pad, y: p.y - style.fontSize * ShapeDrawing.lineHeight / 2 - pad, text: "", color: style.textColor,
                              fontSize: style.fontSize, fontFamily: style.fontFamily, shadow: style.shadow, background: style.textBackground,
                              stroke: style.textStroke, strokeWidth: style.textStrokeWidth))
      return
    default: break
    }
    drag = .draw(origin: p)
    draft = makeShape(tool, id: id, from: p, to: p, shift: false)
  }

  /** The rectangle tool's last variant draws a line. */
  private func kind(of tool: String) -> String {
    tool == "rect" && variants["rect"] == "line" ? "line" : tool
  }

  private func makeShape(_ tool: String, id: String, from o: CGPoint, to p: CGPoint, shift: Bool) -> Shape? {
    let k = kind(of: tool)
    switch k {
    case "pen": return .stroke(.init(id: id, type: "pen", points: [o.x, o.y, p.x, p.y], color: style.color, width: strokeWidth))
    case "highlighter":
      return .stroke(.init(id: id, type: "highlighter", points: [o.x, o.y, p.x, p.y], color: style.highlighterColor, width: settings.annotate.highlighterWidth))
    case "line", "arrow", "ruler":
      let (dx, dy) = shift ? Annotations.snap45(p.x - o.x, p.y - o.y) : (p.x - o.x, p.y - o.y)
      // New arrows have an open head; the two-way style has one at each end.
      return .line(.init(id: id, type: k, points: [o.x, o.y, o.x + dx, o.y + dy], color: style.color, width: strokeWidth,
                         head: k == "arrow" ? "open" : nil, bothEnds: k == "arrow" && variants["arrow"] == "arrow-both" ? true : nil))
    case "rect", "ellipse":
      let v = variants[tool] ?? tool
      let b = Annotations.boxFromDrag(o.x, o.y, p.x, p.y, square: shift)
      return .box(.init(id: id, type: v.hasPrefix("ellipse") ? "ellipse" : "rect", x: b.x, y: b.y, w: b.w, h: b.h, color: style.color, width: strokeWidth,
                        filled: v.hasSuffix("-filled")))
    case "blur":
      let b = Annotations.boxFromDrag(o.x, o.y, p.x, p.y, square: shift)
      return .blur(.init(id: id, x: b.x, y: b.y, w: b.w, h: b.h, mode: style.blurMode, strength: style.blurStrength))
    default: return nil
    }
  }

  /** The shape being drawn, extended to `p` (Shift: straight line, 45°, square). */
  private func extend(_ s: Shape, from o: CGPoint, to p: CGPoint, shift: Bool) -> Shape {
    if case var .stroke(v) = s {
      if shift {
        v.points = [o.x, o.y, p.x, p.y]
      } else if v.points.count < 2 || v.points[v.points.count - 2] != p.x || v.points[v.points.count - 1] != p.y {
        v.points += [p.x, p.y] // only when the pointer moved, so a click stays a click
      }
      return .stroke(v)
    }
    return makeShape(tool ?? "", id: s.id, from: o, to: p, shift: shift) ?? s
  }

  // MARK: - Text

  private func startEditing(_ t: Shape.Text) {
    selectedId = nil
    beginEditing(t)
  }

  private func beginEditing(_ t: Shape.Text) {
    editing = t
    let ed = TextEditorView(shape: t, owner: self)
    textEditor = ed
    addSubview(ed, positioned: .below, relativeTo: actionsBar)
    // Focus once the click that made the box is over (it would end the empty box otherwise).
    DispatchQueue.main.async { ed.focus() }
    refreshToolbars()
    chrome.needsDisplay = true
  }

  fileprivate func textChanged(_ t: Shape.Text) {
    editing = t
    chrome.needsDisplay = true
    editor?.needsDisplay = true
  }

  /** Dragging the frame around the text box while typing: snaps like any shape (⌘: free). */
  fileprivate func textMoved(to origin: CGPoint, free: Bool) -> CGPoint {
    guard var t = editing, let sel else { return origin }
    t.x = origin.x
    t.y = origin.y
    var o = origin
    if !free {
      let others = shapes.filter { $0.id != t.id }.map { LRect(ShapeDrawing.bounds($0, scale: imageScale)) }
      let r = Annotations.snapBox(LRect(ShapeDrawing.textBox(t)), targets: others + [sel], threshold: 6)
      o.x += r.dx
      o.y += r.dy
      guides = r.guides
    } else {
      guides = []
    }
    t.x = o.x
    t.y = o.y
    editing = t
    chrome.needsDisplay = true
    editor?.needsDisplay = true
    return o
  }

  fileprivate func textMoveEnded() {
    guides = []
    chrome.needsDisplay = true
  }

  /** Commit (or drop) the text being typed. A kept text stays selected, ready to move or restyle. */
  func finishEditing(commit doCommit: Bool) {
    guard let t = editing else { return }
    editing = nil
    textEditor?.removeFromSuperview()
    textEditor = nil
    if doCommit {
      if Annotations.isMeaningful(.text(t)) {
        history.commit(upsert(.text(t)))
        selectedId = t.id
      } else if shapes.contains(where: { $0.id == t.id }) {
        history.commit(shapes.filter { $0.id != t.id })
      }
    }
    window?.makeFirstResponder(self)
    refreshToolbars()
    chrome.needsDisplay = true
  }

  /** Test hook: type into the text being edited. */
  func typeText(_ s: String) { textEditor?.type(s) }

  // MARK: - Keys

  override func keyDown(with e: NSEvent) {
    delegate?.overlayActivity(self)
    let mods = e.modifierFlags.intersection([.command, .shift, .option, .control])
    let key = e.charactersIgnoringModifiers?.lowercased() ?? ""
    let cmd = mods.contains(.command) || mods.contains(.control)
    switch e.keyCode {
    case 49 where editorOpen: // Space: the hand, to pan the zoomed preview
      editor?.setHand(true)
      return
    case 53 where editorOpen: // Esc in the editor: a picker, a selected shape, then the editor itself; never the capture.
      if editor?.pickerOpen == true { editor?.closePicker() }
      else if hasPopover { closePopovers(); refreshToolbars() }
      else if selectedId != nil { select(nil) }
      else { closeEditor() }
      return
    case 53: // Esc steps back one level: a menu or picker, the text found, a selected shape, then capture mode.
      if ocrPanel != nil || ocr != nil, !textOnly {
        clearOcr()
        refreshToolbars()
      } else if hasPopover {
        closePopovers()
        refreshToolbars()
      } else if selectedId != nil {
        select(nil)
      } else {
        delegate?.overlayCancel(self)
      }
      return
    case 51, 117: // Delete
      if let id = selectedId {
        selectedId = nil
        commit(shapes.filter { $0.id != id })
      }
      return
    case 36, 76: // Return / Enter (Capture text reads text only: nothing copies the image)
      if !textOnly { delegate?.overlayCopy(self) }
      return
    case 123, 124, 125, 126:
      let step: Double = mods.contains(.shift) ? 10 : 1
      let dx = e.keyCode == 123 ? -step : e.keyCode == 124 ? step : 0
      let dy = e.keyCode == 126 ? -step : e.keyCode == 125 ? step : 0
      if let s = selectedShape {
        commit(upsert(s.moved(dx, dy)))
      } else if let s = sel {
        // Arrows nudge the selection; Option resizes it instead.
        sel = mods.contains(.option) ? OverlayLayout.resizeRect(s, handle: .se, dx: dx, dy: dy, screen: screenSize) : OverlayLayout.moveRect(s, dx: dx, dy: dy, screen: screenSize)
        refreshToolbars()
        chrome.needsDisplay = true
      }
      return
    default: break
    }
    if editorOpen, cmd, ["0", "=", "+", "-"].contains(key) {
      if key == "0" { editor?.zoomTo(1) } else { editor?.zoomTo((editor?.zoomLevel ?? 1) * (key == "-" ? 0.8 : 1.25)) }
      return
    }
    if cmd && key == "z" { run(mods.contains(.shift) ? "redo" : "undo"); return }
    if cmd && key == "y" { run("redo"); return }
    if cmd && key == "," { delegate?.overlayAction(self, "settings"); return }
    // Capture text reads text only: no image copy or save, no drawing tools. A held key repeats: one output per press.
    if textOnly { return }
    if cmd && key == "c" { if !e.isARepeat { delegate?.overlayCopy(self) }; return }
    if cmd && key == "s" { if !e.isARepeat { delegate?.overlaySave(self) }; return }
    if !cmd && !mods.contains(.option), sel != nil, key == "x", visible(.action).contains(where: { $0.id == "ocr" }) {
      run("ocr")
      return
    }
    if !cmd && !mods.contains(.option), sel != nil, let id = toolForKey(key) { run(id); return }
  }

  override func keyUp(with e: NSEvent) {
    if e.keyCode == 49 { editor?.setHand(false) }
  }

  /** Letter → drawing tool, for the tools switched on (custom letters from Settings → Shortcuts first). */
  private func toolForKey(_ key: String) -> String? {
    guard key.count == 1 else { return nil }
    return visible(.tool).filter(\.drawing).first { (settings.toolKeys[$0.id] ?? $0.hint ?? "").lowercased() == key }?.id
  }

  // MARK: - Painting (the chrome layer above the frozen image)

  fileprivate func paint(_ ctx: CGContext) {
    let s = settings.capture
    if editorOpen {
      // The editor's backdrop goes over the dimmed screen.
      ctx.setFillColor(NSColor(hex: s.dimColor, alpha: s.dimOpacity).cgColor)
      ctx.fill(bounds)
      return
    }
    ctx.setFillColor(NSColor(hex: s.dimColor, alpha: s.dimOpacity).cgColor)
    if let sel, sel.w > 0 || sel.h > 0 {
      let path = CGMutablePath()
      path.addRect(bounds)
      path.addRect(sel.cg)
      ctx.addPath(path)
      ctx.fillPath(using: .evenOdd)
    } else {
      ctx.fill(bounds)
    }
    paintMessages(ctx)
    guard let sel else { return }

    // Drawings, clipped to the selection.
    ctx.saveGState()
    ctx.clip(to: sel.cg)
    ShapeDrawing.draw(visibleShapes, in: ctx, env: renderEnv)
    paintShapeUI(ctx)
    ctx.restoreGState()

    // Outline: 1.5 pt outside the selection.
    ctx.setStrokeColor(NSColor(hex: s.accentColor).cgColor)
    ctx.setLineWidth(1.5)
    ctx.stroke(sel.cg.insetBy(dx: -0.75, dy: -0.75))

    for h in Handle.allCases {
      let p = OverlayLayout.handlePoint(sel, h)
      let r = CGRect(x: p.x - 6.5, y: p.y - 6.5, width: 13, height: 13)
      ctx.addPath(CGPath(roundedRect: r, cornerWidth: 3, cornerHeight: 3, transform: nil))
      ctx.setFillColor(NSColor.white.cgColor)
      ctx.fillPath()
      ctx.addPath(CGPath(roundedRect: r.insetBy(dx: -0.5, dy: -0.5), cornerWidth: 3.5, cornerHeight: 3.5, transform: nil))
      ctx.setStrokeColor(NSColor.black.withAlphaComponent(0.35).cgColor)
      ctx.setLineWidth(1)
      ctx.strokePath()
    }

    paintOcr(ctx, sel: sel)

    if s.showSizeLabel && !textOnly {
      let scale = imageScale
      let text = "\(Int(jsRound(sel.w * scale))) × \(Int(jsRound(sel.h * scale)))"
      let str = NSAttributedString(string: text, attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular), .foregroundColor: NSColor.white])
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

  // MARK: - Text recognition

  /** Read the text in the selection (the screenshot only, not the drawings). */
  /** Bumped by every read and by anything that drops a read's result (Esc, a new capture or area): only the newest read counts. */
  private var readId = 0

  func readText() {
    guard let sel, image != nil, ocr == nil || textOnly else { return }
    finishEditing(commit: true)
    selectedId = nil
    tool = nil
    ocr = .reading
    refreshToolbars()
    chrome.needsDisplay = true
    guard let plain = renderPlain() else { return }
    readId += 1
    let session = self.session, read = readId
    TextRecognition.recognize(plain) { [weak self] result, ms in
      guard let self, self.session == session, self.readId == read, self.sel == sel else { return }
      switch result {
      case let .failure(err):
        self.ocr = nil
        self.setNote("Couldn't read the text: \(err.localizedDescription)")
      case let .success(lines):
        let text = lines.map(\.text).joined(separator: "\n")
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          self.ocr = nil
          self.setNote("No text found")
        } else if self.settings.ocr.textButton == "panel" {
          self.ocr = .result(lines, ms: ms)
          self.showOcrPanel(lines, ms: ms)
        } else {
          self.ocr = .result(lines, ms: ms)
          self.setNote("Copied \(lines.count) line\(lines.count == 1 ? "" : "s") of text")
          // Copied now; capture mode closes after the message.
          self.delegate?.overlayCopyText(self, text, closeAfter: 0.6)
        }
      }
      self.refreshToolbars()
      self.chrome.needsDisplay = true
    }
  }

  private func showOcrPanel(_ lines: [TextRecognition.Line], ms: Int) {
    guard let sel else { return }
    ocrPanel?.removeFromSuperview()
    let panel = OcrPanelView(lines: lines, ms: ms, theme: theme)
    panel.backdrop = { [weak self] v in self?.glassBackdrop(for: v) }
    panel.setFrameOrigin(OcrPanelView.place(sel: sel, screen: bounds.size))
    panel.onClose = { [weak self] in
      guard let self else { return }
      if self.textOnly { self.delegate?.overlayCancel(self) } else {
        self.clearOcr()
        self.refreshToolbars()
      }
    }
    panel.onCopy = { [weak self] text in
      guard let self else { return }
      self.delegate?.overlayCopyText(self, text, closeAfter: 0)
    }
    addSubview(panel)
    ocrPanel = panel
    DispatchQueue.main.async { self.window?.makeFirstResponder(panel.text) }
  }

  private func clearOcr() {
    readId += 1 // a read still running is dropped
    ocr = nil
    ocrPanel?.removeFromSuperview()
    ocrPanel = nil
    window?.makeFirstResponder(self)
    chrome.needsDisplay = true
  }

  func setNote(_ text: String?) {
    note = text
    noteWork?.cancel()
    if text != nil {
      let w = DispatchWorkItem { [weak self] in self?.setNote(nil) }
      noteWork = w
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.2, execute: w)
    }
    chrome.needsDisplay = true
  }

  /** Test hooks. */
  var ocrPanelText: String? { ocrPanel?.text.string }
  func ocrPanelPress(_ id: String) {
    if id == "one" { ocrPanel?.oneLine() } else if id == "copy" { ocrPanel.map { $0.onCopy($0.text.string) } } else { ocrPanel?.onClose() }
  }
  var toolbarsShown: Bool { !actionsBar.isHidden }
  var ocrLineCount: Int { if case let .result(l, _) = ocr { return l.count }; return 0 }

  private func pill(_ text: String, at p: CGPoint, centered: Bool, ctx: CGContext, size: CGFloat = 13, pad: (CGFloat, CGFloat) = (12, 7), radius: CGFloat = 8) {
    let str = NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: size), .foregroundColor: NSColor.white])
    let sz = str.size()
    let box = CGRect(x: centered ? p.x - sz.width / 2 - pad.0 : p.x, y: p.y, width: ceil(sz.width) + pad.0 * 2, height: ceil(sz.height) + pad.1 * 2)
    ctx.addPath(CGPath(roundedRect: box, cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.setFillColor(NSColor.rgba(20, 20, 22, 0.85).cgColor)
    ctx.fillPath()
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
    str.draw(at: CGPoint(x: box.minX + pad.0, y: box.minY + pad.1))
    NSGraphicsContext.restoreGraphicsState()
  }

  /** Lines found, "Reading text…", the Capture text hint, and short messages. */
  private func paintOcr(_ ctx: CGContext, sel: LRect) {
    switch ocr {
    case .reading:
      pill("Reading text…", at: CGPoint(x: sel.x, y: sel.y + sel.h + 6), centered: false, ctx: ctx, size: 11, pad: (6, 3), radius: 4)
    case let .result(lines, _):
      let blue = NSColor(hex: "#3b82f6")
      for l in lines {
        let r = CGRect(x: sel.x + l.x * sel.w - 2, y: sel.y + l.y * sel.h - 1, width: l.w * sel.w + 4, height: l.h * sel.h + 2)
        let path = CGPath(roundedRect: r, cornerWidth: 3, cornerHeight: 3, transform: nil)
        ctx.addPath(path)
        ctx.setFillColor(blue.withAlphaComponent(0.22).cgColor)
        ctx.fillPath()
        ctx.addPath(path)
        ctx.setStrokeColor(blue.withAlphaComponent(0.7).cgColor)
        ctx.setLineWidth(1)
        ctx.strokePath()
      }
    case nil: break
    }
  }

  fileprivate func paintMessages(_ ctx: CGContext) {
    if textOnly && sel == nil { pill("Drag over text to copy it", at: CGPoint(x: bounds.midX, y: 24), centered: true, ctx: ctx) }
    if let note { pill(note, at: CGPoint(x: bounds.midX, y: bounds.maxY - 48 - 31), centered: true, ctx: ctx) }
  }

  // MARK: - Background editor

  func openEditor() {
    guard editor == nil, sel != nil else { return }
    closePopovers()
    let ed = BackgroundEditorView(owner: self, theme: theme)
    ed.frame = bounds
    ed.autoresizingMask = [.width, .height]
    addSubview(ed)
    editor = ed
    editorOpen = true
    invalidateCursors()
    chrome.needsDisplay = true
    ed.refresh()
    refreshToolbars()
    window?.makeFirstResponder(self)
  }

  /** Done / close / Esc: back to capture mode, or (editing a stored capture) keep the edits and finish. */
  func closeEditor() {
    finishEditing(commit: true)
    if editMode {
      delegate?.overlayEditDone(self)
      return
    }
    closeEditorView()
    refreshToolbars()
    chrome.needsDisplay = true
  }

  private func closeEditorView() {
    guard let ed = editor else { return }
    ed.closePicker()
    ed.removeFromSuperview()
    editor = nil
    editorOpen = false
    invalidateCursors()
    dockBar.isHidden = true
  }

  /** The preview moved (zoom, pan): the text box and docked bars follow. */
  func editorMoved() {
    if let e = editing { textEditor?.update(e) }
  }

  /** Selection coordinates → this view, and points per selection point (the editor previews at another size). */
  fileprivate var viewTransform: (origin: CGPoint, k: CGFloat) {
    guard let editor, let sel else { return (.zero, 1) }
    let t = editor.transform
    return (CGPoint(x: t.origin.x - sel.x * t.k, y: t.origin.y - sel.y * t.k), t.k)
  }

  // MARK: - Liquid Glass

  private var glassCache: [String: CGImage] = [:]

  /**
   * What's under a panel, as --ui-blur shows it: the frozen screen and the dim (with the selection
   * clear) in the panel's area, bent outward near the edges (#liquid-glass), blurred 10 pt,
   * saturation ×1.9, brightness ×1.06, at the screen's pixel scale. Nil in the background editor (the
   * panel then shows the editor through its translucent gradient).
   */
  func glassBackdrop(for v: NSView) -> CGImage? {
    guard !editorOpen, let image, bounds.width > 0 else { return nil }
    let r = v.convert(v.bounds, to: self)
    let s = settings.capture
    let key = "\(r)|\(sel.map { "\($0)" } ?? "")|\(s.dimColor)|\(s.dimOpacity)|\(image.width)"
    if let c = glassCache[key] { return c }
    let k = CGFloat(image.width) / bounds.width
    // backdrop-filter sees only the panel's own area.
    let area = r.intersection(bounds)
    guard !area.isEmpty, let crop = image.cropping(to: CGRect(x: area.minX * k, y: area.minY * k, width: area.width * k, height: area.height * k)) else { return nil }
    let w = crop.width, h = crop.height
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
    // The dim, with the selection clear: top-left points to bottom-left pixels.
    ctx.setFillColor(NSColor(hex: s.dimColor, alpha: s.dimOpacity).cgColor)
    let dim = CGMutablePath()
    dim.addRect(CGRect(x: 0, y: 0, width: w, height: h))
    if let sel, sel.w > 0 || sel.h > 0 {
      let q = sel.cg
      dim.addRect(CGRect(x: (q.minX - area.minX) * k, y: CGFloat(h) - (q.maxY - area.minY) * k, width: q.width * k, height: q.height * k))
    }
    ctx.addPath(dim)
    ctx.fillPath(using: .evenOdd)
    guard let out = Glass.filter(ctx, w, h, scale: k) else { return nil }
    if glassCache.count > 24 { glassCache = [:] } // old positions and selections
    glassCache[key] = out
    return out
  }

  /** Test hooks. */
  var editorView: BackgroundEditorView? { editor }
  var testViewTransform: (origin: CGPoint, k: CGFloat) { viewTransform }

  /** The selected shape's frame and handles, line end points, and snap guides (AnnotationLayer's UI layer). */
  private func paintShapeUI(_ ctx: CGContext) {
    let blue = NSColor(hex: "#3b82f6").cgColor
    if let s = selectedShape, editing == nil {
      ctx.saveGState()
      ctx.setStrokeColor(blue)
      ctx.setLineWidth(1)
      ctx.setLineDash(phase: 0, lengths: [4, 3])
      ctx.stroke(frameBox(s))
      ctx.restoreGState()
      for (_, p) in anchors(s) {
        ctx.addPath(CGPath(roundedRect: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12), cornerWidth: 3, cornerHeight: 3, transform: nil))
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.setStrokeColor(blue)
        ctx.setLineWidth(1)
        ctx.drawPath(using: .fillStroke)
      }
      for p in lineEnds(s) {
        ctx.addEllipse(in: CGRect(x: p.x - 7.5, y: p.y - 7.5, width: 15, height: 15))
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.setStrokeColor(blue)
        ctx.setLineWidth(2)
        ctx.drawPath(using: .fillStroke)
      }
    }
    guard !guides.isEmpty else { return }
    ctx.saveGState()
    ctx.setStrokeColor(NSColor(hex: "#ff2d95").cgColor)
    ctx.setLineWidth(1)
    ctx.setLineDash(phase: 0, lengths: [4, 3])
    for g in guides {
      if g.vertical {
        ctx.move(to: CGPoint(x: g.at, y: g.from - 8))
        ctx.addLine(to: CGPoint(x: g.at, y: g.to + 8))
      } else {
        ctx.move(to: CGPoint(x: g.from - 8, y: g.at))
        ctx.addLine(to: CGPoint(x: g.to + 8, y: g.at))
      }
    }
    ctx.strokePath()
    ctx.restoreGState()
  }

  /** Test hook: the snap guides showing now. */
  var guideCount: Int { guides.count }

  /** Test hooks: a style bar button, a tool's right-click menu, the style bar's contents. */
  func pressStyle(_ id: String) { stylePress(id) }
  func openVariants(_ id: String) { rightClick(id, in: toolsBar) }
  var styleBarIds: [String] { styleBar.isHidden ? [] : styleBar.items.compactMap(\.id) }
  var toolIds: [String] { toolsBar.items.compactMap(\.id) }
  var activeStyleIds: [String] { styleBar.isHidden ? [] : Array(styleBar.active).sorted() }
  var popoverFrame: CGRect? { variantMenu?.view.frame ?? picker?.view.frame }
  func testPick(_ hex: String) {
    picker?.view.onChange(hex)
    closePicker()
  }
  func testStyle(blur: Double? = nil, fontSize: Double? = nil) {
    if let blur { styleChange(StylePatch(blurStrength: blur), continuous: true) }
    if let fontSize { styleChange(StylePatch(fontSize: fontSize)) }
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

/** Centres a fixed-size control in the space a toolbar gives it. */
final class Wrapped: NSView {
  let inner: NSView
  let innerSize: CGSize
  init(_ inner: NSView, size: CGSize) {
    self.inner = inner
    innerSize = size
    super.init(frame: .zero)
    addSubview(inner)
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    inner.frame = CGRect(x: (newSize.width - innerSize.width) / 2, y: (newSize.height - innerSize.height) / 2, width: innerSize.width, height: innerSize.height)
  }
}

/**
 * Text being typed (TextEditor in AnnotationLayer.tsx): a frame you can drag to move the box, around a
 * text view whose letters are invisible. The capture view draws the text live with the same code as
 * the output, so it looks exactly as it will; the text view gives the caret, selection and editing keys.
 */
private final class TextEditorView: NSView, NSTextViewDelegate {
  static let frameWidth: CGFloat = 7
  private let text = InvisibleTextView()
  private weak var owner: OverlayView?
  private var shape: Shape.Text
  private var dragStart: (mouse: CGPoint, origin: CGPoint)?

  init(shape: Shape.Text, owner: OverlayView) {
    self.shape = shape
    self.owner = owner
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 4
    layer?.borderWidth = 1
    layer?.borderColor = NSColor(srgbRed: 59 / 255, green: 130 / 255, blue: 246 / 255, alpha: 0.9).cgColor
    layer?.backgroundColor = NSColor(srgbRed: 59 / 255, green: 130 / 255, blue: 246 / 255, alpha: 0.08).cgColor
    text.drawsBackground = false
    text.isRichText = false
    text.allowsUndo = true
    text.textContainer?.lineFragmentPadding = 0
    text.textContainer?.widthTracksTextView = false
    text.textContainer?.containerSize = CGSize(width: 100_000, height: 100_000)
    text.isHorizontallyResizable = false
    text.isVerticallyResizable = false
    text.delegate = self
    text.string = shape.text
    text.onFinish = { [weak self] in self?.owner?.finishEditing(commit: true) }
    text.onMarkedChange = { [weak self] in self?.changed() }
    addSubview(text)
    update(shape)
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  func focus() {
    window?.makeFirstResponder(text)
    text.setSelectedRange(NSRange(location: (text.string as NSString).length, length: 0)) // existing text: carry on at the end
  }

  func type(_ s: String) {
    focus()
    text.insertText(s, replacementRange: text.selectedRange())
  }

  /** New style or position: match the font, line height and padding the drawing uses. */
  func update(_ s: Shape.Text) {
    shape = s
    // In the background editor the text is shown at the preview's scale.
    let t = owner?.viewTransform ?? (.zero, 1)
    let k = t.k
    let font = ShapeDrawing.font(size: s.fontSize * k, family: s.fontFamily)
    let lh = s.fontSize * k * ShapeDrawing.lineHeight
    let para = NSMutableParagraphStyle()
    para.minimumLineHeight = lh
    para.maximumLineHeight = lh
    // Glyphs sit where ShapeDrawing puts them: centred in each 1.2× line. TextKit puts a fixed-height
    // line's baseline at its bottom minus the descent.
    let wanted = lh / 2 + (font.ascender + font.descender) / 2
    let natural = lh + font.descender
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.clear, .paragraphStyle: para, .baselineOffset: natural - wanted]
    text.typingAttributes = attrs
    text.textStorage?.setAttributes(attrs, range: NSRange(location: 0, length: (text.string as NSString).length))
    text.insertionPointColor = NSColor(hex: s.color)
    // A word still being composed is drawn with the rest; the view only underlines it, as macOS does.
    text.markedTextAttributes = [.foregroundColor: NSColor.clear, .underlineStyle: NSUnderlineStyle.single.rawValue, .underlineColor: NSColor(hex: s.color)]
    let pad = ShapeDrawing.pad(s) * k
    text.textContainerInset = CGSize(width: pad, height: pad)
    let box = ShapeDrawing.textBox(s)
    let w = max(box.width, s.fontSize * 0.6 + ShapeDrawing.pad(s) * 2) * k + 2
    let f = TextEditorView.frameWidth
    text.frame = CGRect(x: f, y: f, width: w, height: box.height * k)
    frame = CGRect(x: t.origin.x + s.x * k - f, y: t.origin.y + s.y * k - f, width: w + f * 2, height: box.height * k + f * 2)
  }

  func textDidChange(_ notification: Notification) { changed() }

  private func changed() {
    guard shape.text != text.string else { return }
    shape.text = text.string
    owner?.textChanged(shape)
    update(shape)
  }

  // Dragging the frame (not the text) moves the box while typing.
  override func mouseDown(with e: NSEvent) {
    dragStart = (screenPoint(e), CGPoint(x: shape.x, y: shape.y))
  }

  /** The pointer in screen coordinates. */
  private func screenPoint(_ e: NSEvent) -> CGPoint { window?.convertPoint(toScreen: e.locationInWindow) ?? NSEvent.mouseLocation }

  override func mouseDragged(with e: NSEvent) {
    guard let start = dragStart, let owner else { return }
    let m = screenPoint(e)
    let k = owner.viewTransform.k
    let target = CGPoint(x: start.origin.x + (m.x - start.mouse.x) / k, y: start.origin.y - (m.y - start.mouse.y) / k)
    let o = owner.textMoved(to: target, free: e.modifierFlags.contains(.command))
    shape.x = o.x
    shape.y = o.y
    update(shape)
  }

  override func mouseUp(with e: NSEvent) {
    dragStart = nil
    owner?.textMoveEnded()
    focus()
  }
}

/** The text view used while typing: Esc or ⌘Return finishes; every other key stays here. */
private final class InvisibleTextView: NSTextView {
  var onFinish: () -> Void = {}
  /**
   * A word an input method is still composing (Vietnamese Telex, Pinyin, dead keys) is marked text,
   * which posts no text-change notification: without this it would only show once committed (space).
   */
  var onMarkedChange: () -> Void = {}
  override func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
    super.setMarkedText(string, selectedRange: selectedRange, replacementRange: replacementRange)
    onMarkedChange()
  }
  override func unmarkText() {
    super.unmarkText()
    onMarkedChange()
  }
  override func keyDown(with e: NSEvent) {
    if e.keyCode == 53 || (e.keyCode == 36 && e.modifierFlags.contains(.command)) {
      onFinish()
      return
    }
    super.keyDown(with: e)
  }
  override func cancelOperation(_ sender: Any?) { onFinish() }
  // ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z stay with the text, never capture mode's copy or undo.
  override func performKeyEquivalent(with e: NSEvent) -> Bool {
    guard e.modifierFlags.contains(.command), let c = e.charactersIgnoringModifiers?.lowercased() else { return super.performKeyEquivalent(with: e) }
    switch c {
    case "c": copy(nil)
    case "v": pasteAsPlainText(nil)
    case "x": cut(nil)
    case "a": selectAll(nil)
    case "z": if e.modifierFlags.contains(.shift) { undoManager?.redo() } else { undoManager?.undo() }
    default: return super.performKeyEquivalent(with: e)
    }
    return true
  }
}

/** Custom cursors. */
enum Cursors {
  static func named(_ name: String) -> NSCursor {
    switch name {
    case "move": return move
    case "ibeam": return .iBeam
    case "step": return step
    case "ns": return .resizeUpDown
    case "ew": return .resizeLeftRight
    case "nwse": return nwse
    case "nesw": return nesw
    case "arrow": return .arrow
    default: return .crosshair
    }
  }

  static func resizeName(_ h: Handle) -> String {
    switch h {
    case .n, .s: return "ns"
    case .e, .w: return "ew"
    case .nw, .se: return "nwse"
    case .ne, .sw: return "nesw"
    }
  }

  /** The four-way move arrows (CSS `move`). */
  static let move = symbol("arrow.up.and.down.and.arrow.left.and.right")
  /** Diagonal resize: the system's on macOS 15 and later. */
  static let nwse: NSCursor = {
    if #available(macOS 15.0, *) { return NSCursor.frameResize(position: .topLeft, directions: .all) }
    return symbol("arrow.up.left.and.arrow.down.right")
  }()
  static let nesw: NSCursor = {
    if #available(macOS 15.0, *) { return NSCursor.frameResize(position: .topRight, directions: .all) }
    return symbol("arrow.up.right.and.arrow.down.left")
  }()

  /** An SF Symbol as a cursor: black, outlined in white like the system's, hot spot in the middle. */
  private static func symbol(_ name: String) -> NSCursor {
    let size: CGFloat = 22
    let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .bold)
    guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config) else { return .crosshair }
    let tint = { (c: NSColor) -> NSImage in
      let i = NSImage(size: base.size, flipped: false) { r in
        base.draw(in: r)
        c.set()
        r.fill(using: .sourceAtop)
        return true
      }
      return i
    }
    let white = tint(.white), black = tint(.black)
    let img = NSImage(size: NSSize(width: size, height: size), flipped: false) { _ in
      let o = CGPoint(x: (size - base.size.width) / 2, y: (size - base.size.height) / 2)
      for dx in [-1.5, 0, 1.5] { for dy in [-1.5, 0, 1.5] where dx != 0 || dy != 0 {
        white.draw(at: CGPoint(x: o.x + dx, y: o.y + dy), from: .zero, operation: .sourceOver, fraction: 1)
      } }
      black.draw(at: o, from: .zero, operation: .sourceOver, fraction: 1)
      return true
    }
    return NSCursor(image: img, hotSpot: NSPoint(x: size / 2, y: size / 2))
  }

  /** Push pin for the numbered-step tool; the hot spot is the pin's point. */
  static let step: NSCursor = {
    let img = NSImage(size: NSSize(width: 28, height: 28), flipped: true) { _ in
      guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
      ctx.scaleBy(x: 28 / 24, y: 28 / 24)
      ctx.setLineWidth(1.6)
      ctx.setLineCap(.round)
      ctx.setLineJoin(.round)
      let head = CGMutablePath()
      SVGPath.append("M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z", to: head)
      let needle = CGMutablePath()
      SVGPath.append("M12 17v5", to: needle)
      ctx.addPath(head)
      ctx.setFillColor(NSColor.white.cgColor)
      ctx.fillPath()
      ctx.setStrokeColor(NSColor(hex: "#111111").cgColor)
      ctx.addPath(head)
      ctx.addPath(needle)
      ctx.strokePath()
      return true
    }
    return NSCursor(image: img, hotSpot: NSPoint(x: 14, y: 26))
  }()
}

extension LSize {
  init(_ s: CGSize) { self.init(w: s.width, h: s.height) }
}

extension OverlayView: BackgroundEditorOwner {
  func plainCrop() -> CGImage? { renderPlain() }

  func setBeautify(_ s: BeautifyState) {
    beautify = s
    OverlayView.lastBeautify = s
    editor?.refresh()
    refreshToolbars()
  }

  func setCompress(on: Bool, preset: String) {
    compressOn = on
    compressPreset = preset
    editor?.compressChanged()
  }

  func paintDrawings(_ ctx: CGContext, pixelScale: CGFloat) {
    var env = renderEnv
    env.pixelScale = pixelScale
    ShapeDrawing.draw(visibleShapes, in: ctx, env: env)
    paintShapeUI(ctx)
  }

  func editorPointer(_ phase: Int, _ p: CGPoint, _ e: NSEvent) {
    switch phase {
    case 0: pointerDown(p, e)
    case 1: pointerDragged(p, e)
    default: pointerUp(p, e)
    }
    editor?.needsDisplay = true
  }

  func editorCopy() { delegate?.overlayCopy(self) }
  func editorSave() { delegate?.overlaySave(self) }
  func editorClose() { closeEditor() }

  func compressedSizes(preset: String) -> (before: Int, after: Int)? {
    guard let out = renderOutput(), let png = Output.png(out) else { return nil }
    return (png.count, Output.compressed(out, png: png, scale: imageScale, preset: preset).count)
  }
}
