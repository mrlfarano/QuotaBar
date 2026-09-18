import XCTest
@testable import quotabar

final class CodexSourceTests: XCTestCase {
    func testProWeeklyPrimaryWindow() throws {
        let fixture = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("testdata/codex-pro-weekly.json")
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let gauges = CodexSource.gauges(from: root)
        XCTAssertEqual(gauges.map(\.id), ["codex-weekly"])
        XCTAssertEqual(gauges.map(\.label), ["Weekly limit"])
        XCTAssertEqual(gauges.map(\.pct), [10])
        XCTAssertEqual(gauges.first?.resetAt, Date(timeIntervalSince1970: 1788272109))
    }

    func testDurationsOverrideWindowPositions() {
        let gauges = CodexSource.gauges(from: ["rate_limit": [
            "primary_window": ["used_percent": 0, "limit_window_seconds": "604800"],
            "secondary_window": ["used_percent": 25, "limit_window_seconds": 18000]
        ]])
        XCTAssertEqual(gauges.map(\.id), ["codex-weekly", "codex-5h"])
        XCTAssertEqual(gauges.map(\.pct), [0, 25])
    }

    func testLegacyWindowsWithoutDurationKeepLabels() {
        let gauges = CodexSource.gauges(from: ["rate_limit": [
            "primary_window": ["used_percent": 0],
            "secondary_window": ["used_percent": 36]
        ]])
        XCTAssertEqual(gauges.map(\.id), ["codex-5h", "codex-weekly"])
    }
}
