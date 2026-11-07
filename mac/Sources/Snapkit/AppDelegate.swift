import AppKit
import SnapkitCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, HistoryActions {
  private(set) var history: HistoryStore!
  private(set) var historyPanel: HistoryPanel!
  private(set) var settingsWindow: SettingsWindowController!
  private(set) var updater: Updater!
  /** Sparkle, when this build has a feed and key (release builds); else `updater` checks GitHub. */
  private(set) var sparkle: SparkleUpdates?
  private(set) var store: SettingsStore!
  private(set) var capture: CaptureController!
  private var pool: OverlayPool!
  private var grabber: ScreenGrabber!
  private var statusItem: NSStatusItem!

  func applicationDidFinishLaunching(_ notification: Notification) {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    Paths.prepare()
    log("\(Paths.appName) \(version) started (macOS \(ProcessInfo.processInfo.operatingSystemVersionString), data: \(Paths.dataDir.path))")
    if otherInstanceRunning() {
      log("another \(Paths.appName) is already running: quitting")
      NSApp.terminate(nil)
      return
    }
    if Paths.isDev, NSRunningApplication.runningApplications(withBundleIdentifier: Paths.releaseBundleId).isEmpty == false {
      log("note: the Electron Snapkit is running too; both react to the same hotkeys")
    }

    Floating.cleanTemp()
    store = SettingsStore(file: Paths.settingsFile)
    grabber = ScreenGrabber()
    pool = OverlayPool()
    capture = CaptureController(store: store, pool: pool, grabber: grabber)
    capture.onModeChange = { on in Hotkeys.shared.captureMode(on) }
    setUpHistory()
    setUpSettings()
    pool.rebuild()
    grabber.refresh()
    NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
      self?.grabber.refresh()
    }

    registerHotkeys()
    store.onChange { [weak self] s, prev in
      if s.hotkeys != prev.hotkeys { self?.registerHotkeys() }
    }
    makeStatusItem()
    TextRecognition.warmUp()
    #if DEBUG
    TestHook.install(self)
    #endif
  }

  /** A click on the Dock icon (only there while Settings is open) brings Settings forward. */
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if settingsWindow.isOpen { settingsWindow.show() }
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    store?.flush()
    history?.saveIndex()
  }

  private func otherInstanceRunning() -> Bool {
    guard let id = Bundle.main.bundleIdentifier else { return false }
    return NSRunningApplication.runningApplications(withBundleIdentifier: id).contains { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
  }

  /** Actions by hotkey name (HOTKEY_ACTIONS in src/main/index.ts). */
  private var hotkeyActions: [(String, KeyPath<Settings.Hotkeys, String>, () -> Void)] {
    [
      ("capture", \.capture, { [weak self] in self?.capture.toggle() }),
      ("lastArea", \.lastArea, { [weak self] in self?.capture.captureLastArea() }),
      ("fullscreen", \.fullscreen, { [weak self] in self?.capture.captureFullScreen() }),
      ("ocr", \.ocr, { [weak self] in self?.capture.toggle(textOnly: true) })
    ] + extraHotkeys
  }

  /** Hotkeys for windows added in later phases (settings). */
  var extraHotkeys: [(String, KeyPath<Settings.Hotkeys, String>, () -> Void)] = []

  // MARK: - History

  private func setUpHistory() {
    history = HistoryStore(dir: Paths.dataDir.appendingPathComponent("history", isDirectory: true))
    history.limits = { [weak self] in
      let h = self?.store.current.history ?? SettingsRules.defaults.history
      return (h.maxCount, h.maxMB, h.maxAgeDays, h.paused)
    }
    history.load()
    // The age limit also applies while Snapkit stays open for days.
    Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in self?.history.prune() }
    store.onChange { [weak self] s, prev in
      var a = s.history, b = prev.history
      (a.panel, b.panel) = (b.panel, b.panel)
      if a != b { self?.history.prune() } // new limits apply now
    }
    historyPanel = HistoryPanel(store: history, settings: store)
    historyPanel.actions = self
    capture.onOutput = { [weak self] r in self?.record(r) }
    extraHotkeys.append(("history", \.history, { [weak self] in self?.historyPanel.toggle() }))
  }

  /** Keep an output in history (after the copy, so it never delays it). */
  private func record(_ r: OutputRecord) -> String? {
    let w = r.final.width, h = r.final.height
    let k = min(1, 320 / CGFloat(w), 240 / CGFloat(h))
    guard let small = Output.resized(r.final, max(1, Int((CGFloat(w) * k).rounded())), max(1, Int((CGFloat(h) * k).rounded()))),
          let jpeg = Output.jpeg(small, quality: 0.8) else { return nil }
    let t0 = Date()
    let id = history.add(finalPNG: r.finalPNG, width: w, height: h, doc: r.doc, thumbJPEG: jpeg)
    if let id { log("[history] \(r.doc.historyId == nil ? "added" : "updated") \(id) in \(ms(t0))ms") }
    return id
  }

  func historyCopy(_ png: Data, scale: CGFloat) { capture.floatingCopy(png, scale: scale) }
  func historySave(_ png: Data, scale: CGFloat) { capture.floatingSave(png, scale: scale) }
  func historyCopyText(_ png: Data, done: @escaping (Int) -> Void) { capture.floatingCopyText(png, done: done) }
  func historyEdit(_ doc: CaptureDoc) { capture.edit(doc) { _, _, _ in } }
  func historyOpenSettings() { openSettings?() }
  /** Pin centred on the screen with the pointer. */
  func historyPin(_ png: Data, image: CGImage) {
    let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.screens[0]
    let area = Floating.topLeftRect(screen.visibleFrame)
    let w = CGFloat(image.width) / screen.backingScaleFactor, h = CGFloat(image.height) / screen.backingScaleFactor
    Floating.shared.pin(png: png, image: image, at: CGRect(x: (area.midX - w / 2).rounded(), y: (area.midY - h / 2).rounded(), width: w, height: h))
  }

  /** Opens the settings window (set when it exists). */
  var openSettings: (() -> Void)?

  // MARK: - Settings window and updates

  private func setUpSettings() {
    updater = Updater(store: store)
    let model = SettingsModel(store: store)
    model.history = history
    model.openHistoryFolder = { [weak self] in self?.historyPanel.reveal() }
    if SparkleUpdates.configured {
      let sp = SparkleUpdates(store: store)
      sparkle = sp
      model.usesSparkle = true
      var pending: ((UpdateCheck) -> Void)?
      sp.onCheck = { r in
        model.update = r
        pending?(r)
        pending = nil
      }
      model.checkUpdates = { done in
        pending = done
        sp.checkNow()
      }
    } else {
      model.checkUpdates = { [weak self] done in self?.updater.check(manual: true, done: done) }
    }
    model.hotkeyTaken = { name in !Hotkeys.shared.isRegistered(name) && !name.isEmpty }
    model.setHotkey = { [weak self] name, acc in self?.setHotkey(name, acc) }
    history.onChange { [weak model] _ in model?.refreshHistory() }
    settingsWindow = SettingsWindowController(model: model)
    openSettings = { [weak self] in self?.showSettings() }
    extraHotkeys.append(("settings", \.settings, { [weak self] in self?.showSettings() }))
    store.onChange { [weak self] s, prev in
      if s.appearance != prev.appearance {
        self?.settingsWindow.applyAppearance()
        self?.historyPanel.testView?.theme = Theme.from(s.appearance)
        self?.historyPanel.applyAppearance()
      }
    }
    if let sparkle { sparkle.start() } else { updater.schedule() }
  }

  @objc private func checkForUpdates() {
    if let sparkle { sparkle.checkNow() } else { updater.check(manual: true) { _ in } }
  }

  /** From anywhere, capture mode included (it closes, so the window isn't hidden behind it). */
  func showSettings(section: String? = nil) {
    if capture.active { capture.end(reason: "settings opened") }
    historyPanel.hide(giveFocusBack: false)
    settingsWindow.show(section: section)
  }

  /**
   * Change a hotkey from the settings window. Returns an error message if the shortcut can't be used
   * (the old one is kept). "" turns it off (not the capture hotkey).
   */
  func setHotkey(_ name: String, _ acc: String) -> String? {
    if acc.isEmpty && name == "capture" { return "The capture shortcut can't be turned off." }
    if !acc.isEmpty && Accelerator(acc) == nil { return "Snapkit can't use that shortcut." }
    let h = store.current.hotkeys
    let others = ["capture": h.capture, "history": h.history, "fullscreen": h.fullscreen, "settings": h.settings, "lastArea": h.lastArea, "ocr": h.ocr].filter { $0.key != name }
    if !acc.isEmpty, let clash = others.first(where: { $0.value == acc }) {
      return "\(Accelerator.display(acc)) is already used for \(clash.key == "lastArea" ? "Capture last area" : clash.key == "ocr" ? "Capture text" : clash.key.capitalized)."
    }
    store.update(.object([("hotkeys", .object([(name, .string(acc))]))]))
    return nil
  }

  func registerHotkeys() {
    let h = store.current.hotkeys
    for (name, key, action) in hotkeyActions {
      if !Hotkeys.shared.set(name, h[keyPath: key], action: action), name == "capture" {
        log("[hotkeys] the capture hotkey \(Accelerator.display(h.capture)) can't be used yet")
      }
    }
  }

  // MARK: - Menu bar

  private func makeStatusItem() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    if let url = Bundle.main.url(forResource: "trayTemplate", withExtension: "png"), let img = NSImage(contentsOf: url) {
      img.isTemplate = true
      img.size = NSSize(width: 18, height: 18)
      statusItem.button?.image = img
    } else {
      statusItem.button?.image = NSImage(systemSymbolName: "camera.viewfinder", accessibilityDescription: "Snapkit")
    }
    let menu = NSMenu()
    menu.delegate = self
    statusItem.menu = menu
  }

  /** Rebuilt each time it opens, so it shows the current hotkeys. */
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let s = store.current
    for (title, sel, key) in [("Capture Area", #selector(captureArea), s.hotkeys.capture), ("Capture Last Area", #selector(captureLast), s.hotkeys.lastArea),
                              ("Capture Full Screen", #selector(captureFull), s.hotkeys.fullscreen), ("Capture Text (OCR)", #selector(captureText), s.hotkeys.ocr)] {
      let item = NSMenuItem(title: title, action: sel, keyEquivalent: "")
      setKey(item, key)
      menu.addItem(item)
    }
    menu.addItem(.separator())
    let hist = NSMenuItem(title: "History…", action: #selector(showHistory), keyEquivalent: "")
    setKey(hist, s.hotkeys.history)
    menu.addItem(hist)
    // Same as the History window's switch: checked = recording.
    let rec = NSMenuItem(title: "Record History", action: #selector(toggleRecording), keyEquivalent: "")
    rec.state = s.history.paused ? .off : .on
    menu.addItem(rec)
    menu.addItem(.separator())
    for item in extraMenuItems() { menu.addItem(item) }
    menu.addItem(NSMenuItem(title: "Open Screenshots Folder", action: #selector(openFolder), keyEquivalent: ""))
    menu.addItem(NSMenuItem(title: "Close All Pins", action: #selector(closePins), keyEquivalent: ""))
    let settingsItem = NSMenuItem(title: "Settings…", action: #selector(showSettingsMenu), keyEquivalent: ",")
    if !s.hotkeys.settings.isEmpty { setKey(settingsItem, s.hotkeys.settings) }
    menu.addItem(settingsItem)
    menu.addItem(NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: ""))
    menu.addItem(.separator())
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    if let u = updater.latest, u.status == .available, let v = u.version {
      menu.addItem(ClosureMenuItem(title: "Update available: \(v)…") { if let s = u.url, let url = URL(string: s) { NSWorkspace.shared.open(url) } })
    } else {
      let about = NSMenuItem(title: "\(Paths.appName) \(version)", action: nil, keyEquivalent: "")
      about.isEnabled = false
      menu.addItem(about)
    }
    menu.addItem(NSMenuItem(title: "Quit \(Paths.appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    for item in menu.items where item.action != #selector(NSApplication.terminate(_:)) { item.target = self }
  }

  /** Show an accelerator next to a menu item. */
  private func setKey(_ item: NSMenuItem, _ text: String) {
    guard let acc = Accelerator(text) else { return }
    var mask: NSEvent.ModifierFlags = []
    if acc.modifiers.contains(.command) { mask.insert(.command) }
    if acc.modifiers.contains(.shift) { mask.insert(.shift) }
    if acc.modifiers.contains(.option) { mask.insert(.option) }
    if acc.modifiers.contains(.control) { mask.insert(.control) }
    var key = acc.key.lowercased()
    if acc.key.hasPrefix("F"), let n = Int(acc.key.dropFirst()), (1...20).contains(n), let scalar = UnicodeScalar(NSF1FunctionKey + n - 1) {
      key = String(Character(scalar))
    } else if acc.key.count > 1 {
      return
    }
    item.keyEquivalent = key
    item.keyEquivalentModifierMask = mask
  }

  @objc private func captureArea() {
    // Let the menu close first so it isn't in the screenshot.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.capture.toggle() }
  }

  /** Menu items for windows added in later phases (History…, Record History, Settings…). */
  var extraMenuItems: () -> [NSMenuItem] = { [] }

  @objc private func captureLast() { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.capture.captureLastArea() } }
  @objc private func captureFull() { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.capture.captureFullScreen() } }
  @objc private func captureText() { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.capture.toggle(textOnly: true) } }
  @objc private func closePins() { Floating.shared.closeAll() }
  @objc private func showSettingsMenu() { showSettings() }
  @objc private func showHistory() { DispatchQueue.main.async { self.historyPanel.toggle() } }
  @objc private func toggleRecording() { store.update(.object([("history", .object([("paused", .bool(!store.current.history.paused))]))])) }

  @objc private func openFolder() {
    let folder = Output.saveFolder(store.current)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    NSWorkspace.shared.open(folder)
  }

  @objc private func showSettingsFile() {
    store.flush()
    if !FileManager.default.fileExists(atPath: Paths.settingsFile.path) { try? Data("{}".utf8).write(to: Paths.settingsFile) }
    NSWorkspace.shared.activateFileViewerSelecting([Paths.settingsFile])
  }
}
