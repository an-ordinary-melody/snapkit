import Foundation

/** One past capture, as listed in history/index.json (src/shared/history.ts). */
public struct HistoryEntry: Codable, Equatable {
  public var id: String
  public var createdAt: Double
  /** Last copied/saved/edited; the list is sorted by this. */
  public var updatedAt: Double
  /** Output image size in px. */
  public var width: Int
  public var height: Int
  /** Disk use of the entry's files. */
  public var bytes: Int
  /** Starred entries are never pruned. */
  public var starred: Bool

  public init(id: String, createdAt: Double, updatedAt: Double, width: Int, height: Int, bytes: Int, starred: Bool) {
    self.id = id
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.width = width
    self.height = height
    self.bytes = bytes
    self.starred = starred
  }
}

public enum HistoryRules {
  /** Hard ceilings, whatever the settings say: history must stay fast. */
  public static let maxCount = 30
  public static let maxMB = 2000.0

  /**
   * toPrune(): which entries to delete. Starred ones never are. In order: keep at most `maxCount`
   * unstarred, then delete the oldest until under `maxMB`, then anything older than `maxAgeDays`.
   */
  public static func toPrune(_ entries: [HistoryEntry], maxCount: Int, maxMB: Double, maxAgeDays: Double, now: Double = Date().timeIntervalSince1970 * 1000) -> [String] {
    let count = max(0, min(HistoryRules.maxCount, maxCount))
    let maxBytes = max(0, min(HistoryRules.maxMB, maxMB)) * 1024 * 1024
    let newestFirst = entries.enumerated().sorted { a, b in a.element.updatedAt != b.element.updatedAt ? a.element.updatedAt > b.element.updatedAt : a.offset < b.offset }.map(\.element)
    var drop = Set<String>()
    for e in newestFirst.filter({ !$0.starred }).dropFirst(count) { drop.insert(e.id) }
    var total = Double(newestFirst.filter { !drop.contains($0.id) }.reduce(0) { $0 + $1.bytes })
    for e in newestFirst.reversed() {
      if total <= maxBytes { break }
      if e.starred || drop.contains(e.id) { continue }
      drop.insert(e.id)
      total -= Double(e.bytes)
    }
    if maxAgeDays > 0 {
      let cutoff = now - maxAgeDays * 86_400_000
      for e in newestFirst where !e.starred && e.updatedAt < cutoff { drop.insert(e.id) }
    }
    return newestFirst.filter { drop.contains($0.id) }.map(\.id)
  }
}

/**
 * Past captures on disk (src/main/history.ts, plan: docs/history.md). Each entry is a folder:
 *   final.png - the output as copied/saved; source.png + doc.json - to re-edit; thumb.jpg - for the panel
 * plus history/index.json, newest first. Writes go to a .tmp folder renamed when complete, so a crash
 * never leaves half an entry. The same files the Electron app keeps, so either app reads the other's.
 */
public final class HistoryStore {
  public let dir: URL
  public private(set) var entries: [HistoryEntry] = []
  public var limits: () -> (maxCount: Int, maxMB: Double, maxAgeDays: Double, paused: Bool) = { (10, 300, 30, false) }
  private var listeners: [([HistoryEntry]) -> Void] = []
  private let fm = FileManager.default
  private var saveWork: DispatchWorkItem?

  public init(dir: URL) {
    self.dir = dir
  }

  private var indexFile: URL { dir.appendingPathComponent("index.json") }
  public func entryDir(_ id: String) -> URL { dir.appendingPathComponent(id, isDirectory: true) }

  public func onChange(_ fn: @escaping ([HistoryEntry]) -> Void) { listeners.append(fn) }

