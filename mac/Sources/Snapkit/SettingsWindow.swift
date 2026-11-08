import AppKit
import SnapkitCore
import SwiftUI

/**
 * Liquid Glass windows (Settings, History): the whole window is glass, a light or dark frost keeping
 * text readable, over Snapkit's own picture (soft violet in light mode, teal in dark), so it looks the
 * same on any desktop. Before macOS 26 a frosted material stands in for the glass.
 */
enum GlassSurface {
  static func isDark(_ mode: String) -> Bool {
    mode == "system" ? NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua : mode != "light"
  }

  /** Adds the picture and the glass over it, under `content`; both follow the container's size. */
  static func install(in container: NSView, below content: NSView, mode: String, picture: NSImage? = nil) -> (glass: NSView, picture: NSView) {
    let dark = isDark(mode)
    let glass: NSView
    if #available(macOS 26.0, *) {
      let g = NSGlassEffectView()
      g.style = .regular
      g.tintColor = (dark ? NSColor.black : NSColor.white).withAlphaComponent(0.28)
      glass = g
    } else {
      let e = NSVisualEffectView()
      e.material = .sidebar
      e.blendingMode = .withinWindow
      e.state = .active
      glass = e
    }
    let paint = NSView()
    paint.wantsLayer = true
    paint.layer?.contents = picture ?? Bundle.main.image(forResource: dark ? "glass-dark" : "glass-light")
    paint.layer?.contentsGravity = .resizeAspectFill
    for v in [glass, paint] {
      v.frame = container.bounds
      v.autoresizingMask = [.width, .height]
    }
    container.addSubview(glass, positioned: .below, relativeTo: content)
    container.addSubview(paint, positioned: .below, relativeTo: glass)
    return (glass, paint)
  }
}

/**
 * The settings window (Settings.tsx and its sections): a sidebar of sections; every change is saved
 * and applied right away. While it's open Snapkit has a Dock icon, like a normal app.
 */
final class SettingsWindowController: NSObject, NSWindowDelegate {
  let model: SettingsModel
  private var window: NSWindow?
  /** The window's content (its appearance is set directly, so a theme switch shows at once). */
  private var frost: NSView?
  var onClose: () -> Void = {}

  init(model: SettingsModel) {
    self.model = model
    super.init()
    // A click on another app closes Settings, as a popover would. Snapkit's own dialogs (the
    // folder picker, the colour panel) keep it open: those don't make Snapkit inactive.
    NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self, self.isOpen else { return }
      log("[settings] another app was clicked: closing Settings")
      self.close()
    }
    // A modal box (Reset all…, an alert) hides with the app; coming back shows it again, never leaving
    // Settings swallowing clicks behind an invisible one.
    NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
      NSApp.modalWindow?.makeKeyAndOrderFront(nil)
    }
  }

  var isOpen: Bool { window?.isVisible ?? false }

  func show(section: String? = nil) {
    if window == nil {
      let w = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 880, height: 640), styleMask: [.titled, .closable, .resizable, .fullSizeContentView, .miniaturizable],
                       backing: .buffered, defer: false)
      w.titlebarAppearsTransparent = true
      w.titleVisibility = .hidden
      // An empty unified toolbar: the window buttons sit lower, inside the sidebar pane, and the
      // window gets the toolbar corner radius its pane is concentric with (macOS 26).
      w.toolbar = NSToolbar(identifier: "settings")
      w.toolbarStyle = .unified
      w.title = "Snapkit Settings"
      w.minSize = CGSize(width: 720, height: 480)
      w.isReleasedWhenClosed = false
      w.delegate = self
      // The SwiftUI content over a backdrop view (applyBackdrop): Liquid Glass for the whole window.
      let host = NSHostingView(rootView: SettingsRoot(model: model))
      let wrap = NSView(frame: w.contentRect(forFrameRect: w.frame))
      host.frame = wrap.bounds
      host.autoresizingMask = [.width, .height]
      wrap.addSubview(host)
      w.contentView = wrap
      w.center()
      window = w
      self.frost = host
    }
    if let section { model.section = section }
    model.refreshHistory()
    model.refreshLogin()
    applyAppearance()
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    NSApp.modalWindow?.makeKeyAndOrderFront(nil)
  }

  /**
   * Light / dark / system for the window's own parts (title bar, menus, pop-ups); Gray is dark.
   * `mode`: the new one when called from a settings change (the model still holds the old one then).
   */
  func applyAppearance(_ mode: String? = nil) {
    let m = mode ?? model.s.appearance.mode
    let a = m == "light" ? NSAppearance(named: .aqua) : m == "system" ? nil : NSAppearance(named: .darkAqua)
    window?.appearance = a
    frost?.appearance = a ?? NSApp.effectiveAppearance
    frost?.needsDisplay = true
    applyBackdrop()
  }

  private var backdrop: NSView?
  /** The picture under the glass (glass-light.jpg / glass-dark.jpg). */
  private var painting: NSView?
  /** Test hook glass-image: another picture to try under the glass. */
  var testImage: NSImage?

  /**
   * Liquid Glass: the whole window is glass (a light or dark frost keeps text readable) over Snapkit's
   * own picture (soft violet in light mode, teal in dark), so it looks the same on any desktop; SettingsRoot puts the sidebar on it and
   * the content on an inset sheet. Off: opaque.
   * `appearance`: the new one when called from a settings change (the model still holds the old one).
   */
  func applyBackdrop(_ appearance: SnapkitCore.Settings.Appearance? = nil) {
    guard let w = window, let wrap = w.contentView, let host = frost else { return }
    let a = appearance ?? model.s.appearance
    backdrop?.removeFromSuperview()
    backdrop = nil
    painting?.removeFromSuperview()
    painting = nil
    w.isOpaque = !a.glass
    w.backgroundColor = a.glass ? .clear : .windowBackgroundColor
    guard a.glass else { return }
    let layers = GlassSurface.install(in: wrap, below: host, mode: a.mode, picture: testImage)
    backdrop = layers.glass
    painting = layers.picture
  }

  /** Test hook: the window's backdrop ("glass", "frost" before macOS 26, "none"). */
  var testBackdrop: String { backdrop == nil ? "none" : backdrop is NSVisualEffectView ? "frost" : "glass" }
  /** Test hook: the picture under the glass is there. */
  var testHasPicture: Bool { painting?.layer?.contents != nil }

  func windowWillClose(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    onClose()
  }

  func windowDidBecomeKey(_ notification: Notification) {
    model.refreshLogin() // back from System Settings
  }

  /** Test hooks. */
  var testWindow: NSWindow? { window }
  var testFrost: NSView? { frost }
  func close() { window?.close() }
}


