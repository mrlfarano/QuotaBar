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

// MARK: - Status bar battery bars
//
// Two stacked battery-style meters floating directly in the menu bar (no
// background pill): 5-hour window on top with a battery nub, weekly below,
// thinner and slightly dimmed. Fill = quota remaining, color = band.

func batteryBarsImage(fiveRemaining: Double, fiveBand: UsageBand,
                      weekRemaining: Double?, weekBand: UsageBand?) -> NSImage {
    let width: CGFloat = 42
    let fiveHeight: CGFloat = 5
    let weekHeight: CGFloat = 3
    let gap: CGFloat = 3
    let nub: CGFloat = 2
    let height = fiveHeight + gap + weekHeight
    let track = NSColor.systemGray.withAlphaComponent(0.55)

    let image = NSImage(size: NSSize(width: width + nub + 1, height: height))
    image.lockFocusFlipped(true)
    drawBattery(rect: NSRect(x: 0, y: 0, width: width, height: fiveHeight),
                remaining: fiveRemaining, color: fiveBand.color, track: track,
                nubWidth: nub, nubColor: track)
    if let weekRemaining, let weekBand {
        drawBattery(rect: NSRect(x: 0, y: fiveHeight + gap, width: width - 8, height: weekHeight),
                    remaining: weekRemaining,
                    color: weekBand.color.withAlphaComponent(0.75),
                    track: track.withAlphaComponent(0.7),
                    nubWidth: 0, nubColor: .clear)
    }
    image.unlockFocus()
    image.isTemplate = false
    return image
}

private func drawBattery(rect: NSRect, remaining: Double, color: NSColor,
                         track: NSColor, nubWidth: CGFloat, nubColor: NSColor) {
    let body = NSBezierPath(roundedRect: rect, xRadius: rect.height / 2, yRadius: rect.height / 2)
    track.setStroke()
    body.lineWidth = 1
    body.stroke()
    if nubWidth > 0 {
        let nubRect = NSRect(x: rect.maxX + 1, y: rect.midY - rect.height / 4 + 0.5,
                             width: nubWidth, height: rect.height / 2 - 1)
        nubColor.setFill()
        NSBezierPath(roundedRect: nubRect, xRadius: 1, yRadius: 1).fill()
    }
    let inset: CGFloat = 1.5
    let inner = rect.insetBy(dx: inset, dy: inset)
    let fillWidth = inner.width * CGFloat(min(max(remaining, 0), 1))
    if fillWidth > 0.5 {
        let fill = NSBezierPath(roundedRect: NSRect(x: inner.origin.x, y: inner.origin.y,
                                                    width: fillWidth, height: inner.height),
                                xRadius: inner.height / 2, yRadius: inner.height / 2)
        color.setFill()
        fill.fill()
    }
}

// MARK: - Ring drawing (shared with the popover)

/// Donut arc; adapts to the receiver's coordinate system via `flipped`.
/// Starts at the visual top, fills clockwise.
func strokeRing(in bounds: NSRect, fraction: Double, color: NSColor,
                lineWidth: CGFloat, trackColor: NSColor, flipped: Bool) {
    let clamped = min(max(fraction, 0), 1)
    let track = NSBezierPath(ovalIn: bounds)
    track.lineWidth = lineWidth
    trackColor.setStroke()
    track.stroke()
    if clamped > 0.01 {
        let arc = NSBezierPath()
        arc.appendArc(withCenter: NSPoint(x: bounds.midX, y: bounds.midY),
                      radius: bounds.width / 2,
                      startAngle: flipped ? -90 : 90,
                      endAngle: flipped ? -90 + 360 * CGFloat(clamped)
                                        : 90 - 360 * CGFloat(clamped),
                      clockwise: !flipped)
        arc.lineWidth = lineWidth
        arc.lineCapStyle = .round
        color.setStroke()
        arc.stroke()
    }
}
