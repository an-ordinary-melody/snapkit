import AppKit
import SnapkitCore

/**
 * Opens and closes capture mode across all displays (src/main/overlay.ts). Safeguards kept from
 * Electron: the hotkey again closes it whatever state it's in, it closes by itself after 3 minutes
 * without input, and a capture window that didn't reach the screen is replaced at once.
 */
final class CaptureController: OverlayViewDelegate {
  let store: SettingsStore
  let pool: OverlayPool
  let grabber: ScreenGrabber
  private(set) var active = false
  private(set) var session = 0
  private var idleTimer: Timer?
  private var openedAt = Date.distantPast
  /** Any input since capture mode opened (tells a capture you saw from one that never showed). */
  private var touched = false
  var onModeChange: (Bool) -> Void = { _ in }

  /** Seconds without input before capture mode closes itself (`-SnapkitIdleSeconds` for tests). */
  private var idleLimit: TimeInterval {
    let v = UserDefaults.standard.double(forKey: "SnapkitIdleSeconds")
    return v > 0 ? v : 180
  }

  init(store: SettingsStore, pool: OverlayPool, grabber: ScreenGrabber) {
    self.store = store
    self.pool = pool
    self.grabber = grabber
    pool.isBusy = { [weak self] in self?.active ?? false }
    pool.makeView = { [weak self] screen in
      let v = OverlayView(frame: NSRect(origin: .zero, size: screen.frame.size))
      v.delegate = self
      return v
    }
  }

  /** The capture hotkey / menu item: open capture mode, or close it if it's open. */
  func toggle() {
    if active {
      // Pressed again right after opening, with no input in between: the window most likely never
      // showed. Replace the windows, as a restart would.
      if !touched && Date().timeIntervalSince(openedAt) < 10 {
        log("[overlay] hotkey again with no input since opening: replacing the capture windows")
        end(reason: "hotkey pressed again")
        pool.rebuild()
      } else {
        end(reason: "hotkey pressed again")
      }
      return
    }
    start()
  }