struct SettingsRoot: View {
  @ObservedObject var model: SettingsModel
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var body: some View {
    let th = SettingsTheme(model.s.appearance)
    Group {
      if th.glass {
        // The window is glass with the sidebar on it; the content sits on an inset sheet, slightly
        // see-through (solid with Reduce Transparency), its corners concentric with the window's.
        HStack(spacing: 0) {
          sidebar(th).frame(width: 210)
          content(th)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(th.main.opacity(reduceTransparency ? 1 : th.dark ? 0.6 : 0.72)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(th.dark ? Color.white.opacity(0.08) : Color.white.opacity(0.7), lineWidth: 0.5))
            .padding(.vertical, 8).padding(.trailing, 8)
        }
      } else {
        HStack(spacing: 0) {
          sidebar(th).frame(width: 210).background(th.sidebar)
          content(th).background(th.main).overlay(alignment: .leading) { Rectangle().fill(th.cardEdge).frame(width: 0.5) }
        }
      }
    }
    .environment(\.colorScheme, th.dark ? .dark : .light)
    .ignoresSafeArea()
    .frame(minWidth: 720, minHeight: 480)
  }

  private func sidebar(_ th: SettingsTheme) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Spacer().frame(height: 52)
      ForEach(SettingsSections.all, id: \.id) { sec in
        let on = sec.id == model.section
        HStack(spacing: 9) {
          let lit = on && !th.glass
          IconView(id: sec.icon, size: 16, color: lit ? th.t.activeForeground : th.t.foreground)
          Text(sec.label).font(.system(size: 13, weight: on && th.glass ? .semibold : .regular)).foregroundColor(lit ? th.activeFg : th.fg)
          Spacer()
        }
        .padding(.horizontal, 10).frame(height: 30)
        .background(RoundedRectangle(cornerRadius: th.glass ? 9 : 7, style: .continuous).fill(on ? (th.glass ? Color.primary.opacity(th.dark ? 0.14 : 0.09) : th.activeBg) : Color.clear))
        .contentShape(Rectangle())
        .onTapGesture { model.section = sec.id }
      }
      Spacer()
    }
    .padding(.horizontal, 10).padding(.vertical, 8)
  }

  private func content(_ th: SettingsTheme) -> some View {
    VStack(spacing: 0) {
      let sec = SettingsSections.all.first { $0.id == model.section } ?? SettingsSections.all[0]
      HStack {
        Text(sec.label).font(.system(size: 15, weight: .semibold)).foregroundColor(th.fg)
        Spacer()
        if !sec.keys.isEmpty {
          SButton(label: "Reset section", icon: "rotate", subtle: true, th: th) { model.reset(sec.keys) }
        }
      }
      .padding(.horizontal, th.glass ? 16 : 24).frame(height: 52)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) { SectionView(id: sec.id, model: model, th: th) }
          .padding(.horizontal, th.glass ? 16 : 24).padding(.top, 4).padding(.bottom, 32)
      }
    }
  }
}

enum SettingsSections {
  struct Section { let id, label, icon: String; let keys: [String] }
  static let all: [Section] = [
    .init(id: "general", label: "General", icon: "sliders", keys: ["pin", "save", "notifications", "history"]),
    .init(id: "shortcuts", label: "Shortcuts", icon: "keyboard", keys: ["hotkeys", "toolKeys"]),
    .init(id: "appearance", label: "Appearance", icon: "sunmoon", keys: ["appearance", "capture"]),
    .init(id: "toolbar", label: "Toolbar", icon: "panels", keys: ["features", "toolbarOrder"]),
    .init(id: "tools", label: "Tools", icon: "pentool", keys: ["annotate", "toolVariants"]),
    .init(id: "background", label: "Background", icon: "images", keys: ["beautify"]),
    .init(id: "about", label: "About", icon: "info", keys: [])
  ]
}

struct SectionView: View {
  let id: String
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  var body: some View {
    switch id {
    case "general": GeneralSection(model: model, th: th)
    case "shortcuts": ShortcutsSection(model: model, th: th)
    case "appearance": AppearanceSection(model: model, th: th)
    case "toolbar": ToolbarSection(model: model, th: th)
    case "tools": ToolsSection(model: model, th: th)
    case "background": BackgroundSection(model: model, th: th)
    default: AboutSection(model: model, th: th)
    }
  }
}

private func b(_ v: Bool) -> JSON { .bool(v) }
private func n(_ v: Double) -> JSON { .number(v) }
private func str(_ v: String) -> JSON { .string(v) }

// MARK: - General

