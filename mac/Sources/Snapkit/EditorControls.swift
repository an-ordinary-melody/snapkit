import AppKit
import SnapkitCore

/** Small controls for the background editor and Settings, drawn like the Electron app's CSS. */

/** .switch: 34×20 track, 16 pt white knob; accent when on. */
final class SwitchView: NSView {
  var on: Bool { didSet { needsDisplay = true } }
  var theme: Theme { didSet { needsDisplay = true } }
  var onToggle: (Bool) -> Void = { _ in }
  init(on: Bool, theme: Theme) {
    self.on = on
    self.theme = theme
    super.init(frame: CGRect(x: 0, y: 0, width: 34, height: 20))
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with event: NSEvent) {
    on.toggle()
    onToggle(on)
  }
  override func draw(_ dirtyRect: NSRect) {
    let track = CGRect(x: 0, y: (bounds.height - 20) / 2, width: 34, height: 20)
    (on ? theme.switchOn : theme.track).setFill()
    NSBezierPath(roundedRect: track, xRadius: 10, yRadius: 10).fill()
    NSColor.white.setFill()
    NSBezierPath(ovalIn: CGRect(x: track.minX + (on ? 16 : 2), y: track.minY + 2, width: 16, height: 16)).fill()
  }
}

/** A row of rounded chips (.be-chip); one active. */
final class ChipsView: NSView {
  var items: [(id: String, label: String)] { didSet { relayout() } }
  var active: String? { didSet { needsDisplay = true } }
  var theme: Theme { didSet { needsDisplay = true } }
  var onPick: (String) -> Void = { _ in }
  private var frames: [CGRect] = []
  private let font = NSFont.systemFont(ofSize: 12)
  private let maxWidth: CGFloat

  init(items: [(id: String, label: String)], width: CGFloat, theme: Theme) {
    self.items = items
    self.theme = theme
    maxWidth = width
    super.init(frame: .zero)
    relayout()
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  private func relayout() {
    var x: CGFloat = 0, y: CGFloat = 0
    frames = items.map { item in
      let w = NSAttributedString(string: item.label, attributes: [.font: font]).size().width + 20
      if x > 0 && x + w > maxWidth {
        x = 0
        y += 32
      }
      defer { x += w + 6 }
      return CGRect(x: x, y: y, width: w, height: 26)
    }
    setFrameSize(CGSize(width: maxWidth, height: (frames.last?.maxY ?? 0)))
    needsDisplay = true
  }

  override func mouseDown(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if let i = frames.firstIndex(where: { $0.contains(p) }) { onPick(items[i].id) }
  }

  override func draw(_ dirtyRect: NSRect) {
    for (i, r) in frames.enumerated() {
      let on = items[i].id == active
      (on ? theme.chipActiveBackground : theme.field).setFill()
      NSBezierPath(roundedRect: r, xRadius: 13, yRadius: 13).fill()
      let s = NSAttributedString(string: items[i].label, attributes: [.font: font, .foregroundColor: on ? theme.chipActiveForeground : theme.foreground])
      s.draw(at: CGPoint(x: r.midX - s.size().width / 2, y: r.midY - s.size().height / 2))
    }
  }
}

/** A grid of swatches (.be-grid / .be-swatch): 8 columns, gap 5; the active one ringed. */
final class SwatchGrid: NSView {
  enum Fill: Equatable {
    case solid(String)
    case gradient(String, String, Double)
  }
  var swatches: [Fill] { didSet { relayout() } }
  var active: Int? { didSet { needsDisplay = true } }
  var theme: Theme { didSet { needsDisplay = true } }
  var onPick: (Int) -> Void = { _ in }
  private let width: CGFloat