  func start(preset: (CGDirectDisplayID, LRect)? = nil) {
    guard !active else { return }
    if grabber.testImage == nil && !CGPreflightScreenCaptureAccess() {
      Permissions.ask()
      return
    }
    let t0 = Date()
    active = true
    touched = false
    openedAt = t0
    session += 1
    let settings = store.current
    let screens = NSScreen.screens
    let mouse = NSEvent.mouseLocation
    onModeChange(true)

    for screen in screens {
      let e = pool.entry(for: screen)
      e.view.arm(session: session, settings: settings, preset: preset?.0 == screen.displayID ? preset?.1 : nil)
      show(e.panel, on: screen)
    }
    // The keyboard goes to the display under the pointer.
    if let s = screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? screens.first, let e = pool.entries[s.displayID] {
      e.panel.makeKey()
      e.panel.makeFirstResponder(e.view)
    }
    let session = self.session
    grabber.grab(screens, engine: engineId(settings.capture.engine), belowWindow: { [weak self] id in
      self?.pool.entries[id].map { CGWindowID($0.panel.windowNumber) }
    }) { [weak self] id, image in
      guard let self, self.active, self.session == session, let e = self.pool.entries[id] else { return }
      if image == nil { log("[capture] no image for display \(id)") }
      e.view.setImage(image)
      if screens.first?.displayID == id { log("[capture] opened in \(ms(t0)) ms") }
    }
    touchIdle()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.checkPresented(session: session) }
  }

  private func show(_ panel: OverlayPanel, on screen: NSScreen) {
    panel.alphaValue = 1
    panel.setFrame(screen.frame, display: false)
    panel.ignoresMouseEvents = false
    panel.orderFrontRegardless()
  }

  /**
   * Each panel should be on screen now. One that isn't (WindowServer refused it, or it lost its place
   * on this Space) is replaced by a fresh window and shown again.
   */
  private func checkPresented(session: Int) {
    guard active, self.session == session else { return }
    for screen in NSScreen.screens {
      guard let e = pool.entries[screen.displayID] else { continue }
      let ok = e.panel.isVisible && e.panel.isOnActiveSpace && e.panel.occlusionState.contains(.visible)
      guard !ok else { continue }
      log("[overlay] capture window on display \(screen.displayID) isn't on screen (visible \(e.panel.isVisible), this Space \(e.panel.isOnActiveSpace)): replacing it")
      let image = e.view.image
      let sel = e.view.sel
      e.panel.orderOut(nil)
      guard let fresh = pool.replace(screen.displayID) else { continue }
      fresh.view.arm(session: session, settings: store.current, preset: sel)
      fresh.view.setImage(image)
      show(fresh.panel, on: screen)
      if NSMouseInRect(NSEvent.mouseLocation, screen.frame, false) {
        fresh.panel.makeKey()
        fresh.panel.makeFirstResponder(fresh.view)
      }
    }
  }

  func end(reason: String) {
    guard active else { return }
    active = false
    idleTimer?.invalidate()
    idleTimer = nil
    for e in pool.entries.values {
      e.view.clear()
      e.panel.ignoresMouseEvents = true
      e.panel.orderOut(nil)
    }
    log("capture closed: \(reason)")
    onModeChange(false)
    pool.captureEnded()
  }

  private func touchIdle() {
    idleTimer?.invalidate()
    idleTimer = Timer.scheduledTimer(withTimeInterval: idleLimit, repeats: false) { [weak self] _ in
      guard let self else { return }
      self.end(reason: "no input for \(Int(self.idleLimit)) s")
    }
  }

  private func engineId(_ setting: String) -> String {
    setting == "coregraphics" ? "coregraphics" : "screencapturekit"
  }

  // MARK: - OverlayViewDelegate

  func overlaySelectionStarted(_ view: OverlayView) {
    for e in pool.entries.values where e.view !== view { e.view.clearSelection() }
  }

  func overlayActivity(_ view: OverlayView) {
    touched = true
    touchIdle()
  }

  func overlayCancel(_ view: OverlayView) {
    end(reason: "closed")
  }

  func overlayCopy(_ view: OverlayView) {
    guard let out = view.renderOutput(), let png = Output.png(out) else { return }
    Output.copy(png)
    rememberArea(view)
    log("[copy] \(out.width)×\(out.height), \(png.count / 1024) KB")
    end(reason: "copied")
  }

  func overlaySave(_ view: OverlayView) {
    guard let out = view.renderOutput(), let png = Output.png(out) else { return }
    rememberArea(view)
    // Out of the way first: the save dialog must not sit behind the capture windows.
    end(reason: "saving")
    _ = Output.save(png, store: store)
    // A save dialog made Snapkit the active app: give focus back to the app the user was in.
    if store.current.save.askLocation { NSApp.hide(nil) }
  }

  /** "Capture last area": the area just copied or saved, on its display. */
  private func rememberArea(_ view: OverlayView) {
    guard let sel = view.sel, let screen = view.window?.screen else { return }
    let primaryHeight = NSScreen.screens.first?.frame.height ?? screen.frame.height
    let f = screen.frame
    let area = LastArea(displayId: screen.displayID,
                        displayBounds: .init(x: f.minX, y: primaryHeight - f.maxY, width: f.width, height: f.height),
                        rect: .init(x: sel.x, y: sel.y, width: sel.w, height: sel.h))
    do { try area.save(Paths.lastAreaFile) } catch { log("[last area] couldn't save it: \(error.localizedDescription)") }
  }
}

/** Screen Recording permission: without it captures show only the wallpaper, so explain instead. */
enum Permissions {
  static func ask() {
    // The first time, this shows macOS's own prompt and lists Snapkit in System Settings.
    let asked = CGRequestScreenCaptureAccess()
    if asked { return }
    log("[permissions] no Screen Recording permission")
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Snapkit needs Screen Recording permission"
    alert.informativeText = "Turn on \(Paths.appName) in System Settings → Privacy & Security → Screen & System Audio Recording, then capture again. macOS may ask you to reopen Snapkit."
    alert.addButton(withTitle: "Open System Settings")
    alert.addButton(withTitle: "Cancel")
    if alert.runModal() == .alertFirstButtonReturn,
       let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
      NSWorkspace.shared.open(url)
    }
  }
}
