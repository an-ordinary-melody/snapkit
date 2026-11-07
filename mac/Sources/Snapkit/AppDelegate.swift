import AppKit
import SnapkitCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
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

  func applicationWillTerminate(_ notification: Notification) {
    store?.flush()
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

  /** Hotkeys for windows added in later phases (history, settings). */
  var extraHotkeys: [(String, KeyPath<Settings.Hotkeys, String>, () -> Void)] = []

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
    for item in extraMenuItems() { menu.addItem(item) }
    menu.addItem(NSMenuItem(title: "Open Screenshots Folder", action: #selector(openFolder), keyEquivalent: ""))
    menu.addItem(NSMenuItem(title: "Close All Pins", action: #selector(closePins), keyEquivalent: ""))
    menu.addItem(NSMenuItem(title: "Show Settings File", action: #selector(showSettingsFile), keyEquivalent: ""))
    menu.addItem(.separator())
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    let about = NSMenuItem(title: "\(Paths.appName) \(version) (native preview)", action: nil, keyEquivalent: "")
    about.isEnabled = false
    menu.addItem(about)
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
