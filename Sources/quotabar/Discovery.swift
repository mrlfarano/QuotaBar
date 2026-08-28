import Foundation

// MARK: - Credential auto-discovery
//
// Scans well-known CLI auth locations and enables the matching sources in
// config. Rules:
//   • A source with `enabled == false` is never touched (explicit opt-out).
//   • A user-set token is never overwritten.
//   • Discovered entries store no secret when the source can read the CLI's
//     own auth file live (Claude, Codex) — the file stays the fresher copy.
//   • `discovered` marks entries the scan created, so a later scan can tell
//     its own work from manual configuration.

enum SourceDiscovery {

    struct Outcome {
        var changed = false
        var lines: [String] = []   // human-readable, one per scanned source
    }

    @discardableResult
    static func run(config: inout QuotaBarConfig) -> Outcome {
        var outcome = Outcome()

        // Z.AI — first-class: the dashboard token lives in browser
        // localStorage (see ZaiTokenDiscovery). Only fills an empty slot;
        // a user-set token is never touched.
        if !config.zaiToken.isEmpty {
            outcome.lines.append("zai: token already set")
        } else if let found = ZaiTokenDiscovery.findToken() {
            config.zaiToken = found.token
            outcome.lines.append("zai: token discovered in \(found.browser) localStorage")
            outcome.changed = true
        } else if let bridged = ZaiTokenDiscovery.claudeBridgeToken() {
            config.zaiToken = bridged
            outcome.lines.append("zai: token picked up from Claude Code's z.ai base URL")
            outcome.changed = true
        } else {
            outcome.lines.append("zai: no token found (Chrome/Chromium-family + Firefox scanned; Safari is TCC-protected and skipped) — paste it in Settings")
        }

        // Claude — Claude Code credential file (keychain is out of scope).
        let claudeFile = NSString(string: "~/.claude/.credentials.json").expandingTildeInPath
        if claudeReadable(path: claudeFile) {
            if ensureEntry(&config, \.claude) {
                outcome.lines.append("claude: enabled (token read live from ~/.claude/.credentials.json)")
                outcome.changed = true
            } else {
                outcome.lines.append("claude: already configured")
            }
        } else {
            outcome.lines.append("claude: no ~/.claude/.credentials.json found")
        }

        // Codex — Codex CLI auth file.
        let codexFile = NSString(string: "~/.codex/auth.json").expandingTildeInPath
        if codexReadable(path: codexFile) {
            if ensureEntry(&config, \.codex) {
                outcome.lines.append("codex: enabled (token read live from ~/.codex/auth.json)")
                outcome.changed = true
            } else {
                outcome.lines.append("codex: already configured")
            }
        } else {
            outcome.lines.append("codex: no ~/.codex/auth.json found")
        }

        // GitHub — token from environment for the existing rate-limit source.
        let env = ProcessInfo.processInfo.environment
        if let envToken = [env["GH_TOKEN"], env["GITHUB_TOKEN"]].compactMap({ $0 }).first(where: { !$0.isEmpty }) {
            if config.sources == nil { config.sources = SourcesConfig() }
            if let github = config.sources?.github {
                if github.token.isEmpty {
                    config.sources?.github?.token = envToken
                    config.sources?.github?.discovered = true
                    outcome.lines.append("github: token picked up from environment")
                    outcome.changed = true
                } else {
                    outcome.lines.append("github: already configured")
                }
            }
        } else {
            outcome.lines.append("github: no GH_TOKEN/GITHUB_TOKEN in environment (60/hr unauthenticated is fine)")
        }

        // Copilot — tokens other tools drop on disk (opencode, VS Code plugin).
        // Content-checked: an auth file without a Copilot entry doesn't count.
        if CopilotSource.hasStoredCredential() {
            if ensureEntry(&config, \.copilot) {
                outcome.lines.append("copilot: enabled (token read live from opencode/VS Code auth files)")
                outcome.changed = true
            } else {
                outcome.lines.append("copilot: already configured")
            }
        } else {
            outcome.lines.append("copilot: no Copilot sign-in found (opencode/VS Code auth files)")
        }

        // OpenRouter — key from environment.
        if let key = env["OPENROUTER_API_KEY"], !key.isEmpty {
            if config.sources == nil { config.sources = SourcesConfig() }
            if let openrouter = config.sources?.openrouter {
                if openrouter.token.isEmpty {
                    config.sources?.openrouter?.token = key
                    config.sources?.openrouter?.discovered = true
                    outcome.lines.append("openrouter: key picked up from OPENROUTER_API_KEY")
                    outcome.changed = true
                } else {
                    outcome.lines.append("openrouter: already configured")
                }
            }
        } else {
            outcome.lines.append("openrouter: no OPENROUTER_API_KEY in environment")
        }

        // Antigravity — the IDE's user data dir; the source is local-only
        // (reads the running app's local RPC), so existence is all we need.
        let antigravityDir = NSString(
            string: "~/Library/Application Support/Antigravity").expandingTildeInPath
        if FileManager.default.fileExists(atPath: antigravityDir) {
            if ensureEntry(&config, \.antigravity) {
                outcome.lines.append("antigravity: enabled (reads the app's local endpoint — open Antigravity to see quota)")
                outcome.changed = true
            } else {
                outcome.lines.append("antigravity: already configured")
            }
        } else {
            outcome.lines.append("antigravity: app not installed")
        }

        return outcome
    }

