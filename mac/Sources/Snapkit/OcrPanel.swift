import AppKit
import SnapkitCore

/** OcrPanel.tsx: the recognized text, editable, to check before copying ("Show text first"). */
final class OcrPanelView: NSView, NSTextViewDelegate {
  /** Liquid Glass: what's under the panel, blurred (set by capture mode). */
  var backdrop: GlassBackdrop?
  static let size = CGSize(width: 300, height: 200)
  private let theme: Theme
  private let scroll = NSScrollView()
  let text = NSTextView()
  private let ms: Int
  var onCopy: (String) -> Void = { _ in }
  var onClose: () -> Void = {}
  private var hovered: String?

  init(lines: [TextRecognition.Line], ms: Int, theme: Theme) {
    self.theme = theme
    self.ms = ms
    super.init(frame: CGRect(origin: .zero, size: OcrPanelView.size))
    wantsLayer = true
    let s = NSShadow()
    s.shadowColor = theme.shadow
    s.shadowBlurRadius = 24
    s.shadowOffset = NSSize(width: 0, height: -6)
    shadow = s
    scroll.frame = CGRect(x: 10, y: 34, width: 280, height: 200 - 34 - 46)
    scroll.hasVerticalScroller = true
    scroll.scrollerStyle = .overlay
    scroll.drawsBackground = false
    scroll.wantsLayer = true
    scroll.layer?.cornerRadius = 6
    scroll.layer?.backgroundColor = theme.hover.cgColor
    text.frame = scroll.bounds
    text.autoresizingMask = [.width]
    text.isRichText = false
    text.drawsBackground = false
    text.font = NSFont.systemFont(ofSize: 13)
    text.textColor = theme.foreground
    text.insertionPointColor = theme.foreground
    text.textContainerInset = CGSize(width: 8, height: 8)
    text.isAutomaticSpellingCorrectionEnabled = false
    text.isContinuousSpellCheckingEnabled = false
    let para = NSMutableParagraphStyle()
    para.lineHeightMultiple = 1.5
    text.defaultParagraphStyle = para
    text.typingAttributes = [.font: NSFont.systemFont(ofSize: 13), .foregroundColor: theme.foreground, .paragraphStyle: para]
    text.string = lines.map(\.text).joined(separator: "\n")
    text.textStorage?.setAttributes(text.typingAttributes, range: NSRange(location: 0, length: (text.string as NSString).length))
    text.delegate = self
    scroll.documentView = text
    addSubview(scroll)
  }

  required init?(coder: NSCoder) { fatalError() }
  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func rightMouseDown(with event: NSEvent) {}

  var lineCount: Int {
    let t = text.string.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? 0 : t.components(separatedBy: "\n").count
  }

  private var closeRect: CGRect { CGRect(x: bounds.maxX - 30, y: 8, width: 20, height: 20) }
  private func buttonRect(_ id: String) -> CGRect {
    let font = NSFont.systemFont(ofSize: 12)
    let copyW = NSAttributedString(string: "Copy text", attributes: [.font: font]).size().width + 20
    let oneW = NSAttributedString(string: "One line", attributes: [.font: font]).size().width + 20
    let y = bounds.maxY - 10 - 26
    return id == "copy" ? CGRect(x: bounds.maxX - 10 - copyW, y: y, width: copyW, height: 26) : CGRect(x: bounds.maxX - 10 - copyW - 6 - oneW, y: y, width: oneW, height: 26)
  }

  func textDidChange(_ notification: Notification) { needsDisplay = true }

  func textView(_ tv: NSTextView, doCommandBy sel: Selector) -> Bool {
    if sel == #selector(cancelOperation(_:)) { onClose(); return true }
    return false
  }

  override func keyDown(with e: NSEvent) {
    if e.keyCode == 53 { onClose() } else { super.keyDown(with: e) }
  }

  override func performKeyEquivalent(with e: NSEvent) -> Bool {
    if e.keyCode == 36 && e.modifierFlags.contains(.command) {
      onCopy(text.string)
      return true
    }
    return super.performKeyEquivalent(with: e)
  }

  /** Join the lines into one. */
  func oneLine() {
    text.string = text.string.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
    needsDisplay = true
  }

  override func mouseDown(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if closeRect.contains(p) { onClose() }
    else if buttonRect("copy").contains(p) { onCopy(text.string) }
    else if buttonRect("one").contains(p) { oneLine() }
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    theme.drawPanel(bounds, radius: theme.radius, backdrop: theme.glass ? backdrop?(self) : nil, in: ctx)
    let n = lineCount
    let head = NSAttributedString(string: "\(n) line\(n == 1 ? "" : "s") · \(String(format: "%.1f", Double(ms) / 1000)) s",
                                  attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: theme.foreground.withAlphaComponent(0.65)])
    head.draw(at: CGPoint(x: 10, y: 18 - head.size().height / 2))
    Icons.draw("close", in: closeRect, size: 14, color: theme.foreground.withAlphaComponent(0.65), ctx: ctx)
    for (id, label, primary) in [("one", "One line", false), ("copy", "Copy text", true)] {
      let r = buttonRect(id)
      (primary ? theme.activeBackground : theme.hover).setFill()
      NSBezierPath(roundedRect: r, xRadius: 6, yRadius: 6).fill()
      let s = NSAttributedString(string: label, attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: primary ? theme.activeForeground : theme.foreground])
      s.draw(at: CGPoint(x: r.midX - s.size().width / 2, y: r.midY - s.size().height / 2))
    }
  }

  /** Where the panel fits: right of the selection, else left, else below, kept on screen. */
  static func place(sel: LRect, screen: CGSize) -> CGPoint {
    let gap = 10.0, w = size.width, h = size.height
    var x = sel.x + sel.w + gap
    if x + w > screen.width - 8 { x = sel.x - gap - w }
    var y = sel.y
    if x < 8 {
      x = sel.x
      y = sel.y + sel.h + gap
    }
    return CGPoint(x: max(8, min(x, screen.width - w - 8)), y: max(8, min(y, screen.height - h - 8)))
  }
}
