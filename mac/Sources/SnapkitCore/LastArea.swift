import Foundation

/**
 * last-area.json, shared with Electron (src/main/lastArea.ts): the last area copied or saved, for
 * "Capture last area". Display bounds are in Electron's coordinates: points, top-left origin at the
 * main display's top-left corner.
 */
public struct LastArea: Codable, Equatable {
  public struct Rect: Codable, Equatable {
    public var x, y, width, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
      self.x = x
      self.y = y
      self.width = width
      self.height = height
    }
  }

  /** CGDirectDisplayID, which is also Electron's display id on macOS. */
  public var displayId: UInt32
  public var displayBounds: Rect
  /** The area in points from the display's top-left corner. */
  public var rect: Rect

  public init(displayId: UInt32, displayBounds: Rect, rect: Rect) {
    self.displayId = displayId
    self.displayBounds = displayBounds
    self.rect = rect
  }

  public static func load(_ file: URL) -> LastArea? {
    guard let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONDecoder().decode(LastArea.self, from: data)
  }

  /** Not rounded (scaled screens have fractional points). Areas under 1 pt aren't kept. */
  public func save(_ file: URL) throws {
    guard rect.width >= 1, rect.height >= 1 else { return }
    try JSON.encode(self).serialized().data(using: .utf8)!.write(to: file, options: .atomic)
  }

  /**
   * The display to use among those connected now (same id, else same bounds) and the area kept on
   * it: its corner stays on the display even if the resolution changed.
   */
  public func resolve(displays: [(id: UInt32, bounds: Rect)]) -> (id: UInt32, rect: Rect)? {
    guard let d = displays.first(where: { $0.id == displayId }) ?? displays.first(where: { $0.bounds == displayBounds }) else { return nil }
    var r = rect
    r.x = min(max(0, r.x), d.bounds.width - 1)
    r.y = min(max(0, r.y), d.bounds.height - 1)
    return (d.id, r)
  }
}
