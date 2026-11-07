import AppKit
import SnapkitCore

/**
 * Slider.tsx: a thin 3 pt track, filled up to the value, with a white 24×15 capsule knob that grows
 * while held. `rainbow` draws the colour picker's hue track (8 pt) instead.
 */
final class SliderView: NSView {
  var min: Double
  var max: Double
  var step: Double
  var value: Double { didSet { needsDisplay = true } }
  var theme: Theme { didSet { needsDisplay = true } }
  var rainbow = false
  /** `continuous`: part of a drag (one undo step). */
  var onChange: (Double) -> Void = { _ in }
  var onEnd: () -> Void = {}
  private var held = false

  init(min: Double, max: Double, step: Double = 1, value: Double, theme: Theme) {
    self.min = min
    self.max = max
    self.step = step
    self.value = value
    self.theme = theme
    super.init(frame: .zero)
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  private let knob = CGSize(width: 24, height: 15)
  private var inset: CGFloat { rainbow ? 7 : 12 }

  override func draw(_ dirtyRect: NSRect) {
    let pct = max > min ? (value - min) / (max - min) : 0
    let trackH: CGFloat = rainbow ? 8 : 3
    let track = CGRect(x: inset, y: bounds.midY - trackH / 2, width: bounds.width - inset * 2, height: trackH)
    if rainbow {
      let g = NSGradient(colors: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"].map { NSColor(hex: $0) })!
      g.draw(in: NSBezierPath(roundedRect: track, xRadius: 4, yRadius: 4), angle: 0)
    } else {
      theme.track.setFill()
      NSBezierPath(roundedRect: track, xRadius: 1.5, yRadius: 1.5).fill()
      theme.trackFill.setFill()
      NSBezierPath(roundedRect: CGRect(x: track.minX, y: track.minY, width: track.width * pct, height: trackH), xRadius: 1.5, yRadius: 1.5).fill()
    }
    let k = held ? 1.35 : 1
    let kw = knob.width * k, kh = knob.height * k
    let kr = CGRect(x: track.minX + track.width * pct - kw / 2, y: bounds.midY - kh / 2, width: kw, height: kh)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
    shadow.shadowBlurRadius = 4
    shadow.shadowOffset = NSSize(width: 0, height: -1)
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor.white.setFill()
    NSBezierPath(roundedRect: kr, xRadius: kh / 2, yRadius: kh / 2).fill()
    NSGraphicsContext.restoreGraphicsState()
    NSColor.black.withAlphaComponent(0.28).setStroke()
    let edge = NSBezierPath(roundedRect: kr.insetBy(dx: -0.25, dy: -0.25), xRadius: kh / 2, yRadius: kh / 2)
    edge.lineWidth = 0.5
    edge.stroke()
  }

  private func set(from e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    let t = Swift.max(0, Swift.min(1, (p.x - inset) / (bounds.width - inset * 2)))
    var v = min + (max - min) * t
    v = (v / step).rounded() * step
    if v != value {
      value = v
      onChange(v)
    }
  }

  override func mouseDown(with e: NSEvent) {
    held = true
    set(from: e)
  }
  override func mouseDragged(with e: NSEvent) { set(from: e) }
  override func mouseUp(with e: NSEvent) {
    held = false
    needsDisplay = true
    onEnd()
  }
}

/** The style bar's text size field (8–200, applied as you type). */
final class SizeField: NSTextField, NSTextFieldDelegate {
  var onValue: (Double) -> Void = { _ in }
  var theme: Theme { didSet { apply() } }

  init(value: Double, theme: Theme) {
    self.theme = theme
    super.init(frame: CGRect(x: 0, y: 0, width: 38, height: 26))
    isBordered = false
    focusRingType = .none
    alignment = .center
    font = NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .regular)
    stringValue = String(Int(value))
    delegate = self
    wantsLayer = true
    layer?.cornerRadius = 7
    apply()
  }

  required init?(coder: NSCoder) { fatalError() }

  private func apply() {
    drawsBackground = false
    layer?.backgroundColor = theme.field.cgColor
    textColor = theme.foreground
  }

  func controlTextDidChange(_ obj: Notification) {
    if let v = Double(stringValue), v >= 8, v <= 200 { onValue(v.rounded()) }
  }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
    if sel == #selector(insertNewline(_:)) || sel == #selector(cancelOperation(_:)) {
      window?.makeFirstResponder(superview?.superview)
      return true
    }
    return false
  }
}

