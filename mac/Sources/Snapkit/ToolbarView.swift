import AppKit

/**
 * A capture-mode toolbar (styles.css `.toolbar`): 32 pt buttons, 2 pt apart, 4 pt padding, on a
 * rounded panel. Horizontal for actions, vertical for tools. Also used for the style bar (swatches
 * and stroke widths).
 */
final class ToolbarView: NSView {
  enum Item: Equatable {
    case button(id: String, icon: String, tip: String)
    /** A colour swatch button (the Color tool, or a palette swatch). */
    case swatch(id: String, color: String, tip: String)
    /** A stroke-width choice, drawn as a dot of that size. */
    case width(id: String, dot: CGFloat, tip: String)
    case separator
  }

  static let button: CGFloat = 32
  static let gap: CGFloat = 2
  static let padding: CGFloat = 4

  let vertical: Bool
  var items: [Item] = [] { didSet { relayout() } }
  var active: Set<String> = [] { didSet { needsDisplay = true } }
  var disabled: Set<String> = [] { didSet { needsDisplay = true } }
  var theme: Theme { didSet { needsDisplay = true } }
  var onPress: (String) -> Void = { _ in }

  private var frames: [(Item, CGRect)] = []
  private var hovered: Int?
  private var pressed: Int?

  init(vertical: Bool, theme: Theme) {
    self.vertical = vertical
    self.theme = theme
    super.init(frame: .zero)
    wantsLayer = true
    layer?.masksToBounds = false
    shadow = {
      let s = NSShadow()
      s.shadowColor = theme.shadow
      s.shadowBlurRadius = 24
      s.shadowOffset = NSSize(width: 0, height: -6)
      return s
    }()
  }

  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }

  /** Natural size for the current items. */
  var size: CGSize {
    var length = Self.padding * 2
    for (k, item) in items.enumerated() {
      length += item == .separator ? 7 : Self.button
      if k < items.count - 1 { length += Self.gap }
    }
    let thick = Self.button + Self.padding * 2
    return vertical ? CGSize(width: thick, height: length) : CGSize(width: length, height: thick)
  }

  private func relayout() {
    var pos = Self.padding
    frames = items.map { item in
      let len: CGFloat = item == .separator ? 7 : Self.button
      let r = vertical
        ? CGRect(x: Self.padding, y: pos, width: Self.button, height: len)
        : CGRect(x: pos, y: Self.padding, width: len, height: Self.button)
      pos += len + Self.gap
      return (item, r)
    }
    setFrameSize(size)
    toolTip = nil
    removeAllToolTips()
    for (item, r) in frames {
      switch item {
      case let .button(_, _, tip), let .swatch(_, _, tip), let .width(_, _, tip): addToolTip(r, owner: tip as NSString, userData: nil)
      case .separator: break
      }
    }
    needsDisplay = true
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .cursorUpdate], owner: self))
  }

  override func cursorUpdate(with event: NSEvent) { NSCursor.arrow.set() }

  override func mouseMoved(with event: NSEvent) {
    NSCursor.arrow.set()
    let h = index(at: convert(event.locationInWindow, from: nil))
    if h != hovered {
      hovered = h
      needsDisplay = true
    }
  }

  override func mouseExited(with event: NSEvent) {
    hovered = nil
    needsDisplay = true
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    pressed = index(at: convert(event.locationInWindow, from: nil))
  }

  override func mouseUp(with event: NSEvent) {
    defer { pressed = nil }
    guard let i = index(at: convert(event.locationInWindow, from: nil)), i == pressed else { return }
    switch frames[i].0 {
    case let .button(id, _, _), let .swatch(id, _, _), let .width(id, _, _):
      if !disabled.contains(id) { onPress(id) }
    case .separator: break
    }
  }

  private func index(at p: CGPoint) -> Int? {
    frames.firstIndex { $0.0 != .separator && $0.1.contains(p) }
  }

  func frame(of id: String) -> CGRect? {
    frames.first { item, _ in
      switch item {
      case let .button(i, _, _), let .swatch(i, _, _), let .width(i, _, _): return i == id
      case .separator: return false
      }
    }?.1
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    let panel = NSBezierPath(roundedRect: bounds, xRadius: theme.radius, yRadius: theme.radius)
    theme.background.setFill()
    panel.fill()
    // The rim: an inset hairline.
    let rim = NSBezierPath(roundedRect: bounds.insetBy(dx: theme.rimWidth / 2, dy: theme.rimWidth / 2), xRadius: theme.radius, yRadius: theme.radius)
    rim.lineWidth = theme.rimWidth
    theme.rim.setStroke()
    rim.stroke()

    for (k, (item, r)) in frames.enumerated() {
      let id: String
      switch item {
      case .separator:
        theme.separator.setFill()
        let line = vertical ? CGRect(x: r.minX + 6, y: r.midY - 0.5, width: r.width - 12, height: 1) : CGRect(x: r.midX - 0.5, y: r.minY + 6, width: 1, height: r.height - 12)
        NSBezierPath(rect: line).fill()
        continue
      case let .button(i, _, _), let .swatch(i, _, _), let .width(i, _, _): id = i
      }
      let off = disabled.contains(id)
      let isActive = active.contains(id)
      let shape = NSBezierPath(roundedRect: r, xRadius: theme.buttonRadius, yRadius: theme.buttonRadius)
      if isActive {
        theme.activeBackground.setFill()
        shape.fill()
      } else if k == hovered && !off {
        theme.hover.setFill()
        shape.fill()
      }
      let fg = (isActive ? theme.activeForeground : theme.foreground).withAlphaComponent(off ? 0.35 : 1)
      switch item {
      case let .button(_, icon, _):
        Icons.draw(icon, in: r, size: 18, color: fg, ctx: ctx)
      case let .swatch(_, color, _):
        let box = CGRect(x: r.midX - 9, y: r.midY - 9, width: 18, height: 18)
        let p = NSBezierPath(roundedRect: box, xRadius: 5, yRadius: 5)
        NSColor(hex: color).setFill()
        p.fill()
        p.lineWidth = isActive ? 1.5 : 1
        (isActive ? theme.activeForeground : theme.swatchEdge).setStroke()
        (isActive ? NSBezierPath(roundedRect: box.insetBy(dx: -2, dy: -2), xRadius: 6.5, yRadius: 6.5) : NSBezierPath(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), xRadius: 4.5, yRadius: 4.5)).stroke()
      case let .width(_, dot, _):
        fg.setFill()
        NSBezierPath(ovalIn: CGRect(x: r.midX - dot / 2, y: r.midY - dot / 2, width: dot, height: dot)).fill()
      case .separator: break
      }
    }
  }
}
