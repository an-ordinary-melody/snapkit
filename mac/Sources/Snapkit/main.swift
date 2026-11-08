import AppKit

// Snapkit: menu-bar app (LSUIElement), no Dock icon.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