    // MARK: per-source entry rules

    /// Creates the entry when absent; re-arms a previously discovered entry
    /// that lost its credential. Returns true when config changed.
    private static func ensureEntry(_ config: inout QuotaBarConfig,
                                    _ keyPath: WritableKeyPath<SourcesConfig, OAuthSourceConfig?>) -> Bool {
        if config.sources == nil { config.sources = SourcesConfig() }
        if let existing = config.sources?[keyPath: keyPath] {
            if !existing.enabled { return false }          // explicit opt-out wins
            if !existing.token.isEmpty { return false }    // user-managed token wins
            if existing.discovered { return false }        // already set up by us
            config.sources?[keyPath: keyPath]?.discovered = true
            return true
        }
        config.sources?[keyPath: keyPath] = OAuthSourceConfig(discovered: true)
        return true
    }

    private static func claudeReadable(path: String) -> Bool {
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let oauth = root["claudeAiOauth"] as? [String: Any],
              let token = oauth["accessToken"] as? String, !token.isEmpty else { return false }
        return true
    }

    private static func codexReadable(path: String) -> Bool {
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tokens = root["tokens"] as? [String: Any],
              let token = tokens["access_token"] as? String, !token.isEmpty else { return false }
        return true
    }
}

// MARK: Z.AI token discovery

/// Finds the z.ai dashboard token without any copy-paste: the z.ai site
/// keeps it in browser localStorage under a known key, and every
/// Chromium-family browser persists localStorage to on-disk LevelDB we can
/// read directly (no Keychain, no TCC prompts). Firefox keeps the same key
/// in a per-profile SQLite file whose TEXT values are readable the same
/// way. Safari's storage is deliberately NOT read — it is TCC-protected
/// and scanning it would trigger a Full Disk Access prompt.
enum ZaiTokenDiscovery {

    static let storageKey = "z-ai-open-platform-token-production"

    /// Chromium-layout browsers under ~/Library/Application Support, with
    /// per-profile Local Storage/leveldb directories.
    static let chromiumBrowsers: [(name: String, path: String)] = [
        ("Google Chrome", "Google/Chrome"),
        ("Google Chrome Canary", "Google/Chrome Canary"),
        ("Chromium", "Chromium"),
        ("Brave", "BraveSoftware/Brave-Browser"),
        ("Microsoft Edge", "Microsoft Edge"),
        ("Arc", "Arc/User Data"),
        ("Comet", "Comet"),
    ]

    static var defaultAppSupport: String {
        NSString(string: "~/Library/Application Support").expandingTildeInPath
    }

