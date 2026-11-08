import Foundation

/** Math.round: halves round up (towards +∞), and -0 becomes 0. */
public func jsRound(_ v: Double) -> Double {
  let r = (v + 0.5).rounded(.down)
  return r == 0 ? 0 : r
}

/** Colour helpers: ports of src/renderer/src/overlay/annotate/color.ts. */
public enum HexColor {
  /** "#abc", "abc", "#aabbcc" → "#aabbcc"; nil if it isn't a hex colour. */
  public static func parse(_ input: String) -> String? {
    var s = input.trimmingCharacters(in: .whitespaces).lowercased()
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 3 || s.count == 6, s.allSatisfy({ $0.isHexDigit }) else { return nil }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    return "#" + s
  }

  /** (r, g, b) in 0–1; black for anything that isn't a hex colour. */
  public static func rgb(_ hex: String) -> (Double, Double, Double) {
    let n = Int((parse(hex) ?? "#000000").dropFirst(), radix: 16) ?? 0
    return (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
  }

  public static func isLight(_ hex: String) -> Bool {
    guard parse(hex) != nil else { return false }
    let (r, g, b) = rgb(hex)
    return 0.299 * r + 0.587 * g + 0.114 * b > 0.6
  }

  /** Black or white, whichever reads better on `hex`. */
  public static func readableOn(_ hex: String) -> String { isLight(hex) ? "#111111" : "#ffffff" }
}
