import AppKit
import SnapkitCore

/**
 * A capture-mode toolbar (styles.css `.toolbar`): buttons 2 pt apart with 4 pt padding on a rounded
 * panel. Horizontal for actions, vertical for tools (32 pt buttons), and the style bar (28 pt buttons,
 * swatches, widths, text looks and embedded controls).
 */
final class ToolbarView: NSView {
  enum Item: Equatable {
    /** `more`: the tool has a right-click menu (corner mark). `dot`: a green "on" dot. */
    case button(id: String, icon: String, tip: String, hint: String? = nil, sub: String? = nil, more: Bool = false, dot: Bool = false)
    /** A colour: `round` in the style bar (16 pt circle), a rounded square on the Color tool. */
    case swatch(id: String, color: String, tip: String, round: Bool = true)
    /** The custom-colour button (a colour wheel). */
    case customSwatch(id: String, tip: String)
    /** A stroke width, as a dot of that size. */
    case width(id: String, dot: CGFloat, tip: String)
    /** A text look ("A" plain, outlined, on light or dark). */
    case glyph(id: String, look: TextLook, tip: String)
    /** A control view of its own (slider, text field, value). */
    case view(id: String, view: NSView, width: CGFloat)
    case separator

    var id: String? {
      switch self {
      case let .button(id, _, _, _, _, _, _), let .swatch(id, _, _, _), let .customSwatch(id, _), let .width(id, _, _), let .glyph(id, _, _), let .view(id, _, _): return id
      case .separator: return nil
      }
    }

    var tip: (text: String, hint: String?, sub: String?)? {
      switch self {
      case let .button(_, _, tip, hint, sub, _, _): return (tip, hint, sub)
      case let .swatch(_, _, tip, _), let .customSwatch(_, tip), let .width(_, _, tip), let .glyph(_, _, tip): return (tip, nil, nil)
      default: return nil
      }
    }

    static func == (a: Item, b: Item) -> Bool {
      switch (a, b) {
      case let (.button(a1, a2, a3, a4, a5, a6, a7), .button(b1, b2, b3, b4, b5, b6, b7)): return a1 == b1 && a2 == b2 && a3 == b3 && a4 == b4 && a5 == b5 && a6 == b6 && a7 == b7
      case let (.swatch(a1, a2, a3, a4), .swatch(b1, b2, b3, b4)): return a1 == b1 && a2 == b2 && a3 == b3 && a4 == b4
      case let (.customSwatch(a1, a2), .customSwatch(b1, b2)): return a1 == b1 && a2 == b2
      case let (.width(a1, a2, a3), .width(b1, b2, b3)): return a1 == b1 && a2 == b2 && a3 == b3
      case let (.glyph(a1, a2, a3), .glyph(b1, b2, b3)): return a1 == b1 && a2 == b2 && a3 == b3
      case let (.view(a1, a2, a3), .view(b1, b2, b3)): return a1 == b1 && a2 === b2 && a3 == b3
      case (.separator, .separator): return true
      default: return false
      }
    }
  }

  static let gap: CGFloat = 2
  static let padding: CGFloat = 4

  let vertical: Bool
  let button: CGFloat
  var items: [Item] = [] { didSet { if items != oldValue { relayout() } } }
  var active: Set<String> = [] { didSet { if active != oldValue { needsDisplay = true } } }
  var disabled: Set<String> = [] { didSet { if disabled != oldValue { needsDisplay = true } } }
  var theme: Theme { didSet { needsDisplay = true; updateShadow() } }
  /** Liquid Glass: what's under the bar, blurred (set by capture mode). */
  var backdrop: GlassBackdrop?
  var onPress: (String) -> Void = { _ in }
  var onRightClick: (String) -> Void = { _ in }
  /** Hovering a button (for the tooltip); nil when the pointer leaves. */
  var onHover: (String?) -> Void = { _ in }