struct GeneralSection: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  var body: some View {
    let s = model.s
    SGroup(title: "Startup", th: th) {
      SRow(label: "Launch at login", desc: model.login?.needsApproval == true ? "Approve it in System Settings → General → Login Items." : "Start Snapkit when you log in.", first: true, th: th) {
        if model.login?.needsApproval == true {
          SButton(label: "Open Login Items", th: th) { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension")!) }
        }
        SToggle(value: model.login?.enabled ?? false, th: th, disabled: model.login == nil) { model.setLogin($0) }
      }
    }
    SGroup(title: "After a capture", th: th) {
      SRow(label: "Quick area capture", desc: "Copies the area the moment you let go. No editing step.", first: true, th: th) {
        SToggle(value: s.capture.quickCopy, th: th) { model.set(["capture", "quickCopy"], b($0)) }
      }
      SRow(label: "Copy text", desc: s.ocr.textButton == "panel" ? "Shows the text so you can check it before copying." : "Copies the text right away.", th: th) {
        SSegmented(value: s.ocr.textButton, options: [("panel", "Show text first"), ("copy", "Copy right away")], th: th) { model.set(["ocr", "textButton"], str($0)) }
      }
      SRow(label: "Copy last area right away", desc: "For Capture last area. Off: opens capture mode with the area selected.", th: th) {
        SToggle(value: s.capture.lastAreaInstant, th: th) { model.set(["capture", "lastAreaInstant"], b($0)) }
      }
      SRow(label: "Copy full-screen captures right away", desc: "Off: they only go to the floating preview and history.", th: th) {
        SToggle(value: s.capture.fullscreenCopy, th: th) { model.set(["capture", "fullscreenCopy"], b($0)) }
      }
      SRow(label: "Floating preview after copy", desc: "Keeps the result in a corner. Use the \"Pin\" button to turn it on or off.", th: th) {
        SToggle(value: s.pin.afterCopy, th: th) { model.set(["pin", "afterCopy"], b($0)) }
      }
      SRow(label: "Background on by default", desc: "Automatically adds the background when you copy or save. Use the \"Background\" button to turn it on or off.", th: th) {
        SToggle(value: s.beautify.applyOnCopy, th: th) { model.set(["beautify", "applyOnCopy"], b($0)) }
      }
      SRow(label: "Compress images", desc: "Smaller PNGs with fewer colors; text stays sharp. Use the \"Compress\" switch in the editor to turn it on or off.", th: th) {
        SToggle(value: s.compress.enabled, th: th) { model.set(["compress", "enabled"], b($0)) }
      }
      if s.compress.enabled {
        SRow(label: "Compression", desc: s.compress.preset == "standard" ? "Fewer colors, same size." : "Fewer colors, and 1× size on Retina / HiDPI screens.", th: th) {
          SSegmented(value: s.compress.preset, options: [("standard", "Standard"), ("smallest", "Smallest")], th: th) { model.set(["compress", "preset"], str($0)) }
        }
        SRow(label: "Compress when", th: th) {
          SSegmented(value: s.compress.applyTo, options: [("both", "Copy and save"), ("copy", "Copy"), ("save", "Save")], th: th) { model.set(["compress", "applyTo"], str($0)) }
        }
      }
    }
    SGroup(title: "Saving", th: th) {
      SRow(label: "Ask where to save", desc: "Off: save straight to the screenshots folder.", first: true, th: th) {
        SToggle(value: s.save.askLocation, th: th) { model.set(["save", "askLocation"], b($0)) }
      }
      SRow(label: "Screenshots folder", desc: s.save.folder.isEmpty ? "\(Paths.defaultSaveFolder.path) (default)" : s.save.folder, th: th) {
        SButton(label: "Choose…", icon: "folder", th: th) {
          let p = NSOpenPanel()
          p.canChooseDirectories = true
          p.canChooseFiles = false
          p.canCreateDirectories = true
          p.directoryURL = Output.saveFolder(model.s)
          if p.runModal() == .OK, let u = p.url { model.set(["save", "folder"], str(u.path)) }
        }
        if !s.save.folder.isEmpty { SButton(label: "", icon: "rotate", subtle: true, th: th) { model.set(["save", "folder"], str("")) } }
      }
      NameBuilder(model: model, th: th)
    }
    SGroup(title: "Notifications", th: th) {
      SRow(label: "When copied", first: true, th: th) { SToggle(value: s.notifications.onCopy, th: th) { model.set(["notifications", "onCopy"], b($0)) } }
      SRow(label: "When saved", desc: "Click it to show the file.", th: th) { SToggle(value: s.notifications.onSave, th: th) { model.set(["notifications", "onSave"], b($0)) } }
    }
    let h = s.history
    let u = model.historyUsage
    let mb = { (b: Int) in String(format: b < 10 * 1024 * 1024 ? "%.1f MB" : "%.0f MB", Double(b) / 1024 / 1024) }
    SGroup(title: "History", note: "Your copies, saves and pins, to reuse. Open it with \(s.hotkeys.history.isEmpty ? "" : Accelerator.display(s.hotkeys.history) + " or ")History… in the menu bar. Starred ones are never removed.", th: th) {
      SRow(label: "Recording", desc: "Off: new captures aren't kept.", first: true, th: th) { SToggle(value: !h.paused, th: th) { model.set(["history", "paused"], b(!$0)) } }
      SRow(label: "Keep", desc: "Up to \(HistoryRules.maxCount) recent captures.", th: th) {
        SSlider(value: Double(min(h.maxCount, HistoryRules.maxCount)), min: 1, max: Double(HistoryRules.maxCount), th: th) { model.set(["history", "maxCount"], n($0)) }
      }
      SRow(label: "Size limit", desc: "When full, the oldest go first. Max 2 GB.", th: th) {
        SSlider(value: min(h.maxMB, HistoryRules.maxMB), min: 50, max: HistoryRules.maxMB, step: 50, th: th, format: { "\(Int($0)) MB" }) { model.set(["history", "maxMB"], n($0)) }
      }
      SRow(label: "Keep for", th: th) {
        SSelect(value: String(Int(h.maxAgeDays)), options: [("1", "1 day"), ("7", "7 days"), ("30", "30 days"), ("90", "90 days"), ("0", "Forever")], th: th) { model.set(["history", "maxAgeDays"], n(Double($0) ?? 30)) }
      }
      SRow(label: "Stored", desc: u.folder, th: th) {
        Text("\(u.count) \(u.count == 1 ? "capture" : "captures") · \(mb(u.bytes))").font(.system(size: 13)).foregroundColor(th.faint)
        SButton(label: "Show folder", icon: "folder", th: th) { model.openHistoryFolder() }
      }
      SRow(label: "Clear history", desc: "Deletes all history.", th: th) {
        SButton(label: "Clear, keep starred", disabled: u.count == 0, th: th) { model.history?.clear(keepStarred: true); model.refreshHistory() }
        SButton(label: "Clear all…", danger: true, disabled: u.count == 0, th: th) {
          let a = NSAlert()
          a.messageText = "Delete every capture in history, including starred ones?"
          a.addButton(withTitle: "Delete All")
          a.addButton(withTitle: "Cancel")
          if a.runModal() == .alertFirstButtonReturn { model.history?.clear(keepStarred: false); model.refreshHistory() }
        }
      }
    }
  }
}

/** File name, all in one place: text, date and number side by side, and a labelled preview. */
struct NameBuilder: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  var body: some View {
    let rule = model.s.save.name
    let next = model.s.save.nextNumber
    let now = Date()
    let num = String(repeating: "0", count: max(0, rule.digits - String(next).count)) + String(next)
    let parts: [(String, String)] = [
      rule.number == "before" ? ("number", num) : nil, rule.date == "before" ? ("date", Naming.dateStamp(now)) : nil,
      rule.text.trimmingCharacters(in: .whitespaces).isEmpty ? nil : ("text", rule.text.trimmingCharacters(in: .whitespaces)),
      rule.date == "after" ? ("date", Naming.dateStamp(now)) : nil, rule.number == "after" ? ("number", num) : nil
    ].compactMap { $0 }
    let whereOpts = [("none", "Off"), ("before", "Before"), ("after", "After")]
    VStack(alignment: .leading, spacing: 10) {
      Rectangle().fill(th.cardEdge).frame(height: 0.5).padding(.horizontal, -14)
      VStack(alignment: .leading, spacing: 2) {
        Text("File name").font(.system(size: 13)).foregroundColor(th.fg)
        Text("Text, plus the date and/or a counter.").font(.system(size: 11.5)).foregroundColor(th.faint)
      }
      HStack(alignment: .top, spacing: 14) {
        field("Text") {
          TextField("Snapkit", text: Binding(get: { rule.text }, set: { model.set(["save", "name", "text"], str($0)) }))
            .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundColor(th.fg).padding(.horizontal, 8).frame(width: 170, height: 28)
            .background(RoundedRectangle(cornerRadius: 7).fill(th.field))
        }
        field("Date and time") { SSegmented(value: rule.date, options: whereOpts, th: th) { model.set(["save", "name", "date"], str($0)) } }
        field("Number") { SSegmented(value: rule.number, options: whereOpts, th: th) { model.set(["save", "name", "number"], str($0)) } }
      }
      if rule.number != "none" {
        HStack(alignment: .top, spacing: 14) {
          field("Starting number") {
            SNumber(value: Double(next), min: 0, max: 99_999_999, width: 110, th: th) { model.set(["save", "nextNumber"], n($0)) }
            Text("The next save starts with this number.").font(.system(size: 11)).foregroundColor(th.faint)
          }
          field("Number of digits") {
            SNumber(value: Double(rule.digits), min: 1, max: 8, width: 110, th: th) { model.set(["save", "name", "digits"], n($0)) }
            Text("Padded with zeros: " + (0..<3).map { i in let v = String(next + i); return String(repeating: "0", count: max(0, rule.digits - v.count)) + v }.joined(separator: ", ") + "…")
              .font(.system(size: 11)).foregroundColor(th.faint)
          }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 8).fill(th.field))
      }
      HStack(spacing: 4) {
        ForEach(Array((parts.isEmpty ? [("date", Naming.dateStamp(now))] : parts).enumerated()), id: \.offset) { _, p in
          Text(p.1).font(.system(size: 12.5).monospacedDigit()).foregroundColor(th.fg).padding(.horizontal, 7).padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 5).fill(p.0 == "text" ? Color(NSColor.rgba(10, 132, 255, 0.16)) : p.0 == "date" ? Color(NSColor.rgba(52, 199, 89, 0.18)) : Color(NSColor.rgba(255, 159, 10, 0.2))))
        }
        Text(".png").font(.system(size: 12.5)).foregroundColor(th.faint)
        Spacer()
      }
      .padding(.horizontal, 10).padding(.vertical, 8)
      .background(RoundedRectangle(cornerRadius: 8).fill(th.field))
      .accessibilityLabel("Example: \(Naming.fileName(rule, now: now, n: next))")
    }
    .padding(.horizontal, 14).padding(.bottom, 12)
  }

  private func field<C: View>(_ label: String, @ViewBuilder _ c: () -> C) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(label).font(.system(size: 11.5)).foregroundColor(th.dim)
      c()
    }
  }
}

