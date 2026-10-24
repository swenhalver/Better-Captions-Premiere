#!/usr/bin/env swift
// Put Premiere's panels back to Swen's saved workspace layout by pressing
// Window › Workspaces › Reset to Saved Layout. Relaunches (and moving the
// window between displays) redistribute panel sizes and squeeze S-Captions;
// the saved workspace holds the proportions Swen wants.
//
//   swift scripts/reset-premiere-layout.swift            # reset
//   swift scripts/reset-premiere-layout.swift --dry-run  # only report whether the item is there
import AppKit
import ApplicationServices

let bundleID = "com.adobe.PremierePro.26"
let dryRun = CommandLine.arguments.contains("--dry-run")
func fail(_ message: String) -> Never { fputs(message + "\n", stderr); exit(1) }

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else { fail("Premiere is not running.") }
let axApp = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(axApp, 3)

func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success ? result : nil
}
func children(_ element: AXUIElement) -> [AXUIElement] { value(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func title(_ element: AXUIElement) -> String { value(element, kAXTitleAttribute) as? String ?? "" }
// A menu bar item or menu item holds one AXMenu whose children are the items.
func item(in parent: AXUIElement, _ matches: (String) -> Bool) -> AXUIElement? {
    children(parent).flatMap { children($0) }.first { matches(title($0)) }
}
func resetItem() -> AXUIElement? {
    guard let bar = value(axApp, kAXMenuBarAttribute).map({ $0 as! AXUIElement }),
          let window = children(bar).first(where: { title($0) == "Window" }),
          let workspaces = item(in: window, { $0.hasPrefix("Workspaces") }) else { return nil }
    return item(in: workspaces, { $0.hasPrefix("Reset to Saved Layout") })
}

// Right after launch the menu is missing or disabled until the project has opened.
for _ in 0..<90 {
    if let reset = resetItem(), value(reset, kAXEnabledAttribute) as? Bool == true {
        if dryRun { print("Found enabled: Window › Workspaces › \(title(reset))"); exit(0) }
        guard AXUIElementPerformAction(reset, kAXPressAction as CFString) == .success else { fail("Premiere refused Reset to Saved Layout.") }
        print("Reset Premiere to its saved workspace layout.")
        exit(0)
    }
    Thread.sleep(forTimeInterval: 1)
}
fail("Window › Workspaces › Reset to Saved Layout never became available.")
