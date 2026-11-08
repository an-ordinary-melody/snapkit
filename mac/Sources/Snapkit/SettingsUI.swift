import AppKit
import ServiceManagement
import SnapkitCore
import SwiftUI

extension NSFont {
  /** The default line height AppKit and SwiftUI give this font. */
  var lineHeight: CGFloat { ceil(ascender - descender + leading) }
}

/** What the settings window shows and changes (SettingsSnapshot in ipc.ts), kept current. */
final class SettingsModel: ObservableObject {
  let store: SettingsStore
  @Published var s: SnapkitCore.Settings
  @Published var historyUsage: (count: Int, bytes: Int, folder: String) = (0, 0, "")
  @Published var login: (enabled: Bool, needsApproval: Bool)? = nil
  @Published var update: UpdateCheck?
  @Published var checking = false
  /** Updates install inside Snapkit (Sparkle) rather than by download. */
  var usesSparkle = false
  @Published var hotkeyErrors: [String: String] = [:]
  @Published var section = "general"
  var history: HistoryStore?
  var setHotkey: (String, String) -> String? = { _, _ in nil }
  var hotkeyTaken: (String) -> Bool = { _ in false }
  var checkUpdates: (@escaping (UpdateCheck) -> Void) -> Void = { _ in }
  /** Sparkle builds: its window for the update found (download, install, relaunch). */
  var installUpdate: () -> Void = {}
  var openHistoryFolder: () -> Void = {}

  init(store: SettingsStore) {
    self.store = store
    s = store.current
    store.onChange { [weak self] next, _ in
      DispatchQueue.main.async { self?.s = next }
    }
  }

  var defaults: SnapkitCore.Settings { SettingsRules.defaults }

  /** Save a change (any depth): a JSON patch. */
  func set(_ patch: JSON) { s = store.update(patch) }

  func set(_ path: [String], _ value: JSON) {
    var v = value
    for k in path.reversed() { v = .object([(k, v)]) }
    set(v)
  }

  func reset(_ sections: [String]?) { s = store.reset(sections) }

  func refreshHistory() {
    guard let h = history else { return }
    let u = h.usage
    historyUsage = (u.count, u.bytes, h.dir.path)
  }

  /** Read from the OS each time: it can also be changed in System Settings. */
  func refreshLogin() {
    let st = SMAppService.mainApp.status
    login = (st == .enabled || st == .requiresApproval, st == .requiresApproval)
  }

  func setLogin(_ on: Bool) {
    do {
      if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    } catch {
      log("[login item] couldn't \(on ? "turn on" : "turn off"): \(error.localizedDescription)")
    }
    refreshLogin()
  }
}

// MARK: - Theme for SwiftUI

extension Color {
  init(_ ns: NSColor) { self.init(nsColor: ns) }
}

/** Settings-window colours (settings.css). */
struct SettingsTheme {
  var t: Theme
  var dark: Bool { t.dark }
  var gray: Bool
  var glass: Bool
  var fg: Color { Color(t.foreground) }
  var dim: Color { Color(t.foregroundDim) }
  var faint: Color { Color(t.foregroundFaint) }
  var field: Color { Color(t.field) }
  var hover: Color { Color(t.hover) }
  var activeBg: Color { Color(t.activeBackground) }
  var activeFg: Color { Color(t.activeForeground) }
  var ring: Color { Color(t.ring) }
  var switchOn: Color { Color(t.switchOn) }
  var track: Color { Color(t.track) }
  // With Liquid Glass only the sidebar is frosted (like System Settings); the content stays solid.
  var main: Color { Color(gray ? NSColor(hex: "#3a3a3e") : dark ? NSColor(hex: "#232326") : .white) }
  var card: Color { Color(gray ? NSColor(hex: "#46464b") : dark ? NSColor(hex: "#2c2c30") : NSColor(hex: "#f6f6f8")) }
  var cardEdge: Color { Color(dark ? NSColor.white.withAlphaComponent(gray ? 0.08 : 0.06) : NSColor.black.withAlphaComponent(0.08)) }
  var sidebar: Color { glass ? .clear : Color(gray ? NSColor(hex: "#323236") : dark ? NSColor(hex: "#1c1c1f") : NSColor(hex: "#ececef")) }
  static let danger = Color(NSColor(hex: "#e5484d"))

  init(_ a: SnapkitCore.Settings.Appearance) {
    t = Theme.from(a)
    gray = a.mode == "gray"
    glass = a.glass
  }
}

// MARK: - Controls (controls.tsx)