/** A plain number next to a slider (.style-bar .value). */
final class ValueLabel: NSView {
  var text = "" { didSet { needsDisplay = true } }
  var color: NSColor = .white
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func draw(_ dirtyRect: NSRect) {
    let s = NSAttributedString(string: text, attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular), .foregroundColor: color])
    let size = s.size()
    s.draw(at: CGPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2))
  }
}

/** Tooltip (.tip): label, shortcut key, and a second dimmer line. */
final class TooltipView: NSView {
  private let text: String
  private let hint: String?
  private let sub: String?
  private let theme: Theme

  init(text: String, hint: String?, sub: String?, theme: Theme) {
    self.text = text
    self.hint = hint
    self.sub = sub
    self.theme = theme
    super.init(frame: .zero)
    wantsLayer = true
    let s = NSShadow()
    s.shadowColor = NSColor.black.withAlphaComponent(0.3)
    s.shadowBlurRadius = 10
    s.shadowOffset = NSSize(width: 0, height: -2)
    shadow = s
    setFrameSize(measure())
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  private var main: NSAttributedString { NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 11.5), .foregroundColor: theme.tipForeground]) }
  private var key: NSAttributedString? { hint.map { NSAttributedString(string: $0, attributes: [.font: NSFont.systemFont(ofSize: 10.5), .foregroundColor: NSColor(hex: "#a1a1aa")]) } }
  private var second: NSAttributedString? { sub.map { NSAttributedString(string: $0, attributes: [.font: NSFont.systemFont(ofSize: 10.5), .foregroundColor: NSColor(hex: "#a1a1aa")]) } }

  private func measure() -> CGSize {
    var w = main.size().width
    if let k = key { w += 6 + k.size().width + 8 }
    var h = main.size().height
    if let s = second {
      w = max(w, s.size().width)
      h += 2 + s.size().height
    }
    return CGSize(width: ceil(w) + 16, height: ceil(h) + 8)
  }

  override func draw(_ dirtyRect: NSRect) {
    theme.tipBackground.setFill()
    NSBezierPath(roundedRect: bounds, xRadius: 5, yRadius: 5).fill()
    main.draw(at: CGPoint(x: 8, y: 4))
    if let k = key {
      let x = 8 + main.size().width + 6
      let box = CGRect(x: x, y: 4 + (main.size().height - k.size().height) / 2 - 0.5, width: k.size().width + 8, height: k.size().height + 1)
      let p = NSBezierPath(roundedRect: box, xRadius: 3, yRadius: 3)
      NSColor.white.withAlphaComponent(0.18).setStroke()
      p.lineWidth = 1
      p.stroke()
      k.draw(at: CGPoint(x: box.minX + 4, y: box.minY + 0.5))
    }
    if let s = second { s.draw(at: CGPoint(x: 8, y: 4 + main.size().height + 2)) }
  }
}

/** Where a popover goes next to a button: beside a vertical bar's button, below/above a horizontal one's, on screen. */
func popoverOrigin(anchor r: CGRect, vertical: Bool, size: CGSize, screen: CGSize, gap: CGFloat = 8) -> CGPoint {
  if vertical {
    let right = r.maxX + gap + size.width < screen.width
    let y = min(max(r.midY, size.height / 2 + 6), screen.height - size.height / 2 - 6) - size.height / 2
    return CGPoint(x: right ? r.maxX + gap : r.minX - gap - size.width, y: y)
  }
  let below = r.maxY + gap + size.height < screen.height
  let x = min(max(r.midX, size.width / 2 + 6), screen.width - size.width / 2 - 6) - size.width / 2
  return CGPoint(x: x, y: below ? r.maxY + gap : r.minY - gap - size.height)
}

/** A floating panel in capture mode (--ui-bg-strong, rounded, shadowed). */
class PopoverView: NSView {
  var theme: Theme { didSet { needsDisplay = true } }
  var radius: CGFloat = 9

