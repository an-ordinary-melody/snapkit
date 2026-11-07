import Foundation

// How saved files are named: a port of src/shared/naming.ts.

public enum Naming {
  private static func pad(_ n: Int, _ w: Int = 2) -> String {
    let s = String(n)
    return s.count >= w ? s : String(repeating: "0", count: w - s.count) + s
  }

  /** "2026-10-24 at 05.30.12" */
  public static func dateStamp(_ d: Date, calendar: Calendar = .current) -> String {
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: d)
    return "\(c.year!)-\(pad(c.month!))-\(pad(c.day!)) at \(pad(c.hour!)).\(pad(c.minute!)).\(pad(c.second!))"
  }

  /** Characters not allowed in file names on macOS or Windows become "-". */
  static func safe(_ s: String) -> String {
    String(s.unicodeScalars.map { u -> Character in
      "/\\:*?\"<>|".unicodeScalars.contains(u) || u.value < 0x20 ? "-" : Character(u)
    })
  }

  /** The file name (with .png) for a capture saved at `now` as number `n`; a timestamp name if the rule makes nothing. */
  public static func fileName(_ rule: NameRule, now: Date, n: Int, calendar: Calendar = .current) -> String {
    let num = pad(max(0, n), min(8, max(1, rule.digits)))
    let date = dateStamp(now, calendar: calendar)
    let parts: [String?] = [
      rule.number == "before" ? num : nil,
      rule.date == "before" ? date : nil,
      safe(rule.text).trimmingCharacters(in: .whitespaces),
      rule.date == "after" ? date : nil,
      rule.number == "after" ? num : nil
    ]
    var base = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
    while base.hasPrefix(".") { base.removeFirst() }
    return "\(base.isEmpty ? "Snapkit \(date)" : base).png"
  }

  /** "name.png" -> "name 2.png", "name 3.png"… while `taken` says the name is used. */
  public static func uniqueName(_ name: String, taken: (String) -> Bool) -> String {
    if !taken(name) { return name }
    let stem = name.lowercased().hasSuffix(".png") ? String(name.dropLast(4)) : name
    var i = 2
    while true {
      let next = "\(stem) \(i).png"
      if !taken(next) { return next }
      i += 1
    }
  }
}
