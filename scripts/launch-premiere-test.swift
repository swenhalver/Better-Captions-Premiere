#!/usr/bin/env swift
import AppKit
import ApplicationServices

// Test-only launch and window placement. No clicks, keystrokes, monitor changes,
// app termination, or changes to the user's ordinary Premiere launch settings.
struct LaunchFailure: LocalizedError { let message: String; var errorDescription: String? { message } }
let bundleID = "com.adobe.PremierePro.26"
let sspaceCLI = "/Users/swenhalverson/Cursor Projects/S-Space/tools/s-space"

func sspace(_ arguments: [String]) throws -> [String: Any] {
    let process = Process(), output = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    process.arguments = [sspaceCLI] + arguments
    process.standardOutput = output
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], result["ok"] as? Bool == true else {
        throw LaunchFailure(message: "S-Space command failed: " + String(data: data, encoding: .utf8)!)
    }
    return result
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func frame(_ window: AXUIElement) -> CGRect? {
    guard let position = attribute(window, kAXPositionAttribute), let size = attribute(window, kAXSizeAttribute),
          CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, extent = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
    return CGRect(origin: point, size: extent)
}
func dictionary(_ frame: CGRect) -> [String: Double] {
    ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
}
func onMonitor(_ frame: CGRect, _ monitor: CGRect) -> Bool {
    monitor.insetBy(dx: -1, dy: -1).contains(frame)
}
func windows(pid: pid_t, visibleOnly: Bool = true) -> [[String: Any]] {
    let options: CGWindowListOption = visibleOnly ? [.optionOnScreenOnly, .excludeDesktopElements] : [.excludeDesktopElements]
    return (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []).filter {
        ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 &&
            ($0[kCGWindowAlpha as String] as? Double ?? 1) > 0
    }
}
func windowFrame(_ row: [String: Any]) -> CGRect? {
    guard let value = row[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: value)
}
func visibleNormalWindows(pid: pid_t, visibleOnly: Bool = true) -> [[String: Any]] {
    windows(pid: pid, visibleOnly: visibleOnly).filter { windowFrame($0).map { $0.width >= 100 && $0.height >= 80 } ?? false }
}
func publish(_ value: [String: Any], receipt: URL?) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    if let receipt { try data.write(to: receipt, options: .atomic) }
    print(String(decoding: data, as: UTF8.self))
}

