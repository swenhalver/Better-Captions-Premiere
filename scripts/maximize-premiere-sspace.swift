#!/usr/bin/env swift
// Verify Premiere's normal maximized frame on S-Space. This deliberately does
// not press the green/AXZoomButton: Premiere exposes it as AXFullScreenButton,
// and that action entered full screen instead of normal window maximization.
// When needed, a Codex tester must double-click the visible title bar through
// Computer Use, then rerun this check. Never enter full screen to satisfy it.
//
//   swift scripts/maximize-premiere-sspace.swift            # verify normal maximization
//   swift scripts/maximize-premiere-sspace.swift --dry-run  # print the target frame only
import AppKit
import ApplicationServices

let bundleID = "com.adobe.PremierePro.26"
let sspaceCLI = "/Users/swenhalverson/Cursor Projects/S-Space/tools/s-space"
let dryRun = CommandLine.arguments.contains("--dry-run")
func fail(_ message: String) -> Never { fputs(message + "\n", stderr); exit(1) }

// S-Space reports its monitor in global top-left (CoreGraphics) coordinates.
let process = Process(), output = Pipe()
process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
process.arguments = [sspaceCLI, "status"]
process.standardOutput = output
try process.run(); process.waitUntilExit()
guard let status = try JSONSerialization.jsonObject(with: output.fileHandleForReading.readDataToEndOfFile()) as? [String: Any],
      status["displayActive"] as? Bool == true,
      let x = status["x"] as? Double, let y = status["y"] as? Double,
      let width = status["width"] as? Double, let height = status["height"] as? Double else { fail("S-Space is not active.") }
let monitor = CGRect(x: x, y: y, width: width, height: height)

// Menu bar (and a Dock, if any) come from the matching NSScreen's visible frame.
guard let screen = NSScreen.screens.first(where: { $0.localizedName == "S-Space" || ($0.frame.width == width && $0.frame.height == height && $0 != NSScreen.screens.first) })
else { fail("No screen matches the S-Space monitor.") }
var top = screen.frame.maxY - screen.visibleFrame.maxY
let left = screen.visibleFrame.minX - screen.frame.minX, bottom = screen.visibleFrame.minY - screen.frame.minY
// macOS can report S-Space's visible frame without its menu bar. Measure the
// menu bar window itself; Premiere's zoomed frame starts 1 pt below it
// (Swen's hand-maximized frame: y = monitor top + 31, height = 1440 - 31).
let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for row in rows where (row[kCGWindowName as String] as? String) == "Menubar" {
    if let bounds = row[kCGWindowBounds as String] as? NSDictionary, let rect = CGRect(dictionaryRepresentation: bounds),
       abs(rect.minY - monitor.minY) <= 1, rect.minX >= monitor.minX - 1, rect.maxX <= monitor.maxX + 1 { top = max(top, rect.height + 1) }
}
let target = CGRect(x: monitor.minX + left, y: monitor.minY + top, width: monitor.width - left, height: monitor.height - top - bottom)
guard top > 2 else { fail("Cannot establish the menu-bar inset; refusing to accept a full-monitor frame as normal maximization.") }
if dryRun { print("target:", target); exit(0) }

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else { fail("Premiere is not running.") }
let axApp = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(axApp, 3)
func projectWindow() -> AXUIElement? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &value) == .success, let windows = value as? [AXUIElement] else { return nil }
    // Premiere sometimes reports no title to a fresh Accessibility client; its
    // project window is then simply its only (or largest) window.
    let titled = windows.first { w in var t: CFTypeRef?; AXUIElementCopyAttributeValue(w, kAXTitleAttribute as CFString, &t); return (t as? String)?.hasSuffix(".prproj") == true }
    return titled ?? windows.max { (frame($0)?.width ?? 0) * (frame($0)?.height ?? 0) < (frame($1)?.width ?? 0) * (frame($1)?.height ?? 0) }
}
func frame(_ window: AXUIElement) -> CGRect? {
    var p: CFTypeRef?, s: CFTypeRef?, point = CGPoint.zero, size = CGSize.zero
    guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &p) == .success,
          AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &s) == .success,
          AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
// Premiere briefly drops the window from Accessibility while busy; retry for a few seconds.
var found: AXUIElement?
for _ in 0..<20 { if let w = projectWindow() { found = w; break }; Thread.sleep(forTimeInterval: 0.5) }
guard let project = found, let before = frame(project) else { fail("Premiere has no project window.") }
guard monitor.contains(CGPoint(x: before.midX, y: before.midY)) else { fail("Premiere's project window is not on S-Space; move it there first.") }
var fullScreen: CFTypeRef?
if AXUIElementCopyAttributeValue(project, "AXFullScreen" as CFString, &fullScreen) == .success,
   fullScreen as? Bool == true { fail("Premiere is full screen. Full screen is forbidden; restore its normal window through Computer Use.") }
func fills(_ rect: CGRect) -> Bool {
    abs(rect.minX - target.minX) <= 2 && abs(rect.minY - target.minY) <= 2 &&
    abs(rect.width - target.width) <= 2 && abs(rect.height - target.height) <= 2
}
if fills(before) { print("Premiere has the normal maximized S-Space frame: \(before). Also verify visible window controls in the screenshot."); exit(0) }
fail("Premiere is not normally maximized: \(before) (expected \(target)). Use Computer Use to double-click its visible title bar, then rerun this check and reset the saved layout. Do not use the green/full-screen button.")