/** A titled group of rows, like a card in System Settings. */
struct SGroup<Content: View>: View {
  let title: String?
  var note: String? = nil
  let th: SettingsTheme
  @ViewBuilder var content: () -> Content
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let title { Text(title).font(.system(size: 12, weight: .semibold)).foregroundColor(th.dim).padding(.leading, 4) }
      VStack(spacing: 0) { content() }
        .background(th.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(th.cardEdge, lineWidth: 0.5))
      if let note { Text(note).font(.system(size: 11.5)).foregroundColor(th.faint).padding(.horizontal, 4).fixedSize(horizontal: false, vertical: true) }
    }
    .padding(.bottom, 20)
  }
}

/** One setting: label (and an optional description) on the left, its control on the right. */
struct SRow<Control: View>: View {
  let label: String
  var desc: String? = nil
  var first = false
  let th: SettingsTheme
  @ViewBuilder var control: () -> Control
  var body: some View {
    VStack(spacing: 0) {
      if !first { Rectangle().fill(th.cardEdge).frame(height: 0.5) }
      HStack(alignment: .center, spacing: 16) {
        VStack(alignment: .leading, spacing: 2) {
          // Line heights as in settings.css (1.3): 16.9 pt for the label, 14.95 for the description.
          Text(label).font(.system(size: 13)).foregroundColor(th.fg).frame(minHeight: 16.9)
          if let desc {
            Text(desc).font(.system(size: 11.5)).foregroundColor(th.faint).lineSpacing(14.95 - NSFont.systemFont(ofSize: 11.5).lineHeight)
              .padding(.vertical, (14.95 - NSFont.systemFont(ofSize: 11.5).lineHeight) / 2).fixedSize(horizontal: false, vertical: true)
          }
        }
        Spacer(minLength: 0)
        HStack(spacing: 8) { control() }.fixedSize()
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .frame(minHeight: 44)
    }
  }
}

/** .switch */
struct SToggle: View {
  let value: Bool
  let th: SettingsTheme
  var disabled = false
  let onChange: (Bool) -> Void
  /** Held down: the knob stretches (and turns to glass with Liquid Glass on), like .switch:active. */
  @State private var held = false
  var body: some View {
    ZStack(alignment: value ? .trailing : .leading) {
      Capsule().fill(value ? th.switchOn : th.track).frame(width: 34, height: 20)
      knob.frame(width: held ? 22 : 16, height: 16).padding(2)
    }
    .frame(width: 34, height: 20)
    .opacity(disabled ? 0.5 : 1)
    .contentShape(Rectangle())
    .gesture(DragGesture(minimumDistance: 0)
      .onChanged { _ in if !disabled && !held { held = true } }
      .onEnded { _ in
        held = false
        if !disabled { onChange(!value) }
      })
    .animation(.easeOut(duration: 0.15), value: value)
    .animation(.easeOut(duration: 0.12), value: held)
  }

  /** White; held with Liquid Glass on, a clear glass pill the track shows through (styles.css .switch:active span). */
  @ViewBuilder private var knob: some View {
    if th.glass && held {
      Capsule()
        .fill(LinearGradient(colors: [.white.opacity(0.6), .white.opacity(0.22)], startPoint: .top, endPoint: .bottom))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.85), lineWidth: 0.5))
        .overlay(Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.95), .clear, .white.opacity(0.5)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        .background(Capsule().stroke(Color.black.opacity(0.2), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.25), radius: 3, y: 2)
    } else {
      Capsule().fill(Color.white)
        .shadow(color: .black.opacity(held ? 0.25 : 0), radius: 3, y: 2)
    }
  }
}

/** .st-seg */
struct SSegmented: View {
  let value: String
  let options: [(String, String)]
  let th: SettingsTheme
  let onChange: (String) -> Void
  var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.0) { o in
        let on = o.0 == value
        Text(o.1).font(.system(size: 12.5)).foregroundColor(on ? th.activeFg : th.dim)
          .padding(.horizontal, 10).frame(height: 24)
          .background(RoundedRectangle(cornerRadius: 6).fill(on ? th.activeBg : Color.clear))
          .contentShape(Rectangle())
          .onTapGesture { onChange(o.0) }
      }
    }
    .padding(2)
    .background(RoundedRectangle(cornerRadius: 8).fill(th.field))
  }
}