  init(theme: Theme) {
    self.theme = theme
    super.init(frame: .zero)
    wantsLayer = true
    let s = NSShadow()
    s.shadowColor = theme.shadow
    s.shadowBlurRadius = 24
    s.shadowOffset = NSSize(width: 0, height: -6)
    shadow = s
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  // Clicks inside never fall through to capture mode.
  override func mouseDown(with event: NSEvent) {}
  override func rightMouseDown(with event: NSEvent) {}

  override func draw(_ dirtyRect: NSRect) {
    theme.strongBackground.setFill()
    NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    let rim = NSBezierPath(roundedRect: bounds.insetBy(dx: theme.rimWidth / 2, dy: theme.rimWidth / 2), xRadius: radius, yRadius: radius)
    rim.lineWidth = theme.rimWidth
    theme.rim.setStroke()
    rim.stroke()
  }
}

/** A tool's right-click menu of variants (.variant-menu): icon, label, check on the current one. */
final class VariantMenuView: PopoverView {
  private let variants: [FeatureVariant]
  private let current: String
  private var hovered: Int?
  var onPick: (String) -> Void = { _ in }

  init(variants: [FeatureVariant], current: String, theme: Theme) {
    self.variants = variants
    self.current = current
    super.init(theme: theme)
    setFrameSize(CGSize(width: 190, height: CGFloat(variants.count) * 31 - 1 + 8))
  }

  required init?(coder: NSCoder) { fatalError() }

  private func row(_ i: Int) -> CGRect { CGRect(x: 4, y: 4 + CGFloat(i) * 31, width: bounds.width - 8, height: 30) }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for t in trackingAreas { removeTrackingArea(t) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways], owner: self))
  }

  override func mouseMoved(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    let h = variants.indices.first { row($0).contains(p) }
    if h != hovered {
      hovered = h
      needsDisplay = true
    }
  }

  override func mouseExited(with e: NSEvent) {
    hovered = nil
    needsDisplay = true
  }

  override func mouseUp(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if let i = variants.indices.first(where: { row($0).contains(p) }) { onPick(variants[i].id) }
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    for (i, v) in variants.enumerated() {
      let r = row(i)
      let hot = i == hovered
      if hot {
        theme.activeBackground.setFill()
        NSBezierPath(roundedRect: r, xRadius: 6, yRadius: 6).fill()
      }
      let fg = hot ? theme.activeForeground : theme.foreground
      Icons.draw(v.id, in: CGRect(x: r.minX + 10, y: r.minY, width: 16, height: r.height), size: 16, color: fg, ctx: ctx)
      let label = NSAttributedString(string: v.label, attributes: [.font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: fg])
      label.draw(at: CGPoint(x: r.minX + 36, y: r.midY - label.size().height / 2))
      if v.id == current {
        Icons.draw("check", in: CGRect(x: r.maxX - 24, y: r.minY, width: 14, height: r.height), size: 14, color: fg.withAlphaComponent(0.9), ctx: ctx)
      }
    }
  }
}

/** ColorPicker.tsx: saturation/brightness square, hue slider and a hex field. */
final class ColorPickerView: PopoverView, NSTextFieldDelegate {
  private var h: Double, s: Double, v: Double
  private let hue: SliderView
  private let hex = NSTextField()
  private var draggingSquare = false
  var onChange: (String) -> Void = { _ in }
  var onClose: () -> Void = {}

  init(color: String, theme: Theme) {
    (h, s, v) = ColorPickerView.hsv(color)
    hue = SliderView(min: 0, max: 359, value: h.rounded(), theme: theme)
    super.init(theme: theme)
    radius = 10
    setFrameSize(CGSize(width: 200, height: 10 + 130 + 10 + 18 + 10 + 26 + 10))
    hue.rainbow = true
    hue.frame = CGRect(x: 10, y: 150, width: 180, height: 18)
    hue.onChange = { [weak self] val in
      guard let self else { return }
      self.h = val
      self.changed()
    }
    addSubview(hue)
    hex.frame = CGRect(x: 10 + 24 + 8, y: 178, width: 200 - 20 - 32, height: 26)
    hex.isBordered = false
    hex.focusRingType = .none
    hex.drawsBackground = false
    hex.wantsLayer = true
    hex.layer?.cornerRadius = 5
    hex.layer?.backgroundColor = theme.field.cgColor
    hex.textColor = theme.foreground
    hex.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    hex.stringValue = HexColor.parse(color) ?? color
    hex.delegate = self
    addSubview(hex)
  }

