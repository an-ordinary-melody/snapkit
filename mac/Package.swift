// swift-tools-version:5.10
// Native macOS Snapkit (plan: docs/native-mac-plan.md). `swift build`, then mac/scripts/build-app.sh
// wraps the binary into Snapkit.app. `swift test` runs the unit tests (needs Xcode, for Swift Testing).
import PackageDescription

let package = Package(
  name: "Snapkit",
  platforms: [.macOS(.v14)],
  dependencies: [
    // Updates (MIT). Pinned to minor versions: an update of Sparkle is a deliberate change.
    .package(url: "https://github.com/sparkle-project/Sparkle", .upToNextMinor(from: "2.10.1"))
  ],
  targets: [
    // Logic shared by the app and its checks: no AppKit, no windows.
    .target(name: "SnapkitCore"),
    .executableTarget(
      name: "Snapkit",
      dependencies: ["SnapkitCore", .product(name: "Sparkle", package: "Sparkle")],
      // Sparkle.framework is copied to Contents/Frameworks by scripts/build-app.sh.
      linkerSettings: [.linkedFramework("Carbon"), .linkedFramework("ScreenCaptureKit"),
                       .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
    ),
    // Unit tests for SnapkitCore (Swift Testing).
    .testTarget(name: "SnapkitCoreTests", dependencies: ["SnapkitCore"]),
    // Sends test commands to a running debug build (TestHook.swift).
    .executableTarget(name: "snapkitctl")
  ]
)