// MARK: - Shortcuts

struct ShortcutsSection: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  var body: some View {
    let s = model.s
    let tools = Features.all.filter(\.drawing)
    let keyOf = { (id: String) in (s.toolKeys[id] ?? Features.byId(id)?.hint ?? "").uppercased() }
    let taken = { (id: String, k: String) in !k.isEmpty && tools.contains { $0.id != id && keyOf($0.id) == k } }
    let held = { (name: String) in model.hotkeyTaken(name) ? "⚠ In use by another app. Snapkit takes it once it's free." : nil }
    SGroup(title: "Global", th: th) {
      ForEach(Array([("capture", "Capture area", s.hotkeys.capture), ("lastArea", "Capture last area", s.hotkeys.lastArea), ("ocr", "Capture text (OCR)", s.hotkeys.ocr),
                     ("fullscreen", "Capture full screen", s.hotkeys.fullscreen), ("history", "History", s.hotkeys.history), ("settings", "Settings", s.hotkeys.settings)].enumerated()), id: \.offset) { i, h in
        SRow(label: h.1, desc: held(h.0) ?? model.hotkeyErrors[h.0], first: i == 0, th: th) {
          SHotkey(value: h.2, th: th) { acc in model.setHotkey(h.0, acc) }
          if h.0 != "capture" && !h.2.isEmpty { SButton(label: "Off", subtle: true, th: th) { _ = model.setHotkey(h.0, "") } }
        }
      }
    }
    SGroup(title: "Tools in capture mode", note: "One key each. Press it again to go back to moving the selection.", th: th) {
      ForEach(Array(tools.enumerated()), id: \.offset) { i, t in
        let k = keyOf(t.id)
        SRow(label: t.label, desc: taken(t.id, k) ? "\(k) is also used by another tool." : nil, first: i == 0, th: th) {
          TextField("", text: Binding(get: { k }, set: { v in
            let c = String(v.suffix(1)).uppercased()
            guard c.isEmpty || c.range(of: "^[A-Z0-9]$", options: .regularExpression) != nil else { return }
            var keys = s.toolKeys
            keys[t.id] = c.lowercased()
            model.set(["toolKeys"], .object(keys.sorted { $0.key < $1.key }.map { ($0.key, .string($0.value)) }))
          }))
          .textFieldStyle(.plain).multilineTextAlignment(.center).font(.system(size: 12.5, weight: .semibold)).foregroundColor(th.fg)
          .frame(width: 36, height: 28)
          .background(RoundedRectangle(cornerRadius: 7).fill(th.field))
          .overlay(RoundedRectangle(cornerRadius: 7).stroke(taken(t.id, k) ? Color(NSColor(hex: "#f5a524")) : th.cardEdge, lineWidth: taken(t.id, k) ? 1.5 : 0.5))
        }
      }
    }
    SGroup(title: "In capture mode (fixed)", th: th) {
      SRow(label: "Copy", desc: "Also Enter.", first: true, th: th) { SKbd(text: "⌘C", th: th) }
      SRow(label: "Save", th: th) { SKbd(text: "⌘S", th: th) }
      SRow(label: "Undo / redo", th: th) { SKbd(text: "⌘Z", th: th); SKbd(text: "⇧⌘Z", th: th) }
      SRow(label: "Settings", th: th) { SKbd(text: "⌘,", th: th) }
      SRow(label: "Close", desc: "Also right-click.", th: th) { SKbd(text: "Esc", th: th) }
    }
  }
}

// MARK: - Appearance

struct AppearanceSection: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  var body: some View {
    let s = model.s
    SGroup(title: "Theme", th: th) {
      SRow(label: "Appearance", desc: "Gray is a softer Dark. System follows your computer.", first: true, th: th) {
        SSegmented(value: s.appearance.mode, options: [("light", "Light"), ("gray", "Gray"), ("dark", "Dark"), ("system", "System")], th: th) { model.set(["appearance", "mode"], str($0)) }
      }
      SRow(label: "Liquid Glass", desc: "Frosted, see-through panels. Off: solid.", th: th) {
        SToggle(value: s.appearance.glass, th: th) { model.set(["appearance", "glass"], b($0)) }
      }
      SRow(label: "Highlight color", desc: "The selected tool, switches and main buttons.", th: th) {
        SSegmented(value: s.appearance.accent.isEmpty ? "theme" : "custom", options: [("theme", "Theme"), ("custom", "Custom")], th: th) {
          model.set(["appearance", "accent"], str($0 == "custom" ? (s.appearance.accent.isEmpty ? "#0a84ff" : s.appearance.accent) : ""))
        }
        if !s.appearance.accent.isEmpty { SColorField(value: s.appearance.accent, th: th) { model.set(["appearance", "accent"], str($0)) } }
      }
    }
    SGroup(title: "Capture mode", th: th) {
      SRow(label: "Dim amount", first: true, th: th) {
        SSlider(value: s.capture.dimOpacity, min: 0.1, max: 0.9, step: 0.01, th: th, format: { "\(Int(($0 * 100).rounded()))%" }) { model.set(["capture", "dimOpacity"], n($0)) }
      }
      SRow(label: "Dim color", th: th) { SColorField(value: s.capture.dimColor, th: th) { model.set(["capture", "dimColor"], str($0)) } }
      SRow(label: "Selection outline color", th: th) { SColorField(value: s.capture.accentColor, th: th) { model.set(["capture", "accentColor"], str($0)) } }
      SRow(label: "Show the size label", desc: "Width × height in pixels, above the selection.", th: th) {
        SToggle(value: s.capture.showSizeLabel, th: th) { model.set(["capture", "showSizeLabel"], b($0)) }
      }
    }
  }
}

// MARK: - Toolbar

