import Foundation

// The settings model, with the same field names and JSON shape as src/shared/settings.ts, so both
// apps read and write the same settings.json. Only changed values are stored on disk; the full
// settings are those overrides merged over the defaults (see SettingsStore).

public enum BeautifyBackground: Codable, Equatable {
  case solid(color: String)
  /** `angle` in degrees: 0 = left to right, 90 = top to bottom. */
  case gradient(from: String, to: String, angle: Double)
  /** A local image file, scaled to cover the background. */
  case image(path: String)

  private enum Keys: String, CodingKey { case type, color, from, to, angle, path }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    switch try c.decode(String.self, forKey: .type) {
    case "gradient":
      self = .gradient(from: try c.decode(String.self, forKey: .from), to: try c.decode(String.self, forKey: .to), angle: try c.decode(Double.self, forKey: .angle))
    case "image": self = .image(path: try c.decode(String.self, forKey: .path))
    default: self = .solid(color: try c.decode(String.self, forKey: .color))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    switch self {
    case let .solid(color):
      try c.encode("solid", forKey: .type)
      try c.encode(color, forKey: .color)
    case let .gradient(from, to, angle):
      try c.encode("gradient", forKey: .type)
      try c.encode(from, forKey: .from)
      try c.encode(to, forKey: .to)
      try c.encode(angle, forKey: .angle)
    case let .image(path):
      try c.encode("image", forKey: .type)
      try c.encode(path, forKey: .path)
    }
  }
}

public struct BeautifyPreset: Codable, Equatable {
  public var id: String
  public var name: String
  public var background: BeautifyBackground
  public var padding: Double
  public var radius: Double
  public var shadow: Double
}

public struct NameRule: Codable, Equatable {
  public var text: String
  /** 'none' | 'before' | 'after' */
  public var date: String
  public var number: String
  public var digits: Int

  public init(text: String, date: String, number: String, digits: Int) {
    self.text = text
    self.date = date
    self.number = number
    self.digits = digits
  }
}

public struct Settings: Codable, Equatable {
  public struct Hotkeys: Codable, Equatable {
    public var capture, history, fullscreen, settings, lastArea, ocr: String
  }
  public struct Updates: Codable, Equatable {
    public var autoCheck: Bool
    public var repo: String
    public var lastCheck: Double
    public var notified: String
  }
  public struct History: Codable, Equatable {
    public struct Panel: Codable, Equatable { public var width, height: Double }
    public var maxCount: Int
    public var maxMB: Double
    public var maxAgeDays: Double
    public var paused: Bool
    public var panel: Panel
  }
  public struct Capture: Codable, Equatable {
    public var dimOpacity: Double
    public var dimColor: String
    public var showSizeLabel: Bool
    public var accentColor: String
    public var engine: String
    public var fullscreenCopy: Bool
    public var quickCopy: Bool
    public var lastAreaInstant: Bool
  }
  public struct Save: Codable, Equatable {
    public var folder: String
    public var askLocation: Bool
    public var lastFolder: String
    public var name: NameRule
    public var nextNumber: Int
  }
  public struct OCR: Codable, Equatable {
    public var engine: String
    public var textButton: String
    public var vietnamese: String
  }
  public struct Compress: Codable, Equatable {
    public var enabled: Bool
    public var preset: String
    public var applyTo: String
  }
  public struct Notifications: Codable, Equatable {
    public var onCopy: Bool
    public var onSave: Bool
  }
  public struct Annotate: Codable, Equatable {
    public struct StepStroke: Codable, Equatable { public var color: String; public var width: Double }
    public struct Text: Codable, Equatable {
      public var fontFamily: String
      public var fontSize: Double
      /** 'plain' | 'stroke' | 'background' */
      public var style: String
      public var strokeColor: String
      public var strokeWidth: Double
      public var background: String
      public var shadow: Double
    }
    public var palette: [String]
    public var strokeWidths: [Double]
    public var strokeWidth: Int
    public var highlighterColor: String
    public var highlighterPalette: [String]
    public var highlighterWidth: Double
    public var blurMode: String
    public var blurStrength: Double
    public var stepSize: Double
    public var stepTextColor: String
    public var stepColor: String
    public var stepStroke: StepStroke
    public var stepShadow: Double
    public var text: Text
  }
  public struct Pin: Codable, Equatable { public var afterCopy: Bool }
  public struct Appearance: Codable, Equatable {
    public var glass: Bool
    /** 'system' | 'light' | 'dark' | 'gray' */
    public var mode: String
    public var accent: String
  }
  public struct Beautify: Codable, Equatable {
    public var applyOnCopy: Bool
    public var preset: String
    public var presets: [BeautifyPreset]
    public var gradients: [[String]]
    public var solids: [String]
    public var rememberLast: Bool
  }

