import Foundation

// MARK: - GitHub Copilot source
//
// Copilot's premium-request quota has no public API; this mirrors what the
// Copilot Chat extension itself does (pinned from community tooling):
//   1. GET api.github.com/copilot_internal/v2/token  (GitHub OAuth token)
//      -> short-lived session token
//   2. GET api.github.com/copilot_internal/user       (session token)
//      -> quota_snapshots.premium_interactions {entitlement, remaining,
//         unlimited} + quota_reset_date (monthly, ISO date)
// Both calls carry the editor headers; `token <oauth>` is the documented
// fallback when the exchange endpoint refuses.
// Token chain: config token → opencode auth.json → VS Code hosts/apps.json.

enum CopilotSource {
    static let id = "copilot"
    static let title = "Copilot · premium requests"
    static let tokenURL = "https://api.github.com/copilot_internal/v2/token"
    static let userURL = "https://api.github.com/copilot_internal/user"

    static func fetch(config: OAuthSourceConfig?) async -> SourceSection {
        guard let oauthToken = candidateToken(config: config) else {
            return section(error: "No Copilot token — sign in to Copilot in an editor/opencode, or set sources.copilot.token")
        }

        let sessionToken = await exchangeToken(oauth: oauthToken)
        // Session token preferred; raw `token <oauth>` as fallback.
        let attempts: [(scheme: String, token: String)] = sessionToken.map { [("Bearer", $0), ("token", oauthToken)] } ?? [("token", oauthToken)]
        for attempt in attempts {
            var request = URLRequest(url: URL(string: userURL)!)
            request.timeoutInterval = 15
            request.setValue("\(attempt.scheme) \(attempt.token)", forHTTPHeaderField: "Authorization")
            applyEditorHeaders(to: &request)

            let data: Data
            let httpResponse: HTTPURLResponse?
            do {
                let (body, response) = try await URLSession.shared.data(for: request)
                data = body
                httpResponse = response as? HTTPURLResponse
            } catch {
                return section(error: "Network error: \(error.localizedDescription)")
            }
            guard (httpResponse?.statusCode ?? -1) == 200 else { continue }
            guard let object = try? JSONSerialization.jsonObject(with: data),
                  let root = object as? [String: Any] else {
                return section(error: "Response was not JSON")
            }
            return section(from: root)
        }
        return section(error: "Copilot API rejected the token (run an editor sign-in, then Discover Sources)")
    }

    /// Wire-format parser, exposed for `--parse-copilot <fixture>`.
    static func section(from root: [String: Any]) -> SourceSection {
        let snapshots = root["quota_snapshots"] as? [String: Any] ?? [:]
        guard let premium = snapshots["premium_interactions"] as? [String: Any] else {
            return section(error: "No premium_interactions quota in response")
        }
        if premium["unlimited"] as? Bool == true {
            return SourceSection(id: id, title: title, notice: "Unlimited plan — no premium-request cap")
        }
        guard let entitlement = QuotaResponseParser.number(premium["entitlement"]), entitlement > 0,
              let remaining = QuotaResponseParser.number(premium["remaining"]) else {
            return section(error: "Quota fields missing from response")
        }
        let used = max(0, entitlement - remaining)
        var gauge = Gauge(id: "copilot-premium", label: "Premium requests",
                          pct: used / entitlement * 100, used: used, total: entitlement,
                          resetAt: resetDate(root["quota_reset_date"]))
        gauge.clampToHundred()
        return SourceSection(id: id, title: title, gauges: [gauge])
    }

    // MARK: internals

    private static func exchangeToken(oauth: String) async -> String? {
        var request = URLRequest(url: URL(string: tokenURL)!)
        request.timeoutInterval = 15
        request.setValue("Bearer " + oauth, forHTTPHeaderField: "Authorization")
        applyEditorHeaders(to: &request)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String, !token.isEmpty else { return nil }
        return token
    }

    /// Header set the extension sends; the internal API sniffs these.
    private static func applyEditorHeaders(to request: inout URLRequest) {
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("GitHubCopilotChat/0.35.0", forHTTPHeaderField: "User-Agent")
        request.setValue("vscode/1.107.0", forHTTPHeaderField: "Editor-Version")
        request.setValue("copilot-chat/0.35.0", forHTTPHeaderField: "Editor-Plugin-Version")
        request.setValue("vscode-chat", forHTTPHeaderField: "Copilot-Integration-Id")
    }

    /// quota_reset_date is a bare ISO date ("2026-09-01"); the shared
    /// ISO8601 parsers want full timestamps, so add a date-only fallback.
    private static func resetDate(_ any: Any?) -> Date? {
        if let date = QuotaResponseParser.date(any) { return date }
        guard let string = any as? String else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.date(from: string)
    }

    /// Whether any on-disk auth store actually holds a Copilot token —
    /// used by discovery so a login file for other providers doesn't
    /// enable this source with no usable credential.
    static func hasStoredCredential() -> Bool {
        candidateToken(config: nil) != nil
    }

    private static func candidateToken(config: OAuthSourceConfig?) -> String? {
        if let token = config?.token, !token.isEmpty { return token }
        if let file = readOpenCodeAuth() { return file }
        if let file = readHostsOrApps() { return file }
        return nil
    }

    /// opencode: ~/.local/share/opencode/auth.json → github-copilot.refresh|access
    private static func readOpenCodeAuth() -> String? {
        let path = NSString(string: "~/.local/share/opencode/auth.json").expandingTildeInPath
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let copilot = root["github-copilot"] as? [String: Any] else { return nil }
        let token = copilot["refresh"] as? String ?? copilot["access"] as? String
        return token?.isEmpty == false ? token : nil
    }

    /// VS Code/Copilot plugin: hosts.json / apps.json → github.com.oauth_token
    private static func readHostsOrApps() -> String? {
        for name in ["hosts.json", "apps.json"] {
            let path = NSString(string: "~/.config/github-copilot/").appendingPathComponent(name)
            guard let data = FileManager.default.contents(atPath: path),
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let github = root["github.com"] as? [String: Any],
                  let token = github["oauth_token"] as? String, !token.isEmpty else { continue }
            return token
        }
        return nil
    }

    private static func section(error: String) -> SourceSection {
        SourceSection(id: id, title: title, errorMessage: error)
    }
}