struct ToolbarSection: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  var body: some View {
    let s = model.s
    let order = s.orderedFeatureIds()
    let byKind = { (k: Feature.Kind) in order.compactMap { Features.byId($0) }.filter { $0.kind == k && !$0.inGroup } }
    VStack(spacing: 10) {
      ForEach(["tool", "action"], id: \.self) { kind in
        HStack(spacing: 1) {
          ForEach(s.visibleFeatures(kind == "tool" ? .tool : .action), id: \.id) { f in
            Group {
              if f.id == "color" { RoundedRectangle(cornerRadius: 4).fill(Color(NSColor(hex: s.annotate.palette.first ?? "#ef4444"))).frame(width: 15, height: 15) }
              else { IconView(id: f.variants.first { $0.id == s.toolVariants[f.id] }?.id ?? f.id, size: 15, color: th.t.foreground) }
            }.frame(width: 26, height: 26)
          }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: th.t.radius).fill(Color(th.t.background)))
      }
    }
    .frame(maxWidth: .infinity).padding(18)
    .background(RoundedRectangle(cornerRadius: 12).fill(LinearGradient(colors: [Color(NSColor(hex: "#a1c4fd")), Color(NSColor(hex: "#c2e9fb")), Color(NSColor(hex: "#fbc2eb"))], startPoint: .topLeading, endPoint: .bottomTrailing)))
    .padding(.bottom, 20)
    ReorderList(title: "Tools (vertical bar)", items: byKind(.tool), kind: .tool, model: model, th: th)
    ReorderList(title: "Actions (horizontal bar)", items: byKind(.action), kind: .action, model: model, th: th)
  }
}

struct ReorderList: View {
  let title: String
  let items: [Feature]
  let kind: Feature.Kind
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme

  /** Reorder within one bar; the other bar keeps its order. */
  private func move(_ from: Int, _ to: Int) {
    guard to >= 0, to < items.count else { return }
    var list = items.map(\.id)
    let id = list.remove(at: from)
    list.insert(id, at: to)
    let order = model.s.orderedFeatureIds().compactMap(Features.byId)
    let other = order.filter { $0.kind != kind && !$0.inGroup }.map(\.id)
    let grouped = order.filter(\.inGroup).map(\.id)
    let all = (kind == .tool ? list + other : other + list) + grouped
    model.set(["toolbarOrder"], .array(all.map { .string($0) }))
  }