  init(swatches: [Fill], width: CGFloat, theme: Theme) {
    self.swatches = swatches
    self.width = width
    self.theme = theme
    super.init(frame: .zero)
    relayout()
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  private var cell: CGFloat { (width - 7 * 5) / 8 }
  private func frame(_ i: Int) -> CGRect { CGRect(x: CGFloat(i % 8) * (cell + 5), y: CGFloat(i / 8) * (cell + 5), width: cell, height: cell) }

  private func relayout() {
    let rows = (swatches.count + 7) / 8
    setFrameSize(CGSize(width: width, height: CGFloat(rows) * cell + CGFloat(max(0, rows - 1)) * 5))
    needsDisplay = true
  }

  override func mouseDown(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if let i = swatches.indices.first(where: { frame($0).contains(p) }) { onPick(i) }
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    for (i, s) in swatches.enumerated() {
      let r = frame(i)
      let inner = r.insetBy(dx: 2, dy: 2)
      let path = CGPath(roundedRect: inner, cornerWidth: 5, cornerHeight: 5, transform: nil)
      ctx.saveGState()
      ctx.addPath(path)
      ctx.clip()
      switch s {
      case let .solid(c):
        ctx.setFillColor(NSColor(hex: c).cgColor)
        ctx.fill(inner)
      case let .gradient(a, b, angle):
        ctx.translateBy(x: inner.minX, y: inner.minY)
        BeautifyRenderer.paint(.gradient(from: a, to: b, angle: angle), w: inner.width, h: inner.height, ctx: ctx)
      }
      ctx.restoreGState()
      ctx.addPath(CGPath(roundedRect: inner.insetBy(dx: 0.5, dy: 0.5), cornerWidth: 5, cornerHeight: 5, transform: nil))
      ctx.setStrokeColor(theme.swatchEdge.cgColor)
      ctx.setLineWidth(1)
      ctx.strokePath()
      if i == active {
        ctx.addPath(CGPath(roundedRect: r.insetBy(dx: -1, dy: -1), cornerWidth: 8, cornerHeight: 8, transform: nil))
        ctx.setStrokeColor(theme.ring.cgColor)
        ctx.setLineWidth(2)
        ctx.strokePath()
      }
    }
  }
}

/** A flat button (.be-btn, .be-wand, .be-color, tabs…): drawn by a closure, with hover. */
final class FlatButton: NSView {
  var label: String { didSet { needsDisplay = true } }
  var icon: String?
  var primary = false
  /** A segment of a tab control: no background unless selected. */
  var tab = false
  var selected = false { didSet { needsDisplay = true } }
  var radius: CGFloat = 8
  var swatch: String? { didSet { needsDisplay = true } }
  var theme: Theme { didSet { needsDisplay = true } }
  var font = NSFont.systemFont(ofSize: 12.5)
  var onPress: () -> Void = {}
  private var hover = false

