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

/// Compact countdown for the status bar: "2h47m" / "47m".
func shortReset(_ date: Date?) -> String? {
    guard let date else { return nil }
    let interval = date.timeIntervalSinceNow
    guard interval > 0 else { return nil }
    let minutes = Int(interval) / 60
    if minutes >= 60 { return "\(minutes / 60)h\(String(format: "%02d", minutes % 60))m" }
    return "\(minutes)m"
}

// MARK: - Status bar ring

/// Filled donut arc showing the portion of quota remaining, band-colored.
/// Bitmap-backed via lockFocus — drawingHandler-based images have proven
/// unreliable in NSStatusBarButton.
func ringImage(fraction: Double, color: NSColor, diameter: CGFloat = 14) -> NSImage {
    let clamped = min(max(fraction, 0), 1)
    let image = NSImage(size: NSSize(width: diameter, height: diameter))
    image.lockFocus()
    let line: CGFloat = 3
    let inset = line / 2 + 1
    let bounds = NSRect(x: inset, y: inset,
                        width: diameter - inset * 2, height: diameter - inset * 2)
    let track = NSBezierPath(ovalIn: bounds)
    track.lineWidth = line
    NSColor.tertiaryLabelColor.setStroke()
    track.stroke()
    if clamped > 0.01 {
        let arc = NSBezierPath()
        arc.appendArc(withCenter: NSPoint(x: bounds.midX, y: bounds.midY),
                      radius: bounds.width / 2,
                      startAngle: 90,
                      endAngle: 90 - 360 * CGFloat(clamped),
                      clockwise: true)
        arc.lineWidth = line
        arc.lineCapStyle = .round
        color.setStroke()
        arc.stroke()
    }
    image.unlockFocus()
    image.isTemplate = false
    return image
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