  var body: some View {
    SGroup(title: title, note: "Drag or use the arrows to reorder. Right-click a group while capturing to pick a style.", th: th) {
      ForEach(Array(items.enumerated()), id: \.element.id) { i, f in
        VStack(alignment: .leading, spacing: 0) {
          if i > 0 { Rectangle().fill(th.cardEdge).frame(height: 0.5) }
          HStack(alignment: f.variants.isEmpty ? .center : .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
              HStack(spacing: 8) {
                IconView(id: "grip", size: 15, color: th.t.foregroundFaint)
                Group {
                  if f.id == "color" { RoundedRectangle(cornerRadius: 4).fill(AngularGradient(colors: ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ef4444"].map { Color(NSColor(hex: $0)) }, center: .center)).frame(width: 15, height: 15) }
                  else { IconView(id: f.variants.first?.id ?? f.id, size: 16, color: th.t.foreground) }
                }.frame(width: 22)
                Text(f.groupLabel ?? f.label).font(.system(size: 13)).foregroundColor(th.fg)
                if !f.variants.isEmpty {
                  Text("Group · \(f.variants.count)").font(.system(size: 10.5)).foregroundColor(th.dim).padding(.horizontal, 6).padding(.vertical, 1)
                    .background(RoundedRectangle(cornerRadius: 5).fill(th.field))
                }
              }
              if !f.variants.isEmpty {
                FlowLayout(spacing: 4) {
                  ForEach(f.variants, id: \.id) { v in
                    HStack(spacing: 5) {
                      IconView(id: v.id, size: 13, color: th.t.foregroundDim)
                      Text(v.label).font(.system(size: 11.5)).foregroundColor(th.dim)
                    }
                    .padding(.horizontal, 8).frame(height: 22)
                    .background(Capsule().fill(th.card))
                    .overlay(Capsule().stroke(th.cardEdge, lineWidth: 0.5))
                  }
                }
                .padding(.leading, 53)
              }
            }
            Spacer()
            HStack(spacing: 8) {
              HStack(spacing: 0) {
                SButton(label: "", icon: "chevron-up", subtle: true, disabled: i == 0, th: th) { move(i, i - 1) }
                SButton(label: "", icon: "chevron-down", subtle: true, disabled: i == items.count - 1, th: th) { move(i, i + 1) }
              }
              SToggle(value: model.s.features[f.id] ?? f.defaultEnabled, th: th) { model.set(["features", f.id], b($0)) }
            }
          }
          .padding(.horizontal, 14).padding(.vertical, 8).frame(minHeight: 44)
          .background(f.variants.isEmpty ? Color.clear : th.field)
          .onDrag { NSItemProvider(object: String(i) as NSString) }
          .onDrop(of: [.text], isTargeted: nil) { providers in
            providers.first?.loadObject(ofClass: NSString.self) { s, _ in
              guard let s = s as? String, let from = Int(s) else { return }
              DispatchQueue.main.async { if from != i { move(from, i) } }
            }
            return true
          }
        }
      }
    }
  }
}

// MARK: - Tools

struct ToolsSection: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  static let fonts: [(String, String)] = [
    ("-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif", "System"),
    ("ui-rounded, \"SF Pro Rounded\", system-ui, sans-serif", "Rounded"),
    ("Georgia, \"Times New Roman\", serif", "Serif"),
    ("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", "Monospace"),
    ("\"Marker Felt\", \"Bradley Hand\", \"Comic Sans MS\", cursive", "Handwritten")
  ]
  var body: some View {
    let a = model.s.annotate
    let v = model.s.toolVariants
    let setA = { (k: String, j: JSON) in model.set(["annotate", k], j) }
    let setT = { (k: String, j: JSON) in model.set(["annotate", "text", k], j) }
    SGroup(title: "Colors", note: "Changes made while capturing last until you quit.", th: th) {
      SRow(label: "Quick colors", desc: "Shown in the style bar. The first is the default.", first: true, th: th) {
        PaletteEditor(colors: a.palette, defaults: model.defaults.annotate.palette, th: th) { setA("palette", .array($0.map { .string($0) })) }
      }
      SRow(label: "Highlighter colors", desc: "Light colors work best.", th: th) {
        PaletteEditor(colors: a.highlighterPalette, defaults: model.defaults.annotate.highlighterPalette, th: th) { c in
          model.set(.object([("annotate", .object([("highlighterPalette", .array(c.map { .string($0) })), ("highlighterColor", .string(c.first ?? "#fde047"))]))]))
        }
      }
    }
    SGroup(title: "Lines and shapes", th: th) {
      SRow(label: "Line widths", desc: "Thin, medium and thick, in px.", first: true, th: th) {
        ForEach(0..<3, id: \.self) { i in
          SNumber(value: a.strokeWidths.indices.contains(i) ? a.strokeWidths[i] : 3, min: 1, max: 40, th: th) { val in
            var w = a.strokeWidths
            if w.indices.contains(i) { w[i] = val }
            setA("strokeWidths", .array(w.map { .number($0) }))
          }
        }
      }
      SRow(label: "Starting width", th: th) {
        SSegmented(value: String(a.strokeWidth), options: [("0", "Thin"), ("1", "Medium"), ("2", "Thick")], th: th) { setA("strokeWidth", n(Double($0) ?? 0)) }
      }
      SRow(label: "Arrow tool draws", desc: "Right-click the tool to switch while capturing.", th: th) {
        SSelect(value: v["arrow"] ?? "arrow", options: Features.byId("arrow")!.variants.map { ($0.id, $0.label) }, th: th) { id in
          var nv = v
          nv["arrow"] = id
          model.set(["toolVariants"], .object(nv.sorted { $0.key < $1.key }.map { ($0.key, .string($0.value)) }))
        }
      }
      SRow(label: "Rectangle tool draws", desc: "Right-click the tool to switch while capturing.", th: th) {
        SSelect(value: v["rect"] ?? "rect", options: Features.byId("rect")!.variants.map { ($0.id, $0.label) }, th: th) { id in
          var nv = v
          nv["rect"] = id
          model.set(["toolVariants"], .object(nv.sorted { $0.key < $1.key }.map { ($0.key, .string($0.value)) }))
        }
      }
      SRow(label: "Highlighter width", th: th) {
        SSlider(value: a.highlighterWidth, min: 6, max: 40, th: th, format: { "\(Int($0)) px" }) { setA("highlighterWidth", n($0)) }
      }
    }
    SGroup(title: "Text", th: th) {
      SRow(label: "Font", first: true, th: th) {
        SSelect(value: a.text.fontFamily, options: (Self.fonts.contains { $0.0 == a.text.fontFamily } ? [] : [(a.text.fontFamily, "Custom")]) + Self.fonts, th: th) { setT("fontFamily", str($0)) }
      }
      SRow(label: "Size", th: th) { SNumber(value: a.text.fontSize, min: 8, max: 200, unit: "px", th: th) { setT("fontSize", n($0)) } }
      SRow(label: "Starting style", desc: "Light and Dark put a background behind the text.", th: th) {
        SSegmented(value: StartingTextLook.current(a.text), options: [("plain", "Plain"), ("stroke", "Stroke"), ("light", "Light"), ("dark", "Dark")], th: th) {
          model.set(["annotate", "text"], StartingTextLook.patch($0, background: a.text.background))
        }
      }
      SRow(label: "Stroke", th: th) {
        SColorField(value: a.text.strokeColor, th: th) { setT("strokeColor", str($0)) }
        SNumber(value: a.text.strokeWidth, min: 1, max: 12, unit: "px", th: th) { setT("strokeWidth", n($0)) }
      }
      SRow(label: "Background color", desc: "For the Light and Dark styles. Text stays readable on it.", th: th) {
        SColorField(value: a.text.background.isEmpty ? "#ffffff" : a.text.background, th: th) { setT("background", str($0)) }
      }
      SRow(label: "Shadow", th: th) {
        SSlider(value: a.text.shadow, min: 0, max: 0.6, step: 0.01, th: th, format: { $0 > 0 ? "\(Int(($0 * 100).rounded()))%" : "Off" }) { setT("shadow", n($0)) }
      }
    }
    SGroup(title: "Numbered steps", th: th) {
      SRow(label: "Badge color", desc: "For new steps. Change it while capturing in the style bar.", first: true, th: th) { SColorField(value: a.stepColor, th: th) { setA("stepColor", str($0)) } }
      SRow(label: "Badge size", th: th) { SSlider(value: a.stepSize, min: 18, max: 72, th: th, format: { "\(Int($0)) px" }) { setA("stepSize", n($0)) } }
      SRow(label: "Number color", desc: "Auto picks black or white for contrast.", th: th) {
        SSegmented(value: a.stepTextColor.isEmpty ? "auto" : "custom", options: [("auto", "Auto"), ("custom", "Custom")], th: th) {
          setA("stepTextColor", str($0 == "custom" ? (a.stepTextColor.isEmpty ? "#ffffff" : a.stepTextColor) : ""))
        }
        if !a.stepTextColor.isEmpty { SColorField(value: a.stepTextColor, th: th) { setA("stepTextColor", str($0)) } }
      }
      SRow(label: "Outline", desc: "0 px for none.", th: th) {
        SNumber(value: a.stepStroke.width, min: 0, max: 8, unit: "px", th: th) { model.set(["annotate", "stepStroke", "width"], n($0)) }
        if a.stepStroke.width > 0 { SColorField(value: a.stepStroke.color, th: th) { model.set(["annotate", "stepStroke", "color"], str($0)) } }
      }
      SRow(label: "Shadow", desc: "Lifts the badge off busy screenshots.", th: th) {
        SSlider(value: a.stepShadow, min: 0, max: 1, step: 0.05, th: th, format: { $0 > 0 ? "\(Int(($0 * 100).rounded()))%" : "Off" }) { setA("stepShadow", n($0)) }
      }
    }
    SGroup(title: "Blur", th: th) {
      SRow(label: "Style", first: true, th: th) { SSegmented(value: a.blurMode, options: [("blur", "Blur"), ("pixelate", "Pixelate")], th: th) { setA("blurMode", str($0)) } }
      SRow(label: "Strength", th: th) { SSlider(value: a.blurStrength, min: 0, max: 40, th: th) { setA("blurStrength", n($0)) } }
    }
  }
}

/** Edit a fixed set of colours: click a swatch to change it; reset brings back the defaults. */
struct PaletteEditor: View {
  let colors: [String]
  let defaults: [String]
  let th: SettingsTheme
  let onChange: ([String]) -> Void
  var body: some View {
    HStack(spacing: 6) {
      ForEach(Array(colors.enumerated()), id: \.offset) { i, c in
        SColorField(value: c, th: th, hexField: false) { v in onChange(colors.enumerated().map { $0.offset == i ? v : $0.element }) }
      }
      SButton(label: "Reset", icon: "rotate", subtle: true, disabled: colors == defaults, th: th) { onChange(defaults) }
    }
  }
}

// MARK: - Background

struct BackgroundSection: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  @State private var selGradient: Int?
  @State private var selSolid: Int?

  private var b: SnapkitCore.Settings.Beautify { model.s.beautify }
  private var def: BeautifyPreset { b.presets.first { $0.id == b.preset } ?? b.presets[0] }

  private func updateDefault(_ change: (inout BeautifyPreset) -> Void) {
    let presets = b.presets.map { p -> BeautifyPreset in
      guard p.id == def.id else { return p }
      var q = p
      change(&q)
      return q
    }
    model.set(.object([("beautify", .object([("presets", (try? JSON.encode(presets)) ?? .null), ("preset", .string(def.id))]))]))
  }