  public var hotkeys: Hotkeys
  public var updates: Updates
  public var history: History
  public var toolKeys: [String: String]
  public var toolVariants: [String: String]
  public var capture: Capture
  public var save: Save
  public var ocr: OCR
  public var compress: Compress
  public var notifications: Notifications
  public var annotate: Annotate
  public var pin: Pin
  public var appearance: Appearance
  public var beautify: Beautify
  public var features: [String: Bool]
  public var toolbarOrder: [String]
}

// MARK: - Defaults and merging (ports of settings.ts)

public enum SettingsRules {
  /** DEFAULT_SETTINGS (macOS) as JSON. */
  public static let defaultsJSON: JSON = {
    do { return try JSON.parse(defaultSettingsJSON) } catch { fatalError("bad built-in defaults: \(error)") }
  }()

  public static let defaults: Settings = {
    do { return try defaultsJSON.decode(Settings.self) } catch { fatalError("built-in defaults don't decode: \(error)") }
  }()

  /**
   * mergeSettings: deep-merge saved settings over the defaults. Keys only in `saved` are kept;
   * a value of a different JavaScript type than its default falls back to the default.
   */
  public static func merge(_ d: JSON?, _ s: JSON?) -> JSON? {
    if let d, let s, d.isObject, s.isObject {
      var out = d
      for k in s.keys {
        let sv = s[k]!
        out = out.setting(k, d[k] != nil ? merge(d[k], sv) ?? sv : sv)
      }
      return out
    }
    guard let s else { return d }
    if let d, d.jsType != s.jsType { return d }
    return s
  }

  /** applyPatch: objects merge key by key at any depth; arrays and plain values replace. */
  public static func applyPatch(_ saved: JSON, _ patch: JSON) -> JSON {
    var out: JSON = saved.isObject ? saved : .object([])
    for k in patch.keys {
      let v = patch[k]!
      if let prev = out[k], v.isObject, prev.isObject { out = out.setting(k, applyPatch(prev, v)) } else { out = out.setting(k, v) }
    }
    return out
  }

  /** The settings in effect for stored overrides. Values that don't decode fall back to the defaults. */
  public static func resolve(_ saved: JSON) -> Settings {
    let merged = merge(defaultsJSON, saved) ?? defaultsJSON
    if let s = try? merged.decode(Settings.self) { return s }
    // Something survived the type check but not the stricter Swift model (e.g. a wrong item type
    // inside an array): keep each section that decodes on its own, default the rest.
    var fixed = defaultsJSON
    for k in defaultsJSON.keys {
      let candidate = defaultsJSON.setting(k, merged[k] ?? defaultsJSON[k]!)
      if (try? candidate.decode(Settings.self)) != nil { fixed = fixed.setting(k, merged[k]!) }
    }
    return (try? fixed.decode(Settings.self)) ?? defaults
  }
}

// MARK: - Toolbar order (port of toolbarOrder / visibleFeatures)

extension Settings {
  /** Every feature id in the user's order; ids missing from a saved order go right after the feature they follow. */
  public func orderedFeatureIds() -> [String] {
    var order = toolbarOrder.filter { id in Features.all.contains { $0.id == id } }
    for (i, f) in Features.all.enumerated() where !order.contains(f.id) {
      let after = i > 0 ? (order.firstIndex(of: Features.all[i - 1].id) ?? -1) : -1
      order.insert(f.id, at: after + 1)
    }
    return order
  }

  /** Enabled features of one kind, in the user's order. */
  public func visibleFeatures(_ kind: Feature.Kind) -> [Feature] {
    orderedFeatureIds()
      .compactMap { id in Features.all.first { $0.id == id } }
      .filter { $0.kind == kind && (features[$0.id] ?? $0.defaultEnabled) }
  }
}