  init(label: String, icon: String? = nil, theme: Theme) {
    self.label = label
    self.icon = icon
    self.theme = theme
    super.init(frame: .zero)
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  override func mouseEntered(with e: NSEvent) { hover = true; needsDisplay = true }
  override func mouseExited(with e: NSEvent) { hover = false; needsDisplay = true }
  override func mouseDown(with e: NSEvent) {}
  override func mouseUp(with e: NSEvent) {
    if bounds.contains(convert(e.locationInWindow, from: nil)) { onPress() }
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    let bg = tab ? (selected ? theme.strongBackground : .clear) : primary ? theme.accentButton : hover ? theme.hover : theme.field
    bg.setFill()
    NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    let fg = primary ? theme.onAccent : tab && !selected && !hover ? theme.foregroundDim : theme.foreground
    if let swatch {
      NSColor(hex: swatch).setFill()
      NSBezierPath(roundedRect: bounds.insetBy(dx: 3, dy: 3), xRadius: 5, yRadius: 5).fill()
      return
    }
    let text = NSAttributedString(string: label, attributes: [.font: font, .foregroundColor: fg])
    let tw = label.isEmpty ? 0 : text.size().width
    let iw: CGFloat = icon == nil ? 0 : 15
    let gap: CGFloat = icon != nil && !label.isEmpty ? 6 : 0
    var x = bounds.midX - (tw + iw + gap) / 2
    if let icon {
      Icons.draw(icon, in: CGRect(x: x, y: 0, width: iw, height: bounds.height), size: 15, color: fg, ctx: ctx)
      x += iw + gap
    }
    text.draw(at: CGPoint(x: x, y: bounds.midY - text.size().height / 2))
  }
}

/** A plain label. */
final class LabelView: NSView {
  var text: String { didSet { needsDisplay = true } }
  var color: NSColor { didSet { needsDisplay = true } }
  var font: NSFont
  var align: NSTextAlignment = .left
  init(_ text: String, font: NSFont = .systemFont(ofSize: 12.5), color: NSColor) {
    self.text = text
    self.font = font
    self.color = color
    super.init(frame: .zero)
  }
  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func draw(_ dirtyRect: NSRect) {
    let s = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
    let size = s.size()
    let x = align == .right ? bounds.maxX - size.width : align == .center ? bounds.midX - size.width / 2 : 0
    s.draw(at: CGPoint(x: x, y: bounds.midY - size.height / 2))
  }
}

/** A text field styled like the editor's inputs (.be-hex, .be-size input). */
final class FieldView: NSTextField, NSTextFieldDelegate {
  var onChange: (String) -> Void = { _ in }
  var onCommit: (String) -> Void = { _ in }
  override class var cellClass: AnyClass? {
    get { CenteredTextFieldCell.self }
    set {}
  }
  init(text: String, monospace: Bool, theme: Theme) {
    super.init(frame: .zero)
    isBordered = false
    focusRingType = .none
    drawsBackground = false
    wantsLayer = true
    layer?.cornerRadius = 7
    layer?.backgroundColor = theme.field.cgColor
    textColor = theme.foreground
    font = monospace ? NSFont.monospacedSystemFont(ofSize: 12, weight: .regular) : NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .regular)
    stringValue = text
    delegate = self
    (cell as? NSTextFieldCell)?.usesSingleLineMode = true
  }
  required init?(coder: NSCoder) { fatalError() }
  func controlTextDidChange(_ obj: Notification) { onChange(stringValue) }
  func controlTextDidEndEditing(_ obj: Notification) { onCommit(stringValue) }
  func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
    if sel == #selector(insertNewline(_:)) || sel == #selector(cancelOperation(_:)) {
      window?.makeFirstResponder(nil)
      return true
    }
    return false
  }
}

extension Theme {
  var switchOn: NSColor { accentOverride.map { NSColor(hex: $0) } ?? NSColor(hex: "#0a84ff") }
  var chipActiveBackground: NSColor { dark ? NSColor(hex: "#f4f4f5") : NSColor(hex: "#1c1c1e") }
  var chipActiveForeground: NSColor { dark ? NSColor(hex: "#111111") : .white }
  /** --ui-accent (primary buttons): ink unless an accent colour is set. */
  var accentButton: NSColor { accentOverride.map { NSColor(hex: $0) } ?? (dark ? NSColor(hex: "#f4f4f5") : NSColor(hex: "#1c1c1e")) }
  var onAccent: NSColor { accentOverride.map { NSColor(hex: HexColor.readableOn($0)) } ?? (dark ? NSColor(hex: "#111111") : .white) }
}

/** A text field cell with its text vertically centred and 8 pt side padding. */
final class CenteredTextFieldCell: NSTextFieldCell {
  private func centred(_ r: NSRect) -> NSRect {
    let h = cellSize(forBounds: r).height
    return NSRect(x: r.minX + 8, y: r.minY + (r.height - h) / 2, width: r.width - 16, height: h)
  }
  override func drawingRect(forBounds r: NSRect) -> NSRect { centred(r) }
  override func edit(withFrame r: NSRect, in v: NSView, editor: NSText, delegate: Any?, event: NSEvent?) {
    super.edit(withFrame: centred(r), in: v, editor: editor, delegate: delegate, event: event)
  }
  override func select(withFrame r: NSRect, in v: NSView, editor: NSText, delegate: Any?, start: Int, length: Int) {
    super.select(withFrame: centred(r), in: v, editor: editor, delegate: delegate, start: start, length: length)
  }
}
