import Foundation

// MARK: - Claude (Pro/Max) source
//
// Anthropic publishes no quota API for subscription plans. This mirrors what
// Claude Code's own OAuth session sees:
//   GET https://api.anthropic.com/api/oauth/usage
//   Authorization: Bearer <oauth access token>
//   anthropic-beta: oauth-2025-04-20
// Response buckets (utilization 0-100, resets_at ISO8601):
//   { "five_hour": {...}, "seven_day": {...}, "seven_day_sonnet": {...} }
// Token chain: config token → ~/.claude/.credentials.json (Claude Code keeps
// it fresh when the CLI is used) → refresh via api.anthropic.com/v1/oauth/token.

enum ClaudeSource {
    static let id = "claude"
    static let title = "Claude (Pro/Max) · usage"
    static let usageURL = "https://api.anthropic.com/api/oauth/usage"
    static let refreshURL = "https://api.anthropic.com/v1/oauth/token"
    // Claude Code's public PKCE client id.
    static let clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

    /// Fetches usage. Returns the section plus a token update the caller
    /// should persist when the refresh flow produced new credentials.
    static func fetch(config: OAuthSourceConfig?) async -> (section: SourceSection, tokenUpdate: OAuthSourceConfig?)
        { await fetch(config: config, triedRefresh: false) }

    private static func fetch(config: OAuthSourceConfig?, triedRefresh: Bool) async
        -> (section: SourceSection, tokenUpdate: OAuthSourceConfig?) {
        let candidates = candidateTokens(config: config)
        guard !candidates.isEmpty else {
            return (section(error: "No OAuth token — run `claude` once, then Discover Sources"), nil)
        }

        var sawAuthFailure = false
        for token in candidates {
            var request = URLRequest(url: URL(string: usageURL)!)
            request.timeoutInterval = 15
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

            let data: Data
            let httpResponse: HTTPURLResponse?
            do {
                let (body, response) = try await URLSession.shared.data(for: request)
                data = body
                httpResponse = response as? HTTPURLResponse
            } catch {
                return (section(error: "Network error: \(error.localizedDescription)"), nil)
            }
            let status = httpResponse?.statusCode ?? -1
            if status == 401 || status == 403 { sawAuthFailure = true; continue }
            guard status == 200 else {
                return (section(error: "HTTP \(status) from api.anthropic.com"), nil)
            }
            guard let object = try? JSONSerialization.jsonObject(with: data),
                  let root = object as? [String: Any] else {
                return (section(error: "Response was not JSON"), nil)
            }
            let gauges = Self.gauges(from: root)
            guard !gauges.isEmpty else {
                return (section(error: "Connected, but no usage buckets in response"), nil)
            }
            return (SourceSection(id: id, title: title, gauges: gauges), nil)
        }
        guard sawAuthFailure else { return (section(error: "Request failed"), nil) }

        if let refreshed = await refreshToken(config: config) {
            var updated = config ?? OAuthSourceConfig()
            updated.token = refreshed.token
            updated.refreshToken = refreshed.refreshToken ?? updated.refreshToken
            if !triedRefresh {
                let retry = await fetch(config: updated, triedRefresh: true)
                return (retry.section, retry.tokenUpdate ?? updated)
            }
            return (section(error: "Token refreshed but usage still unauthorized"), updated)
        }
        return (section(error: "Token expired — run `claude` once to re-authenticate, then Discover Sources"), nil)
    }

    /// Wire-format parser, exposed for `--parse-claude <fixture>`.
    static func gauges(from root: [String: Any]) -> [Gauge] {
        var gauges: [Gauge] = []
        for (key, gaugeID, label) in [("five_hour", "claude-5h", "5-hour window"),
                                      ("seven_day", "claude-weekly", "Weekly limit")] {
            guard let bucket = root[key] as? [String: Any],
                  let utilization = QuotaResponseParser.number(bucket["utilization"]) else { continue }
            var gauge = Gauge(id: gaugeID, label: label, pct: utilization,
                              resetAt: QuotaResponseParser.date(bucket["resets_at"]))
            gauge.clampToHundred()
            gauges.append(gauge)
        }
        return gauges
    }

    // MARK: credential plumbing

    /// Config token first, then the CLI auth file read live.
    private static func candidateTokens(config: OAuthSourceConfig?) -> [String] {
        var tokens: [String] = []
        if let token = config?.token, !token.isEmpty { tokens.append(token) }
        if let file = readCredentialFile(), !file.accessToken.isEmpty, !tokens.contains(file.accessToken) {
            tokens.append(file.accessToken)
        }
        return tokens
    }

    private static func refreshToken(config: OAuthSourceConfig?) async -> (token: String, refreshToken: String?)? {
        guard let refresh = config?.refreshToken ?? readCredentialFile()?.refreshToken, !refresh.isEmpty else {
            return nil
        }
        var request = URLRequest(url: URL(string: refreshURL)!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "grant_type": "refresh_token", "client_id": clientID, "refresh_token": refresh,
        ])
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["access_token"] as? String else { return nil }
        return (token, object["refresh_token"] as? String)
    }

    private static func readCredentialFile() -> (accessToken: String, refreshToken: String?)? {
        let path = NSString(string: "~/.claude/.credentials.json").expandingTildeInPath
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let oauth = root["claudeAiOauth"] as? [String: Any],
              let token = oauth["accessToken"] as? String, !token.isEmpty else { return nil }
        return (token, oauth["refreshToken"] as? String)
    }

    private static func section(error: String) -> SourceSection {
        SourceSection(id: id, title: title, errorMessage: error)
    }
}
