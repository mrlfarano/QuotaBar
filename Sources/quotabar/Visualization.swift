import AppKit

// MARK: - Color banding
//
// Traffic-light semantics on the quota REMAINING (battery metaphor):
//   remaining ≥ 76%  → green   (plenty left, i.e. ≤24% used)
//   remaining 26–75% → yellow
//   remaining ≤ 25%  → red     (nearly exhausted)

enum UsageBand {
    case green, yellow, red

    static func of(remainingPct: Double) -> UsageBand {
        let rounded = min(max(remainingPct, 0), 100).rounded()
        if rounded >= 76 { return .green }
        if rounded >= 26 { return .yellow }
        return .red
    }

    var color: NSColor {
        switch self {
        case .green: return .systemGreen
        case .yellow: return .systemYellow
        case .red: return .systemRed
        }
    }
}

extension Gauge {
    var remainingPct: Double { min(max(100 - pct, 0), 100) }
    var band: UsageBand { UsageBand.of(remainingPct: remainingPct) }
}

// MARK: - Text helpers

enum StatusText {
    static let base = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .regular)
    static let emphasis = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)

    static func run(_ text: String, color: NSColor,
                    font: NSFont = StatusText.base) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
    }
}

/// Compact countdown for the status bar: "2h47m" / "47m". `now` is injectable
/// so tests can assert exact text deterministically.
func shortReset(_ date: Date?, now: Date = Date()) -> String? {
    guard let date else { return nil }
    let interval = date.timeIntervalSince(now)
    guard interval > 0 else { return nil }
    let minutes = Int(interval) / 60
    if minutes >= 60 { return "\(minutes / 60)h\(String(format: "%02d", minutes % 60))m" }
    return "\(minutes)m"
}

// MARK: - Status bar glyph (B2 concentric dual ring)
//
// One 20×20 glyph: outer ring = 5-hour quota remaining, inner ring =
// weekly remaining, both band-colored and filling clockwise from 12
// o'clock. Bitmap-backed via lockFocus — drawingHandler-based images have
// proven unreliable in NSStatusBarButton.

func dualRingImage(fiveRemaining: Double?, fiveBand: UsageBand?,
                   weekRemaining: Double?, weekBand: UsageBand?) -> NSImage {
    let size: CGFloat = 20
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let center = NSPoint(x: size / 2, y: size / 2)

    // Weekly-only fallback: weekly takes the outer ring, no inner ring.
    let outerRemaining = fiveRemaining ?? weekRemaining
    let outerColor = (fiveBand ?? weekBand)?.color
    if let fraction = outerRemaining, let color = outerColor {
        strokeArc(center: center, radius: 8.25, lineWidth: 3.5,
                  fraction: fraction / 100, color: color)
    }
    if fiveRemaining != nil, let fraction = weekRemaining, let color = weekBand?.color {
        strokeArc(center: center, radius: 4.25, lineWidth: 2,
                  fraction: fraction / 100, color: color)
    }
    image.unlockFocus()
    image.isTemplate = false
    return image
}

private func strokeArc(center: NSPoint, radius: CGFloat, lineWidth: CGFloat,
                       fraction: Double, color: NSColor) {
    let track = NSBezierPath(ovalIn: NSRect(x: center.x - radius, y: center.y - radius,
                                            width: radius * 2, height: radius * 2))
    track.lineWidth = lineWidth
    NSColor.tertiaryLabelColor.setStroke()
    track.stroke()
    let clamped = min(max(fraction, 0), 1)
    if clamped > 0.01 {
        let arc = NSBezierPath()
        arc.appendArc(withCenter: center, radius: radius,
                      startAngle: 90,
                      endAngle: 90 - 360 * CGFloat(clamped),
                      clockwise: true)
        arc.lineWidth = lineWidth
        arc.lineCapStyle = .round
        color.setStroke()
        arc.stroke()
    }
}

// MARK: - Menu bars

/// Block bar for menu rows: filled runs in the band color, rest muted.
func coloredBlocks(pct: Double, band: UsageBand, width: Int = 12) -> NSAttributedString {
    let clamped = min(max(pct, 0), 100)
    let filled = Int((clamped / 100 * Double(width)).rounded())
    let font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
    let composed = NSMutableAttributedString(
        attributedString: StatusText.run(String(repeating: "█", count: filled),
                                         color: band.color, font: font))
    composed.append(StatusText.run(String(repeating: "░", count: max(width - filled, 0)),
                                   color: .tertiaryLabelColor, font: font))
    return composed
}
