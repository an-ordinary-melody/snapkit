// swift-tools-version:5.10
// Native macOS Snapkit (plan: docs/native-mac-plan.md). `swift build`, then mac/scripts/build-app.sh
// wraps the binary into Snapkit.app. `swift test` runs the unit tests (needs Xcode, for Swift Testing).
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
    // Unit tests for SnapkitCore (Swift Testing).
    .testTarget(name: "SnapkitCoreTests", dependencies: ["SnapkitCore"]),
    // Sends test commands to a running debug build (TestHook.swift).
    .executableTarget(name: "snapkitctl")
  ]
)
