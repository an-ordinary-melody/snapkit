import Foundation

/**
 * A JSON value that keeps object keys in order, so settings.json is written back the way
 * Electron writes it (JSON.stringify keeps insertion order) and unknown keys survive.
 */
public enum JSON: Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSON])
  case object([(String, JSON)])

  public static func == (a: JSON, b: JSON) -> Bool {
    switch (a, b) {
    case (.null, .null): return true
    case let (.bool(x), .bool(y)): return x == y
    case let (.number(x), .number(y)): return x == y
    case let (.string(x), .string(y)): return x == y
    case let (.array(x), .array(y)): return x == y
    case let (.object(x), .object(y)):
      // Same keys and values, in any order.
      guard x.count == y.count else { return false }
      return x.allSatisfy { k, v in y.first { $0.0 == k }?.1 == v }
    default: return false
    }
  }

  public subscript(key: String) -> JSON? {
    if case let .object(pairs) = self { return pairs.first { $0.0 == key }?.1 }
    return nil
  }

  /** A copy with `key` set (replaced in place, or appended). Non-objects become objects. */
  public func setting(_ key: String, _ value: JSON) -> JSON {
    var pairs: [(String, JSON)] = []
    if case let .object(p) = self { pairs = p }
    if let i = pairs.firstIndex(where: { $0.0 == key }) { pairs[i].1 = value } else { pairs.append((key, value)) }
    return .object(pairs)
  }

  public func removing(_ key: String) -> JSON {
    guard case let .object(p) = self else { return self }
    return .object(p.filter { $0.0 != key })
  }

  public var isObject: Bool { if case .object = self { return true }; return false }
  public var keys: [String] { if case let .object(p) = self { return p.map(\.0) }; return [] }
  public var string: String? { if case let .string(s) = self { return s }; return nil }
  public var double: Double? { if case let .number(n) = self { return n }; return nil }
  public var bool: Bool? { if case let .bool(b) = self { return b }; return nil }
  public var array: [JSON]? { if case let .array(a) = self { return a }; return nil }

  /** JavaScript's `typeof`, which mergeSettings compares: null and arrays are "object". */
  public var jsType: String {
    switch self {
    case .null, .array, .object: return "object"
    case .bool: return "boolean"
    case .number: return "number"
    case .string: return "string"
    }
  }
}

// MARK: - Parsing

public struct JSONError: Error, CustomStringConvertible {
  public let description: String
}

extension JSON {
  public static func parse(_ text: String) throws -> JSON {
    var p = Parser(Array(text.utf8))
    p.skipSpace()
    let v = try p.value()
    p.skipSpace()
    guard p.i == p.b.count else { throw JSONError(description: "trailing characters at \(p.i)") }
    return v
  }

  public static func parse(_ data: Data) throws -> JSON {
    guard let s = String(data: data, encoding: .utf8) else { throw JSONError(description: "not UTF-8") }
    return try parse(s)
  }

  private struct Parser {
    let b: [UInt8]
    var i = 0
    init(_ b: [UInt8]) { self.b = b }

    mutating func skipSpace() {
      while i < b.count, b[i] == 0x20 || b[i] == 0x0A || b[i] == 0x0D || b[i] == 0x09 { i += 1 }
    }

    func fail(_ msg: String) -> JSONError { JSONError(description: "\(msg) at \(i)") }

    mutating func expect(_ word: String) throws {
      let w = Array(word.utf8)
      guard i + w.count <= b.count, Array(b[i..<i + w.count]) == w else { throw fail("expected \(word)") }
      i += w.count
    }

    mutating func value() throws -> JSON {
      guard i < b.count else { throw fail("unexpected end") }
      switch b[i] {
      case UInt8(ascii: "{"): return try object()
      case UInt8(ascii: "["): return try array()
      case UInt8(ascii: "\""): return .string(try string())
      case UInt8(ascii: "t"): try expect("true"); return .bool(true)
      case UInt8(ascii: "f"): try expect("false"); return .bool(false)
      case UInt8(ascii: "n"): try expect("null"); return .null
      default: return .number(try number())
      }
    }

    mutating func object() throws -> JSON {
      i += 1
      var pairs: [(String, JSON)] = []
      skipSpace()
      if i < b.count, b[i] == UInt8(ascii: "}") { i += 1; return .object(pairs) }
      while true {
        skipSpace()
        guard i < b.count, b[i] == UInt8(ascii: "\"") else { throw fail("expected a key") }
        let k = try string()
        skipSpace()
        guard i < b.count, b[i] == UInt8(ascii: ":") else { throw fail("expected :") }
        i += 1
        skipSpace()
        let v = try value()
        // A repeated key: the last one wins, as in JSON.parse.
        if let j = pairs.firstIndex(where: { $0.0 == k }) { pairs[j].1 = v } else { pairs.append((k, v)) }
        skipSpace()
        guard i < b.count else { throw fail("unexpected end") }
        if b[i] == UInt8(ascii: ",") { i += 1; continue }
        if b[i] == UInt8(ascii: "}") { i += 1; return .object(pairs) }
        throw fail("expected , or }")
      }
    }

