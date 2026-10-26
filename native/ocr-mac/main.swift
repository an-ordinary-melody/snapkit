// Snapkit's macOS text recognizer: Apple's Vision framework, run as a small helper.
// Reads a PNG on stdin, prints {"lines":[{"text","x","y","w","h"}]} on stdout, with each
// line's box as fractions of the image, top-left origin. Arguments: preferred languages
// in Vision's codes (e.g. vi-VT en-US); none = Vietnamese and English.
// Built by scripts/build-ocr.mjs.
import Foundation
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

let png = FileHandle.standardInput.readDataToEndOfFile()
guard !png.isEmpty else { fail("no image on stdin") }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
let wanted = CommandLine.arguments.count > 1 ? Array(CommandLine.arguments.dropFirst()) : ["vi-VT", "en-US"]
// Older macOS reads fewer languages (Vietnamese needs macOS 14): keep the ones this Mac has.
var supported = ["en-US"]
if #available(macOS 12.0, *) { supported = (try? request.supportedRecognitionLanguages()) ?? supported }
let languages = wanted.filter { supported.contains($0) }
if !languages.isEmpty { request.recognitionLanguages = languages }

do {
  try VNImageRequestHandler(data: png, options: [:]).perform([request])
} catch {
  fail("recognition failed: \(error)")
}

var lines: [[String: Any]] = []
for observation in request.results ?? [] {
  guard let best = observation.topCandidates(1).first else { continue }
  let b = observation.boundingBox // fractions, bottom-left origin
  lines.append(["text": best.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height])
}
let out = try! JSONSerialization.data(withJSONObject: ["lines": lines, "languages": languages])
FileHandle.standardOutput.write(out)
