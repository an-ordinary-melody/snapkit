import AppKit
import Vision

/**
 * Text recognition with Apple's Vision, in-process (Electron runs the same code as a helper,
 * native/ocr-mac/main.swift). Lines come back top to bottom with boxes as fractions of the image,
 * top-left origin, like OcrLine in src/shared/ipc.ts.
 */
enum TextRecognition {
  struct Line: Equatable {
    var text: String
    var x, y, w, h: Double
  }

  /** Languages to read, most likely first (LANGUAGES in src/main/ocr/index.ts, in Vision's codes). */
  static let languages = ["vi-VT", "en-US"]

  /**
   * Load Vision's text models ahead of time: the first recognition after a restart can take most of
   * a minute while macOS prepares them, which would otherwise land on the first Capture text.
   */
  static func warmUp() {
    let size = CGSize(width: 240, height: 60)
    let img = NSImage(size: size, flipped: false) { r in
      NSColor.white.setFill()
      r.fill()
      NSAttributedString(string: "Snapkit", attributes: [.font: NSFont.systemFont(ofSize: 32), .foregroundColor: NSColor.black]).draw(at: CGPoint(x: 10, y: 10))
      return true
    }
    guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 3) {
      recognize(cg) { _, ms in log("[ocr] warmed up in \(ms) ms") }
    }
  }

  /** Recognize on a background queue; `done` runs on the main thread with the lines (or an error) and the time taken. */
  #if DEBUG
  /** Tests: extra time before each answer (one per read, in order), to make reads overlap or arrive late. */
  static var testDelays: [Double] = []
  #endif

  /** The first run on a Mac can take most of a minute while macOS prepares its text models (helper.ts). */
  static var timeout: TimeInterval = 120

  static func recognize(_ image: CGImage, done finish: @escaping (Result<[Line], Error>, Int) -> Void) {
    let t0 = Date()
    var delay = 0.0
    #if DEBUG
    if !testDelays.isEmpty { delay = testDelays.removeFirst() }
    #endif
    // Answered once: the result, or a timeout if Vision never answers (the request is cancelled).
    var answered = false
    let request = VNRecognizeTextRequest()
    let done = { (r: Result<[Line], Error>, ms: Int) in
      guard !answered else { return }
      answered = true
      finish(r, ms)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
      guard !answered else { return }
      request.cancel()
      log("[ocr] vision: no answer after \(Int(timeout)) s")
      done(.failure(NSError(domain: "Snapkit", code: 1, userInfo: [NSLocalizedDescriptionKey: "no answer after \(Int(timeout)) s"])), ms(t0))
    }
    DispatchQueue.global(qos: .userInitiated).async {
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      // Keep the languages this Mac can read.
      let supported = (try? request.supportedRecognitionLanguages()) ?? ["en-US"]
      let langs = languages.filter { supported.contains($0) }
      if !langs.isEmpty { request.recognitionLanguages = langs }
      let result: Result<[Line], Error>
      do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let lines = (request.results ?? []).compactMap { o -> Line? in
          guard let best = o.topCandidates(1).first, !best.string.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
          let b = o.boundingBox // bottom-left origin
          return Line(text: best.string, x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height)
        }
        result = .success(lines)
      } catch {
        result = .failure(error)
      }
      let elapsed = ms(t0)
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        if case let .success(l) = result { log("[ocr] vision: \(l.count) line(s) in \(elapsed) ms") }
        done(result, elapsed)
      }
    }
  }
}
