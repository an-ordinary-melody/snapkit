// Electron accelerators ("Alt+Shift+Z", "CommandOrControl+Shift+1") as stored in settings.json,
// parsed into a Carbon key code and modifiers for RegisterEventHotKey, and formatted the way the
// Electron Settings window shows them ("⌥⇧Z": the parts in the stored order).

public struct Accelerator: Equatable {
  public struct Modifiers: OptionSet, Equatable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let command = Modifiers(rawValue: 1)
    public static let control = Modifiers(rawValue: 2)
    public static let option = Modifiers(rawValue: 4)
    public static let shift = Modifiers(rawValue: 8)
  }

  /** Key name as Electron writes it: "Z", "1", "F11", "Space", ",", "Up"… */
  public let key: String
  public let modifiers: Modifiers
  /** Carbon virtual key code (kVK_*). */
  public let keyCode: UInt32

  /** Nil for an empty string (no hotkey) or anything this app can't register. */
  public init?(_ text: String) {
    // "+" is a separator, but also a key ("CommandOrControl+Plus" is how Electron writes it; "+" alone
    // after a separator means the plus key).
    var parts = text.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
    if text.hasSuffix("++") {
      parts = Array(parts.dropLast(2)) + ["Plus"]
    }
    guard let last = parts.last, !last.isEmpty else { return nil }
    var mods: Modifiers = []
    for p in parts.dropLast() {
      switch p.lowercased() {
      case "commandorcontrol", "cmdorctrl", "command", "cmd", "super", "meta": mods.insert(.command)
      case "control", "ctrl": mods.insert(.control)
      case "alt", "option", "altgr": mods.insert(.option)
      case "shift": mods.insert(.shift)
      default: return nil
      }
    }
    let name = Accelerator.canonical(last)
    guard let code = Accelerator.keyCodes[name] else { return nil }
    key = name
    modifiers = mods
    keyCode = code
  }

  /** "⌥⇧Z": each part's symbol, in the order stored (as formatAccelerator in controls.tsx). */
  public static func display(_ text: String) -> String {
    let sym = ["CommandOrControl": "⌘", "Command": "⌘", "Control": "⌃", "Ctrl": "⌃", "Alt": "⌥", "Option": "⌥", "Shift": "⇧"]
    return text.split(separator: "+").map { sym[String($0)] ?? String($0) }.joined()
  }

  /** The accelerator Electron's recorder would store for this key and modifiers: Cmd, Control, Alt, Shift, key. */
  public static func string(key: String, modifiers: Modifiers) -> String {
    var parts: [String] = []
    if modifiers.contains(.command) { parts.append("CommandOrControl") }
    if modifiers.contains(.control) { parts.append("Control") }
    if modifiers.contains(.option) { parts.append("Alt") }
    if modifiers.contains(.shift) { parts.append("Shift") }
    return (parts + [key]).joined(separator: "+")
  }

  static func canonical(_ k: String) -> String {
    if k.count == 1 { return k.uppercased() }
    let lower = k.lowercased()
    let aliases = ["return": "Enter", "enter": "Enter", "esc": "Escape", "escape": "Escape", "space": "Space", "tab": "Tab",
                   "backspace": "Backspace", "delete": "Delete", "up": "Up", "down": "Down", "left": "Left", "right": "Right",
                   "home": "Home", "end": "End", "pageup": "PageUp", "pagedown": "PageDown", "plus": "Plus"]
    if let a = aliases[lower] { return a }
    if lower.hasPrefix("f"), Int(lower.dropFirst()) != nil { return k.uppercased() }
    return k
  }

  /** Carbon kVK_* codes (ANSI layout positions, as Electron's macOS accelerators use). */
  public static let keyCodes: [String: UInt32] = [
    "A": 0x00, "S": 0x01, "D": 0x02, "F": 0x03, "H": 0x04, "G": 0x05, "Z": 0x06, "X": 0x07, "C": 0x08, "V": 0x09,
    "B": 0x0B, "Q": 0x0C, "W": 0x0D, "E": 0x0E, "R": 0x0F, "Y": 0x10, "T": 0x11, "1": 0x12, "2": 0x13, "3": 0x14,
    "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18, "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E,
    "O": 0x1F, "U": 0x20, "[": 0x21, "I": 0x22, "P": 0x23, "L": 0x25, "J": 0x26, "'": 0x27, "K": 0x28, ";": 0x29,
    "\\": 0x2A, ",": 0x2B, "/": 0x2C, "N": 0x2D, "M": 0x2E, ".": 0x2F, "`": 0x32, "Plus": 0x18,
    "Enter": 0x24, "Tab": 0x30, "Space": 0x31, "Backspace": 0x33, "Escape": 0x35, "Delete": 0x75,
    "Home": 0x73, "End": 0x77, "PageUp": 0x74, "PageDown": 0x79, "Left": 0x7B, "Right": 0x7C, "Down": 0x7D, "Up": 0x7E,
    "F1": 0x7A, "F2": 0x78, "F3": 0x63, "F4": 0x76, "F5": 0x60, "F6": 0x61, "F7": 0x62, "F8": 0x64, "F9": 0x65,
    "F10": 0x6D, "F11": 0x67, "F12": 0x6F, "F13": 0x69, "F14": 0x6B, "F15": 0x71, "F16": 0x6A, "F17": 0x40,
    "F18": 0x4F, "F19": 0x50, "F20": 0x5A
  ]
}
