import XCTest
@testable import quotabar

// Pure logic behind the Settings window: poll-cadence clamping, per-source
// enable toggles (with credential preservation), and the version label.

final class SettingsTests: XCTestCase {

    // MARK: poll cadence

    func testNormalizedPollMinutes() {
        XCTAssertEqual(normalizedPollMinutes(5), 5)
        XCTAssertEqual(normalizedPollMinutes(0), 1)
        XCTAssertEqual(normalizedPollMinutes(-7), 1)
        XCTAssertEqual(normalizedPollMinutes(999), 60)
    }

    // MARK: source enable state

    func testDefaultEnabledStatesMirrorFetchGates() {
        let config = QuotaBarConfig()
        XCTAssertTrue(SettingsWindowController.isSourceEnabled(config, id: "github"),
                      "GitHub polls by default")
        for id in ["claude", "codex", "openrouter", "copilot", "antigravity"] {
            XCTAssertFalse(SettingsWindowController.isSourceEnabled(config, id: id),
                           "\(id) stays off until discovered or enabled")
        }
        XCTAssertFalse(SettingsWindowController.isSourceEnabled(config, id: "unknown"))
    }

    func testTogglePreservesStoredCredentials() {
        var config = QuotaBarConfig()
        config.sources = SourcesConfig()
        config.sources?.codex = OAuthSourceConfig(token: "t0", accountId: "a1", discovered: true)

        config = SettingsWindowController.setSourceEnabled(config, id: "codex", enabled: false)
        XCTAssertFalse(SettingsWindowController.isSourceEnabled(config, id: "codex"))
        XCTAssertEqual(config.sources?.codex?.token, "t0")
        XCTAssertEqual(config.sources?.codex?.accountId, "a1")
        XCTAssertTrue(config.sources?.codex?.discovered ?? false)

        config = SettingsWindowController.setSourceEnabled(config, id: "codex", enabled: true)
        XCTAssertTrue(SettingsWindowController.isSourceEnabled(config, id: "codex"))
        XCTAssertEqual(config.sources?.codex?.token, "t0", "re-enabling must not wipe the token")
    }

    func testToggleCreatesMissingSourceStruct() {
        let config = QuotaBarConfig() // sources nil
        let toggled = SettingsWindowController.setSourceEnabled(config, id: "copilot", enabled: true)
        XCTAssertTrue(SettingsWindowController.isSourceEnabled(toggled, id: "copilot"))
        XCTAssertTrue(SettingsWindowController.isSourceEnabled(toggled, id: "github"),
                      "toggling one source must not flip GitHub's default")
        XCTAssertFalse(SettingsWindowController.isSourceEnabled(toggled, id: "claude"))
    }

    // MARK: version label

    func testVersionLabel() {
        XCTAssertEqual(versionLabel(from: ["CFBundleShortVersionString": "0.10.0"]),
                       "QuotaBar v0.10.0")
        XCTAssertEqual(versionLabel(from: nil), "QuotaBar (dev build)")
        XCTAssertEqual(versionLabel(from: ["CFBundleShortVersionString": ""]),
                       "QuotaBar (dev build)")
        XCTAssertEqual(versionLabel(from: ["CFBundleShortVersionString": 12]),
                       "QuotaBar (dev build)", "non-string version values fall back")
    }
}
