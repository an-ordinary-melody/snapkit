// swift-tools-version:5.10
// Native macOS Snapkit (plan: docs/native-mac-plan.md). Builds with the Command Line Tools:
// `swift build`, then mac/scripts/build-app.sh wraps the binary into Snapkit.app.
import PackageDescription

let package = Package(
  name: "Snapkit",
  platforms: [.macOS(.v14)],
  targets: [
    // Logic shared by the app and its checks: no AppKit, no windows.
    .target(name: "SnapkitCore"),
    .executableTarget(
      name: "Snapkit",
      dependencies: ["SnapkitCore"],
      linkerSettings: [.linkedFramework("Carbon"), .linkedFramework("ScreenCaptureKit")]
    ),
    // Unit checks for SnapkitCore. A plain executable because the Command Line Tools have no XCTest;
    // these move to Swift Testing once Xcode is installed.
    .executableTarget(name: "SnapkitChecks", dependencies: ["SnapkitCore"]),
    // Sends test commands to a running debug build (TestHook.swift).
    .executableTarget(name: "snapkitctl")
  ]
)