  required init?(coder: NSCoder) { fatalError() }

  private var square: CGRect { CGRect(x: 10, y: 10, width: 180, height: 130) }
  private var current: String { ColorPickerView.hex(h: h, s: s, v: v) }

  private func changed() {
    hex.stringValue = current
    needsDisplay = true
    onChange(current)
  }

  override func mouseDown(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    guard square.contains(p) else { return }
    draggingSquare = true
    pick(p)
  }

  override func mouseDragged(with e: NSEvent) {
    if draggingSquare { pick(convert(e.locationInWindow, from: nil)) }
  }

  override func mouseUp(with e: NSEvent) { draggingSquare = false }

  private func pick(_ p: CGPoint) {
    s = max(0, min(1, (p.x - square.minX) / square.width))
    v = 1 - max(0, min(1, (p.y - square.minY) / square.height))
    changed()
  }

  func controlTextDidChange(_ obj: Notification) {
    guard let c = HexColor.parse(hex.stringValue) else { return }
    (h, s, v) = ColorPickerView.hsv(c)
    hue.value = h.rounded()
    needsDisplay = true
    onChange(c)
  }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
    if sel == #selector(insertNewline(_:)) || sel == #selector(cancelOperation(_:)) {
      onClose()
      return true
    }
    return false
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let sq = NSBezierPath(roundedRect: square, xRadius: 6, yRadius: 6)
    NSGraphicsContext.saveGraphicsState()
    sq.addClip()
    NSColor(hue: h / 360, saturation: 1, brightness: 1, alpha: 1).setFill()
    square.fill()
    NSGradient(starting: .white, ending: NSColor.white.withAlphaComponent(0))!.draw(in: square, angle: 0)
    NSGradient(starting: .black, ending: NSColor.black.withAlphaComponent(0))!.draw(in: square, angle: 270)
    NSGraphicsContext.restoreGraphicsState()
    let dot = CGRect(x: square.minX + s * square.width - 6, y: square.minY + (1 - v) * square.height - 6, width: 12, height: 12)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.4)
    shadow.shadowBlurRadius = 3
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor.white.setFill()
    NSBezierPath(ovalIn: dot.insetBy(dx: -2, dy: -2)).fill()
    NSGraphicsContext.restoreGraphicsState()
    NSColor(hex: current).setFill()
    NSBezierPath(ovalIn: dot).fill()
    let preview = CGRect(x: 10, y: 178, width: 24, height: 24)
    NSColor(hex: current).setFill()
    NSBezierPath(roundedRect: preview, xRadius: 5, yRadius: 5).fill()
    theme.swatchEdge.setStroke()
    NSBezierPath(roundedRect: preview.insetBy(dx: 0.5, dy: 0.5), xRadius: 5, yRadius: 5).stroke()
  }

  /** hexToHsv in color.ts (h 0–360, s/v 0–1). */
  static func hsv(_ hexString: String) -> (Double, Double, Double) {
    let (r, g, b) = HexColor.rgb(hexString)
    let mx = max(r, g, b), d = mx - min(r, g, b)
    var hh = 0.0
    if d > 0 {
      if mx == r { hh = ((g - b) / d).truncatingRemainder(dividingBy: 6) } else if mx == g { hh = (b - r) / d + 2 } else { hh = (r - g) / d + 4 }
    }
    return ((hh * 60 + 360).truncatingRemainder(dividingBy: 360), mx > 0 ? d / mx : 0, mx)
  }

  /** hsvToHex in color.ts. */
  static func hex(h: Double, s: Double, v: Double) -> String {
    func f(_ k: Double) -> Double {
      let x = (k + h / 60).truncatingRemainder(dividingBy: 6)
      return v - v * s * max(0, min(x, 4 - x, 1))
    }
    func to(_ c: Double) -> String { String(format: "%02x", Int(jsRound(c * 255))) }
    return "#" + to(f(5)) + to(f(3)) + to(f(1))
  }
}