/** .st-btn */
struct SButton: View {
  let label: String
  var icon: String? = nil
  var subtle = false
  var danger = false
  var primary = false
  var disabled = false
  let th: SettingsTheme
  let action: () -> Void
  @State private var hover = false
  var body: some View {
    HStack(spacing: 6) {
      if let icon { IconView(id: icon, size: label.isEmpty ? 14 : 13, color: danger ? NSColor(hex: "#e5484d") : primary ? .white : th.t.foreground) }
      if !label.isEmpty { Text(label).font(.system(size: 12.5)) }
    }
    .foregroundColor(danger ? SettingsTheme.danger : primary ? .white : th.fg)
    .padding(.horizontal, label.isEmpty ? 0 : 12)
    .frame(minWidth: label.isEmpty ? 28 : nil, minHeight: 28, maxHeight: 28)
    .background(RoundedRectangle(cornerRadius: 7).fill(primary ? th.switchOn : hover && !disabled ? th.hover : subtle ? Color.clear : th.field))
    .overlay(RoundedRectangle(cornerRadius: 7).stroke(subtle || primary ? Color.clear : th.cardEdge, lineWidth: 0.5))
    .opacity(disabled ? 0.45 : 1)
    .contentShape(Rectangle())
    .onHover { hover = $0 }
    .onTapGesture { if !disabled { action() } }
  }
}

/** A Lucide icon from Icons.swift. */
struct IconView: NSViewRepresentable {
  let id: String
  var size: CGFloat = 16
  var color: NSColor
  func makeNSView(context: Context) -> IconNSView { IconNSView() }
  func updateNSView(_ v: IconNSView, context: Context) {
    v.id = id
    v.size = size
    v.color = color
    v.needsDisplay = true
  }
  func sizeThatFits(_ proposal: ProposedViewSize, nsView: IconNSView, context: Context) -> CGSize? { CGSize(width: size + 2, height: size + 2) }
}

final class IconNSView: NSView {
  var id = ""
  var size: CGFloat = 16
  var color: NSColor = .white
  override var isFlipped: Bool { true }
  override func draw(_ r: NSRect) {
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    Icons.draw(id, in: bounds, size: size, color: color, ctx: ctx)
  }
}

/** Slider with its value next to it (.st-slider): the capture-mode slider look. */
struct SSlider: View {
  let value: Double
  let min: Double
  let max: Double
  var step: Double = 1
  var width: CGFloat = 170
  let th: SettingsTheme
  var format: (Double) -> String = { "\(Int($0))" }
  let onChange: (Double) -> Void
  var body: some View {
    HStack(spacing: 10) {
      SliderRep(value: value, min: min, max: max, step: step, theme: th.t, onChange: onChange).frame(width: width, height: 18)
      Text(format(value)).font(.system(size: 12).monospacedDigit()).foregroundColor(th.dim).frame(minWidth: 44, alignment: .trailing)
    }
  }
}

struct SliderRep: NSViewRepresentable {
  let value: Double
  let min: Double
  let max: Double
  let step: Double
  let theme: Theme
  let onChange: (Double) -> Void
  func makeNSView(context: Context) -> SliderView {
    let v = SliderView(min: min, max: max, step: step, value: value, theme: theme)
    v.fullTrack = true
    return v
  }
  func updateNSView(_ v: SliderView, context: Context) {
    v.min = min
    v.max = max
    v.step = step
    v.theme = theme
    v.value = value
    v.onChange = onChange
  }
}

/** Swatch that opens the colour picker, plus the hex value. */
struct SColorField: View {
  let value: String
  let th: SettingsTheme
  var hexField = true
  let onChange: (String) -> Void
  @State private var open = false
  @State private var text = ""
  var body: some View {
    HStack(spacing: 6) {
      RoundedRectangle(cornerRadius: 5).fill(Color(NSColor(hex: value))).padding(3)
        .frame(width: 28, height: 28)
        .background(RoundedRectangle(cornerRadius: 7).fill(th.field))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(th.cardEdge, lineWidth: 0.5))
        .contentShape(Rectangle())
        .onTapGesture { open.toggle() }
        .popover(isPresented: $open, arrowEdge: .bottom) {
          PickerRep(color: value, theme: th.t, onChange: onChange, onClose: { open = false }).frame(width: 200, height: 224)
        }
      if hexField {
        TextField("", text: Binding(get: { text.isEmpty ? value.uppercased() : text }, set: { t in
          text = t
          if let c = HexColor.parse(t) { onChange(c) }
        }), onCommit: { text = "" })
          .textFieldStyle(.plain).font(.system(size: 12, design: .monospaced)).foregroundColor(th.fg)
          .padding(.horizontal, 8).frame(width: 82, height: 28)
          .background(RoundedRectangle(cornerRadius: 7).fill(th.field))
      }
    }
  }
}

struct PickerRep: NSViewRepresentable {
  let color: String
  let theme: Theme
  let onChange: (String) -> Void
  let onClose: () -> Void
  func makeNSView(context: Context) -> ColorPickerView {
    let p = ColorPickerView(color: color, theme: theme)
    p.onChange = onChange
    p.onClose = onClose
    return p
  }
  func updateNSView(_ v: ColorPickerView, context: Context) {
    v.onChange = onChange
    v.onClose = onClose
  }
}

