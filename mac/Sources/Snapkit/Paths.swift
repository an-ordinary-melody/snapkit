import Foundation

/**
 * Where Snapkit keeps its files. The release app uses the same folder as the Electron app
 * (~/Library/Application Support/Snapkit), so settings and history carry over. Dev builds
 * (bundle id com.charios.snapkit.dev, or run outside a bundle) use "Snapkit Dev" so they never
 * touch the real data; `-SnapkitProfile <dir>` points either at any folder (tests).
 */
enum Paths {
  static let releaseBundleId = "com.charios.snapkit"

  static var isDev: Bool { Bundle.main.bundleIdentifier != releaseBundleId }

  static let appName = isDev ? "Snapkit Dev" : "Snapkit"

  static let dataDir: URL = {
    if let p = UserDefaults.standard.string(forKey: "SnapkitProfile"), !p.isEmpty {
      return URL(fileURLWithPath: (p as NSString).expandingTildeInPath, isDirectory: true)
    }
    return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(appName, isDirectory: true)
  }()

  /** The Electron app's folder (the release app's own). */
  static let electronDataDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Snapkit", isDirectory: true)

  static var settingsFile: URL { dataDir.appendingPathComponent("settings.json") }
  static var lastAreaFile: URL { dataDir.appendingPathComponent("last-area.json") }

  static let logDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("Logs", isDirectory: true).appendingPathComponent(appName, isDirectory: true)

  static var defaultSaveFolder: URL {
    FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask)[0].appendingPathComponent("Snapkit", isDirectory: true)
  }

  /**
   * Dev builds start from a copy of the real settings.json the first time, so they behave like the
   * user's Snapkit without ever writing to its files.
   */
  static func prepare() {
    let fm = FileManager.default
    try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
    let real = electronDataDir.appendingPathComponent("settings.json")
    if isDev, UserDefaults.standard.string(forKey: "SnapkitProfile") == nil, !fm.fileExists(atPath: settingsFile.path), fm.fileExists(atPath: real.path) {
      try? fm.copyItem(at: real, to: settingsFile)
      log("copied settings.json from \(real.path)")
    }
  }
}

/** Test-mode launch options (`-SnapkitTestScreen`, `-SnapkitTestPasteboard`, `-SnapkitIdleSeconds`): debug builds only. */
enum TestOption {
  static func string(_ key: String) -> String? {
    #if DEBUG
    return UserDefaults.standard.string(forKey: key)
    #else
    return nil
    #endif
  }

  static func double(_ key: String) -> Double {
    #if DEBUG
    return UserDefaults.standard.double(forKey: key)
    #else
    return 0
    #endif
  }
}
