import XCTest
@testable import quotabar

// Pure logic behind the inline settings rows in the menu dropdown:
// poll-cadence clamping, per-source enable toggles (with credential
// preservation), masked key entry, and the version label.

final class SettingsTests: XCTestCase {

    // MARK: poll cadence

    func testNormalizedPollMinutes() {
        XCTAssertEqual(normalizedPollMinutes(5), 5)
        XCTAssertEqual(normalizedPollMinutes(0), 1)
        XCTAssertEqual(normalizedPollMinutes(-7), 1)
        XCTAssertEqual(normalizedPollMinutes(999), 60)
    }

    // MARK: masked keys

    func testMaskedKeyKeepsOnlyLastFiveCharacters() {
        XCTAssertEqual(SettingsLogic.maskedKey("sk-or-v1-0123456789abcdefghij"),
                       "********fghij")
        XCTAssertEqual(SettingsLogic.maskedKey("1234567890"), "********67890")
    }

    func testMaskedKeyShortKeysStayAllStars() {
        XCTAssertEqual(SettingsLogic.maskedKey(""), "")
        XCTAssertEqual(SettingsLogic.maskedKey("abc"), "***")
        XCTAssertEqual(SettingsLogic.maskedKey("abcde"), "*****",
                       "exactly five characters: nothing readable")
        XCTAssertEqual(SettingsLogic.maskedKey("  ab  "), "**",
                       "whitespace is trimmed before masking")
    }

    func testMaskedKeyFixedLengthDoesNotLeakKeyLength() {
        XCTAssertEqual(SettingsLogic.maskedKey("abcdefghijklmn"), "********jklmn")
        XCTAssertEqual(SettingsLogic.maskedKey("abcdefghijklmnopqrstuvwxyz012345"),
                       "********12345",
                       "a 32-char key and a 14-char key both show exactly 8 stars + last 5")
    }

    // MARK: key fields

    func testSetKeyRoundTrip() {
        var config = QuotaBarConfig()
        config.authScheme = "Bearer "
        config = SettingsLogic.setKey(config, id: "zai", key: "z1")
        XCTAssertEqual(SettingsLogic.keyValue(config, id: "zai"), "z1")
        XCTAssertEqual(config.zaiToken, "z1")
        XCTAssertNil(config.authScheme, "changing the Z.AI key must re-probe header styles")
        XCTAssertEqual(SettingsLogic.maskedKey(config.zaiToken),
                       SettingsLogic.maskedKey("z1"))

        config = SettingsLogic.setKey(config, id: "github", key: "gh1")
        config = SettingsLogic.setKey(config, id: "openrouter", key: "or1")
        XCTAssertEqual(SettingsLogic.keyValue(config, id: "github"), "gh1")
        XCTAssertEqual(SettingsLogic.keyValue(config, id: "openrouter"), "or1")
        XCTAssertEqual(config.zaiToken, "z1", "one field must not disturb the others")
    }

    func testSetKeyCreatesSourceStructOnDemand() {
        let config = QuotaBarConfig() // sources nil
        let updated = SettingsLogic.setKey(config, id: "github", key: "gh1")
        XCTAssertEqual(updated.sources?.github?.token, "gh1")
        XCTAssertTrue(SettingsLogic.isSourceEnabled(updated, id: "github"),
                      "pasting a key into a fresh struct keeps its enabled-by-default state")

        let openrouter = SettingsLogic.setKey(config, id: "openrouter", key: "or1")
        XCTAssertEqual(openrouter.sources?.openrouter?.token, "or1")
        XCTAssertTrue(SettingsLogic.isSourceEnabled(openrouter, id: "openrouter"),
                      "a fresh struct enables the source — pasting a key reads as intent to use it")
    }

    func testSetKeyPreservesExistingSourceState() {
        var config = QuotaBarConfig()
        config.sources = SourcesConfig()
        config.sources?.github = GitHubSourceConfig(enabled: false, token: "", discovered: true)
        config.sources?.openrouter = OAuthSourceConfig(enabled: false, token: "",
                                                       refreshToken: "r0", accountId: "a0")
        config = SettingsLogic.setKey(config, id: "github", key: "gh1")
        config = SettingsLogic.setKey(config, id: "openrouter", key: "or1")

        XCTAssertFalse(SettingsLogic.isSourceEnabled(config, id: "github"),
                       "an explicit opt-out survives key entry")
        XCTAssertTrue(config.sources?.github?.discovered ?? false)
        XCTAssertFalse(SettingsLogic.isSourceEnabled(config, id: "openrouter"))
        XCTAssertEqual(config.sources?.openrouter?.refreshToken, "r0")
        XCTAssertEqual(config.sources?.openrouter?.accountId, "a0")
        XCTAssertEqual(config.sources?.openrouter?.token, "or1")
    }

