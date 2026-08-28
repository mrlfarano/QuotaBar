import XCTest
@testable import quotabar

// Pinned Z.AI contract parsing plus the tolerant leaf conversions that
// custom sources share (QuotaResponseParser.number / .date), and the
// keyword-based adaptive fallback (QuotaParser).

final class QuotaResponseParserTests: XCTestCase {

    // MARK: number(_:)

    func testNumberConversions() {
        XCTAssertEqual(QuotaResponseParser.number(41.5), 41.5)
        XCTAssertEqual(QuotaResponseParser.number(3), 3)
        XCTAssertEqual(QuotaResponseParser.number("42"), 42)
        XCTAssertEqual(QuotaResponseParser.number("37.5%"), 37.5)  // dashboard-style strings
        XCTAssertNil(QuotaResponseParser.number("abc"))
        XCTAssertNil(QuotaResponseParser.number(nil))
    }

    func testNumberRejectsRealBooleansButKeepsNumericOne() {
        // JSON true/false must not become 1/0 (see the CFBoolean note in
        // number()), while JSON 1 stays a legitimate percentage value.
        XCTAssertNil(QuotaResponseParser.number(true))
        XCTAssertNil(QuotaResponseParser.number(false))
        XCTAssertEqual(QuotaResponseParser.number(1), 1)
    }

    // MARK: date(_:)

    func testDateEpochSecondsAndMilliseconds() throws {
        XCTAssertEqual(try XCTUnwrap(QuotaResponseParser.date(1_787_862_451)),
                       Date(timeIntervalSince1970: 1_787_862_451))
        XCTAssertEqual(try XCTUnwrap(QuotaResponseParser.date(1_788_719_742_998))
                           .timeIntervalSince1970,
                       1_788_719_742.998,
                       accuracy: 0.001)
        // Below epoch-s range is a nonsensical timestamp, not a date.
        XCTAssertNil(QuotaResponseParser.date(123))
    }

    func testDateISO8601WithAndWithoutFractionalSeconds() throws {
        func utc(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

        XCTAssertEqual(try XCTUnwrap(QuotaResponseParser.date("2026-08-27T12:00:00Z")),
                       utc("2026-08-27T12:00:00Z"))

        let fractional = try XCTUnwrap(QuotaResponseParser.date("2026-08-27T12:00:00.500Z"))
        XCTAssertEqual(fractional.timeIntervalSince(utc("2026-08-27T12:00:00Z")),
                       0.5, accuracy: 0.001)

        XCTAssertNil(QuotaResponseParser.date("not a date"))
        XCTAssertNil(QuotaResponseParser.date(""))
    }

    // MARK: pinned contract

    private func pinnedFixture(percentage: Double = 41) -> [String: Any] {
        [
            "code": 200, "success": true,
            "data": [
                "level": "max",
                "limits": [
                    ["type": "TIME_LIMIT", "unit": 3, "percentage": percentage,
                     "currentValue": 49_200, "usage": 120_000,
                     "nextResetTime": 1_787_862_451_000],
                    ["type": "TIME_LIMIT", "unit": 6, "percentage": 14,
                     "currentValue": 8_400, "usage": 60_000,
                     "nextResetTime": "2026-09-01T00:00:00Z"],
                    ["type": "TIME_LIMIT", "unit": 5, "percentage": 3,
                     "currentValue": 139, "usage": 4_000,
                     "usageDetails": [["modelCode": "GLM-4.7", "usage": 139]],
                     "nextResetTime": 1_788_719_742_998],
                ] as [[String: Any]],
            ] as [String: Any],
        ]
    }

    func testPinnedGaugesParseInDisplayOrder() {
        let gauges = QuotaResponseParser.gauges(from: pinnedFixture())
        XCTAssertEqual(gauges.map(\.id), ["fiveHour", "week", "mcp"])
        XCTAssertEqual(gauges[0].pct, 41)
        XCTAssertEqual(gauges[0].used, 49_200)
        XCTAssertEqual(gauges[0].total, 120_000)
        XCTAssertEqual(gauges[0].resetAt, Date(timeIntervalSince1970: 1_787_862_451))
        XCTAssertEqual(gauges[1].label, "Weekly limit")
        // ISO8601 reset strings parse through the same date() path.
        XCTAssertEqual(gauges[1].resetAt,
                       ISO8601DateFormatter().date(from: "2026-09-01T00:00:00Z"))
    }

    func testPinnedGaugesClampAndCarryDetails() {
        let gauges = QuotaResponseParser.gauges(from: pinnedFixture(percentage: 120))
        XCTAssertEqual(gauges[0].pct, 100, "percentage > 100 must clamp, not invert the ring")
        XCTAssertEqual(gauges[2].details?.first?.modelCode, "GLM-4.7")
        XCTAssertEqual(gauges[2].details?.first?.usage, 139)
    }

    func testPlanLevel() {
        XCTAssertEqual(QuotaResponseParser.planLevel(from: pinnedFixture()), "max")
        XCTAssertNil(QuotaResponseParser.planLevel(from: [:]))
    }

    // MARK: adaptive fallback

    func testAdaptiveFallbackParsesKeywordPayloads() {
        // payload_b shape: fractional ratios normalize to percents, keyword
        // scoring picks one gauge per window.
        let payloadB: [String: Any] = [
            "success": true,
            "data": ["quota": ["fiveHourWindow": ["used_ratio": 0.37],
                               "week": ["usedRatio": 0.52]]] as [String: Any],
        ]
        let gauges = QuotaResponseParser.gauges(from: payloadB)
        XCTAssertEqual(gauges.map(\.id), ["fiveHour", "week"])
        XCTAssertEqual(gauges[0].pct, 37, accuracy: 0.001)
        XCTAssertEqual(gauges[1].pct, 52, accuracy: 0.001)
    }
}
