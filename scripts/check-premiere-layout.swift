#!/usr/bin/env swift
// Read-only screenshot guard. This never connects to Premiere or sends UI events.
// Usage: swift scripts/check-premiere-layout.swift IMAGE [--window-width N --window-height N] [--pixels-per-point N]
import Foundation
import CoreGraphics
import ImageIO

func finish(_ result: [String: Any], code: Int32) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    exit(code)
}
var args = Array(CommandLine.arguments.dropFirst())
guard let path = args.first, !path.hasPrefix("--") else {
    finish(["pass": false, "errors": ["Usage: check-premiere-layout.swift IMAGE [--window-width N --window-height N] [--pixels-per-point N]"]], code: 2)
}
args.removeFirst()
var expectedWidth: Double?, expectedHeight: Double?
var expectedScale = 1.0
while !args.isEmpty {
    let key = args.removeFirst()
    guard !args.isEmpty, let value = Double(args.removeFirst()), value.isFinite, value > 0 else {
        finish(["pass": false, "errors": ["Each window dimension must be a positive finite number."]], code: 2)
    }
    switch key {
    case "--window-width": expectedWidth = value
    case "--window-height": expectedHeight = value
    case "--pixels-per-point": expectedScale = value
    default: finish(["pass": false, "errors": ["Unknown option: \(key)"]], code: 2)
    }
}
guard (expectedWidth == nil) == (expectedHeight == nil) else {
    finish(["pass": false, "errors": ["Provide both --window-width and --window-height."]], code: 2)
}
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    finish(["pass": false, "errors": ["Cannot decode screenshot: \(path)"]], code: 2)
}
let width = image.width, height = image.height
guard width >= 400, height >= 250 else {
    finish(["pass": false, "rawImage": ["width": width, "height": height],
            "errors": ["Screenshot is too small to measure dock separators reliably."]], code: 2)
}
var pixels = [UInt8](repeating: 0, count: width * height * 4)
let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
    guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return true
}
guard rendered else {
    finish(["pass": false, "errors": ["Cannot allocate screenshot pixel buffer."]], code: 2)
}
func light(_ x: Int, _ y: Int) -> Double {
    let i = (y * width + x) * 4
    return Double(pixels[i]) * 0.2126 + Double(pixels[i + 1]) * 0.7152 + Double(pixels[i + 2]) * 0.0722
}
// CUA app shots can contain a large white canvas. Derive the real content box;
// never assume image width is window width or use it as a click coordinate scale.
var minX = width, minY = height, maxX = -1, maxY = -1
for y in 0..<height {
    for x in 0..<width {
        let i = (y * width + x) * 4
        if pixels[i + 3] > 16 && min(pixels[i], min(pixels[i + 1], pixels[i + 2])) < 235 {
            minX = min(minX, x); minY = min(minY, y); maxX = max(maxX, x); maxY = max(maxY, y)
        }
    }
}
guard maxX >= minX, maxY >= minY else {
    finish(["pass": false, "rawImage": ["width": width, "height": height],
            "errors": ["Screenshot contains no non-white application content."]], code: 1)
}
let contentWidth = maxX - minX + 1, contentHeight = maxY - minY + 1
var errors = [String]()
var caveats = ["Do not use image or content coordinates for UI input until the actual Computer Use input mapping is independently calibrated."]
let padded = contentWidth != width || contentHeight != height || minX != 0 || minY != 0
if padded {
    caveats.append("Raw image includes white padding. Coordinates must use contentBounds and a verified window mapping; raw image width is not window width.")
}
var mapping: [String: Any] = ["verified": false, "scope": "screenshot-content-to-window-bounds-only", "inputCoordinatesVerified": false]
if let expectedWidth, let expectedHeight {
    let sx = Double(contentWidth) / expectedWidth, sy = Double(contentHeight) / expectedHeight
    let mappingError = max(abs(sx - expectedScale), abs(sy - expectedScale)) / expectedScale
    mapping = ["verified": mappingError <= 0.015, "windowWidth": expectedWidth, "windowHeight": expectedHeight,
               "scope": "screenshot-content-to-window-bounds-only", "inputCoordinatesVerified": false,
               "pixelsPerWindowPointX": sx, "pixelsPerWindowPointY": sy,
               "expectedPixelsPerWindowPoint": expectedScale,
               "rawToContentWidthRatio": Double(width) / Double(contentWidth)]
    if mappingError > 0.015 {
        errors.append("Detected content bounds do not match supplied window dimensions at the expected pixel scale; coordinate mapping is unsafe. Use actual content bounds, not padded raw-image dimensions.")
    }
} else {
    caveats.append("No window metadata supplied. This validates image proportions only and cannot establish screen coordinates or screenshot freshness.")
}
let sampleStartY = minY + Int(Double(contentHeight) * 0.15)
let sampleEndY = minY + Int(Double(contentHeight) * 0.44)
let gap = max(2, Int(Double(contentWidth) * 0.002))
var columns = [Double](repeating: 0, count: contentWidth)
for x in 0..<contentWidth {
    for y in sampleStartY..<sampleEndY { columns[x] += light(minX + x, y) }
    columns[x] /= Double(max(1, sampleEndY - sampleStartY))
}
struct Separator {
    let x: Int
    let contrast: Double
    let continuity: Double
    var json: [String: Any] { ["x": x, "contrast": contrast, "continuity": continuity] }
}
func separator(from lower: Double, to upper: Double) -> Separator? {
    var best: Separator?
    for x in Int(Double(contentWidth) * lower)...Int(Double(contentWidth) * upper) {
        guard x >= gap, x + gap < contentWidth else { continue }
        let contrast = min(columns[x - gap], columns[x + gap]) - columns[x]
        guard contrast >= 3 else { continue }
        var consistent = 0
        for y in stride(from: sampleStartY, to: sampleEndY, by: 2) {
            let neighbor = min(light(minX + x - gap, y), light(minX + x + gap, y))
            if neighbor - light(minX + x, y) >= 3 { consistent += 1 }
        }
        let continuity = Double(consistent) / Double(max(1, (sampleEndY - sampleStartY + 1) / 2))
        guard continuity >= 0.80 else { continue }
        let candidate = Separator(x: x, contrast: contrast, continuity: continuity)
        if best == nil || candidate.contrast > best!.contrast { best = candidate }
    }
    return best
}
let left = separator(from: 0.08, to: 0.48), right = separator(from: 0.60, to: 0.92)
var measured: [String: Any] = [:], separators: [String: Any] = [:]
if let left {
    separators["left"] = left.json
    let ratio = Double(left.x) / Double(contentWidth)
    measured["leftPane"] = ratio
    if !(0.28...0.35).contains(ratio) { errors.append("Left pane is \(String(format: "%.1f", ratio * 100))%; expected 28–35% (target 31%).") }
}
else { errors.append("No continuous left/program dock separator found.") }
if let right {
    separators["programRight"] = right.json
    let ratio = Double(right.x) / Double(contentWidth)
    measured["rightPane"] = 1 - ratio
    if !(0.745...0.805).contains(ratio) { errors.append("Program/right boundary is \(String(format: "%.1f", ratio * 100))%; expected 74.5–80.5% (target 77.5%).") }
}
else { errors.append("No continuous program/right dock separator found.") }
if let left, let right {
    let leftRatio = Double(left.x) / Double(contentWidth), rightRatio = Double(right.x) / Double(contentWidth)
    measured["programPane"] = rightRatio - leftRatio
    // The row divider crosses both the left dock and Program Monitor. Ignore
    // the right accordion column, which intentionally spans the whole window.
    let rowStartX = minX + Int(Double(contentWidth) * 0.02)
    let rowEndX = minX + right.x - gap
    var rows = [Double](repeating: 0, count: contentHeight)
    for y in 0..<contentHeight {
        for x in stride(from: rowStartX, to: rowEndX, by: 2) { rows[y] += light(x, minY + y) }
        rows[y] /= Double(max(1, (rowEndX - rowStartX + 1) / 2))
    }
    var bestY: Int?, bestContrast = 0.0
    let rowGap = max(2, Int(Double(contentHeight) * 0.004))
    for y in Int(Double(contentHeight) * 0.35)...Int(Double(contentHeight) * 0.90) {
        guard y >= rowGap, y + rowGap < contentHeight else { continue }
        let contrast = min(rows[y - rowGap], rows[y + rowGap]) - rows[y]
        if contrast > bestContrast { bestContrast = contrast; bestY = y }
    }
    if let bestY, bestContrast >= 3 {
        let ratio = Double(bestY) / Double(contentHeight)
        measured["topRowHeight"] = ratio
        separators["topRowBottom"] = ["y": bestY, "contrast": bestContrast]
        if !(0.43...0.60).contains(ratio) { errors.append("Top row is \(String(format: "%.1f", ratio * 100))% of content height; expected 43–60% (about half).") }
    } else { errors.append("No horizontal top-row/timeline divider found.") }
}
finish(["pass": errors.isEmpty, "image": path, "rawImage": ["width": width, "height": height],
        "contentBounds": ["x": minX, "y": minY, "width": contentWidth, "height": contentHeight],
        "whitePaddingDetected": padded, "measuredRatios": measured, "separators": separators,
        "coordinateMapping": mapping, "coordinateCaveats": caveats, "errors": errors,
        "verificationScope": "Image geometry only. Future acceptance also requires named evidence after real focus/tab round trips and a final post-release capture."],
       code: errors.isEmpty ? 0 : 1)