@MainActor func run() async throws {
    var args = Array(CommandLine.arguments.dropFirst()), project: URL?, receipt: URL?, checkOnly = false
    while !args.isEmpty {
        let name = args.removeFirst()
        if name == "--check" { checkOnly = true; continue }
        guard ["--project", "--receipt"].contains(name), !args.isEmpty else {
            throw LaunchFailure(message: "Usage: swift scripts/launch-premiere-test.swift --project /absolute/project.prproj [--receipt /absolute/receipt.json], or --check")
        }
        let path = args.removeFirst()
        guard path.hasPrefix("/") else { throw LaunchFailure(message: "Use absolute paths.") }
        if name == "--project" { project = URL(fileURLWithPath: path) } else { receipt = URL(fileURLWithPath: path) }
    }
    guard AXIsProcessTrusted() else { throw LaunchFailure(message: "The test launcher has no Accessibility access. Premiere was not launched.") }
    let status = try sspace(["status"])
    guard status["displayActive"] as? Bool == true,
          let x = status["x"] as? Double, let y = status["y"] as? Double,
          let width = status["width"] as? Double, let height = status["height"] as? Double else {
        throw LaunchFailure(message: "Start the existing S-Space monitor before testing. Premiere was not launched.")
    }
    let monitor = CGRect(x: x, y: y, width: width, height: height)
    guard width > 100, height > 100, let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
        throw LaunchFailure(message: "Premiere or S-Space is unavailable.")
    }
    if checkOnly {
        try publish(["ok": true, "accessibility": true, "monitor": dictionary(monitor), "appPath": appURL.path], receipt: receipt)
        return
    }
    guard let project, project.pathExtension.lowercased() == "prproj", FileManager.default.fileExists(atPath: project.path) else {
        throw LaunchFailure(message: "Specify an existing Premiere project. Premiere was not launched.")
    }
    guard NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).isEmpty else {
        throw LaunchFailure(message: "Premiere is already running. Save it and quit through Computer Use before this test launch; this launcher never quits or hides a running user session.")
    }
    _ = try sspace(["prepare-app", "--app", bundleID])
    let priorFrontmost = NSWorkspace.shared.frontmostApplication
    let frontmostBefore = priorFrontmost?.processIdentifier ?? 0
    // Large projects can take minutes to open. prepare-app registration lasts
    // 60 seconds, so it is refreshed every 50 seconds until placement is done.
    let deadline = Date().addingTimeInterval(300)
    var lastPrepare = Date()
    var physicalWindows = Set<UInt32>(), focusTaken = false
    let startupObserver = Task { @MainActor in
        while !Task.isCancelled {
            for candidate in NSRunningApplication.runningApplications(withBundleIdentifier: bundleID) where !candidate.isTerminated {
                if NSWorkspace.shared.frontmostApplication?.processIdentifier == candidate.processIdentifier {
                    focusTaken = true
                    _ = candidate.hide()
                    _ = priorFrontmost?.activate(options: [.activateIgnoringOtherApps])
                }
                for row in windows(pid: candidate.processIdentifier) {
                    if let actual = windowFrame(row), actual.width >= 100, actual.height >= 80, !onMonitor(actual, monitor),
                       let id = row[kCGWindowNumber as String] as? UInt32 { physicalWindows.insert(id) }
                }
                if !candidate.isHidden { _ = candidate.hide() }
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
    }
    defer { startupObserver.cancel() }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = false
    config.hides = true
    config.addsToRecentItems = false
    let app = try await NSWorkspace.shared.open([project], withApplicationAt: appURL, configuration: config)
    let pid = app.processIdentifier, axApp = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(axApp, 1)
    var records: [String: [String: Any]] = [:]
    var placementReady = false, projectFrame: CGRect?
    while Date() < deadline && !app.isTerminated {
        if Date().timeIntervalSince(lastPrepare) >= 50 {
            _ = try? sspace(["prepare-app", "--app", bundleID]); lastPrepare = Date()
        }
        // Adobe can override a launch-hidden request while initializing. Keep
        // startup windows hidden until every normal window is on S-Space.
        if !app.isHidden {
            _ = app.hide()
        }
        let windows = attribute(axApp, kAXWindowsAttribute) as? [AXUIElement] ?? []
        projectFrame = nil
        for window in windows {
            guard let original = frame(window), original.width >= 100, original.height >= 80 else { continue }
            let title = attribute(window, kAXTitleAttribute) as? String ?? ""
            let key = "\(title):\(original.width):\(original.height)"
            if !onMonitor(original, monitor) {
                if records[key] == nil { records[key] = ["title": title, "originalFrame": dictionary(original)] }
                guard original.width <= monitor.width, original.height <= monitor.height else {
                    throw LaunchFailure(message: "Premiere's window cannot fit S-Space without resizing. It remains hidden.")
                }
                var point = CGPoint(x: monitor.minX + min(40, monitor.width - original.width),
                                    y: monitor.minY + min(40, monitor.height - original.height))
                guard let value = AXValueCreate(.cgPoint, &point),
                      AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, value) == .success,
                      let actual = frame(window), onMonitor(actual, monitor) else {
                    _ = app.hide()
                    throw LaunchFailure(message: "Premiere refused hidden placement on S-Space. It remains hidden; no main-display window was revealed.")
                }
                records[key]?["placedFrame"] = dictionary(actual)
            }
            if title.contains(project.lastPathComponent) { projectFrame = frame(window) }
        }
        if projectFrame != nil && !windows.isEmpty && windows.allSatisfy({ frame($0).map { $0.width < 100 || $0.height < 80 || onMonitor($0, monitor) } ?? false }) {
            // Explicit preparation must own the exact hidden windows before
            // reveal, or normal S-Space routing could return them to main.
            let inventory = visibleNormalWindows(pid: pid, visibleOnly: false)
            let claims = Set((try sspace(["status"])["routingClaimedWindowIDs"] as? [Int]) ?? [])
            let axFrames = windows.compactMap(frame).filter { $0.width >= 100 && $0.height >= 80 }
            let matches = axFrames.map { expected in
                inventory.filter { row in
                    guard let actual = windowFrame(row) else { return false }
                    return abs(actual.minX-expected.minX) <= 1 && abs(actual.minY-expected.minY) <= 1 && abs(actual.width-expected.width) <= 1 && abs(actual.height-expected.height) <= 1
                }
            }
            if !matches.isEmpty && matches.allSatisfy({ $0.count == 1 && claims.contains(($0[0][kCGWindowNumber as String] as? Int) ?? -1) }) {
                placementReady = true; break
            }
        }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    // Premiere's "Open Project" progress dialog flashes on the main display and
    // is not exposed to Accessibility, so it cannot be moved. Only windows that
    // are still on the main display at reveal time count as a failure.
    let stillOnMain = visibleNormalWindows(pid: pid, visibleOnly: false).filter { row in
        guard let id = row[kCGWindowNumber as String] as? UInt32, physicalWindows.contains(id), let actual = windowFrame(row) else { return false }
        return !onMonitor(actual, monitor)
    }
    guard placementReady, !app.isTerminated, NSWorkspace.shared.frontmostApplication?.processIdentifier != pid, stillOnMain.isEmpty else {
        _ = app.hide()
        try publish(["ok": false, "pid": pid, "placementReady": placementReady, "focusTaken": focusTaken,
                     "mainDisplayWindowIDsObserved": Array(physicalWindows), "placements": Array(records.values),
                     "adobeRequestedFocusDuringStartup": focusTaken, "frontmostPIDBefore": frontmostBefore, "frontmostPIDAfter": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0], receipt: receipt)
        throw LaunchFailure(message: "Premiere did not complete an isolated hidden launch (placement, registration, or focus verification failed). It remains hidden.")
    }
    startupObserver.cancel()
    // AppKit can report false although Adobe has already revealed the window.
    // Verify actual visibility and focus below instead of trusting that return.
    _ = app.unhide()
    var revealedProject = false
    for _ in 0..<10 {
        let visible = visibleNormalWindows(pid: pid)
        if visible.contains(where: { windowFrame($0).map { !onMonitor($0, monitor) } ?? true }) || NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
            _ = app.hide()
            throw LaunchFailure(message: "Premiere moved off S-Space or took focus during reveal. It was hidden again.")
        }
        revealedProject = visible.contains { row in
            guard let actual = windowFrame(row), let expected = projectFrame else { return false }
            return abs(actual.minX-expected.minX) <= 1 && abs(actual.minY-expected.minY) <= 1 && abs(actual.width-expected.width) <= 1 && abs(actual.height-expected.height) <= 1
        }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    guard revealedProject, !app.isHidden, !app.isTerminated else {
        _ = app.hide(); throw LaunchFailure(message: "The placed Premiere project did not become visible. It remains hidden.")
    }
    try publish(["ok": true, "pid": Int(pid), "projectPath": project.path,
                 "launchHidden": true, "mainDisplayWindowsObserved": physicalWindows.count,
                 "adobeRequestedFocusDuringStartup": focusTaken,
                 "frontmostPIDBefore": Int(frontmostBefore),
                 "frontmostPIDAfter": Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0),
                 "monitor": dictionary(monitor), "placements": Array(records.values),
                 "visibleWindows": visibleNormalWindows(pid: pid).compactMap { row -> [String: Any]? in
                     guard let actual = windowFrame(row) else { return nil }
                     return ["id": row[kCGWindowNumber as String] ?? 0, "frame": dictionary(actual), "onSSpace": onMonitor(actual, monitor)]
                 }], receipt: receipt)
}
Task { @MainActor in
    do { try await run(); exit(0) }
    catch { fputs((error.localizedDescription + "\n"), stderr); exit(1) }
}
RunLoop.main.run()
