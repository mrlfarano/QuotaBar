import XCTest
@testable import quotabar

// Custom-source dot-path resolution ("data.usage", "items.0.left") and the
// small formatting helpers the menu and status bar render through.

final class CustomSourcePathTests: XCTestCase {

    private let payload: [String: Any] = [
        "data": [
            "label": "default",
            "limit": 1_000,
            "usage": 400,
            "usages": [
                ["provider": "p1", "used": 250],
                ["provider": "p2", "used": "37.5%"],
            ],
        ] as [String: Any],
    ]

    func testDotPathResolvesDictKeysAndArrayIndices() {
        XCTAssertEqual(CustomSource.value(at: "data.usage", in: payload), 400)
        XCTAssertEqual(CustomSource.value(at: "data.limit", in: payload), 1_000)
        XCTAssertEqual(CustomSource.value(at: "data.usages.0.used", in: payload), 250)
        XCTAssertEqual(CustomSource.value(at: "data.usages.1.used", in: payload), 37.5,
                       "numeric-string leaves resolve through the same %/number rules")
    }

    func testDotPathMissesReturnNil() {
        XCTAssertNil(CustomSource.value(at: "data.missing", in: payload))
        XCTAssertNil(CustomSource.value(at: "data.usages.5.used", in: payload))   // out of bounds
        XCTAssertNil(CustomSource.value(at: "data.label.sub", in: payload))       // walking into a string
        XCTAssertNil(CustomSource.value(at: "", in: payload))
        XCTAssertNil(CustomSource.value(at: "data.usages.p1", in: payload))       // string index into array
    }

    // MARK: formatting helpers

    func testCompactCount() {
        XCTAssertEqual(compactCount(5), "5")
        XCTAssertEqual(compactCount(999), "999")
        XCTAssertEqual(compactCount(42_000), "42.0k")
        XCTAssertEqual(compactCount(1_500_000), "1.5M")
    }

    func testShortResetAndResetText() {
        let now = Date(timeIntervalSince1970: 1_787_862_451)
        XCTAssertNil(shortReset(nil))
        XCTAssertNil(shortReset(now.addingTimeInterval(-60), now: now),
                     "past resets hide from the status bar")
        XCTAssertEqual(shortReset(now.addingTimeInterval(47 * 60), now: now), "47m")
        XCTAssertEqual(shortReset(now.addingTimeInterval(2 * 3600 + 47 * 60), now: now), "2h47m")

        XCTAssertEqual(resetText(now.addingTimeInterval(-1), now: now), "Reset time reached")
        XCTAssertEqual(resetText(now.addingTimeInterval(2 * 3600 + 47 * 60), now: now),
                       "Resets in 2h 47m")
        XCTAssertEqual(resetText(now.addingTimeInterval(5 * 60), now: now), "Resets in 5m")
        XCTAssertNil(resetText(nil))
    }

    func testPadToWidth() {
        XCTAssertEqual("zai".pad(toWidth: 13), "zai          ")
        XCTAssertEqual("five-hour-window".pad(toWidth: 13), "five-hour-window")
    }
}
