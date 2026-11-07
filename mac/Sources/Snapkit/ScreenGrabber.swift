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
      let c = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
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
  func grab(_ screens: [NSScreen], engine: String, belowWindow: @escaping (CGDirectDisplayID) -> CGWindowID?, deliver: @escaping (CGDirectDisplayID, CGImage?) -> Void) {
    if let testImage {
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
      var cached = await MainActor.run { self.content }
      if cached == nil { cached = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) }
      let content = cached
      let me = content?.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier } ?? []
      await withTaskGroup(of: Void.self) { group in
        for spec in specs {
          group.addTask {
            let image: CGImage? = await {
            if let display = content?.displays.first(where: { $0.displayID == spec.id }) {
              let filter = SCContentFilter(display: display, excludingApplications: me, exceptingWindows: [])
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
      log("[capture] screencapturekit: \(specs.count) display(s) in \(ms(t0)) ms")
      await MainActor.run { self.content = content }
    }
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