    /// Scan every browser profile for the z.ai localStorage key.
    /// `appSupport` is injectable so tests can point at a fixture tree.
    static func findToken(appSupport: String = defaultAppSupport) -> (browser: String, token: String)? {
        for browser in chromiumBrowsers {
            let root = "\(appSupport)/\(browser.path)"
            guard let profiles = try? FileManager.default.contentsOfDirectory(atPath: root) else { continue }
            for profile in profiles {
                let leveldb = "\(root)/\(profile)/Local Storage/leveldb"
                guard let files = try? FileManager.default.contentsOfDirectory(atPath: leveldb) else { continue }
                for file in files {
                    guard let data = FileManager.default.contents(atPath: "\(leveldb)/\(file)"),
                          let token = extractToken(from: data, key: storageKey) else { continue }
                    return (browser.name, token)
                }
            }
        }
        // Firefox: webappsstore.sqlite per profile; localStorage TEXT
        // values sit in the file as plain runs, same extraction.
        let firefox = "\(appSupport)/Firefox/Profiles"
        if let profiles = try? FileManager.default.contentsOfDirectory(atPath: firefox) {
            for profile in profiles {
                let db = "\(firefox)/\(profile)/webappsstore.sqlite"
                guard let data = FileManager.default.contents(atPath: db),
                      let token = extractToken(from: data, key: storageKey) else { continue }
                return ("Firefox", token)
            }
        }
        return nil
    }

    /// GLM coding plan routed through Claude Code: ~/.claude/settings.json
    /// with ANTHROPIC_BASE_URL on z.ai carries the plan token in
    /// ANTHROPIC_AUTH_TOKEN. Only picks it up when the base URL actually
    /// points at z.ai — a real Anthropic token is never touched.
    static func claudeBridgeToken(path: String? = nil) -> String? {
        let file = path
            ?? NSString(string: "~/.claude/settings.json").expandingTildeInPath
        guard let data = FileManager.default.contents(atPath: file),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let env = root["env"] as? [String: Any],
              let base = env["ANTHROPIC_BASE_URL"] as? String,
              base.contains("z.ai"),
              let token = env["ANTHROPIC_AUTH_TOKEN"] as? String,
              token.count >= 20
        else { return nil }
        return token
    }

    /// Pull the localStorage value for `key` out of raw LevelDB/SQLite
    /// bytes. Chromium writes DOM strings as UTF-16LE, so both encodings of
    /// the key are probed; the value is the first plausible token run
    /// (≥20 printable chars, UTF-16LE NULs stripped) within a window after
    /// the key — record headers are short, the value follows immediately.
    static func extractToken(from data: Data, key: String) -> String? {
        for probe in [Data(key.utf8), utf16LE(key)] {
            guard let range = data.range(of: probe) else { continue }
            let tail = data.subdata(in: range.upperBound..<data.endIndex)
            let window = tail.prefix(512)
            if let token = firstTokenRun(in: window), token != key {
                return token
            }
        }
        return nil
    }

    /// First run of ≥20 printable bytes, taken whole once it ends; an
    /// interleaved NUL continues the run only when the next byte is
    /// printable too (the UTF-16LE pattern) — stray NULs or header bytes
    /// split it.
    private static func firstTokenRun(in data: Data) -> String? {
        let bytes = [UInt8](data)
        var run = [UInt8]()
        func finish(_ run: [UInt8]) -> String? {
            let cleaned = run.filter { $0 != 0 }
            return cleaned.count >= 20 ? String(decoding: cleaned, as: UTF8.self) : nil
        }
        var index = 0
        while index < bytes.count {
            let byte = bytes[index]
            let printable = (0x21...0x7E).contains(byte)
            let utf16Interleave = byte == 0 && !run.isEmpty
                && index + 1 < bytes.count && (0x21...0x7E).contains(bytes[index + 1])
            if printable || utf16Interleave {
                run.append(byte)
            } else {
                if let token = finish(run) { return token }
                run = []
            }
            index += 1
        }
        return finish(run)
    }

    private static func utf16LE(_ string: String) -> Data {
        var out = Data()
        for scalar in string.unicodeScalars where scalar.value < 0x80 {
            out.append(UInt8(scalar.value))
            out.append(0)
        }
        return out
    }
}
