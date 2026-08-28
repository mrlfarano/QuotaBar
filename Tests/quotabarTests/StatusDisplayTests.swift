import XCTest
@testable import quotabar

// What the status bar shows, decided by StatusDisplayResolver: selected
// source → healthy fallback → short error → cached warm start → idle.
// The two regression tests pin the critique bugs: an errored selection (or
// a z.ai auth failure) must fall through to a healthy provider instead of
// replacing the rings with a warning.

final class StatusDisplayTests: XCTestCase {

    private func gauge(_ id: String, pct: Double = 50) -> Gauge {
        Gauge(id: id, label: id, pct: pct)
    }

    private func section(_ id: String, gauges: [Gauge] = [],
                         error: String? = nil) -> SourceSection {
        SourceSection(id: id, title: id, gauges: gauges, errorMessage: error)
    }

    private func zaiSnapshot(gauges: [Gauge] = [], error: String? = nil) -> Snapshot {
        Snapshot(fetchedAt: Date(), rawJSON: "", gauges: gauges,
                 errorMessage: error, usedScheme: "")
    }

    // MARK: happy paths

    func testMainSourceHealthyWins() {
        let zai = section("zai", gauges: [gauge("fiveHour")])
        let claude = section("claude", gauges: [gauge("claude-5h")])
        let result = StatusDisplayResolver.resolve(sections: [zai, claude],
                                                   zaiSnapshot: zaiSnapshot(gauges: [gauge("fiveHour")]),
                                                   mainSource: "claude")
        XCTAssertEqual(result, .gauges([gauge("claude-5h")]))
    }

    func testDefaultsToZaiWhenNoMainSource() {
        let result = StatusDisplayResolver.resolve(
            sections: [section("github", gauges: [gauge("gh-core")]),
                       section("zai", gauges: [gauge("fiveHour")])],
            zaiSnapshot: zaiSnapshot(), mainSource: nil)
        XCTAssertEqual(result, .gauges([gauge("fiveHour")]))
    }

    // MARK: the regression tests (critique bugs 1 and 2)

    func testErroredMainSourceFallsBackToHealthySection() {
        let erroredClaude = section("claude", error: "run `claude` once to re-authenticate")
        let healthyGithub = section("github", gauges: [gauge("gh-core")])
        let result = StatusDisplayResolver.resolve(sections: [erroredClaude, healthyGithub],
                                                   zaiSnapshot: nil, mainSource: "claude")
        XCTAssertEqual(result, .gauges([gauge("gh-core")]),
                       "an errored selection must not hijack the bar")
    }

    func testZaiAuthErrorYieldsToHealthySection() {
        let healthyClaude = section("claude", gauges: [gauge("claude-5h")])
        let result = StatusDisplayResolver.resolve(sections: [healthyClaude],
                                                   zaiSnapshot: zaiSnapshot(error: "No token — paste it in the menu's key fields"),
                                                   mainSource: nil)
        XCTAssertEqual(result, .gauges([gauge("claude-5h")]),
                       "a missing z.ai token must not hijack the bar for other users")
    }

    // MARK: error wording

    func testNothingHealthySurfacesMainSourceError() {
        let result = StatusDisplayResolver.resolve(
            sections: [section("claude", error: "Network error: offline"),
                       section("zai", error: "HTTP 503")],
            zaiSnapshot: zaiSnapshot(error: "HTTP 503"), mainSource: "claude")
        XCTAssertEqual(result, .error(text: "⚠︎ claude"))
    }

    func testNothingHealthyFallsBackToZaiSnapshotError() {
        let result = StatusDisplayResolver.resolve(
            sections: [], zaiSnapshot: zaiSnapshot(error: "No token — paste it"), mainSource: nil)
        XCTAssertEqual(result, .error(text: "⚠︎ z.ai auth"))
    }

    func testZaiErrorWordingPreservedForAuthAndGeneric() {
        XCTAssertEqual(StatusDisplayResolver.errorText(id: "zai", message: "No token — paste it in the menu's key fields"),
                       "⚠︎ z.ai auth")
        XCTAssertEqual(StatusDisplayResolver.errorText(id: "zai", message: "Unauthorized — token rejected"),
                       "⚠︎ z.ai auth")
        XCTAssertEqual(StatusDisplayResolver.errorText(id: "zai", message: "HTTP 503 from api.z.ai"),
                       "⚠︎ z.ai")
        XCTAssertEqual(StatusDisplayResolver.errorText(id: "codex", message: "HTTP 429"),
                       "⚠︎ codex")
    }

    // MARK: warm start / idle / no data

    func testCachedZaiSnapshotWarmStartsBeforeFirstFetch() {
        let cached = [gauge("fiveHour"), gauge("week")]
        let result = StatusDisplayResolver.resolve(sections: [],
                                                   zaiSnapshot: zaiSnapshot(gauges: cached),
                                                   mainSource: nil)
        XCTAssertEqual(result, .gauges(cached))
    }

    func testIdleWhenNothingExistsYet() {
        let result = StatusDisplayResolver.resolve(sections: [], zaiSnapshot: nil, mainSource: nil)
        XCTAssertEqual(result, .idle(text: "quotabar…"))
    }

    func testNoDataWhenSectionsExistButAllEmpty() {
        let result = StatusDisplayResolver.resolve(
            sections: [section("copilot"), section("github")],
            zaiSnapshot: nil, mainSource: nil)
        XCTAssertEqual(result, .error(text: "⚠︎ no data"))
    }
}

// MARK: - refresh coalescing

final class RefreshCoordinatorTests: XCTestCase {

    func testSingleCycleBeginEnd() {
        let coordinator = RefreshCoordinator()
        XCTAssertTrue(coordinator.begin(), "first request runs")
        XCTAssertFalse(coordinator.end(), "clean cycle end reports no re-run")
        XCTAssertTrue(coordinator.begin())
    }

    func testRequestDuringFlightReRuns() {
        let coordinator = RefreshCoordinator()
        XCTAssertTrue(coordinator.begin())
        XCTAssertFalse(coordinator.begin(), "arrives mid-flight → pending")
        XCTAssertTrue(coordinator.end(), "cycle end reports the pending re-run")
        XCTAssertFalse(coordinator.end(), "end is idempotent outside a cycle")
        XCTAssertFalse(coordinator.running)
    }

    func testReRunCycleCanAlsoAccumulate() {
        let coordinator = RefreshCoordinator()
        _ = coordinator.begin()
        _ = coordinator.begin()
        XCTAssertTrue(coordinator.end())
        XCTAssertTrue(coordinator.begin(), "re-run starts normally")
        XCTAssertFalse(coordinator.end())
    }
}
