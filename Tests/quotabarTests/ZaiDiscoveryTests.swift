import XCTest
import Foundation
@testable import quotabar

// Z.AI token discovery: the z.ai dashboard stores its API token in browser
// localStorage under a known key. Chromium-family browsers keep localStorage
// in LevelDB (values often UTF-16LE); Firefox keeps it in SQLite with plain
// TEXT runs. The extractor must survive both encodings and record-header
// noise without ever returning garbage.

final class ZaiDiscoveryTests: XCTestCase {

    private let key = ZaiTokenDiscovery.storageKey

    private func utf16LE(_ string: String) -> Data {
        var out = Data()
        for scalar in string.unicodeScalars where scalar.value < 0x80 {
            out.append(UInt8(scalar.value))
            out.append(0)
        }
        return out
    }

    // MARK: extractor

    func testExtractsAsciiValueAfterAsciiKey() {
        let blob = Data([0x01, 0x02]) + Data(key.utf8) + Data([0x00, 0x08]) + Data("eyJhb-token-ascii-98765".utf8) + Data([0x00])
        XCTAssertEqual(ZaiTokenDiscovery.extractToken(from: blob, key: key),
                       "eyJhb-token-ascii-98765")
    }

    func testExtractsUtf16ValueAfterUtf16Key() {
        // Chrome writes DOM strings as UTF-16LE: key and value interleaved.
        let blob = utf16LE(key) + utf16LE("eyJhb-token-utf16-43210")
        XCTAssertEqual(ZaiTokenDiscovery.extractToken(from: blob, key: key),
                       "eyJhb-token-utf16-43210")
    }

    func testMissingKeyYieldsNothing() {
        let blob = Data("https://z.ai totally unrelated bytes".utf8)
        XCTAssertNil(ZaiTokenDiscovery.extractToken(from: blob, key: key))
    }

    func testShortRunIsNotAToken() {
        let blob = Data(key.utf8) + Data("\u{01}abc".utf8)
        XCTAssertNil(ZaiTokenDiscovery.extractToken(from: blob, key: key),
                     "a 3-char run is header noise, not a token")
    }

    func testNulGapsSplitRunsSoHeaderNoiseGluesNothing() {
        // token, then a NUL run (gap) followed by unrelated printable junk:
        // the extractor must not glue them into one value.
        var blob = Data(key.utf8) + Data("eyJhb-real-token-value-1".utf8)
        blob.append(contentsOf: [0x00, 0x00, 0x00])
        blob.append(Data("https://example.com/path".utf8))
        XCTAssertEqual(ZaiTokenDiscovery.extractToken(from: blob, key: key),
                       "eyJhb-real-token-value-1")
    }

    // MARK: filesystem walker (fixture tree)

    private func makeFixture() -> String {
        let root = NSTemporaryDirectory() + "quotabar-zai-fixture-\(UUID().uuidString)"
        let leveldb = root + "/Comet/Default/Local Storage/leveldb"
        try? FileManager.default.createDirectory(atPath: leveldb, withIntermediateDirectories: true)
        var blob = Data([0x00, 0x03]) + utf16LE(key) + utf16LE("eyJhb-fixture-token-abc123")
        try? blob.write(to: URL(fileURLWithPath: leveldb + "/000003.log"))
        return root
    }

    func testFindTokenScansChromiumProfiles() {
        let root = makeFixture()
        defer { try? FileManager.default.removeItem(atPath: root) }
        let found = ZaiTokenDiscovery.findToken(appSupport: root)
        XCTAssertEqual(found?.browser, "Comet")
        XCTAssertEqual(found?.token, "eyJhb-fixture-token-abc123")
    }

    func testFindTokenReturnsNilOnEmptyTree() {
        let root = NSTemporaryDirectory() + "quotabar-zai-empty-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: root) }
        XCTAssertNil(ZaiTokenDiscovery.findToken(appSupport: root))
    }

    // MARK: Claude Code bridge

    private func writeBridge(base: String, token: String) -> String {
        let path = NSTemporaryDirectory() + "quotabar-bridge-\(UUID().uuidString).json"
        let json = #"{"env":{"ANTHROPIC_BASE_URL":"\#(base)","ANTHROPIC_AUTH_TOKEN":"\#(token)"}}"#
        try? Data(json.utf8).write(to: URL(fileURLWithPath: path))
        return path
    }

    func testBridgePicksUpTokenOnlyForZaiBaseURL() {
        let zai = writeBridge(base: "https://api.z.ai/api/anthropic", token: "eyJhb-bridge-token-xyz987")
        defer { try? FileManager.default.removeItem(atPath: zai) }
        XCTAssertEqual(ZaiTokenDiscovery.claudeBridgeToken(path: zai), "eyJhb-bridge-token-xyz987")

        let anthropic = writeBridge(base: "https://api.anthropic.com", token: "sk-ant-real-anthropic-key-12345")
        defer { try? FileManager.default.removeItem(atPath: anthropic) }
        XCTAssertNil(ZaiTokenDiscovery.claudeBridgeToken(path: anthropic),
                     "a real Anthropic token must never be grabbed")
    }

    func testBridgeIgnoresShortTokens() {
        let short = writeBridge(base: "https://api.z.ai", token: "id")
        defer { try? FileManager.default.removeItem(atPath: short) }
        XCTAssertNil(ZaiTokenDiscovery.claudeBridgeToken(path: short))
    }

    // MARK: run() integration (deterministic branch)

    func testRunWithStoredZaiTokenNeverTouchesIt() {
        var config = QuotaBarConfig()
        config.zaiToken = "user-set-token-abcde"
        let outcome = SourceDiscovery.run(config: &config)
        XCTAssertEqual(config.zaiToken, "user-set-token-abcde",
                       "the never-overwrite rule covers zai too")
        XCTAssertTrue(outcome.lines.contains("zai: token already set"))
    }
}
