import AppKit

/**
 * The capture window for one display: a borderless, non-activating panel above everything, on every
 * Space and over full-screen apps. Non-activating, so it takes the keyboard without making Snapkit
 * the active app: focus is back in the user's app the moment it closes.
 */
final class OverlayPanel: NSPanel {
  init(screen: NSScreen) {
    super.init(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    level = .screenSaver
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    // No appearance animation: under Reduce Motion it becomes a zoom that shows at the screen's edges.
    animationBehavior = .none
    isMovable = false
    acceptsMouseMovedEvents = true
    // Idle panels never take clicks, so one left on screen by mistake can't block the desktop.
    ignoresMouseEvents = true
    setFrame(screen.frame, display: false)
  }

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

/**
 * One ready panel per display, made at launch so capture mode opens at once. Hidden panels can lose
 * their place on every Space after Mission Control changes, full-screen Spaces or sleep (WindowServer
 * keeps them on one desktop only); re-setting their collection behaviour doesn't repair that, a new
 * window does. So the pool is rebuilt after those events, while no capture is open.
 */
final class OverlayPool {
  private(set) var entries: [CGDirectDisplayID: (panel: OverlayPanel, view: OverlayView)] = [:]
  var isBusy: () -> Bool = { false }
  var makeView: (NSScreen) -> OverlayView = { OverlayView(frame: NSRect(origin: .zero, size: $0.frame.size)) }
  private var pending: DispatchWorkItem?
  private var rebuildWhenIdle = false

  init() {
    let ws = NSWorkspace.shared.notificationCenter
    ws.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.schedule("Space changed") }
    ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.schedule("woke from sleep") }
    ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.schedule("screens woke") }
    NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
      self?.schedule("displays changed")
    }
  }

  func rebuild() {
    for e in entries.values { e.panel.orderOut(nil); e.panel.close() }
    entries = [:]
    for s in NSScreen.screens { entries[s.displayID] = make(s) }
  }

  /** A fresh panel for one display (the old one never reached the screen). */
  func replace(_ id: CGDirectDisplayID) -> (panel: OverlayPanel, view: OverlayView)? {
    guard let screen = NSScreen.screens.first(where: { $0.displayID == id }) else { return nil }
    if let old = entries[id] { old.panel.orderOut(nil); old.panel.close() }
    let e = make(screen)
    entries[id] = e
    return e
  }

  /** The panel for a display, made now if it's new. */
  func entry(for screen: NSScreen) -> (panel: OverlayPanel, view: OverlayView) {
    if let e = entries[screen.displayID] { return e }
    let e = make(screen)
    entries[screen.displayID] = e
    return e
  }

  /** Rebuild soon (events come in bursts during Mission Control gestures); after capture mode if it's open. */
  func schedule(_ reason: String) {
    pending?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      if self.isBusy() {
        self.rebuildWhenIdle = true
        return
      }
      log("[overlay] new capture windows: \(reason)")
      self.rebuild()
    }
    pending = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
  }

  /** Capture mode closed: do a rebuild that had to wait. */
  func captureEnded() {
    guard rebuildWhenIdle else { return }
    rebuildWhenIdle = false
    schedule("deferred until capture mode closed")
  }

  private func make(_ screen: NSScreen) -> (panel: OverlayPanel, view: OverlayView) {
    let panel = OverlayPanel(screen: screen)
    let view = makeView(screen)
    view.autoresizingMask = [.width, .height]
    panel.contentView = view
    // Warm it: one invisible pass on screen so WindowServer has its surface ready for the first capture.
    panel.alphaValue = 0
    panel.orderFrontRegardless()
    DispatchQueue.main.async {
      // A capture that started meanwhile sets the alpha back to 1 and keeps the panel.
      if panel.alphaValue == 0 {
        panel.orderOut(nil)
        panel.alphaValue = 1
      }
    }
    return (panel, view)
  }
}