    mutating func array() throws -> JSON {
      i += 1
      var items: [JSON] = []
      skipSpace()
      if i < b.count, b[i] == UInt8(ascii: "]") { i += 1; return .array(items) }
      while true {
        skipSpace()
        items.append(try value())
        skipSpace()
        guard i < b.count else { throw fail("unexpected end") }
        if b[i] == UInt8(ascii: ",") { i += 1; continue }
        if b[i] == UInt8(ascii: "]") { i += 1; return .array(items) }
        throw fail("expected , or ]")
      }
    }

    mutating func string() throws -> String {
      i += 1
      var out = [UInt8]()
      while i < b.count {
        let c = b[i]
        if c == UInt8(ascii: "\"") { i += 1; return String(decoding: out, as: UTF8.self) }
        if c == UInt8(ascii: "\\") {
          i += 1
          guard i < b.count else { break }
          let e = b[i]
          i += 1
          switch e {
          case UInt8(ascii: "n"): out.append(0x0A)
          case UInt8(ascii: "t"): out.append(0x09)
          case UInt8(ascii: "r"): out.append(0x0D)
          case UInt8(ascii: "b"): out.append(0x08)
          case UInt8(ascii: "f"): out.append(0x0C)
          case UInt8(ascii: "u"):
            var code = try hex4()
            // Surrogate pair.
            if (0xD800..<0xDC00).contains(code), i + 1 < b.count, b[i] == UInt8(ascii: "\\"), b[i + 1] == UInt8(ascii: "u") {
              i += 2
              let low = try hex4()
              code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
            }
            out.append(contentsOf: Array(String(UnicodeScalar(code).map(Character.init) ?? "\u{FFFD}").utf8))
          default: out.append(e)
          }
          continue
        }
        out.append(c)
        i += 1
      }
      throw fail("unterminated string")
    }

    mutating func hex4() throws -> UInt32 {
      guard i + 4 <= b.count, let v = UInt32(String(decoding: b[i..<i + 4], as: UTF8.self), radix: 16) else { throw fail("bad \\u escape") }
      i += 4
      return v
    }

    mutating func number() throws -> Double {
      let start = i
      while i < b.count, "+-0123456789.eE".utf8.contains(b[i]) { i += 1 }
      guard let v = Double(String(decoding: b[start..<i], as: UTF8.self)) else { throw fail("bad number") }
      return v
    }
  }
}

// MARK: - Writing

extension JSON {
  /** Like JSON.stringify(value, null, indent) (indent 0: compact). */
  public func serialized(indent: Int = 0) -> String {
    var out = ""
    write(&out, indent: indent, level: 0)
    return out
  }

  private func write(_ out: inout String, indent: Int, level: Int) {
    let nl = indent > 0 ? "\n" : ""
    let pad = { (l: Int) in String(repeating: " ", count: indent * l) }
    switch self {
    case .null: out += "null"
    case let .bool(b): out += b ? "true" : "false"
    case let .number(n): out += JSON.format(n)
    case let .string(s): out += JSON.quote(s)
    case let .array(items):
      if items.isEmpty { out += "[]"; return }
      out += "[" + nl
      for (k, v) in items.enumerated() {
        out += pad(level + 1)
        v.write(&out, indent: indent, level: level + 1)
        out += (k < items.count - 1 ? "," : "") + nl
      }
      out += pad(level) + "]"
    case let .object(pairs):
      if pairs.isEmpty { out += "{}"; return }
      out += "{" + nl
      for (k, (key, v)) in pairs.enumerated() {
        out += pad(level + 1) + JSON.quote(key) + (indent > 0 ? ": " : ":")
        v.write(&out, indent: indent, level: level + 1)
        out += (k < pairs.count - 1 ? "," : "") + nl
      }
      out += pad(level) + "}"
    }
  }

  static func format(_ n: Double) -> String {
    if !n.isFinite { return "null" }
    if n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
    return "\(n)"
  }

  static func quote(_ s: String) -> String {
    var out = "\""
    for u in s.unicodeScalars {
      switch u {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      default:
        if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
      }
    }
    return out + "\""
  }
}

// MARK: - Codable bridge

extension JSON {
  /** Decode a Codable type from this value. */
  public func decode<T: Decodable>(_ type: T.Type) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(serialized().utf8))
  }

  /** A JSON value from any Encodable. */
  public static func encode<T: Encodable>(_ value: T) throws -> JSON {
    try parse(try JSONEncoder().encode(value))
  }
}
