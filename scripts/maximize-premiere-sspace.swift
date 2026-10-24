#!/usr/bin/env swift
// Zoom Premiere's project window to fill the S-Space monitor, exactly like
// double-clicking its title bar (Swen's way). It presses the window's zoom
// button only when the window doesn't already fill S-Space, because a second
// zoom would restore the smaller size. Only acts on a window already on S-Space.
//
//   swift scripts/maximize-premiere-sspace.swift            # apply
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
// Premiere sometimes comes up covering the whole monitor, menu bar strip
// included (y = monitor top, height 1440). That is already full; zooming it
// would toggle it to a smaller size, and every resize redistributes Premiere's
// panel sizes (Swen's S-Captions panel kept shrinking).
func fills(_ rect: CGRect) -> Bool { abs(rect.minX - target.minX) <= 2 && abs(rect.width - target.width) <= 2 && rect.minY <= target.minY + 2 && rect.minY >= monitor.minY - 2 && rect.maxY >= target.maxY - 2 }
if fills(before) { print("Premiere already fills S-Space: \(before)"); exit(0) }
var zoom: CFTypeRef?
guard AXUIElementCopyAttributeValue(project, kAXZoomButtonAttribute as CFString, &zoom) == .success, let button = zoom
else { fail("Premiere's window has no zoom button available.") }
_ = AXUIElementPerformAction(button as! AXUIElement, kAXPressAction as CFString)
var after = before
for _ in 0..<20 { Thread.sleep(forTimeInterval: 0.1); if let now = frame(project) { after = now; if fills(now) { break } } }
print(fills(after) ? "Premiere fills S-Space: \(after)" : "Zoom did not fill S-Space: \(after) (expected \(target))")
exit(fills(after) ? 0 : 1)