  var body: some View {
    let angle: Double = { if case let .gradient(_, _, a) = def.background { return a }; return 135 }()
    SGroup(title: "Default background", note: "Used when Background is on.", th: th) {
      BackgroundPreview(preset: def).frame(height: 150).clipShape(RoundedRectangle(cornerRadius: 12)).padding(14)
      SRow(label: "Padding", th: th) { SSlider(value: def.padding, min: 0, max: 200, th: th, format: { "\(Int($0)) px" }) { v in updateDefault { $0.padding = v } } }
      SRow(label: "Corners", th: th) { SSlider(value: def.radius, min: 0, max: 48, th: th, format: { "\(Int($0)) px" }) { v in updateDefault { $0.radius = v } } }
      SRow(label: "Shadow", th: th) { SSlider(value: def.shadow, min: 0, max: 1, step: 0.01, th: th, format: { "\(Int(($0 * 100).rounded()))%" }) { v in updateDefault { $0.shadow = v } } }
      if case let .gradient(from, to, a) = def.background {
        SRow(label: "Gradient angle", th: th) { SSlider(value: a, min: 0, max: 359, th: th, format: { "\(Int($0))°" }) { v in updateDefault { $0.background = .gradient(from: from, to: to, angle: v) } } }
      }
      SRow(label: "Remember last background", desc: "The last one you copied or saved with becomes the default.", th: th) {
        SToggle(value: b.rememberLast, th: th) { model.set(["beautify", "rememberLast"], .bool($0)) }
      }
    }
    LibraryEditor(title: "Gradient library", note: "Shown in the background editor. New ones go first.",
                  swatches: b.gradients.map { .gradient($0.first ?? "#fff", $0.last ?? "#000", 225) },
                  isDefault: { i in if case let .gradient(f, t, _) = def.background { return b.gradients[i].first?.lowercased() == f.lowercased() && b.gradients[i].last?.lowercased() == t.lowercased() }; return false },
                  sel: $selGradient, th: th,
                  onAdd: { model.set(["beautify", "gradients"], .array(([["#a1c4fd", "#6366f1"]] + b.gradients).map { .array($0.map { .string($0) }) })) },
                  onReset: { model.set(["beautify", "gradients"], .array(model.defaults.beautify.gradients.map { .array($0.map { .string($0) }) })) },
                  onChange: { list in model.set(["beautify", "gradients"], .array(list.map { s -> JSON in if case let .gradient(f, t, _) = s { return .array([.string(f), .string(t)]) }; return .null })) },
                  onMakeDefault: { i in let g = b.gradients[i]; updateDefault { $0.background = .gradient(from: g.first ?? "#fff", to: g.last ?? "#000", angle: angle) } },
                  editor: { i in
                    AnyView(HStack {
                      SColorField(value: b.gradients[i].first ?? "#ffffff", th: th) { c in var g = b.gradients; g[i][0] = c; model.set(["beautify", "gradients"], .array(g.map { .array($0.map { .string($0) }) })) }
                      SColorField(value: b.gradients[i].last ?? "#000000", th: th) { c in var g = b.gradients; g[i][g[i].count - 1] = c; model.set(["beautify", "gradients"], .array(g.map { .array($0.map { .string($0) }) })) }
                    })
                  })
    LibraryEditor(title: "Color library", note: "Solid colors shown in the background editor.",
                  swatches: b.solids.map { .solid($0) },
                  isDefault: { i in if case let .solid(c) = def.background { return b.solids[i].lowercased() == c.lowercased() }; return false },
                  sel: $selSolid, th: th,
                  onAdd: { model.set(["beautify", "solids"], .array((["#94a3b8"] + b.solids).map { .string($0) })) },
                  onReset: { model.set(["beautify", "solids"], .array(model.defaults.beautify.solids.map { .string($0) })) },
                  onChange: { list in model.set(["beautify", "solids"], .array(list.map { s -> JSON in if case let .solid(c) = s { return .string(c) }; return .null })) },
                  onMakeDefault: { i in let c = b.solids[i]; updateDefault { $0.background = .solid(color: c) } },
                  editor: { i in
                    AnyView(SColorField(value: b.solids[i], th: th) { c in var l = b.solids; l[i] = c; model.set(["beautify", "solids"], .array(l.map { .string($0) })) })
                  })
  }
}

/** The default background with a stand-in screenshot (.st-bg-preview). */
struct BackgroundPreview: NSViewRepresentable {
  let preset: BeautifyPreset
  func makeNSView(context: Context) -> PreviewNSView { PreviewNSView() }
  func updateNSView(_ v: PreviewNSView, context: Context) {
    v.preset = preset
    v.needsDisplay = true
  }
  final class PreviewNSView: NSView {
    var preset: BeautifyPreset?
    override var isFlipped: Bool { true }
    override func draw(_ r: NSRect) {
      guard let p = preset, let ctx = NSGraphicsContext.current?.cgContext else { return }
      BeautifyRenderer.paint(p.background, w: bounds.width, h: bounds.height, ctx: ctx)
      let pad = min(44, p.padding / 2)
      let shot = bounds.insetBy(dx: pad, dy: pad)
      let path = CGPath(roundedRect: shot, cornerWidth: p.radius / 2, cornerHeight: p.radius / 2, transform: nil)
      if p.shadow > 0 {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -6 * p.shadow), blur: 24 * p.shadow, color: NSColor.black.withAlphaComponent(p.shadow).cgColor)
        ctx.addPath(path)
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.fillPath()
        ctx.restoreGState()
      }
      ctx.saveGState()
      ctx.addPath(path)
      ctx.clip()
      var y = shot.minY
      while y < shot.maxY {
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.fill(CGRect(x: shot.minX, y: y, width: shot.width, height: 14))
        ctx.setFillColor(NSColor(hex: "#f1f1f4").cgColor)
        ctx.fill(CGRect(x: shot.minX, y: y + 14, width: shot.width, height: 8))
        y += 22
      }
      ctx.restoreGState()
    }
  }
}

/** A list of swatches to edit: click one to change it or make it the default, reorder, add, delete, reset. */
struct LibraryEditor: View {
  let title: String
  let note: String
  let swatches: [SwatchGrid.Fill]
  let isDefault: (Int) -> Bool
  @Binding var sel: Int?
  let th: SettingsTheme
  let onAdd: () -> Void
  let onReset: () -> Void
  let onChange: ([SwatchGrid.Fill]) -> Void
  let onMakeDefault: (Int) -> Void
  let editor: (Int) -> AnyView

  private func move(_ from: Int, _ to: Int) {
    guard to >= 0, to < swatches.count else { return }
    var l = swatches
    let it = l.remove(at: from)
    l.insert(it, at: to)
    onChange(l)
    sel = to
  }