  private var frames: [(Item, CGRect)] = []
  private var hovered: Int?
  private var pressed: Int?

  init(vertical: Bool, button: CGFloat = 32, theme: Theme) {
    self.vertical = vertical
    self.button = button
    self.theme = theme
    super.init(frame: .zero)
    wantsLayer = true
    updateShadow()
  }

  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }

  private func updateShadow() { shadow = theme.panelShadow }

  private func length(_ item: Item) -> CGFloat {
    switch item {
    case .separator: return 7
    case let .view(_, _, w): return w
    default: return button
    }
  }

  /** Natural size for the current items (the bar's own padding included). */
  var size: CGSize {
    var len = Self.padding * 2
    for (k, item) in items.enumerated() { len += length(item) + (k < items.count - 1 ? Self.gap : 0) }
    let thick = button + Self.padding * 2
    return vertical ? CGSize(width: thick, height: len) : CGSize(width: len, height: thick)
  }

  private func relayout() {
    for sub in subviews { sub.removeFromSuperview() }
    var pos = Self.padding
    frames = items.map { item in
      let len = length(item)
      let r = vertical ? CGRect(x: Self.padding, y: pos, width: button, height: len) : CGRect(x: pos, y: Self.padding, width: len, height: button)
      pos += len + Self.gap
      if case let .view(_, v, _) = item {
        v.frame = r
        addSubview(v)
      }
      return (item, r)
    }
    setFrameSize(size)
    hovered = nil
    needsDisplay = true
  }

  func frame(of id: String) -> CGRect? { frames.first { $0.0.id == id }?.1 }

  func item(_ id: String) -> Item? { frames.first { $0.0.id == id }?.0 }

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
      onHover(h.flatMap { frames[$0].0.id })
    }
  }

  override func mouseExited(with event: NSEvent) {
    hovered = nil
    needsDisplay = true
    onHover(nil)
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    pressed = index(at: convert(event.locationInWindow, from: nil))
  }

  override func mouseUp(with event: NSEvent) {
    defer { pressed = nil }
    guard let i = index(at: convert(event.locationInWindow, from: nil)), i == pressed, let id = frames[i].0.id else { return }
    if !disabled.contains(id) {
      onHover(nil)
      onPress(id)
    }
  }

  // Right-clicks on the bars never reach capture mode (where they'd cancel it).
  override func rightMouseDown(with event: NSEvent) {
    guard let i = index(at: convert(event.locationInWindow, from: nil)), let id = frames[i].0.id else { return }
    onHover(nil)
    onRightClick(id)
  }

  private func index(at p: CGPoint) -> Int? {
    frames.firstIndex { item, r in
      switch item {
      case .separator, .view: return false
      default: return r.contains(p)
      }
    }
  }

  /** A moved bar shows a different part of the screen through its glass. */
  override func setFrameOrigin(_ p: NSPoint) {
    super.setFrameOrigin(p)
    if theme.glass { needsDisplay = true }
  }

  /**
   * A button's background: rounded like the bar where it meets the bar's ends (the bar's radius minus
   * its padding, so the two curves run parallel), the usual button radius elsewhere.
   */
  func buttonShape(_ r: CGRect, first: Bool, last: Bool) -> NSBezierPath {
    let inner = theme.buttonRadius, outer = max(inner, theme.radius - Self.padding)
    // Corners in the view's (flipped) coordinates: top-left, top-right, bottom-right, bottom-left.
    var c = [inner, inner, inner, inner]
    if first { if vertical { c[0] = outer; c[1] = outer } else { c[0] = outer; c[3] = outer } }
    if last { if vertical { c[2] = outer; c[3] = outer } else { c[1] = outer; c[2] = outer } }
    return NSBezierPath.rounded(r, corners: c)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    theme.drawPanel(bounds, radius: theme.radius, backdrop: theme.glass ? backdrop?(self) : nil, in: ctx)
    let ends = (frames.firstIndex { $0.0.id != nil }, frames.lastIndex { $0.0.id != nil })

    for (k, (item, r)) in frames.enumerated() {
      guard let id = item.id else {
        theme.separator.setFill()
        let line = vertical ? CGRect(x: r.minX + 6, y: r.midY - 0.5, width: r.width - 12, height: 1) : CGRect(x: r.midX - 0.5, y: r.midY - 10, width: 1, height: 20)
        NSBezierPath(rect: line).fill()
        continue
      }
      if case .view = item { continue }
      let off = disabled.contains(id)
      let isActive = active.contains(id)
      let shape = buttonShape(r, first: k == ends.0, last: k == ends.1)
      let swatchLike: Bool = {
        switch item {
        case let .swatch(_, _, _, round): return round
        case .customSwatch: return true
        default: return false
        }
      }()
      if isActive && swatchLike {
        theme.hover.setFill() // a picked swatch: hover background plus a ring
        shape.fill()
      } else if isActive {
        theme.activeBackground.setFill()
        shape.fill()
      } else if k == hovered && !off {
        theme.hover.setFill()
        shape.fill()
      }
      let fg = (isActive && !swatchLike ? theme.activeForeground : theme.foreground).withAlphaComponent(off ? 0.35 : 1)
      switch item {
      case let .button(_, icon, _, _, _, more, dot):
        Icons.draw(icon, in: r, size: button == 32 ? 17 : 16, color: fg, ctx: ctx)
        if more {
          // Small corner mark: this button has a right-click menu.
          let m = NSBezierPath()
          m.move(to: CGPoint(x: r.maxX - 3, y: r.maxY - 3))
          m.line(to: CGPoint(x: r.maxX - 7, y: r.maxY - 3))
          m.line(to: CGPoint(x: r.maxX - 3, y: r.maxY - 7))
          m.close()
          fg.withAlphaComponent(0.55 * (off ? 0.35 : 1)).setFill()
          m.fill()
        }
        if dot {
          let d = CGRect(x: r.maxX - 11, y: r.minY + 4, width: 7, height: 7)
          NSColor.white.setFill()
          NSBezierPath(ovalIn: d.insetBy(dx: -1.5, dy: -1.5)).fill()
          NSColor(hex: "#22c55e").setFill()
          NSBezierPath(ovalIn: d).fill()
        }
      case let .swatch(_, color, _, round):
        if round {
          let c = CGRect(x: r.midX - 8, y: r.midY - 8, width: 16, height: 16)
          NSColor(hex: color).setFill()
          NSBezierPath(ovalIn: c).fill()
          if isActive {
            let ring = NSBezierPath(ovalIn: c.insetBy(dx: -1, dy: -1))
            ring.lineWidth = 2
            theme.ring.setStroke()
            ring.stroke()
          } else {
            let edge = NSBezierPath(ovalIn: c.insetBy(dx: 0.5, dy: 0.5))
            edge.lineWidth = 1
            theme.swatchEdge.setStroke()
            edge.stroke()
          }
        } else {
          let box = CGRect(x: r.midX - 9, y: r.midY - 9, width: 18, height: 18)
          NSColor(hex: color).setFill()
          NSBezierPath(roundedRect: box, xRadius: 5, yRadius: 5).fill()
          let edge = NSBezierPath(roundedRect: isActive ? box.insetBy(dx: -0.75, dy: -0.75) : box.insetBy(dx: 0.5, dy: 0.5), xRadius: 5, yRadius: 5)
          edge.lineWidth = isActive ? 1.5 : 1
          (isActive ? theme.activeForeground : theme.swatchEdge).setStroke()
          edge.stroke()
        }
      case .customSwatch:
        let c = CGRect(x: r.midX - 8, y: r.midY - 8, width: 16, height: 16)
        drawColorWheel(in: c, ctx: ctx)
        if isActive {
          let ring = NSBezierPath(ovalIn: c.insetBy(dx: -1, dy: -1))
          ring.lineWidth = 2
          theme.ring.setStroke()
          ring.stroke()
        }
      case let .width(_, dot, _):
        fg.setFill()
        NSBezierPath(ovalIn: CGRect(x: r.midX - dot / 2, y: r.midY - dot / 2, width: dot, height: dot)).fill()
      case let .glyph(_, look, _):
        drawGlyph(look, in: r, fg: fg)
      default: break
      }
    }
  }

  /** The custom-colour button: a conic rainbow (conic-gradient(red, yellow, lime, aqua, blue, magenta, red)). */
  private func drawColorWheel(in r: CGRect, ctx: CGContext) {
    ctx.saveGState()
    ctx.addEllipse(in: r)
    ctx.clip()
    let steps = 72
    for i in 0..<steps {
      let a0 = CGFloat(i) / CGFloat(steps) * 2 * .pi - .pi / 2
      let a1 = CGFloat(i + 1) / CGFloat(steps) * 2 * .pi - .pi / 2 + 0.02
      ctx.move(to: CGPoint(x: r.midX, y: r.midY))
      ctx.addArc(center: CGPoint(x: r.midX, y: r.midY), radius: r.width, startAngle: a0, endAngle: a1, clockwise: false)
      ctx.closePath()
      ctx.setFillColor(NSColor(hue: CGFloat(i) / CGFloat(steps), saturation: 1, brightness: 1, alpha: 1).cgColor)
      ctx.fillPath()
    }
    ctx.restoreGState()
  }

  private func drawGlyph(_ look: TextLook, in r: CGRect, fg: NSColor) {
    let font = NSFont.systemFont(ofSize: 14, weight: .bold)
    var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: fg]
    let size = NSAttributedString(string: "A", attributes: attrs).size()
    let at = CGPoint(x: r.midX - size.width / 2, y: r.midY - size.height / 2)
    switch look {
    case .plain: break
    case .stroke:
      // White letter with a 3 pt outline (paint-order: stroke fill), both from the same glyph outline
      // so they line up, centred on the letter's own shape.
      guard let ctx = NSGraphicsContext.current?.cgContext else { break }
      var ch: UniChar = 65 // "A"
      var glyph: CGGlyph = 0
      CTFontGetGlyphsForCharacters(font, &ch, &glyph, 1)
      guard let outline = CTFontCreatePathForGlyph(font, glyph, nil) else { break }
      let box = outline.boundingBoxOfPath
      // Glyph outlines are y-up; this view is flipped.
      var t = CGAffineTransform(translationX: r.midX - box.midX, y: r.midY + box.midY).scaledBy(x: 1, y: -1)
      guard let path = outline.copy(using: &t) else { break }
      ctx.saveGState()
      ctx.addPath(path)
      ctx.setLineWidth(3)
      ctx.setLineJoin(.round)
      ctx.setStrokeColor(theme.glyphLine.cgColor)
      ctx.strokePath()
      ctx.addPath(path)
      ctx.setFillColor(theme.glyphFill.cgColor)
      ctx.fillPath()
      ctx.restoreGState()
      return
    case .light, .dark:
      let bg = CGRect(x: r.midX - size.width / 2 - 4, y: r.midY - size.height / 2 - 1, width: size.width + 8, height: size.height + 2)
      NSColor(hex: look == .light ? "#ffffff" : "#111111").setFill()
      NSBezierPath(roundedRect: bg, xRadius: 3, yRadius: 3).fill()
      let edge = NSBezierPath(roundedRect: bg.insetBy(dx: 0.5, dy: 0.5), xRadius: 3, yRadius: 3)
      theme.swatchEdge.setStroke()
      edge.stroke()
      attrs[.foregroundColor] = NSColor(hex: look == .light ? "#111111" : "#ffffff")
    }
    NSAttributedString(string: "A", attributes: attrs).draw(at: at)
  }
}