/** .st-input number field (applies valid values as you type). */
struct SNumber: View {
  let value: Double
  let min: Double
  let max: Double
  var unit: String? = nil
  var width: CGFloat = 64
  let th: SettingsTheme
  let onChange: (Double) -> Void
  @State private var text: String? = nil
  var body: some View {
    HStack(spacing: 4) {
      TextField("", text: Binding(get: { text ?? Self.fmt(value) }, set: { t in
        text = t
        if let v = Double(t), v >= min, v <= max { onChange(v) }
      }), onCommit: { text = nil })
        .textFieldStyle(.plain).font(.system(size: 12.5).monospacedDigit()).foregroundColor(th.fg)
        .padding(.horizontal, 8).frame(width: width, height: 28)
        .background(RoundedRectangle(cornerRadius: 7).fill(th.field))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(th.cardEdge, lineWidth: 0.5))
      if let unit { Text(unit).font(.system(size: 12)).foregroundColor(th.faint) }
    }
  }
  static func fmt(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }
}

/** .st-select */
struct SSelect: View {
  let value: String
  let options: [(String, String)]
  let th: SettingsTheme
  let onChange: (String) -> Void
  var body: some View {
    Menu {
      ForEach(options, id: \.0) { o in
        Button(o.1) { onChange(o.0) }
      }
    } label: {
      Text(options.first { $0.0 == value }?.1 ?? value).font(.system(size: 12.5)).foregroundColor(th.fg)
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .padding(.horizontal, 8).frame(height: 28)
    .background(RoundedRectangle(cornerRadius: 7).fill(th.field))
    .overlay(RoundedRectangle(cornerRadius: 7).stroke(th.cardEdge, lineWidth: 0.5))
  }
}

/** Click, then press the new shortcut. Esc cancels. Needs a modifier (except F-keys). */
struct SHotkey: View {
  let value: String
  let th: SettingsTheme
  let onChange: (String) -> String?
  @State private var recording = false
  @State private var error: String?
  @State private var monitor: Any?
  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      Text(recording ? "Press the new shortcut…" : value.isEmpty ? "None" : Accelerator.display(value))
        .font(.system(size: 13)).tracking(recording ? 0 : 0.5).foregroundColor(recording ? th.dim : th.fg)
        .padding(.horizontal, 12).frame(minWidth: 96, minHeight: 28)
        .background(RoundedRectangle(cornerRadius: 7).fill(th.field))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(recording ? th.ring : th.cardEdge, lineWidth: recording ? 1.5 : 0.5))
        .contentShape(Rectangle())
        .onTapGesture { recording ? stop() : start() }
      if let error { Text(error).font(.system(size: 11.5)).foregroundColor(SettingsTheme.danger).frame(maxWidth: 260, alignment: .trailing) }
    }
  }

  private func start() {
    error = nil
    recording = true
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
      if e.keyCode == 53 { stop(); return nil }
      guard let key = SHotkey.keyName(e) else { return nil }
      var mods: Accelerator.Modifiers = []
      if e.modifierFlags.contains(.command) { mods.insert(.command) }
      if e.modifierFlags.contains(.control) { mods.insert(.control) }
      if e.modifierFlags.contains(.option) { mods.insert(.option) }
      if e.modifierFlags.contains(.shift) { mods.insert(.shift) }
      if mods.isEmpty && !key.hasPrefix("F") {
        error = "Add ⌘, ⌥, ⌃ or ⇧ (or use an F-key)."
        return nil
      }
      stop()
      error = onChange(Accelerator.string(key: key, modifiers: mods))
      return nil
    }
  }

  private func stop() {
    recording = false
    if let m = monitor { NSEvent.removeMonitor(m) }
    monitor = nil
  }

  /** Key name as Electron's recorder writes it, layout-independent (by key code). */
  static func keyName(_ e: NSEvent) -> String? {
    let byCode = Dictionary(uniqueKeysWithValues: Accelerator.keyCodes.map { ($0.value, $0.key) })
    guard var k = byCode[UInt32(e.keyCode)] else { return nil }
    if k == "Plus" { k = "=" }
    if ["Enter", "Tab", "Backspace", "Escape", "Delete", "Home", "End", "PageUp", "PageDown"].contains(k) { return nil }
    return k
  }
}

/** .st-kbd */
struct SKbd: View {
  let text: String
  let th: SettingsTheme
  var body: some View {
    Text(text).font(.system(size: 12)).foregroundColor(th.fg).padding(.horizontal, 8).padding(.vertical, 2).frame(minWidth: 28)
      .background(RoundedRectangle(cornerRadius: 6).fill(th.field))
      .overlay(RoundedRectangle(cornerRadius: 6).stroke(th.cardEdge, lineWidth: 0.5))
  }
}
