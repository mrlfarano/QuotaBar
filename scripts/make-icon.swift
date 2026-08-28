import AppKit

// Draws the app icon: the status bar's concentric dual-ring glyph (outer =
// 5-hour window, inner = weekly, both in the green/yellow bands) on a
// macOS-style dark rounded tile. Writes Resources/AppIcon.icns and a
// docs/icon-1024.png preview. Run via scripts/make-icon.sh from repo root.
// Same arc math as Visualization.swift's status glyph, scaled up.

let tileFraction: CGFloat = 824 / 1024   // macOS icon grid: 824pt body on 1024pt canvas
let cornerRadiusFraction: CGFloat = 185 / 1024

func drawIcon(size: CGFloat) {
    let s = size / 1024

    let inset = (1 - tileFraction) / 2 * size
    let tile = NSBezierPath(roundedRect: NSRect(x: inset, y: inset,
                                                width: size - 2 * inset, height: size - 2 * inset),
                            xRadius: cornerRadiusFraction * size,
                            yRadius: cornerRadiusFraction * size)
    NSGradient(colors: [NSColor(srgbRed: 0.17, green: 0.20, blue: 0.27, alpha: 1),
                        NSColor(srgbRed: 0.05, green: 0.07, blue: 0.11, alpha: 1)])!
        .draw(in: tile, angle: -90)
    let hairline = NSBezierPath(roundedRect: tile.bounds.insetBy(dx: 2 * s, dy: 2 * s),
                                xRadius: (cornerRadiusFraction * 1024 - 2) * s,
                                yRadius: (cornerRadiusFraction * 1024 - 2) * s)
    hairline.lineWidth = 3 * s
    NSColor.white.withAlphaComponent(0.07).setStroke()
    hairline.stroke()

    func ring(radius: CGFloat, width: CGFloat, fraction: Double, _ color: NSColor) {
        let center = NSPoint(x: size / 2, y: size / 2)
        let track = NSBezierPath(ovalIn: NSRect(x: center.x - radius, y: center.y - radius,
                                                width: radius * 2, height: radius * 2))
        track.lineWidth = width
        NSColor.white.withAlphaComponent(0.10).setStroke()
        track.stroke()
        let arc = NSBezierPath()
        arc.appendArc(withCenter: center, radius: radius, startAngle: 90,
                      endAngle: 90 - 360 * CGFloat(min(max(fraction, 0), 1)),
                      clockwise: true)
        arc.lineWidth = width
        arc.lineCapStyle = .round
        color.setStroke()
        arc.stroke()
    }

    ring(radius: 300 * s, width: 64 * s, fraction: 0.78, NSColor.systemGreen)
    ring(radius: 180 * s, width: 44 * s, fraction: 0.55, NSColor.systemYellow)
}

func renderPNG(pixels: Int, to path: String) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                               isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: pixels, height: pixels)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    drawIcon(size: CGFloat(pixels))
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

let fm = FileManager.default
let iconset = fm.temporaryDirectory.appendingPathComponent("QuotaBar.iconset")
try? fm.removeItem(at: iconset)
try! fm.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    renderPNG(pixels: base, to: iconset.appendingPathComponent("icon_\(base)x\(base).png").path)
    renderPNG(pixels: base * 2, to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png").path)
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", "Resources/AppIcon.icns"]
try! iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else {
    FileHandle.standardError.write(Data("make-icon: iconutil failed\n".utf8))
    exit(1)
}

renderPNG(pixels: 1024, to: "docs/icon-1024.png")
print("Wrote Resources/AppIcon.icns and docs/icon-1024.png")
