import Carbon
import SnapkitCore

/**
 * Global hotkeys with Carbon's RegisterEventHotKey (no Accessibility permission needed). The
 * callback runs on the main run loop, so a capture starts without waiting for anything.
 * As in src/main/hotkeys.ts: a hotkey that is also a capture-mode key (⌘⇧Z = Redo) steps aside while
 * capturing, and hotkeys that fail to register are retried every few seconds.
 */
final class Hotkeys {
  static let shared = Hotkeys()

  private struct Entry {
    var accelerator: Accelerator
    var ref: EventHotKeyRef?
    var action: () -> Void
  }

  private var entries: [String: Entry] = [:]
  private var idsByName: [String: UInt32] = [:]
  private var namesById: [UInt32: String] = [:]
  private var nextId: UInt32 = 1
  private var handlerInstalled = false
  private var steppedAside: Set<String> = []
  private var retryTimer: Timer?

  /** Keys capture mode handles itself (undo, redo, copy, save, settings). */
  private static let captureKeys: [(String, Accelerator.Modifiers)] = [
    ("Z", [.command]), ("Z", [.command, .shift]), ("Y", [.command]), ("C", [.command]), ("S", [.command]), (",", [.command])
  ]

  /** Set (or clear, with "") the hotkey called `name`. Returns false if it couldn't be registered now. */
  @discardableResult
  func set(_ name: String, _ text: String, action: @escaping () -> Void) -> Bool {
    installHandler()
    unregister(name)
    entries[name] = nil
    guard let acc = Accelerator(text) else {
      if !text.isEmpty { log("[hotkeys] can't use \(name) = \(text)") }
      return text.isEmpty
    }
    entries[name] = Entry(accelerator: acc, ref: nil, action: action)
    return register(name)
  }

  /** Registered right now. */
  func isRegistered(_ name: String) -> Bool { entries[name]?.ref != nil }

  /** Capture mode opened or closed: hotkeys that are also capture-mode keys step aside, then come back. */
  func captureMode(_ on: Bool) {
    if on {
      for (name, e) in entries where Hotkeys.captureKeys.contains(where: { $0.0 == e.accelerator.key && $0.1 == e.accelerator.modifiers }) {
        unregister(name)
        steppedAside.insert(name)
      }
    } else {
      for name in steppedAside { register(name) }
      steppedAside = []
    }
  }

  @discardableResult
  private func register(_ name: String) -> Bool {
    guard var e = entries[name], e.ref == nil else { return entries[name] != nil }
    let id = idsByName[name] ?? {
      let id = nextId
      nextId += 1
      idsByName[name] = id
      namesById[id] = name
      return id
    }()
    var mods: UInt32 = 0
    if e.accelerator.modifiers.contains(.command) { mods |= UInt32(cmdKey) }
    if e.accelerator.modifiers.contains(.shift) { mods |= UInt32(shiftKey) }
    if e.accelerator.modifiers.contains(.option) { mods |= UInt32(optionKey) }
    if e.accelerator.modifiers.contains(.control) { mods |= UInt32(controlKey) }
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(e.accelerator.keyCode, mods, EventHotKeyID(signature: OSType(0x534E_4B54), id: id), GetApplicationEventTarget(), 0, &ref)
    guard status == noErr, let ref else {
      log("[hotkeys] \(name) (\(Accelerator.display(Accelerator.string(key: e.accelerator.key, modifiers: e.accelerator.modifiers)))) is taken (\(status)); retrying")
      scheduleRetry()
      return false
    }
    e.ref = ref
    entries[name] = e
    return true
  }

  private func unregister(_ name: String) {
    guard var e = entries[name], let ref = e.ref else { return }
    UnregisterEventHotKey(ref)
    e.ref = nil
    entries[name] = e
  }

  /** Taken hotkeys: try again every 5 s until each is ours (there's no OS event for "now free"). */
  private func scheduleRetry() {
    guard retryTimer == nil else { return }
    retryTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] t in
      guard let self else { return t.invalidate() }
      let missing = self.entries.filter { $0.value.ref == nil && !self.steppedAside.contains($0.key) }.map(\.key)
      for name in missing { self.register(name) }
      if self.entries.allSatisfy({ $0.value.ref != nil || self.steppedAside.contains($0.key) }) {
        t.invalidate()
        self.retryTimer = nil
      }
    }
  }

  fileprivate func fire(_ id: UInt32) {
    guard let name = namesById[id], let e = entries[name] else { return }
    e.action()
  }

  private func installHandler() {
    guard !handlerInstalled else { return }
    handlerInstalled = true
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
      var hk = EventHotKeyID()
      GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
      Hotkeys.shared.fire(hk.id)
      return noErr
    }, 1, &spec, nil, nil)
  }
}
