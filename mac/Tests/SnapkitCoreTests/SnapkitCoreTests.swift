import Foundation
import ImageIO
import SnapkitCore
import Testing

// Unit tests for SnapkitCore: ports of the Electron vitest cases (settings, naming, layout, model,
// version) plus native-only ones, checked against the shared fixtures. Run: `swift test` (from mac/).

func expect<T: Equatable>(_ got: T, _ want: T, _ what: String, sourceLocation: SourceLocation = #_sourceLocation) {
  #expect(got == want, Comment(rawValue: what), sourceLocation: sourceLocation)
}

func expectTrue(_ ok: Bool, _ what: String, sourceLocation: SourceLocation = #_sourceLocation) {
  #expect(ok, Comment(rawValue: what), sourceLocation: sourceLocation)
}

func json(_ s: String) -> JSON { try! JSON.parse(s) }

// MARK: - JSON

@Test("json") func json() throws {
  let text = ##"{"b":1,"a":[true,null,"x\n\"y\"",1.5,-2],"c":{"é":"é 😀"}}"##
  let v = try JSON.parse(text)
  expect(v.keys, ["b", "a", "c"], "keeps key order")
  expect(v.serialized(), ##"{"b":1,"a":[true,null,"x\n\"y\"",1.5,-2],"c":{"é":"é 😀"}}"##, "round trip")
  expect(try JSON.parse(v.serialized(indent: 2)), v, "pretty output parses back")
  expect(json(##"{"a":1,"b":2}"##), json(##"{"b":2,"a":1}"##), "objects compare regardless of key order")
  expectTrue((try? JSON.parse("{")) == nil, "rejects broken JSON")
}

// MARK: - Settings (settings.test.ts)

@Test("settings") func settings() throws {
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

@Test("toolbarOrder") func toolbarorder() throws {
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

@Test("settings store") func settingsStore() throws {
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

@Test("file naming") func fileNaming() throws {
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

@Test("accelerators") func accelerators() throws {
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

@Test("placeToolbars") func placetoolbars() throws {
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

@Test("annotation model") func annotationModel() throws {
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

@Test("colors") func colors() throws {
  expect(HexColor.readableOn("#18181b"), "#ffffff", "white on dark")
  expect(HexColor.readableOn("#facc15"), "#111111", "black on yellow")
  expect(HexColor.parse("ABC"), "#aabbcc", "short hex")
  expect(jsRound(-2.5), -2, "Math.round semantics")
}

@Test("last area") func lastArea() throws {
  let a = LastArea(displayId: 1, displayBounds: .init(x: 0, y: 0, width: 1470, height: 956), rect: .init(x: 2000, y: 10, width: 300, height: 200))
  let r = a.resolve(displays: [(id: 7, bounds: .init(x: 0, y: 0, width: 1470, height: 956))])
  expect(r?.id, 7, "found again by bounds when the id changed")
  expect(r?.rect.x, 1469, "corner kept on the display")
  let electron = ##"{"displayId":1,"displayBounds":{"x":0,"y":0,"width":1470,"height":956},"rect":{"x":194.98046875,"y":250.13671875,"width":688.75,"height":519.71875}}"##
  let parsed = try JSONDecoder().decode(LastArea.self, from: Data(electron.utf8))
  expect(parsed.rect.width, 688.75, "reads Electron's last-area.json")
}

@Test("model (model.test.ts, the rest)") func modelModelTestTsTheRest() throws {
  let rect = { (id: String, x: Double) in Shape.box(.init(id: id, type: "rect", x: x, y: 0, w: 10, h: 10, color: "#000", width: 2)) }
  var h = ShapeHistory()
  h.commit([rect("a", 0)])
  h.commit([rect("a", 0), rect("b", 0)])
  h.undo()
  h.undo()
  expect(h.present, [], "undo to empty")
  var g = ShapeHistory()
  g.commit([rect("a", 0)])
  g.commit([rect("a", 1)], mergeKey: "slide")
  g.commit([rect("a", 2)], mergeKey: "slide")
  g.commit([rect("a", 3)], mergeKey: "slide")
  expect(g.past.count, 2, "consecutive commits with the same key are one undo step")
  let steps = [Shape.step(.init(id: "a", x: 0, y: 0, size: 30, color: "#f00")), .step(.init(id: "b", x: 0, y: 0, size: 30, color: "#f00")), .step(.init(id: "c", x: 0, y: 0, size: 30, color: "#f00"))]
  expect(Annotations.stepNumbers(steps)["c"], 3, "steps numbered in drawing order")
  expect(Annotations.stepNumbers(steps.filter { $0.id != "b" })["c"], 2, "renumbered after delete")
  let (sx, sy) = Annotations.snap45(-2, -100)
  expect([sx, sy], [0, -100], "snap45 up")
  let b1 = Annotations.boxFromDrag(50, 50, 10, 20)
  expect([b1.x, b1.y, b1.w, b1.h], [10, 20, 40, 30], "box from a drag up-left")
  let b2 = Annotations.boxFromDrag(0, 0, 30, -10, square: true)
  expect([b2.x, b2.y, b2.w, b2.h], [0, -30, 30, 30], "square box")
  let head = Annotations.openArrowHead([0, 0, 100, 0], length: 20)
  expect([head[2], head[3]], [100, 0], "open arrow head meets at the tip")
  expectTrue(head[0] < 100 && abs(head[0] - head[4]) < 1e-9 && abs(head[1] + head[5]) < 1e-9, "head strokes behind the tip, symmetric")
  if case let .line(l) = Shape.line(.init(id: "l", type: "line", points: [0, 0, 10, 10], color: "#000", width: 2)).moved(5, -5) {
    expect(l.points, [5, -5, 15, 5], "moves point-based shapes")
  }
  let target = LRect(x: 100, y: 100, w: 100, h: 50)
  let r = Annotations.snapBox(LRect(x: 104, y: 300, w: 40, h: 20), targets: [target], threshold: 6)
  expect([r.dx, r.dy], [-4, 0], "snaps left edges")
  expect(r.guides, [Annotations.Guide(vertical: true, at: 100, from: 100, to: 320)], "with a guide")
  let c = Annotations.snapBox(LRect(x: 127, y: 117, w: 46, h: 20), targets: [target], threshold: 6)
  expect([c.dx, c.dy], [0, -2], "snaps centres")
  let far = Annotations.snapBox(LRect(x: 400, y: 400, w: 10, h: 10), targets: [target], threshold: 6)
  expectTrue(far.dx == 0 && far.dy == 0 && far.guides.isEmpty, "leaves the box alone when nothing is close")

  // Style helpers (Overlay.tsx styleOf / restyle, StyleBar.tsx lookPatch).
  let base = Style.initial(SettingsRules.defaults)
  let dark = TextLook.dark.patch(base)
  expect(dark.textBackground, "#111111", "dark look: dark background")
  expect(dark.textColor, "#ffffff", "with white text")
  let after = base.applying(dark)
  expect(TextLook.plain.patch(after).textColor, base.color, "leaving a background look restores the drawing colour")
  let arrow = Shape.line(.init(id: "a", type: "arrow", points: [0, 0, 1, 1], color: "#000", width: 8))
  expect(arrow.style(over: base, widths: [3, 5, 8]).widthIndex, 2, "a selected arrow shows its own width")
  if case let .line(l) = arrow.restyled(StylePatch(color: "#fff", widthIndex: 0), widths: [3, 5, 8]) {
    expect([l.color, String(l.width)], ["#fff", "3.0"], "restyle a shape")
  }
  if case let .text(t) = Shape.text(.init(id: "t", x: 10, y: 10, text: "a", color: "#000", fontSize: 20, fontFamily: "", shadow: 0, background: "", stroke: nil, strokeWidth: nil))
    .transformed(gx: 0, gy: 0, sx: 2, sy: 2) {
    expect([t.x, t.fontSize], [20, 40], "resizing text scales its size")
  }
}

@Test("compress (UPNG port) and capture documents") func compressUpngPortAndCaptureDocuments() throws {
  // 4×2 image, three colours.
  let colors: [[UInt8]] = [[255, 0, 0, 255], [0, 128, 255, 255], [20, 20, 20, 255]]
  var px: [UInt8] = []
  for i in 0..<8 { px += colors[i % 3] }
  let q = Quantizer.quantize(px)
  expect(q.palette.first, 0, "palette starts with the reserved transparent colour")
  expect(q.palette.count, 4, "three colours in, three (+1) out")
  var back: [UInt8] = []
  for i in q.indices {
    let c = q.palette[Int(i)]
    back.append(contentsOf: [UInt8(c & 0xff), UInt8((c >> 8) & 0xff), UInt8((c >> 16) & 0xff), UInt8(c >> 24)])
  }
  expect(back, px, "each pixel maps back to its own colour")
  let png = PNGWriter.indexed(width: 4, height: 2, palette: q.palette, indices: q.indices)
  let src = CGImageSourceCreateWithData(png as CFData, nil)
  let img = src.flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
  expect(img.map { [$0.width, $0.height] }, [4, 2], "the palette PNG decodes")
  expect(png[25], 3, "colour type 3 (palette)")
  // Many colours: at most 256.
  var many: [UInt8] = []
  for i in 0..<4096 {
    let r = UInt8(i % 256), g = UInt8((i / 16) % 256), b = UInt8((i * 7) % 256)
    many.append(contentsOf: [r, g, b, 255])
  }
  expectTrue(Quantizer.quantize(many).palette.count <= 256, "at most 256 colours")
  expect(compressesFor("both", true, "copy"), true, "compressesFor both")
  expect(compressesFor("copy", true, "save"), false, "compressesFor copy only")
  expect(compressesFor("both", false, "copy"), false, "compressesFor off")

  let doc = CaptureDoc(png: Data([1, 2, 3]), width: 800, height: 600, scale: 2, shapes: [.step(.init(id: "s", x: 1, y: 2, size: 30, color: "#f00"))], historyId: "h1")
  expect(CaptureDoc(json: try JSON.parse(doc.json.serialized()), png: doc.png), doc, "doc.json round trip")
  let electronDoc = #"{"width":2341,"height":1569,"scale":2,"shapes":[],"beautify":{"on":true,"presetId":"ocean","padding":20,"radius":17,"shadow":0.05},"historyId":"mw4id9h31vxu"}"#
  let d2 = CaptureDoc(json: try JSON.parse(electronDoc), png: Data())
  expect(d2?.beautify["presetId"], .string("ocean"), "reads an Electron doc.json, background kept")
}

@Test("beautify layout (layout.test.ts)") func beautifyLayoutLayoutTestTs() throws {
  let l = BeautifyGeometry.layout(w: 800, h: 600, padding: 48, radius: 12, shadow: 0.3, frame: nil, scale: 2)
  expect([l.width, l.height, l.x, l.y, l.radius], [992, 792, 96, 96, 24], "adds padding on every side, in image pixels")
  let b = BeautifyGeometry.layout(w: 40, h: 20, padding: 10, radius: 100, shadow: 2, frame: nil, scale: 1)
  expectTrue(b.radius == 10 && b.shadowAlpha == 1 && b.shadowBlur <= 8, "keeps corners and shadow within bounds")
  let z = BeautifyGeometry.layout(w: 100, h: 100, padding: 0, radius: 8, shadow: 0, frame: nil, scale: 2)
  expect([z.width, z.height, z.x, z.shadowBlur], [100, 100, 0, 0], "no shadow or padding when they are zero")
  let r = BeautifyGeometry.layout(w: 100, h: 100, padding: 10, radius: 0, shadow: 0, frame: .ratio(w: 16, h: 9), scale: 1)
  expect([r.height, r.width, r.x, r.y], [120, 213, jsRound((213 - 100) / 2), 10], "widens a tall capture to 16:9, centred")
  let sq = BeautifyGeometry.layout(w: 300, h: 100, padding: 10, radius: 0, shadow: 0, frame: .ratio(w: 1, h: 1), scale: 1)
  expect([sq.width, sq.height, sq.y], [320, 320, 110], "heightens a wide capture to 1:1")
  let big = BeautifyGeometry.layout(w: 2000, h: 1000, padding: 10, radius: 0, shadow: 0, frame: .size(w: 1020, h: 1020), scale: 1)
  expect([big.width, big.height, big.drawW, big.drawH], [1020, 1020, 1000, 500], "fits a large capture into an exact size")
  let small = BeautifyGeometry.layout(w: 100, h: 50, padding: 10, radius: 0, shadow: 0, frame: .size(w: 400, h: 300), scale: 1)
  expect([small.drawW, small.drawH, small.x, small.y], [100, 50, 150, 125], "never scaling up")
  let g0 = BeautifyGeometry.gradientLine(w: 200, h: 100, angle: 0)
  expect([g0.0, g0.1, g0.2, g0.3].map { jsRound($0) }, [0, 50, 200, 50], "gradient runs left to right at 0°")
  let g90 = BeautifyGeometry.gradientLine(w: 200, h: 100, angle: 90)
  expect([g90.0, g90.1, g90.2, g90.3].map { jsRound($0) }, [100, 0, 100, 100], "and top to bottom at 90°")
  let electron = ##"{"on":true,"presetId":"ocean","padding":20,"radius":17,"shadow":0.05,"frame":{"kind":"ratio","w":16,"h":9},"background":{"type":"solid","color":"#18181b"}}"##
  let st = try JSONDecoder().decode(BeautifyState.self, from: Data(electron.utf8))
  expect(st.frame, .ratio(w: 16, h: 9), "reads Electron's background state")
  expect(BeautifyState.initial(SettingsRules.defaults, last: nil).presetId, "ocean", "default preset")
}

@Test("history pruning (history.test.ts)") func historyPruningHistoryTestTs() throws {
  let MB = 1024 * 1024
  let day = 86_400_000.0
  let now = 100 * day
  func entry(_ id: String, _ age: Double, _ bytes: Int = 1024 * 1024, _ starred: Bool = false) -> HistoryEntry {
    HistoryEntry(id: id, createdAt: now - age, updatedAt: now - age, width: 10, height: 10, bytes: bytes, starred: starred)
  }
  expect(HistoryRules.toPrune([entry("a", 1), entry("b", 2), entry("c", 3, MB, true), entry("d", 4), entry("e", 5)], maxCount: 2, maxMB: 999, maxAgeDays: 0, now: now), ["d", "e"], "keeps the newest N, never starred ones")
  expect(HistoryRules.toPrune([entry("a", 1, 3 * MB), entry("b", 2, 3 * MB), entry("c", 3, 3 * MB)], maxCount: 10, maxMB: 6, maxAgeDays: 0, now: now), ["c"], "deletes the oldest until under the size limit")
  expect(HistoryRules.toPrune([entry("a", day), entry("b", 40 * day), entry("c", 50 * day, MB, true)], maxCount: 10, maxMB: 999, maxAgeDays: 30, now: now), ["b"], "deletes entries older than the age limit")
  expect(HistoryRules.toPrune((0..<35).map { entry("e\($0)", Double($0 + 1), 1) }, maxCount: 10_000, maxMB: 999_999, maxAgeDays: 0, now: now).count, 5, "the hard ceiling applies")
  expect(HistoryRules.toPrune([entry("a", 1), entry("b", 2, MB, true)], maxCount: 0, maxMB: 999, maxAgeDays: 0, now: now), ["a"], "a count of 0 keeps only starred entries")

  // The store on disk, with Electron's file layout.
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("snapkit-history-\(UUID().uuidString)")
  defer { try? FileManager.default.removeItem(at: dir) }
  let store = HistoryStore(dir: dir)
  store.load()
  let doc = CaptureDoc(png: Data([1, 2, 3]), width: 4, height: 3, scale: 2, shapes: [])
  let id = store.add(finalPNG: Data([9, 9]), width: 4, height: 3, doc: doc, thumbJPEG: Data([7]))
  expectTrue(id != nil && FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id!)/final.png").path), "an entry is a folder with final.png")
  for f in ["source.png", "doc.json", "thumb.jpg"] { expectTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id!)/\(f)").path), "and \(f)") }
  var again = doc
  again.historyId = id
  _ = store.add(finalPNG: Data([8]), width: 4, height: 3, doc: again, thumbJPEG: Data([7]))
  expect(store.entries.count, 1, "re-editing updates the same entry")
  store.saveIndex()
  try FileManager.default.createDirectory(at: dir.appendingPathComponent("junk.tmp"), withIntermediateDirectories: true)
  let reloaded = HistoryStore(dir: dir)
  reloaded.load()
  expect(reloaded.entries.map(\.id), [id!], "index.json reloads; half-written folders are removed")
  expect(reloaded.doc(id!)?.historyId, id, "the document reopens with its id")
}

// MARK: - Shared fixtures (fixtures/*.json, written by the Electron side with `npm run fixtures`)

@Test("fixtures") func fixtures() throws {
  let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../fixtures").standardized
  let defaults = try JSON.parse(Data(contentsOf: fixtures.appendingPathComponent("default-settings.json")))
  expect(SettingsRules.defaultsJSON, defaults, "native defaults are fixtures/default-settings.json (run mac/scripts/sync-fixtures.sh)")
  expectTrue((try? defaults.decode(Settings.self)) != nil, "the Electron defaults decode into the Swift settings model")

  let list = try JSON.parse(Data(contentsOf: fixtures.appendingPathComponent("features.json"))).array ?? []
  expect(Features.all.map(\.id), list.compactMap { $0["id"]?.string }, "same feature ids in the same order as features.ts")
  for (f, j) in zip(Features.all, list) {
    let variants = (j["variants"]?.array ?? []).map { FeatureVariant(id: $0["id"]?.string ?? "", label: $0["label"]?.string ?? "") }
    let same = f.label == j["label"]?.string && f.kind.rawValue == j["kind"]?.string && f.hint == j["hint"]?.string
      && f.drawing == (j["drawing"]?.bool ?? false) && f.variants == variants && f.groupLabel == j["groupLabel"]?.string
      && f.variantsHint == j["variantsHint"]?.string && f.tipNote == j["tipNote"]?.string
      && f.defaultEnabled == j["defaultEnabled"]?.bool && f.inGroup == (j["inGroup"]?.bool ?? false)
    expectTrue(same, "feature \(f.id) matches features.ts")
  }
}

// Version (src/shared/version.test.ts)
@Test("version") func version() throws {
  expectTrue(Version.compare("0.1.0", "0.2.0") < 0 && Version.compare("v1.10.0", "1.9.9") > 0 && Version.compare("1.2", "v1.2.0") == 0, "compares versions, v prefix and missing parts")
  expectTrue(Version.compare("1.0.0-beta.1", "1.0.0") < 0 && Version.compare("1.0.0", "1.0.0-rc.1") > 0 && Version.compare("1.0.0-beta.2", "1.0.0-beta.1") > 0, "a prerelease is older than its release")
  expectTrue(Version.compare("1.0.0-beta.10", "1.0.0-beta.2") > 0 && Version.compare("1.0.0-beta", "1.0.0-beta.1") < 0 && Version.compare("1.0.0-rc.1", "1.0.0-beta.9") > 0, "prerelease numbers compare as numbers")
  expectTrue(Version.compare("nightly", "0.0.1") < 0, "junk is 0.0.0")
  let list = [Version.Release(tag: "v0.2.0-beta.2", prerelease: true), Version.Release(tag: "v0.3.0", draft: true), Version.Release(tag: "v0.1.5"), Version.Release(tag: "v0.2.0-beta.1", prerelease: true)]
  expect(Version.pick(list, current: "0.2.0-beta.1")?.tag, "v0.2.0-beta.2", "betas offered to beta users, never drafts")
  expect(Version.pick(list, current: "0.1.0")?.tag, "v0.1.5", "only stable releases for everyone else")
  expectTrue(Version.pick([Version.Release(tag: "v0.2.0-beta.1", prerelease: true)], current: "0.1.0") == nil, "no stable release: nothing offered")
}