  private func changed() {
    entries.sort { $0.updatedAt > $1.updatedAt }
    saveWork?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.saveIndex() }
    saveWork = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: w)
    for fn in listeners { fn(entries) }
  }

  /** Write index.json now (atomically). */
  public func saveIndex() {
    saveWork?.cancel()
    saveWork = nil
    do {
      try fm.createDirectory(at: dir, withIntermediateDirectories: true)
      try JSONEncoder().encode(entries).write(to: indexFile, options: .atomic)
    } catch {
      NSLog("[history] couldn't save the index: %@", String(describing: error))
    }
  }

  /** Load the index and tidy up: remove half-written (.tmp) and unknown folders, and entries whose files are gone. */
  public func load() {
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    entries = (try? Data(contentsOf: indexFile)).flatMap { try? JSONDecoder().decode([HistoryEntry].self, from: $0) } ?? []
    let known = Set(entries.map(\.id))
    for name in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where name != "index.json" && name != "index.json.tmp" {
      if name.hasSuffix(".tmp") || !known.contains(name) { try? fm.removeItem(at: dir.appendingPathComponent(name)) }
    }
    entries = entries.filter { fm.fileExists(atPath: entryDir($0.id).appendingPathComponent("final.png").path) }
    prune()
    changed()
  }

  /** Apply the count / size / age limits (starred entries are kept). */
  public func prune() {
    let l = limits()
    let drop = HistoryRules.toPrune(entries, maxCount: l.maxCount, maxMB: l.maxMB, maxAgeDays: l.maxAgeDays)
    guard !drop.isEmpty else { return }
    entries.removeAll { drop.contains($0.id) }
    changed()
    for id in drop { try? fm.removeItem(at: entryDir(id)) }
  }

  private static func newId() -> String {
    let t = String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
    let r = String(Int.random(in: 0..<(36 * 36 * 36 * 36)), radix: 36)
    return t + String(repeating: "0", count: max(0, 4 - r.count)) + r
  }

  /**
   * Keep an output. An output from an entry being re-edited (`doc.historyId`) replaces that entry
   * and moves it to the top. Returns the entry id (nil while paused, or on failure).
   */
  @discardableResult
  public func add(finalPNG: Data, width: Int, height: Int, doc: CaptureDoc, thumbJPEG: Data) -> String? {
    let l = limits()
    if l.paused || l.maxCount <= 0 { return nil }
    let replace = doc.historyId.flatMap { id in entries.first { $0.id == id } }
    let id = replace?.id ?? HistoryStore.newId()
    let tmp = dir.appendingPathComponent("\(id).tmp", isDirectory: true)
    do {
      try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
      var d = doc
      d.historyId = id
      try finalPNG.write(to: tmp.appendingPathComponent("final.png"))
      try doc.png.write(to: tmp.appendingPathComponent("source.png"))
      try thumbJPEG.write(to: tmp.appendingPathComponent("thumb.jpg"))
      try Data(d.json.serialized().utf8).write(to: tmp.appendingPathComponent("doc.json"))
      try? fm.removeItem(at: entryDir(id))
      try fm.moveItem(at: tmp, to: entryDir(id))
    } catch {
      NSLog("[history] couldn't save the capture: %@", String(describing: error))
      try? fm.removeItem(at: tmp)
      return nil
    }
    let now = Date().timeIntervalSince1970 * 1000
    entries.removeAll { $0.id == id }
    entries.insert(HistoryEntry(id: id, createdAt: replace?.createdAt ?? now, updatedAt: now, width: width, height: height,
                                bytes: finalPNG.count + doc.png.count + thumbJPEG.count, starred: replace?.starred ?? false), at: 0)
    changed()
    prune()
    return id
  }

  public func file(_ id: String, _ name: String) -> URL? {
    entries.contains { $0.id == id } ? entryDir(id).appendingPathComponent(name) : nil
  }

  public func data(_ id: String, _ name: String) -> Data? { file(id, name).flatMap { try? Data(contentsOf: $0) } }

  /** The capture document to reopen an entry in the editor. */
  public func doc(_ id: String) -> CaptureDoc? {
    guard let json = data(id, "doc.json").flatMap({ try? JSON.parse($0) }), let png = data(id, "source.png") else { return nil }
    var d = CaptureDoc(json: json, png: png)
    d?.historyId = id
    return d
  }

  public func setStarred(_ id: String, _ starred: Bool) {
    guard let i = entries.firstIndex(where: { $0.id == id }) else { return }
    entries[i].starred = starred
    changed()
    prune() // unstarring may put it over a limit
  }

  public func delete(_ id: String) {
    entries.removeAll { $0.id == id }
    changed()
    try? fm.removeItem(at: entryDir(id))
  }

  /** Delete everything (or everything but starred entries). */
  public func clear(keepStarred: Bool) {
    let drop = entries.filter { !keepStarred || !$0.starred }.map(\.id)
    entries.removeAll { drop.contains($0.id) }
    changed()
    for id in drop { try? fm.removeItem(at: entryDir(id)) }
  }

  public var usage: (count: Int, bytes: Int) { (entries.count, entries.reduce(0) { $0 + $1.bytes }) }
}
