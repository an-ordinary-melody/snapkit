import Foundation
import SnapkitCore

// Unit checks for SnapkitCore: ports of the Electron vitest cases (settings, naming, layout, model)
// plus native-only ones. Run: `swift run SnapkitChecks` (from mac/). Prints one line per failed check
// and a summary; exits 1 on any failure. Moves to Swift Testing once Xcode is installed.

var failures = 0
var passed = 0
var group = ""

func describe(_ name: String, _ body: () throws -> Void) {
  group = name
  do { try body() } catch {
    failures += 1
    print("✗ \(group): threw \(error)")
  }
}

func expect<T: Equatable>(_ got: T, _ want: T, _ what: String, file: String = #fileID, line: Int = #line) {
  if got == want { passed += 1 } else {
    failures += 1
    print("✗ \(group): \(what)\n    got:  \(got)\n    want: \(want)   (\(file):\(line))")
  }
}

func expectTrue(_ ok: Bool, _ what: String, file: String = #fileID, line: Int = #line) {
  expect(ok, true, what, file: file, line: line)
}

func json(_ s: String) -> JSON { try! JSON.parse(s) }

// MARK: - JSON

describe("json") {
  let text = ##"{"b":1,"a":[true,null,"x\n\"y\"",1.5,-2],"c":{"é":"é 😀"}}"##
  let v = try JSON.parse(text)
  expect(v.keys, ["b", "a", "c"], "keeps key order")
  expect(v.serialized(), ##"{"b":1,"a":[true,null,"x\n\"y\"",1.5,-2],"c":{"é":"é 😀"}}"##, "round trip")
  expect(try JSON.parse(v.serialized(indent: 2)), v, "pretty output parses back")
  expect(json(##"{"a":1,"b":2}"##), json(##"{"b":2,"a":1}"##), "objects compare regardless of key order")
  expectTrue((try? JSON.parse("{")) == nil, "rejects broken JSON")
}

// MARK: - Settings (settings.test.ts)

describe("settings") {
  let saved = json(##"{"annotate":{"text":{"fontSize":30,"strokeWidth":4}},"save":{"askLocation":false}}"##)
  expect(SettingsRules.applyPatch(saved, json(##"{"annotate":{"text":{"fontSize":24}}}"##)),
         json(##"{"annotate":{"text":{"fontSize":24,"strokeWidth":4}},"save":{"askLocation":false}}"##),
         "patches nested values without dropping their siblings")
  expect(SettingsRules.applyPatch(json(##"{"annotate":{"palette":["#000","#111"]}}"##), json(##"{"annotate":{"palette":["#fff"]}}"##)),
         json(##"{"annotate":{"palette":["#fff"]}}"##), "replaces arrays whole")

  let merged = SettingsRules.merge(SettingsRules.defaultsJSON, json(##"{"appearance":{"theme":"dark"}}"##))!
  expect(merged["appearance"]!["theme"], .string("dark"), "keeps unknown saved keys")
  expect(merged["appearance"]!["mode"], .string("dark"), "fills the rest from the defaults")
  expect(merged["annotate"]!, SettingsRules.defaultsJSON["annotate"]!, "untouched sections are the defaults")

  let wrong = SettingsRules.resolve(json(##"{"capture":{"dimOpacity":"dark"}}"##))
  expect(wrong.capture.dimOpacity, 0.75, "ignores saved values of the wrong type")

  let d = SettingsRules.defaults
  expect(d.annotate.text.fontSize, 20, "macOS text size 20")
  expect(d.compress.enabled, false, "compression off by default")
  expect(d.compress.preset, "standard", "compression preset standard")
  expect(d.capture.dimOpacity, 0.75, "75% dim")
  expect(d.appearance.mode, "dark", "Dark theme")
  expect(d.history.maxCount, 10, "history keeps 10")
  expect(d.hotkeys.capture, "Alt+Shift+Z", "capture hotkey")
  expect(d.beautify.preset, "ocean", "default background preset")
  expect(d.beautify.presets.first?.background, .gradient(from: "#f093fb", to: "#f5576c", angle: 171), "default background gradient (beta.14)")
  expect([d.beautify.presets[0].padding, d.beautify.presets[0].radius, d.beautify.presets[0].shadow], [20, 17, 0.05], "default padding, radius, shadow")
  expect(d.beautify.rememberLast, true, "remember last background on")
  expect(d.features["ruler"], false, "ruler off by default")
}

describe("toolbarOrder") {
  var s = SettingsRules.defaults
  let saved = s.toolbarOrder.filter { $0 != "ruler" }
  s.toolbarOrder = ["blur"] + saved.filter { $0 != "blur" }
  let order = s.orderedFeatureIds()
  expect(order.firstIndex(of: "ruler"), order.firstIndex(of: "blur")! + 1, "a new tool goes right after the one it follows")
  expect(Array(order.prefix(2)), ["blur", "ruler"], "saved order kept")
  expect(order.count, SettingsRules.defaults.toolbarOrder.count, "every feature listed once")
  expect(SettingsRules.defaults.orderedFeatureIds(), Features.all.map(\.id), "default order is the registry order")
  expect(SettingsRules.defaults.visibleFeatures(.tool).map(\.id), ["pen", "arrow", "rect", "highlighter", "text", "step", "blur", "color", "undo"], "default tools")
  expect(SettingsRules.defaults.visibleFeatures(.action).map(\.id), ["beautify", "beautifyEdit", "ocr", "pin", "save", "copy", "close"], "default actions")
}

describe("settings store") {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("snapkit-checks-\(UUID().uuidString)")
  defer { try? FileManager.default.removeItem(at: dir) }
  let file = dir.appendingPathComponent("settings.json")
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  try Data(##"{"futureKey":{"x":1},"save":{"askLocation":false}}"##.utf8).write(to: file)
  let store = SettingsStore(file: file)
  expect(store.current.save.askLocation, false, "reads saved overrides")
  var seen: (Double, Double)?
  store.onChange { s, prev in seen = (s.capture.dimOpacity, prev.capture.dimOpacity) }
  store.update(json(##"{"capture":{"dimOpacity":0.5}}"##))
  expect(seen.map { [$0.0, $0.1] }, [0.5, 0.75], "listeners get new and previous settings")
  store.flush()
  let written = try JSON.parse(Data(contentsOf: file))
  expect(written, json(##"{"futureKey":{"x":1},"save":{"askLocation":false},"capture":{"dimOpacity":0.5}}"##), "only overrides written; unknown keys kept")
  store.reset(["capture"])
  store.flush()
  expect(try JSON.parse(Data(contentsOf: file))["capture"], nil, "reset one section")
}

// MARK: - Naming (naming.test.ts)

describe("file naming") {
  var cal = Calendar(identifier: .gregorian)
  cal.timeZone = TimeZone(identifier: "UTC")!
  let at = cal.date(from: DateComponents(year: 2026, month: 10, day: 24, hour: 5, minute: 30, second: 12))!
  let rule = { (t: String, d: String, n: String, digits: Int) in NameRule(text: t, date: d, number: n, digits: digits) }
  expect(Naming.fileName(SettingsRules.defaults.save.name, now: at, n: 1, calendar: cal), "Snapkit 2026-10-24 at 05.30.12.png", "text plus a timestamp")
  expect(Naming.fileName(rule("Bug", "none", "after", 3), now: at, n: 7, calendar: cal), "Bug 007.png", "padded number after")
  expect(Naming.fileName(rule("Bug", "before", "before", 2), now: at, n: 12, calendar: cal), "12 2026-10-24 at 05.30.12 Bug.png", "number and date before")
  expect(Naming.fileName(rule("Bug", "after", "after", 1), now: at, n: 3, calendar: cal), "Bug 2026-10-24 at 05.30.12 3.png", "date and number after")
  expect(Naming.fileName(rule("a/b: c", "none", "none", 3), now: at, n: 1, calendar: cal), "a-b- c.png", "safe characters")
  expect(Naming.fileName(rule("  ", "none", "none", 3), now: at, n: 1, calendar: cal), "Snapkit 2026-10-24 at 05.30.12.png", "never empty")
  let used: Set = ["x.png", "x 2.png"]
  expect(Naming.uniqueName("x.png") { used.contains($0) }, "x 3.png", "counter when taken")
  expect(Naming.uniqueName("y.png") { used.contains($0) }, "y.png", "free name kept")
}

// MARK: - Accelerators

describe("accelerators") {
  let a = Accelerator("Alt+Shift+Z")
  expect(a?.keyCode, 0x06, "Z key code")
  expect(a?.modifiers, [.option, .shift], "Alt+Shift")
  expect(Accelerator("CommandOrControl+Shift+1")?.modifiers, [.command, .shift], "CommandOrControl is ⌘")
  expect(Accelerator("CommandOrControl+Alt+Shift+F11")?.keyCode, 0x67, "F11")
  expect(Accelerator(""), nil, "empty = no hotkey")
  expect(Accelerator("Hyper+Z"), nil, "unknown modifier rejected")
  expect(Accelerator.display("Alt+Shift+Z"), "⌥⇧Z", "display ⌥⇧Z")
  expect(Accelerator.display("CommandOrControl+Shift+9"), "⌘⇧9", "display ⌘⇧9")
  expect(Accelerator.display("CommandOrControl+Alt+Shift+F11"), "⌘⌥⇧F11", "display ⌘⌥⇧F11")
  expect(Accelerator.string(key: "F11", modifiers: [.shift, .command, .option]), "CommandOrControl+Alt+Shift+F11", "recorder order")
  for (name, acc) in [("capture", "Alt+Shift+Z"), ("history", "CommandOrControl+Shift+1"), ("fullscreen", "CommandOrControl+Shift+9"),
                      ("settings", "CommandOrControl+Shift+2"), ("lastArea", "Alt+Shift+X"), ("ocr", "Alt+Shift+T")] {
    expectTrue(Accelerator(acc) != nil, "default \(name) hotkey parses")
  }
}

// MARK: - Layout (layout.test.ts)

describe("placeToolbars") {
  let screen = LSize(w: 1440, h: 900)
  let actions = LSize(w: 200, h: 40)
  let tools = LSize(w: 40, h: 300)
  func overlap(_ a: LRect, _ b: LRect) -> Bool { a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h }
  func onScreen(_ r: LRect) -> Bool { r.x >= 0 && r.y >= 0 && r.x + r.w <= screen.w && r.y + r.h <= screen.h }
  var bad = 0
  func check(_ sel: LRect) -> ToolbarLayout {
    let l = OverlayLayout.placeToolbars(sel: sel, screen: screen, actions: actions, tools: tools)
    let a = LRect(x: l.actions.x, y: l.actions.y, w: actions.w, h: actions.h)
    let t = LRect(x: l.tools.x, y: l.tools.y, w: tools.w, h: tools.h)
    if !onScreen(a) || !onScreen(t) || overlap(a, t) { bad += 1 }
    return l
  }
  let l = check(LRect(x: 400, y: 200, w: 500, h: 400))
  expect([l.actionsSide, l.toolsSide], [.below, .right], "below + right for a centered selection")
  expect([l.actions.y, l.tools.x], [608, 908], "positions")
  expect(check(LRect(x: 400, y: 400, w: 500, h: 495)).actionsSide, .above, "above when touching the bottom")
  expect(check(LRect(x: 800, y: 200, w: 630, h: 400)).toolsSide, .left, "left when touching the right edge")
  let full = check(LRect(x: 0, y: 0, w: 1440, h: 900))
  expect([full.actionsSide, full.toolsSide], [.inside, .inside], "inside a full-screen selection")
  _ = check(LRect(x: 0, y: 0, w: 10, h: 10))
  _ = check(LRect(x: 1430, y: 890, w: 10, h: 10))
  _ = check(LRect(x: 1430, y: 0, w: 10, h: 10))
  for x in stride(from: 0.0, to: 1440, by: 97) {
    for y in stride(from: 0.0, to: 900, by: 83) {
      for (w, h) in [(20.0, 20.0), (300, 200), (900, 700), (1440 - x, 900 - y)] {
        _ = check(LRect(x: x, y: y, w: min(w, 1440 - x), h: min(h, 900 - y)))
      }
    }
  }
  expect(bad, 0, "never overlaps or leaves the screen")

  expect(OverlayLayout.resizeRect(LRect(x: 100, y: 100, w: 100, h: 100), handle: .se, dx: 50, dy: 20, screen: screen), LRect(x: 100, y: 100, w: 150, h: 120), "resize from a corner")
  expect(OverlayLayout.resizeRect(LRect(x: 100, y: 100, w: 100, h: 100), handle: .e, dx: -150, dy: 0, screen: screen), LRect(x: 50, y: 100, w: 50, h: 100), "flip past the opposite edge")
  expect(OverlayLayout.moveRect(LRect(x: 100, y: 100, w: 100, h: 100), dx: 5000, dy: -5000, screen: screen), LRect(x: 1340, y: 0, w: 100, h: 100), "moved rects stay on screen")

  let bar = LSize(w: 260, h: 36)
  func place(_ sel: LRect) -> (LRect, LRect) {
    let l = OverlayLayout.placeToolbars(sel: sel, screen: screen, actions: actions, tools: tools)
    let a = LRect(x: l.actions.x, y: l.actions.y, w: actions.w, h: actions.h)
    let t = LRect(x: l.tools.x, y: l.tools.y, w: tools.w, h: tools.h)
    let p = OverlayLayout.placeStyleBar(actions: a, tools: t, bar: bar, screen: screen)
    let s = LRect(x: p.x, y: p.y, w: bar.w, h: bar.h)
    expectTrue(onScreen(s) && !overlap(s, a) && !overlap(s, t), "style bar on screen, no overlap")
    return (a, s)
  }
  let (a1, s1) = place(LRect(x: 400, y: 200, w: 500, h: 300))
  expectTrue(s1.y + s1.h / 2 == a1.y + a1.h / 2 && s1.x + s1.w < a1.x, "style bar left of the action bar, same row")
  let (a2, s2) = place(LRect(x: 0, y: 200, w: 150, h: 200))
  expectTrue(s2.y != a2.y, "own row when narrow near the left edge")
  _ = place(LRect(x: 0, y: 0, w: screen.w, h: screen.h))
}

// MARK: - Annotation model (model.test.ts)

describe("annotation model") {
  let (dx, dy) = Annotations.snap45(10, 3)
  expect([dx, dy], [10, 0], "snap45 to horizontal")
  let (ex, ey) = Annotations.snap45(10, 9)
  expect([ex, ey], [10, 10], "snap45 to diagonal")
  let b = Annotations.boxFromDrag(100, 100, 60, 130, square: true)
  expect([b.x, b.y, b.w, b.h], [60, 100, 40, 40], "square box from a drag up-left")
  expect(Annotations.rulerLabel([0, 0, 120, 0], scale: 2), "240 px", "ruler length in image pixels")
  expect(Annotations.arrowHead(width: 4), 18, "arrow head size")
  let click = Shape.stroke(.init(id: "a", type: "pen", points: [1, 1], color: "#000", width: 3))
  expect(Annotations.isMeaningful(click), false, "a click isn't a stroke")

  var h = ShapeHistory()
  let s1 = Shape.box(.init(id: "r", type: "rect", x: 0, y: 0, w: 10, h: 10, color: "#f00", width: 3))
  h.commit([s1])
  h.commit([s1, click])
  h.undo()
  expect(h.present, [s1], "undo")
  h.redo()
  expect(h.present.count, 2, "redo")
  h.commit([s1], mergeKey: "slider")
  h.commit([], mergeKey: "slider")
  h.undo()
  expect(h.present.count, 2, "a slider drag is one undo step")

  let doc = ##"[{"id":"s1","type":"arrow","points":[1,2,3,4],"color":"#ef4444","width":3,"head":"open","bothEnds":true},{"id":"s2","type":"text","x":5,"y":6,"text":"Hi","color":"#fff","fontSize":20,"fontFamily":"x","shadow":0.1,"background":"","stroke":"#ffffff","strokeWidth":2}]"##
  let shapes = try JSONDecoder().decode([Shape].self, from: Data(doc.utf8))
  expect(shapes.map(\.type), ["arrow", "text"], "decodes doc.json shapes")
  let again = try JSONDecoder().decode([Shape].self, from: JSONEncoder().encode(shapes))
  expect(again, shapes, "shapes round trip")
}

describe("colors") {
  expect(HexColor.readableOn("#18181b"), "#ffffff", "white on dark")
  expect(HexColor.readableOn("#facc15"), "#111111", "black on yellow")
  expect(HexColor.parse("ABC"), "#aabbcc", "short hex")
  expect(jsRound(-2.5), -2, "Math.round semantics")
}

describe("last area") {
  let a = LastArea(displayId: 1, displayBounds: .init(x: 0, y: 0, width: 1470, height: 956), rect: .init(x: 2000, y: 10, width: 300, height: 200))
  let r = a.resolve(displays: [(id: 7, bounds: .init(x: 0, y: 0, width: 1470, height: 956))])
  expect(r?.id, 7, "found again by bounds when the id changed")
  expect(r?.rect.x, 1469, "corner kept on the display")
  let electron = ##"{"displayId":1,"displayBounds":{"x":0,"y":0,"width":1470,"height":956},"rect":{"x":194.98046875,"y":250.13671875,"width":688.75,"height":519.71875}}"##
  let parsed = try JSONDecoder().decode(LastArea.self, from: Data(electron.utf8))
  expect(parsed.rect.width, 688.75, "reads Electron's last-area.json")
}

print(failures == 0 ? "✓ \(passed) checks passed" : "\n\(failures) failed, \(passed) passed")
exit(failures == 0 ? 0 : 1)
