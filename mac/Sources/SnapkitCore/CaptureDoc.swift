import Foundation

/**
 * Everything needed to reopen a capture in the editor (CaptureDoc in src/shared/ipc.ts): the plain
 * screenshot crop plus the drawings (relative to the crop's top-left, in points) and the background
 * state. history/<id>/doc.json is this without the PNG; source.png is the PNG.
 */
public struct CaptureDoc: Equatable {
  /** The crop without drawings, PNG. */
  public var png: Data
  /** Size in image pixels, and image pixels per point. */
  public var width: Int
  public var height: Int
  public var scale: Double
  public var shapes: [Shape]
  /** BeautifyState as JSON (null: none yet), kept as-is so either app's fields survive. */
  public var beautify: JSON
  /** Set when this came from history: outputs update that entry instead of adding one. */
  public var historyId: String?

  public init(png: Data, width: Int, height: Int, scale: Double, shapes: [Shape], beautify: JSON = .null, historyId: String? = nil) {
    self.png = png
    self.width = width
    self.height = height
    self.scale = scale
    self.shapes = shapes
    self.beautify = beautify
    self.historyId = historyId
  }

  /** doc.json (everything but the PNG). Shapes that don't decode are dropped, not fatal. */
  public var json: JSON {
    var o = JSON.object([])
    o = o.setting("width", .number(Double(width)))
    o = o.setting("height", .number(Double(height)))
    o = o.setting("scale", .number(scale))
    o = o.setting("shapes", (try? JSON.encode(shapes)) ?? .array([]))
    o = o.setting("beautify", beautify)
    if let historyId { o = o.setting("historyId", .string(historyId)) }
    return o
  }

  public init?(json: JSON, png: Data) {
    guard let w = json["width"]?.double, let h = json["height"]?.double else { return nil }
    self.png = png
    width = Int(w)
    height = Int(h)
    scale = json["scale"]?.double ?? 1
    shapes = (json["shapes"]?.array ?? []).compactMap { try? $0.decode(Shape.self) }
    beautify = json["beautify"] ?? .null
    historyId = json["historyId"]?.string
  }
}
