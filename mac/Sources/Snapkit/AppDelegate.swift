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

  private func registerHotkeys() {
    let h = store.current.hotkeys
    if !Hotkeys.shared.set("capture", h.capture, action: { [weak self] in self?.capture.toggle() }) {
      log("[hotkeys] the capture hotkey \(Accelerator.display(h.capture)) can't be used yet")
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
    let capture = NSMenuItem(title: "Capture Area", action: #selector(captureArea), keyEquivalent: "")
    setKey(capture, s.hotkeys.capture)
    menu.addItem(capture)
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Open Screenshots Folder", action: #selector(openFolder), keyEquivalent: ""))
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
