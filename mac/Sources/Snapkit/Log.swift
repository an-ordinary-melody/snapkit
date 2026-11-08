import Foundation

/** main.log in ~/Library/Logs/Snapkit (or Snapkit Dev), plus stderr. */
private let logQueue = DispatchQueue(label: "snapkit.log")
private var logHandle: FileHandle?
private let logStamp: DateFormatter = {
  let f = DateFormatter()
  f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
  return f
}()

func log(_ message: String) {
  let line = "[\(logStamp.string(from: Date()))] \(message)\n"
  FileHandle.standardError.write(Data(line.utf8))
  logQueue.async {
    if logHandle == nil {
      try? FileManager.default.createDirectory(at: Paths.logDir, withIntermediateDirectories: true)
      let file = Paths.logDir.appendingPathComponent("main.log")
      if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
      logHandle = try? FileHandle(forWritingTo: file)
      _ = try? logHandle?.seekToEnd()
    }
    logHandle?.write(Data(line.utf8))
  }
}
