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
