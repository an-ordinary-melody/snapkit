import AppKit
import SnapkitCore

/** The result of an update check (UpdateCheck in ipc.ts). */
struct UpdateCheck {
  enum Status { case available, latest, unavailable, error }
  var status: Status
  var current: String
  var version: String?
  /** The download for this OS (or the release page). */
  var url: String?
  var page: String?
  var message: String?
}

/**
 * Update checks (src/main/system.ts): compare the newest GitHub release of `updates.repo` with this
 * version; an available update is announced once per version and opens its download. Nothing
 * installs by itself. (Sparkle replaces this when release work is done: the feed isn't hosted yet.)
 */
final class Updater {
  let store: SettingsStore
  private(set) var latest: UpdateCheck?
  var onCheck: (UpdateCheck) -> Void = { _ in }

  init(store: SettingsStore) {
    self.store = store
  }

  static var current: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }

  /** Check a little after startup, then every 6 hours; at most once a day unless asked. */
  func schedule() {
    let maybe = { [weak self] in
      guard let self else { return }
      let u = self.store.current.updates
      if u.autoCheck && Date().timeIntervalSince1970 * 1000 - u.lastCheck > 86_400_000 { self.check(manual: false) { _ in } }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: maybe)
    Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in maybe() }
  }

  func check(manual: Bool, done: @escaping (UpdateCheck) -> Void) {
    let repo = store.current.updates.repo
    let current = Updater.current
    guard repo.range(of: #"^[\w.-]+/[\w.-]+$"#, options: .regularExpression) != nil,
          let url = URL(string: "https://api.github.com/repos/\(repo)/releases?per_page=30") else {
      return finish(UpdateCheck(status: .error, current: current, message: "not a GitHub \"owner/repo\""), manual: manual, done: done)
    }
    var req = URLRequest(url: url, timeoutInterval: 10)
    req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    req.setValue("Snapkit/\(current)", forHTTPHeaderField: "User-Agent")
    URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
      let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
      var result: UpdateCheck
      if let err {
        result = UpdateCheck(status: .error, current: current, message: err.localizedDescription)
      } else if code == 404 {
        result = UpdateCheck(status: .unavailable, current: current, message: "No release has been published yet.")
      } else if code != 200 {
        result = UpdateCheck(status: .error, current: current, message: "GitHub answered \(code).")
      } else {
        let list = ((try? JSONSerialization.jsonObject(with: data ?? Data())) as? [[String: Any]] ?? []).map { r in
          Version.Release(tag: r["tag_name"] as? String ?? "", draft: r["draft"] as? Bool ?? false, prerelease: r["prerelease"] as? Bool ?? false,
                          page: r["html_url"] as? String,
                          assets: (r["assets"] as? [[String: Any]] ?? []).map { ($0["name"] as? String ?? "", $0["browser_download_url"] as? String ?? "") })
        }
        if let r = Version.pick(list, current: current) {
          let version = r.tag.replacingOccurrences(of: #"^v"#, with: "", options: .regularExpression)
          // The installer for this OS, when the release has one; else the release page.
          let asset = r.assets.first { $0.name.lowercased().hasSuffix(".dmg") }
          let page = r.page ?? "https://github.com/\(repo)/releases/latest"
          result = Version.compare(version, current) > 0
            ? UpdateCheck(status: .available, current: current, version: version, url: asset?.url ?? page, page: page)
            : UpdateCheck(status: .latest, current: current, version: version)
        } else {
          result = UpdateCheck(status: .unavailable, current: current, message: "No release has been published yet.")
        }
      }
      DispatchQueue.main.async { self?.finish(result, manual: manual, done: done) }
    }.resume()
  }

  private func finish(_ r: UpdateCheck, manual: Bool, done: (UpdateCheck) -> Void) {
    store.update(.object([("updates", .object([("lastCheck", .number(Date().timeIntervalSince1970 * 1000))]))]))
    latest = r
    log("[updates] \(manual ? "manual" : "auto") check: \(r.status)\(r.version.map { " " + $0 } ?? "")\(r.message.map { " (" + $0 + ")" } ?? "")")
    if r.status == .available, let v = r.version, manual || store.current.updates.notified != v {
      store.update(.object([("updates", .object([("notified", .string(v))]))]))
      Notifier.post(title: "Snapkit \(v) is available", body: "You have \(r.current). Click to download.", open: r.url.flatMap(URL.init(string:)))
    }
    onCheck(r)
    done(r)
  }
}
