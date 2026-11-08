import Foundation

/** Version comparison and release picking: a port of src/shared/version.ts. */
public enum Version {
  /** "v1.2.3" / "1.2.3-beta.1" → (1, 2, 3, "beta.1"). */
  static func parse(_ v: String) -> (Int, Int, Int, String) {
    let s = v.trimmingCharacters(in: .whitespaces)
    let re = try! NSRegularExpression(pattern: #"^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?"#)
    guard let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return (0, 0, 0, "") }
    func g(_ i: Int) -> String? { Range(m.range(at: i), in: s).map { String(s[$0]) } }
    return (Int(g(1) ?? "0") ?? 0, Int(g(2) ?? "0") ?? 0, Int(g(3) ?? "0") ?? 0, g(4) ?? "")
  }

  /** Negative if a < b, 0 if equal, positive if a > b. A prerelease is older than its release. */
  public static func compare(_ a: String, _ b: String) -> Int {
    let pa = parse(a), pb = parse(b)
    for (x, y) in [(pa.0, pb.0), (pa.1, pb.1), (pa.2, pb.2)] where x != y { return x - y }
    if pa.3 == pb.3 { return 0 }
    if pa.3.isEmpty { return 1 }
    if pb.3.isEmpty { return -1 }
    // Prerelease parts one by one: numbers as numbers (beta.10 > beta.2), words alphabetically.
    let xa = pa.3.split(separator: ".").map(String.init), xb = pb.3.split(separator: ".").map(String.init)
    for i in 0..<max(xa.count, xb.count) {
      if i >= xa.count { return -1 }
      if i >= xb.count { return 1 }
      if let na = Int(xa[i]), let nb = Int(xb[i]), xa[i].allSatisfy(\.isNumber), xb[i].allSatisfy(\.isNumber) {
        if na != nb { return na - nb }
      } else if xa[i] != xb[i] {
        return xa[i] < xb[i] ? -1 : 1
      }
    }
    return 0
  }

  public struct Release: Equatable {
    public var tag: String
    public var draft: Bool
    public var prerelease: Bool
    public var page: String?
    public var assets: [(name: String, url: String)]

    public init(tag: String, draft: Bool = false, prerelease: Bool = false, page: String? = nil, assets: [(name: String, url: String)] = []) {
      self.tag = tag
      self.draft = draft
      self.prerelease = prerelease
      self.page = page
      self.assets = assets
    }

    public static func == (a: Release, b: Release) -> Bool { a.tag == b.tag && a.draft == b.draft && a.prerelease == b.prerelease }
  }

  /** The newest release to offer. Betas only to people already on a beta. */
  public static func pick(_ list: [Release], current: String) -> Release? {
    let onBeta = current.contains("-")
    var best: Release?
    for r in list where !r.draft && (!r.prerelease || onBeta) {
      if best == nil || compare(r.tag, best!.tag) > 0 { best = r }
    }
    return best
  }
}
