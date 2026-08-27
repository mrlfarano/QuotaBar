import Foundation

// MARK: - OpenAI Codex (ChatGPT plan) source
//
// ChatGPT Plus/Pro quota has no official API either. Codex CLI authenticates
// to the ChatGPT backend with OAuth tokens stored in ~/.codex/auth.json, and
// the backend exposes the plan's rate-limit windows:
//   GET https://chatgpt.com/backend-api/wham/usage
//   Authorization: Bearer <access token>
//   ChatGPT-Account-Id: <account uuid>
// Response: rate_limit.primary_window (5h) / secondary_window (weekly), each
// with used_percent (0-100), reset_after_seconds, reset_at (epoch seconds).
// Token chain: config token → ~/.codex/auth.json → refresh via
// auth.openai.com/oauth/token (rotated tokens persisted in OUR config; the
// CLI's auth.json is never written).

enum CodexSource {
    static let id = "codex"
    static let title = "Codex · usage"
    static let usageURL = "https://chatgpt.com/backend-api/wham/usage"
    static let refreshURL = "https://auth.openai.com/oauth/token"
    // Codex CLI's public OAuth client id.
    static let clientID = "app_EMoamEEZ73f0CkXaXp7hrann"

    static func fetch(config: OAuthSourceConfig?) async -> (section: SourceSection, tokenUpdate: OAuthSourceConfig?)
        { await fetch(config: config, tokenOverride: nil, triedRefresh: false) }

    private static func fetch(config: OAuthSourceConfig?, tokenOverride: String?, triedRefresh: Bool) async
        -> (section: SourceSection, tokenUpdate: OAuthSourceConfig?) {
        guard let credential = resolveCredential(config: config, tokenOverride: tokenOverride) else {
            return (section(error: "No OAuth token — run `codex login`, then Discover Sources"), nil)
        }

        var request = URLRequest(url: URL(string: usageURL)!)
        request.timeoutInterval = 15
        request.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization")
        request.setValue(credential.accountId, forHTTPHeaderField: "ChatGPT-Account-Id")

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
        if status == 401 || status == 403 {
            if let refreshed = await refreshToken(config: config, fileRefreshToken: credential.refreshToken) {
                var updated = config ?? OAuthSourceConfig()
                updated.token = refreshed.token
                updated.refreshToken = refreshed.refreshToken ?? updated.refreshToken
                updated.accountId = updated.accountId ?? credential.accountId
                if !triedRefresh {
                    let retry = await fetch(config: updated, tokenOverride: refreshed.token, triedRefresh: true)
                    return (retry.section, retry.tokenUpdate ?? updated)
                }
                return (section(error: "Token refreshed but usage still unauthorized"), updated)
            }
            return (section(error: "Token expired — run `codex login`, then Discover Sources"), nil)
        }
        guard status == 200 else {
            return (section(error: "HTTP \(status) from chatgpt.com"), nil)
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any] else {
            return (section(error: "Response was not JSON"), nil)
        }
        let gauges = Self.gauges(from: root)
        guard !gauges.isEmpty else {
            return (section(error: "Connected, but no rate-limit windows in response"), nil)
        }
        let plan = root["plan_type"] as? String
        let sectionTitle = plan.map { "Codex (\($0)) · usage" } ?? title
        return (SourceSection(id: id, title: sectionTitle, gauges: gauges), nil)
    }

    /// Wire-format parser, exposed for `--parse-codex <fixture>`.
    static func gauges(from root: [String: Any]) -> [Gauge] {
        guard let rateLimit = root["rate_limit"] as? [String: Any] else { return [] }
        var gauges: [Gauge] = []
        for (key, gaugeID, label) in [("primary_window", "codex-5h", "5-hour window"),
                                      ("secondary_window", "codex-weekly", "Weekly limit")] {
            guard let window = rateLimit[key] as? [String: Any],
                  let used = QuotaResponseParser.number(window["used_percent"]) else { continue }
            var gauge = Gauge(id: gaugeID, label: label, pct: used,
                              resetAt: QuotaResponseParser.date(window["reset_at"]))
            gauge.clampToHundred()
            gauges.append(gauge)
        }
        return gauges
    }

    // MARK: credential plumbing

    private static func resolveCredential(config: OAuthSourceConfig?, tokenOverride: String?) ->
        (token: String, accountId: String?, refreshToken: String?)? {
        if let override = tokenOverride, !override.isEmpty {
            let file = readAuthFile()
            return (override, config?.accountId ?? file?.accountId, config?.refreshToken ?? file?.refreshToken)
        }
        if let token = config?.token, !token.isEmpty {
            let file = readAuthFile()
            return (token, config?.accountId ?? file?.accountId, config?.refreshToken ?? file?.refreshToken)
        }
        if let file = readAuthFile(), !file.token.isEmpty {
            return (file.token, file.accountId, file.refreshToken)
        }
        return nil
    }

    private static func refreshToken(config: OAuthSourceConfig?, fileRefreshToken: String?) async
        -> (token: String, refreshToken: String?)? {
        guard let refresh = config?.refreshToken ?? fileRefreshToken, !refresh.isEmpty else { return nil }
        var request = URLRequest(url: URL(string: refreshURL)!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = ["grant_type": "refresh_token", "client_id": clientID, "refresh_token": refresh]
        request.httpBody = body.map { "\($0)=\($1)" }.joined(separator: "&").data(using: .utf8)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["access_token"] as? String else { return nil }
        return (token, object["refresh_token"] as? String)
    }

    private static func readAuthFile() -> (token: String, accountId: String?, refreshToken: String?)? {
        let path = NSString(string: "~/.codex/auth.json").expandingTildeInPath
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tokens = root["tokens"] as? [String: Any],
              let token = tokens["access_token"] as? String, !token.isEmpty else { return nil }
        return (token, tokens["account_id"] as? String, tokens["refresh_token"] as? String)
    }

    private static func section(error: String) -> SourceSection {
        SourceSection(id: id, title: title, errorMessage: error)
    }
}
