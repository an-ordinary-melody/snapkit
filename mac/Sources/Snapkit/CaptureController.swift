import AppKit
import SnapkitCore
import UserNotifications

/** What happens to an output besides the clipboard or file (history; filled in by the app). */
struct OutputRecord {
  var final: CGImage
  var finalPNG: Data
  var doc: CaptureDoc
  var session: Int
}

/**
 * Opens and closes capture mode across all displays (src/main/overlay.ts), and turns outputs into
 * copies, saves, floating previews and history (output.ts, fullscreen.ts). Safeguards kept from
 * Electron: the hotkey again closes capture mode whatever state it's in, it closes by itself after
 * 3 minutes without input, and a capture window that didn't reach the screen is replaced.
 */
final class CaptureController: OverlayViewDelegate, FloatingDelegate {
  let store: SettingsStore
  let pool: OverlayPool
  let grabber: ScreenGrabber
  private(set) var active = false
  private(set) var session = 0
  private var idleTimer: Timer?
  private var openedAt = Date.distantPast
  /** Any input since capture mode opened (tells a capture you saw from one that never showed). */
  private var touched = false
  /** Floating preview after copy, for this capture (the pin button; starts from pin.afterCopy). */
  private var floatingOn = false
  /** Editing a floating preview: where the edited result goes. */
  private var editTarget: ((Data, CGImage, CaptureDoc) -> Void)?
  private var editOrigin: (sel: LRect, historyId: String?)?
  var onModeChange: (Bool) -> Void = { _ in }
  /** Every output (copy, save, preview, full screen): history records it. Returns the entry id. */
  var onOutput: (OutputRecord) -> String? = { _ in nil }
  private var nextFullscreenId = -1

  /** Seconds without input before capture mode closes itself (`-SnapkitIdleSeconds` for tests). */
  private var idleLimit: TimeInterval {
    let v = TestOption.double("SnapkitIdleSeconds")
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
    Floating.shared.delegate = self
    Floating.shared.settings = { [weak store] in store?.current ?? SettingsRules.defaults }
  }

  private var hasPermission: Bool { grabber.testImage != nil || CGPreflightScreenCaptureAccess() }

  /** The capture hotkey / menu item: open capture mode, or close it if it's open. */
  func toggle(textOnly: Bool = false) {
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
    start(textOnly: textOnly)
  }

