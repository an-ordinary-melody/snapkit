import CoreGraphics

// Capture-mode geometry: a port of src/renderer/src/overlay/layout.ts. All values are in screen
// points with a top-left origin, like the Electron overlay's CSS pixels.

public struct LRect: Equatable {
  public var x, y, w, h: Double
  public init(x: Double, y: Double, w: Double, h: Double) {
    self.x = x
    self.y = y
    self.w = w
    self.h = h
  }
  public var cg: CGRect { CGRect(x: x, y: y, width: w, height: h) }
  public init(_ r: CGRect) { self.init(x: r.minX, y: r.minY, w: r.width, h: r.height) }
  public func contains(_ p: CGPoint) -> Bool { p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h }
}

public struct LSize: Equatable {
  public var w, h: Double
  public init(w: Double, h: Double) {
    self.w = w
    self.h = h
  }
}

public enum Side: String { case below, above, inside, right, left }

public struct ToolbarLayout: Equatable {
  public var actions: CGPoint
  public var actionsSide: Side
  public var tools: CGPoint
  public var toolsSide: Side
}

public enum Handle: String, CaseIterable { case n, s, e, w, ne, nw, se, sw }

public enum OverlayLayout {
  static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { max(lo, min(hi, v)) }

  static func overlaps(_ a: LRect, _ b: LRect) -> Bool { a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h }

  /**
   * Lightshot-style toolbar placement. Action bar (horizontal): below the selection, right-aligned;
   * else above; else inside the bottom edge. Tool bar (vertical): right of the selection,
   * bottom-aligned; else left; else inside the right edge. They never overlap or leave the screen.
   */
  public static func placeToolbars(sel: LRect, screen: LSize, actions: LSize, tools: LSize, gap: Double = 8, margin: Double = 6) -> ToolbarLayout {
    let maxX = { (w: Double) in screen.w - w - margin }
    let maxY = { (h: Double) in screen.h - h - margin }

    var aSide = Side.below
    var ay = sel.y + sel.h + gap
    if ay > maxY(actions.h) {
      aSide = .above
      ay = sel.y - gap - actions.h
      if ay < margin {
        aSide = .inside
        ay = sel.y + sel.h - gap - actions.h
      }
    }
    var ax = clamp(sel.x + sel.w - actions.w, margin, maxX(actions.w))
    ay = clamp(ay, margin, maxY(actions.h))

    var tSide = Side.right
    var tx = sel.x + sel.w + gap
    if tx > maxX(tools.w) {
      tSide = .left
      tx = sel.x - gap - tools.w
      if tx < margin {
        tSide = .inside
        tx = sel.x + sel.w - gap - tools.w
      }
    }
    tx = clamp(tx, margin, maxX(tools.w))
    var ty = clamp(sel.y + sel.h - tools.h, margin, maxY(tools.h))

    // Move the tool bar vertically out of the action bar's way; if it still collides, slide the action bar sideways.
    let aRect = { LRect(x: ax, y: ay, w: actions.w, h: actions.h) }
    let tRect = { LRect(x: tx, y: ty, w: tools.w, h: tools.h) }
    if overlaps(aRect(), tRect()) {
      let upY = ay - gap - tools.h
      let downY = ay + actions.h + gap
      if upY >= margin { ty = upY } else if downY <= maxY(tools.h) { ty = downY }
    }
    if overlaps(aRect(), tRect()) {
      let leftX = tx - gap - actions.w
      ax = leftX >= margin ? leftX : clamp(tx + tools.w + gap, margin, maxX(actions.w))
    }
    return ToolbarLayout(actions: CGPoint(x: ax, y: ay), actionsSide: aSide, tools: CGPoint(x: tx, y: ty), toolsSide: tSide)
  }

  /** Normalise a drag from a to b into a rect clamped to the screen. */
  public static func rectFromPoints(_ a: CGPoint, _ b: CGPoint, screen: LSize) -> LRect {
    let x1 = clamp(min(a.x, b.x), 0, screen.w)
    let y1 = clamp(min(a.y, b.y), 0, screen.h)
    let x2 = clamp(max(a.x, b.x), 0, screen.w)
    let y2 = clamp(max(a.y, b.y), 0, screen.h)
    return LRect(x: x1, y: y1, w: x2 - x1, h: y2 - y1)
  }

  /** Resize by dragging a handle by (dx, dy). Can flip past the opposite edge. */
  public static func resizeRect(_ start: LRect, handle: Handle, dx: Double, dy: Double, screen: LSize) -> LRect {
    var x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h
    let h = handle.rawValue
    if h.contains("w") { x1 += dx }
    if h.contains("e") { x2 += dx }
    if h.contains("n") { y1 += dy }
    if h.contains("s") { y2 += dy }
    return rectFromPoints(CGPoint(x: x1, y: y1), CGPoint(x: x2, y: y2), screen: screen)
  }

  /** Move by (dx, dy), keeping the rect fully on screen. */
  public static func moveRect(_ start: LRect, dx: Double, dy: Double, screen: LSize) -> LRect {
    var r = start
    r.x = clamp(start.x + dx, 0, screen.w - start.w)
    r.y = clamp(start.y + dy, 0, screen.h - start.h)
    return r
  }

  /**
   * Style bar: in the action bar's row, to its left; if that doesn't fit or hits the tool bar, in a
   * row of its own next to the action bar (below if there's room, else above).
   */
  public static func placeStyleBar(actions: LRect, tools: LRect, bar: LSize, screen: LSize, gap: Double = 8, margin: Double = 6) -> CGPoint {
    func fits(_ r: LRect) -> Bool {
      r.x >= margin && r.y >= margin && r.x + r.w <= screen.w - margin && r.y + r.h <= screen.h - margin && !overlaps(r, tools) && !overlaps(r, actions)
    }
    let sameRow = LRect(x: actions.x - gap - bar.w, y: actions.y + (actions.h - bar.h) / 2, w: bar.w, h: bar.h)
    if fits(sameRow) { return CGPoint(x: sameRow.x, y: sameRow.y) }
    let x = clamp(actions.x + actions.w - bar.w, margin, screen.w - margin - bar.w)
    let below = LRect(x: x, y: actions.y + actions.h + gap, w: bar.w, h: bar.h)
    if fits(below) { return CGPoint(x: below.x, y: below.y) }
    let above = LRect(x: x, y: actions.y - gap - bar.h, w: bar.w, h: bar.h)
    if fits(above) { return CGPoint(x: above.x, y: above.y) }
    return CGPoint(x: x, y: clamp(below.y, margin, screen.h - margin - bar.h))
  }

  /** Where a handle sits on a rect. */
  public static func handlePoint(_ r: LRect, _ h: Handle) -> CGPoint {
    let s = h.rawValue
    let x = s.contains("w") ? r.x : s.contains("e") ? r.x + r.w : r.x + r.w / 2
    let y = s.contains("n") ? r.y : s.contains("s") ? r.y + r.h : r.y + r.h / 2
    return CGPoint(x: x, y: y)
  }
}
