import Foundation

/**
 * settings.json, as src/main/settings.ts keeps it: only changed values are stored, never the full
 * defaults, so new defaults in an update still apply to everything the user hasn't changed. Keys
 * this app doesn't know are kept as they are, so the Electron app loses nothing either.
 */
public final class SettingsStore {
  public let file: URL
  public private(set) var saved: JSON
  public private(set) var current: Settings
  private var listeners: [(Settings, Settings) -> Void] = []
  private var flushWork: DispatchWorkItem?
  private var dirty = false

  public init(file: URL) {
    self.file = file
    var saved = JSON.object([])
    if let data = try? Data(contentsOf: file) {
      if let v = try? JSON.parse(data), v.isObject { saved = v } else { NSLog("[settings] couldn't read %@, using the defaults", file.path) }
    }
    self.saved = saved
    current = SettingsRules.resolve(saved)
  }

  /** Called after every change, with the new and previous settings. */
  public func onChange(_ fn: @escaping (Settings, Settings) -> Void) {
    listeners.append(fn)
  }

  /** Merge `patch` (any depth) into the stored overrides and save shortly after. */
  @discardableResult
  public func update(_ patch: JSON) -> Settings {
    write(SettingsRules.applyPatch(saved, patch))
  }

  /** Back to the defaults for these top-level sections (all of them if nil). */
  @discardableResult
  public func reset(_ sections: [String]? = nil) -> Settings {
    guard let sections else { return write(.object([])) }
    var next = saved
    for k in sections { next = next.removing(k) }
    return write(next)
  }

  /**
   * Apply a change in memory now and write it 100 ms later: dragging a slider makes many changes a
   * second, and each would otherwise rewrite the file.
   */
  private func write(_ next: JSON) -> Settings {
    let prev = current
    saved = next
    current = SettingsRules.resolve(next)
    dirty = true
    flushWork?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.flush() }
    flushWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: work)
    for fn in listeners { fn(current, prev) }
    return current
  }

  /** Write the stored overrides now, atomically (a crash never leaves a half-written file). */
  public func flush() {
    flushWork?.cancel()
    flushWork = nil
    guard dirty else { return }
    dirty = false
    do {
      try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(saved.serialized(indent: 2).utf8).write(to: file, options: .atomic)
    } catch {
      NSLog("[settings] couldn't save: %@", String(describing: error))
    }
  }
}