  func start(preset: (CGDirectDisplayID, LRect)? = nil, textOnly: Bool = false) {
    guard !active else { return }
    guard hasPermission else {
      Permissions.ask()
      return
    }
    let t0 = Date()
    begin()
    let settings = store.current
    floatingOn = settings.pin.afterCopy
    let screens = NSScreen.screens
    for screen in screens {
      let e = pool.entry(for: screen)
      e.view.arm(session: session, settings: settings, preset: preset?.0 == screen.displayID ? preset?.1 : nil, textOnly: textOnly)
      updatePinButton(e.view)
      show(e.panel, on: screen)
    }
    focus(screens.first { $0.displayID == preset?.0 } ?? screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? screens.first)
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

  /**
   * Reopen a capture in the editor (from a floating preview): its plain crop with its drawings,
   * centred on the display under the pointer. Copy updates the preview and copies; Esc keeps the edits.
   */
  func edit(_ doc: CaptureDoc, onDone: @escaping (Data, CGImage, CaptureDoc) -> Void) {
    if active { end(reason: "editing a stored capture") }
    guard let crop = NSBitmapImageRep(data: doc.png)?.cgImage,
          let screen = NSScreen.screens.first(where: { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }) ?? NSScreen.screens.first else { return }
    begin()
    floatingOn = true
    editTarget = onDone
    editOrigin = (LRect(x: 0, y: 0, w: 0, h: 0), doc.historyId)
    let e = pool.entry(for: screen)
    e.view.armEdit(session: session, settings: store.current, doc: doc, crop: crop)
    show(e.panel, on: screen)
    focus(screen)
    touchIdle()
  }

  private func begin() {
    active = true
    touched = false
    openedAt = Date()
    session += 1
    editTarget = nil
    editOrigin = nil
    onModeChange(true)
  }

  private func focus(_ screen: NSScreen?) {
    guard let screen, let e = pool.entries[screen.displayID] else { return }
    e.panel.makeKey()
    e.panel.makeFirstResponder(e.view)
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
    guard active, self.session == session, editTarget == nil else { return }
    for screen in NSScreen.screens {
      guard let e = pool.entries[screen.displayID] else { continue }
      let ok = e.panel.isVisible && e.panel.isOnActiveSpace && e.panel.occlusionState.contains(.visible)
      guard !ok else { continue }
      log("[overlay] capture window on display \(screen.displayID) isn't on screen (visible \(e.panel.isVisible), this Space \(e.panel.isOnActiveSpace)): replacing it")
      let image = e.view.image
      let sel = e.view.sel
      let textOnly = e.view.textOnly
      e.panel.orderOut(nil)
      guard let fresh = pool.replace(screen.displayID) else { continue }
      fresh.view.arm(session: session, settings: store.current, preset: sel, textOnly: textOnly)
      fresh.view.setImage(image)
      updatePinButton(fresh.view)
      show(fresh.panel, on: screen)
      if NSMouseInRect(NSEvent.mouseLocation, screen.frame, false) { focus(screen) }
    }
  }

  func end(reason: String) {
    guard active else { return }
    active = false
    editTarget = nil
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

  private func updatePinButton(_ view: OverlayView) {
    view.floating = floatingOn
  }

  // MARK: - Full screen and last area (fullscreen.ts)

  /** The whole screen under the pointer, no capture mode: straight to the floating preview (and the clipboard if set). */
  func captureFullScreen() {
    let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.screens.first
    if let screen { captureRect(screen, nil) }
  }

  /**
   * "Capture last area": the area last copied or saved, copied right away (lastAreaInstant) or opened
   * selected in capture mode. Nothing remembered (or its display is gone): a normal capture.
   */
  func captureLastArea() {
    if active { return toggle() }
    let displays = NSScreen.screens.map { s -> (id: UInt32, bounds: LastArea.Rect) in
      let f = Floating.topLeftRect(s.frame)
      return (s.displayID, LastArea.Rect(x: f.minX, y: f.minY, width: f.width, height: f.height))
    }
    guard let last = LastArea.load(Paths.lastAreaFile)?.resolve(displays: displays),
          let screen = NSScreen.screens.first(where: { $0.displayID == last.id }) else { return start() }
    let size = screen.frame.size
    let r = LRect(x: last.rect.x, y: last.rect.y, w: min(last.rect.width, size.width - last.rect.x), h: min(last.rect.height, size.height - last.rect.y))
    if store.current.capture.lastAreaInstant { captureRect(screen, r) } else { start(preset: (screen.displayID, r)) }
  }

  /** Capture `rect` (points on `screen`) or, with nil, the whole display, without capture mode. */
  func captureRect(_ screen: NSScreen, _ rect: LRect?) {
    guard !active else { return }
    guard hasPermission else { return Permissions.ask() }
    let t0 = Date()
    let kind = rect == nil ? "fullscreen" : "last area"
    let id = nextFullscreenId
    nextFullscreenId -= 1
    grabber.grab([screen], engine: engineId(store.current.capture.engine), belowWindow: { _ in nil }) { [weak self] _, image in
      guard let self, let image else { return log("[\(kind)] capture failed") }
      let scale = CGFloat(image.width) / screen.frame.width
      let area = rect ?? LRect(x: 0, y: 0, w: screen.frame.width, h: screen.frame.height)
      guard let crop = Output.render(image: image, sel: area, scale: scale, shapes: [],
                                     env: RenderEnv(settings: self.store.current, source: image, imageScale: scale, pixelScale: scale)),
            let plainPNG = Output.png(crop) else { return }
      self.remember(screen: screen, area)
      let settings = self.store.current
      // "Background on by default" applies here too. The plain screenshot and the background stay in the
      // document, so Edit can still change it.
      let b = BeautifyState.initial(settings, last: nil)
      var final = crop
      if b.on, let bg = b.background(in: settings.beautify.presets), let d = BeautifyRenderer.draw(crop, bg: bg, state: b, scale: scale) { final = d }
      let finalPNG = final === crop ? plainPNG : (Output.png(final) ?? plainPNG)
      let doc = CaptureDoc(png: plainPNG, width: crop.width, height: crop.height, scale: Double(scale), shapes: [], beautify: b.on ? ((try? JSON.encode(b)) ?? .null) : .null)
      let global = self.globalRect(screen, area)
      if rect != nil || settings.capture.fullscreenCopy, let out = Output.outputPNG(final, kind: "copy", settings: settings, scale: scale) {
        Output.copy(out)
        self.notifyCopied()
      }
      if rect == nil || settings.pin.afterCopy {
        Floating.shared.preview(png: finalPNG, image: final, doc: doc, rect: global, session: id)
      }
      log("[\(kind)] \(crop.width)x\(crop.height) in \(ms(t0))ms")
      if let historyId = self.onOutput(OutputRecord(final: final, finalPNG: finalPNG, doc: doc, session: id)) {
        Floating.shared.link(session: id, historyId: historyId)
      }
    }
  }

  private func globalRect(_ screen: NSScreen, _ r: LRect) -> CGRect {
    let f = Floating.topLeftRect(screen.frame)
    return CGRect(x: f.minX + r.x, y: f.minY + r.y, width: r.w, height: r.h)
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
    // Leaving the editor of a floating preview keeps the edits there.
    if editTarget != nil { return overlayEditDone(view) }
    end(reason: "closed")
  }

  func overlayCopyText(_ view: OverlayView, _ text: String, closeAfter: Double) {
    let pb = Output.pasteboard
    pb.clearContents()
    pb.setString(text, forType: .string)
    log("[ocr] copied \(text.components(separatedBy: "\n").count) line(s) of text")
    let session = self.session
    DispatchQueue.main.asyncAfter(deadline: .now() + closeAfter) { [weak self] in
      if self?.session == session { self?.end(reason: "text copied") }
    }
  }

  func overlayEditDone(_ view: OverlayView) {
    guard let snap = snapshot(view) else { return end(reason: "editor closed") }
    editTarget?(snap.png, snap.image, snap.doc)
    let session = self.session
    end(reason: "editor closed, edits kept")
    _ = onOutput(OutputRecord(final: snap.image, finalPNG: snap.png, doc: snap.doc, session: session))
  }

  func overlayRememberBackground(_ view: OverlayView, _ state: BeautifyState, _ bg: BeautifyBackground) {
    let set = store.current.beautify
    let presets = set.presets.map { p -> BeautifyPreset in
      guard p.id == set.preset else { return p }
      var q = p
      (q.background, q.padding, q.radius, q.shadow) = (bg, state.padding, state.radius, state.shadow)
      return q
    }
    guard presets != set.presets, let json = try? JSON.encode(presets) else { return }
    store.update(.object([("beautify", .object([("presets", json)]))]))
  }

  func overlayAction(_ view: OverlayView, _ id: String) {
    switch id {
    case "settings":
      (NSApp.delegate as? AppDelegate)?.showSettings()
    case "pin":
      floatingOn.toggle()
      for e in pool.entries.values { updatePinButton(e.view) }
    default:
      log("[capture] action \(id) isn't built yet")
    }
  }

  /** The output with its document (plain crop + drawings relative to it). */
  private func snapshot(_ view: OverlayView) -> (png: Data, image: CGImage, doc: CaptureDoc, sel: LRect)? {
    guard let sel = view.sel, let plain = view.renderPlain(), let plainPNG = Output.png(plain), let out = view.renderOutput(), let png = Output.png(out) else { return nil }
    let doc = CaptureDoc(png: plainPNG, width: plain.width, height: plain.height, scale: Double(view.imageScale),
                         shapes: view.shapes.map { $0.moved(-sel.x, -sel.y) }, beautify: view.beautifyJSON, historyId: editOrigin?.historyId)
    return (png, out, doc, sel)
  }

  func overlayCopy(_ view: OverlayView) {
    guard let snap = snapshot(view), let screen = view.window?.screen else { return }
    let settings = store.current
    guard let out = Output.outputPNG(snap.image, kind: "copy", settings: settings, compress: view.compressOn, preset: view.compressPreset, scale: view.imageScale) else { return }
    Output.copy(out)
    log("[copy] \(snap.image.width)×\(snap.image.height), \(out.count / 1024) KB")
    notifyCopied()
    let session = self.session
    if let editTarget {
      editTarget(snap.png, snap.image, snap.doc)
    } else {
      remember(screen: screen, snap.sel)
      if floatingOn { Floating.shared.preview(png: snap.png, image: snap.image, doc: snap.doc, rect: globalRect(screen, snap.sel), session: session) }
    }
    end(reason: "copied")
    // History after the output, so the copy is never held up by it.
    DispatchQueue.main.async { [weak self] in
      guard let self, let historyId = self.onOutput(OutputRecord(final: snap.image, finalPNG: snap.png, doc: snap.doc, session: session)) else { return }
      Floating.shared.link(session: session, historyId: historyId)
    }
  }

  func overlaySave(_ view: OverlayView) {
    guard let snap = snapshot(view), let screen = view.window?.screen else { return }
    let settings = store.current
    guard let out = Output.outputPNG(snap.image, kind: "save", settings: settings, compress: view.compressOn, preset: view.compressPreset, scale: view.imageScale) else { return }
    if editTarget == nil { remember(screen: screen, snap.sel) } else { editTarget?(snap.png, snap.image, snap.doc) }
    let session = self.session
    // Out of the way first: the save dialog must not sit behind the capture windows.
    end(reason: "saving")
    saveFile(out)
    _ = onOutput(OutputRecord(final: snap.image, finalPNG: snap.png, doc: snap.doc, session: session))
  }

  /** Save a PNG (dialog or straight to the folder), notify, and give focus back after a dialog. */
  func saveFile(_ png: Data) {
    let url = Output.save(png, store: store)
    if store.current.save.askLocation { NSApp.hide(nil) }
    if let url, store.current.notifications.onSave {
      Notifier.post(title: "Screenshot saved", body: url.path, reveal: url)
    }
  }

  private func notifyCopied() {
    if store.current.notifications.onCopy { Notifier.post(title: "Copied", body: "Screenshot copied to clipboard") }
  }

  /** "Capture last area": remember the area just copied or saved, on its display. */
  private func remember(screen: NSScreen, _ sel: LRect) {
    let f = Floating.topLeftRect(screen.frame)
    let area = LastArea(displayId: screen.displayID, displayBounds: .init(x: f.minX, y: f.minY, width: f.width, height: f.height),
                        rect: .init(x: sel.x, y: sel.y, width: sel.w, height: sel.h))
    do { try area.save(Paths.lastAreaFile) } catch { log("[last area] couldn't save it: \(error.localizedDescription)") }
  }

  // MARK: - FloatingDelegate

  func floatingCopy(_ png: Data, scale: CGFloat) {
    guard let img = NSBitmapImageRep(data: png)?.cgImage, let out = Output.outputPNG(img, kind: "copy", settings: store.current, scale: scale) else { return }
    Output.copy(out)
    notifyCopied()
  }

  func floatingSave(_ png: Data, scale: CGFloat) {
    guard let img = NSBitmapImageRep(data: png)?.cgImage, let out = Output.outputPNG(img, kind: "save", settings: store.current, scale: scale) else { return }
    saveFile(out)
  }

  func floatingCopyText(_ png: Data, done: @escaping (Int) -> Void) {
    guard let img = NSBitmapImageRep(data: png)?.cgImage else { return done(-1) }
    TextRecognition.recognize(img) { result, _ in
      switch result {
      case let .success(lines):
        if !lines.isEmpty {
          let pb = Output.pasteboard
          pb.clearContents()
          pb.setString(lines.map(\.text).joined(separator: "\n"), forType: .string)
        }
        done(lines.count)
      case .failure:
        done(-1)
      }
    }
  }

  func floatingEdit(_ item: Floating.Item) {
    guard let doc = item.doc else { return }
    edit(doc) { png, image, doc in
      Floating.shared.update(item, png: png, image: image, doc: doc)
    }
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

/** Notifications on copy / save (silent, like Electron's). A click on a saved file's shows it in Finder. */
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Notifier()
  /** Tests record notifications instead of showing them. */
  static var posted: [(String, String)] = []

  static func post(title: String, body: String, reveal: URL? = nil, open: URL? = nil) {
    posted.append((title, body))
    if TestOption.string("SnapkitTestPasteboard") != nil { return }
    let center = UNUserNotificationCenter.current()
    center.delegate = shared
    center.requestAuthorization(options: [.alert]) { granted, _ in
      guard granted else { return }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      if let reveal { content.userInfo = ["reveal": reveal.path] }
      if let open { content.userInfo = ["open": open.absoluteString] }
      center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    if let path = response.notification.request.content.userInfo["reveal"] as? String {
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }
    if let s = response.notification.request.content.userInfo["open"] as? String, let url = URL(string: s) {
      NSWorkspace.shared.open(url)
    }
    done()
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner])
  }
}
