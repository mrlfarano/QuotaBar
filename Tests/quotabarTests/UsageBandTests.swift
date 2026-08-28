import XCTest
@testable import quotabar

// Color banding on quota REMAINING (battery metaphor) — the thresholds live
// in UsageBand.of(remainingPct:) and feed both the status glyph and the menu.

final class UsageBandTests: XCTestCase {

    func testBandBoundaries() {
        XCTAssertEqual(UsageBand.of(remainingPct: 100), .green)
        XCTAssertEqual(UsageBand.of(remainingPct: 76), .green)   // ≥76 green
        XCTAssertEqual(UsageBand.of(remainingPct: 75.4), .yellow)
        XCTAssertEqual(UsageBand.of(remainingPct: 50), .yellow)
        XCTAssertEqual(UsageBand.of(remainingPct: 26), .yellow)  // ≥26 yellow
        XCTAssertEqual(UsageBand.of(remainingPct: 25.4), .red)
        XCTAssertEqual(UsageBand.of(remainingPct: 25), .red)     // ≤25 red
        XCTAssertEqual(UsageBand.of(remainingPct: 0), .red)
    }

    func testBandClampsOutOfRangeInput() {
        XCTAssertEqual(UsageBand.of(remainingPct: -10), .red)
        XCTAssertEqual(UsageBand.of(remainingPct: 150), .green)
    }

    func testGaugeRemainingPctAndBand() {
        var gauge = Gauge(id: "fiveHour", label: "5-hour window", pct: 41)
        XCTAssertEqual(gauge.remainingPct, 59, accuracy: 0.001)
        XCTAssertEqual(gauge.band, .yellow)

        gauge.pct = 0
        XCTAssertEqual(gauge.remainingPct, 100)
        XCTAssertEqual(gauge.band, .green)

        // Over-100 usage pins remaining at 0 (red), never negative.
        gauge.pct = 120
        XCTAssertEqual(gauge.remainingPct, 0)
        XCTAssertEqual(gauge.band, .red)
    }
}
