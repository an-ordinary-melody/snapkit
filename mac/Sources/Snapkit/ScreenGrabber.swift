import AppKit
import ScreenCaptureKit

extension NSScreen {
  var displayID: CGDirectDisplayID {
    (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
  }
}

/**
 * Freezes the screens. Engines, as `capture.engine` picks them:
 * - ScreenCaptureKit (default): leaves Snapkit's own windows out, so the dim can already be on
 *   screen while the image is taken.
 * - CoreGraphics: fallback when ScreenCaptureKit fails. Deprecated by Apple but still working; it
 *   takes only the windows below Snapkit's capture window.
 * `-SnapkitTestScreen <png>` replaces both with a fixed image (tests; no permission needed).
 */
final class ScreenGrabber {
  private var content: SCShareableContent?
  private var refreshing = false
  let testImage: CGImage?
  #if DEBUG
  /** Tests: the next grab of the test image lands this much later (seconds), as a slow ScreenCaptureKit grab. */
  static var testDelay = 0.0
  #endif

  init() {
    if let path = TestOption.string("SnapkitTestScreen"),
       let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: (path as NSString).expandingTildeInPath) as CFURL, nil),
       let img = CGImageSourceCreateImageAtIndex(src, 0, nil) {
      testImage = img
      log("[capture] test screen: \(path) (\(img.width)×\(img.height))")
    } else {
      testImage = nil
    }
  }

  /** Fetch the display list ahead of time, so a capture doesn't wait for it. Called at launch and on screen changes. */
  func refresh() {
    guard testImage == nil, !refreshing, CGPreflightScreenCaptureAccess() else { return }
    refreshing = true
    Task {
      let c = await ScreenGrabber.shareableContent()
      await MainActor.run {
        self.content = c
        self.refreshing = false
      }
    }
  }

  /**
   * Grab every screen; `deliver` is called on the main thread once per screen as its image lands.
   * `belowWindow`: the capture window on that screen (the CoreGraphics engine takes what's under it).
   */
  func grab(_ screens: [NSScreen], engine: String, exclude: [CGWindowID], belowWindow: @escaping (CGDirectDisplayID) -> CGWindowID?,
            deliver: @escaping (CGDirectDisplayID, CGImage?) -> Void) {
    if let testImage {
      #if DEBUG
      if ScreenGrabber.testDelay > 0 {
        let ids = screens.map(\.displayID)
        DispatchQueue.main.asyncAfter(deadline: .now() + ScreenGrabber.testDelay) { for id in ids { deliver(id, testImage) } }
        ScreenGrabber.testDelay = 0
        return
      }
      #endif
      for s in screens { deliver(s.displayID, testImage) }
      return
    }
    let t0 = Date()
    if engine == "coregraphics" {
      for s in screens { deliver(s.displayID, cgGrab(s, below: belowWindow(s.displayID))) }
      log("[capture] coregraphics: \(screens.count) display(s) in \(ms(t0)) ms")
      return
    }
    let specs = screens.map { (id: $0.displayID, size: $0.frame.size, scale: $0.backingScaleFactor) }
    Task {
      // Only the capture windows are left out (as Electron's overlay): Snapkit's own Settings, History,
      // pins and previews are captured like any other window. The list has to hold those windows, or
      // the capture window's dim lands in the frozen image; one taken before they existed is fetched again.
      var cached = await MainActor.run { self.content }
      if !ScreenGrabber.has(cached, exclude) { cached = await ScreenGrabber.shareableContent() }
      let content = cached
      let mine = content?.windows.filter { exclude.contains($0.windowID) } ?? []
      let missing = content != nil && mine.count < exclude.count
      if missing { log("[capture] \(exclude.count - mine.count) capture window(s) not in ScreenCaptureKit's list; they may show in the capture") }
      await withTaskGroup(of: Void.self) { group in
        for spec in specs {
          group.addTask {
            let image: CGImage? = await {
            if let display = content?.displays.first(where: { $0.displayID == spec.id }) {
              let filter = SCContentFilter(display: display, excludingWindows: mine)
              let config = SCStreamConfiguration()
              config.width = Int(spec.size.width * spec.scale)
              config.height = Int(spec.size.height * spec.scale)
              config.showsCursor = false
              config.captureResolution = .best
              do {
                return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
              } catch {
                log("[capture] screencapturekit failed on display \(spec.id): \(error.localizedDescription); using coregraphics")
              }
            }
            return nil
            }()
            await MainActor.run {
              let img = image ?? NSScreen.screens.first(where: { $0.displayID == spec.id }).flatMap { self.cgGrab($0, below: belowWindow(spec.id)) }
              deliver(spec.id, img)
            }
          }
        }
      }
      log("[capture] screencapturekit: \(specs.count) display(s) in \(ms(t0)) ms\(missing ? " (capture windows not all excluded)" : "")")
      await MainActor.run { self.content = content }
    }
  }

  /**
   * Displays and windows for ScreenCaptureKit. All windows, not only on-screen ones: between captures
   * the capture windows aren't on screen, and a window that isn't listed can't be left out.
   */
  static func shareableContent() async -> SCShareableContent? {
    try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
  }

  /** Whether `c` lists every one of these windows. */
  static func has(_ c: SCShareableContent?, _ ids: [CGWindowID]) -> Bool {
    guard let c else { return false }
    let listed = Set(c.windows.map(\.windowID))
    return ids.allSatisfy(listed.contains)
  }

  /** CoreGraphics: everything on this screen below `below` (Snapkit's capture window), at full resolution. */
  private func cgGrab(_ screen: NSScreen, below: CGWindowID?) -> CGImage? {
    let bounds = CGDisplayBounds(screen.displayID)
    if let below {
      return CGWindowListCreateImage(bounds, .optionOnScreenBelowWindow, below, [.bestResolution])
    }
    return CGWindowListCreateImage(bounds, .optionOnScreenOnly, kCGNullWindowID, [.bestResolution])
  }
}

func ms(_ since: Date) -> Int { Int(Date().timeIntervalSince(since) * 1000) }