  var body: some View {
    SGroup(title: title, note: note, th: th) {
      HStack {
        Text("\(swatches.count) \(swatches.count == 1 ? "item" : "items") · click one to edit it or make it the default").font(.system(size: 13)).foregroundColor(th.faint)
        Spacer()
        SButton(label: "Add", icon: "plus", th: th) { onAdd(); sel = 0 }
        SButton(label: "Reset to defaults", icon: "rotate", subtle: true, th: th) { onReset(); sel = nil }
      }
      .padding(.horizontal, 14).frame(minHeight: 40)
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 34), spacing: 6)], spacing: 6) {
        ForEach(Array(swatches.enumerated()), id: \.offset) { i, s in
          ZStack(alignment: .topTrailing) {
            SwatchRep(fill: s).aspectRatio(1, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 6)).padding(2)
              .overlay(RoundedRectangle(cornerRadius: 8).stroke(sel == i ? th.ring : Color.clear, lineWidth: 2))
            if isDefault(i) {
              IconView(id: "check", size: 10, color: .white).frame(width: 16, height: 16).background(Circle().fill(th.switchOn)).offset(x: 3, y: -3)
            }
          }
          .contentShape(Rectangle())
          .onTapGesture { sel = sel == i ? nil : i }
        }
      }
      .padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 14)
      if let i = sel, i < swatches.count {
        Rectangle().fill(th.cardEdge).frame(height: 0.5)
        HStack {
          editor(i)
          Spacer()
          SButton(label: isDefault(i) ? "Default" : "Make default", icon: "check", disabled: isDefault(i), th: th) { onMakeDefault(i) }
          SButton(label: "", icon: "chevron-left", subtle: true, disabled: i == 0, th: th) { move(i, i - 1) }
          SButton(label: "", icon: "chevron-right", subtle: true, disabled: i == swatches.count - 1, th: th) { move(i, i + 1) }
          SButton(label: "Delete", icon: "trash", danger: true, disabled: swatches.count < 2, th: th) { onChange(swatches.enumerated().filter { $0.offset != i }.map(\.element)); sel = nil }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
      }
    }
  }
}

struct SwatchRep: NSViewRepresentable {
  let fill: SwatchGrid.Fill
  func makeNSView(context: Context) -> FillView { FillView() }
  func updateNSView(_ v: FillView, context: Context) {
    v.fill = fill
    v.needsDisplay = true
  }
  final class FillView: NSView {
    var fill: SwatchGrid.Fill?
    override var isFlipped: Bool { true }
    override func draw(_ r: NSRect) {
      guard let ctx = NSGraphicsContext.current?.cgContext, let fill else { return }
      switch fill {
      case let .solid(c): BeautifyRenderer.paint(.solid(color: c), w: bounds.width, h: bounds.height, ctx: ctx)
      case let .gradient(a, b, angle): BeautifyRenderer.paint(.gradient(from: a, to: b, angle: angle), w: bounds.width, h: bounds.height, ctx: ctx)
      }
    }
  }
}

// MARK: - About

struct AboutSection: View {
  @ObservedObject var model: SettingsModel
  let th: SettingsTheme
  var body: some View {
    let s = model.s
    VStack(spacing: 4) {
      Text("Snapkit").font(.system(size: 20, weight: .semibold)).foregroundColor(th.fg)
      Text("Version \(Updater.current)").font(.system(size: 13)).foregroundColor(th.faint)
    }
    .frame(maxWidth: .infinity).padding(.top, 24).padding(.bottom, 20)
    SGroup(title: "Advanced", th: th) {
      SRow(label: "Capture engine", desc: "Auto picks the fastest one that works.", first: true, th: th) {
        // An Electron engine id (desktop-capturer, node-screenshots) left in settings.json runs as Auto here.
        SSelect(value: ["screencapturekit", "coregraphics"].contains(s.capture.engine) ? s.capture.engine : "auto", options: [("auto", "Auto"), ("screencapturekit", "ScreenCaptureKit"), ("coregraphics", "CoreGraphics")], th: th) { model.set(["capture", "engine"], str($0)) }
      }
      SRow(label: "Text recognition", desc: "Auto uses the one built into your system.", th: th) {
        SSelect(value: s.ocr.engine == "vision" ? "vision" : "auto", options: [("auto", "Auto"), ("vision", "Apple Vision")], th: th) { model.set(["ocr", "engine"], str($0)) }
      }
    }
    SGroup(title: nil, th: th) {
      let u = s.updates
      let c = model.update
      let text: String = {
        guard let c else { return u.lastCheck > 0 ? "Last checked \(DateFormatter.localizedString(from: Date(timeIntervalSince1970: u.lastCheck / 1000), dateStyle: .short, timeStyle: .short))." : "Not checked yet." }
        switch c.status {
        case .available: return "Snapkit \(c.version ?? "") is available (you have \(c.current))."
        case .latest: return "You have the latest version (\(c.current))."
        default: return c.message ?? "Could not check."
        }
      }()
      SRow(label: "Check for updates", desc: text, first: true, th: th) {
        if c?.status == .available, !model.usesSparkle {
          SButton(label: "What's new", subtle: true, th: th) { if let p = c?.page, let url = URL(string: p) { NSWorkspace.shared.open(url) } }
          SButton(label: "Download \(c?.version ?? "")", primary: true, th: th) { if let p = c?.url, let url = URL(string: p) { NSWorkspace.shared.open(url) } }
        }
        if c?.status == .available, model.usesSparkle {
          SButton(label: "Update to \(c?.version ?? "")…", primary: true, th: th) { model.installUpdate() }
        }
        SButton(label: model.checking ? "Checking…" : "Check now", disabled: model.checking, th: th) {
          model.checking = true
          model.checkUpdates { r in model.update = r; model.checking = false }
        }
      }
      SRow(label: "Check automatically", desc: model.usesSparkle ? "Once a day. A new version installs only after you agree." : "Once a day; a notification when there's a new version. Nothing installs by itself.", th: th) {
        SToggle(value: u.autoCheck, th: th) { model.set(["updates", "autoCheck"], .bool($0)) }
      }
      SRow(label: "Logs", desc: "Timing and errors, for troubleshooting.", th: th) {
        SButton(label: "Open log folder", th: th) { NSWorkspace.shared.open(Paths.logDir) }
      }
      SRow(label: "Settings file", desc: "Only the values you changed are stored.", th: th) {
        SButton(label: "Show in Finder", th: th) {
          model.store.flush()
          if !FileManager.default.fileExists(atPath: Paths.settingsFile.path) { try? Data("{}".utf8).write(to: Paths.settingsFile) }
          NSWorkspace.shared.activateFileViewerSelecting([Paths.settingsFile])
        }
      }
      SRow(label: "Reset all settings", desc: "Every section, including shortcuts.", th: th) {
        SButton(label: "Reset all…", danger: true, th: th) {
          let a = NSAlert()
          a.messageText = "Reset all Snapkit settings to their defaults?"
          a.addButton(withTitle: "Reset All")
          a.addButton(withTitle: "Cancel")
          if a.runModal() == .alertFirstButtonReturn { model.reset(nil) }
        }
      }
    }
  }
}

/** Children left to right, wrapping onto new rows (flex-wrap). */
struct FlowLayout: Layout {
  var spacing: CGFloat = 4
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 400
    var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > 0 && x + s.width > width {
        x = 0
        y += row + spacing
        row = 0
      }
      x += s.width + spacing
      maxX = max(maxX, x - spacing)
      row = max(row, s.height)
    }
    return CGSize(width: min(width, maxX), height: y + row)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > bounds.minX && x + s.width > bounds.maxX {
        x = bounds.minX
        y += row + spacing
        row = 0
      }
      v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
      x += s.width + spacing
      row = max(row, s.height)
    }
  }
}