    func testKeyValueUnknownFieldIsEmpty() {
        XCTAssertEqual(SettingsLogic.keyValue(QuotaBarConfig(), id: "unknown"), "")
    }

    // MARK: source enable state

    func testDefaultEnabledStatesMirrorFetchGates() {
        let config = QuotaBarConfig()
        XCTAssertTrue(SettingsLogic.isSourceEnabled(config, id: "zai"),
                      "Z.AI polls by default (token at top level, entry absent)")
        XCTAssertTrue(SettingsLogic.isSourceEnabled(config, id: "github"),
                      "GitHub polls by default")
        for id in ["claude", "codex", "openrouter", "copilot", "antigravity"] {
            XCTAssertFalse(SettingsLogic.isSourceEnabled(config, id: id),
                           "\(id) stays off until discovered or enabled")
        }
        XCTAssertFalse(SettingsLogic.isSourceEnabled(config, id: "unknown"))
    }

    // MARK: Z.AI toggle (token lives at the top level, enable state in sources)

    func testZaiTogglePreservesTopLevelToken() {
        var config = QuotaBarConfig()
        config.zaiToken = "z-secret"
        config = SettingsLogic.setSourceEnabled(config, id: "zai", enabled: false)
        XCTAssertFalse(SettingsLogic.isSourceEnabled(config, id: "zai"))
        XCTAssertEqual(config.zaiToken, "z-secret", "toggling must not touch the token")

        config = SettingsLogic.setSourceEnabled(config, id: "zai", enabled: true)
        XCTAssertTrue(SettingsLogic.isSourceEnabled(config, id: "zai"))
        XCTAssertEqual(config.zaiToken, "z-secret")
    }

    func testLegacyConfigWithoutZaiEntryDecodesEnabled() throws {
        let legacy = #"{"zaiToken":"z1","baseURL":"https://api.z.ai","pollMinutes":5,"sources":{"github":{"enabled":true,"token":""}}}"#
        let config = try JSONDecoder().decode(QuotaBarConfig.self, from: Data(legacy.utf8))
        XCTAssertNil(config.sources?.zai, "no zai key in old configs")
        XCTAssertTrue(SettingsLogic.isSourceEnabled(config, id: "zai"),
                      "absent entry means enabled — no migration needed")
    }

    func testSetKeyZaiCreatesEnabledEntryOnDemand() {
        let config = QuotaBarConfig() // sources nil
        let updated = SettingsLogic.setKey(config, id: "zai", key: "z1")
        XCTAssertEqual(updated.zaiToken, "z1")
        XCTAssertTrue(SettingsLogic.isSourceEnabled(updated, id: "zai"),
                      "pasting a key into a fresh struct keeps its enabled-by-default state")
    }

    func testSetKeyZaiKeepsExplicitOptOut() {
        var config = QuotaBarConfig()
        config.sources = SourcesConfig()
        config.sources?.zai = OAuthSourceConfig(enabled: false)
        config = SettingsLogic.setKey(config, id: "zai", key: "z1")
        XCTAssertFalse(SettingsLogic.isSourceEnabled(config, id: "zai"),
                       "an explicit opt-out survives key entry, as with the other fields")
        XCTAssertEqual(config.zaiToken, "z1")
    }

    func testTogglePreservesStoredCredentials() {
        var config = QuotaBarConfig()
        config.sources = SourcesConfig()
        config.sources?.codex = OAuthSourceConfig(token: "t0", accountId: "a1", discovered: true)

        config = SettingsLogic.setSourceEnabled(config, id: "codex", enabled: false)
        XCTAssertFalse(SettingsLogic.isSourceEnabled(config, id: "codex"))
        XCTAssertEqual(config.sources?.codex?.token, "t0")
        XCTAssertEqual(config.sources?.codex?.accountId, "a1")
        XCTAssertTrue(config.sources?.codex?.discovered ?? false)

        config = SettingsLogic.setSourceEnabled(config, id: "codex", enabled: true)
        XCTAssertTrue(SettingsLogic.isSourceEnabled(config, id: "codex"))
        XCTAssertEqual(config.sources?.codex?.token, "t0", "re-enabling must not wipe the token")
    }

    func testToggleCreatesMissingSourceStruct() {
        let config = QuotaBarConfig() // sources nil
        let toggled = SettingsLogic.setSourceEnabled(config, id: "copilot", enabled: true)
        XCTAssertTrue(SettingsLogic.isSourceEnabled(toggled, id: "copilot"))
        XCTAssertTrue(SettingsLogic.isSourceEnabled(toggled, id: "github"),
                      "toggling one source must not flip GitHub's default")
        XCTAssertFalse(SettingsLogic.isSourceEnabled(toggled, id: "claude"))
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
