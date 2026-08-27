import Foundation

// MARK: - OpenRouter source
//
// Official credits endpoint:
//   GET https://openrouter.ai/api/v1/credits
//   Authorization: Bearer <api key>
// Response: data {label, usage, usage_bonus, limit, limit_remaining,
// is_free_tier} — USD amounts. `limit: null` means no spending cap is
// configured, which is reported honestly as a notice instead of a ring.

enum OpenRouterSource {
    static let id = "openrouter"
    static let title = "OpenRouter · credits"
    static let creditsURL = "https://openrouter.ai/api/v1/credits"

    static func fetch(config: OAuthSourceConfig?) async -> SourceSection {
        let env = ProcessInfo.processInfo.environment
        let token = env["OPENROUTER_API_KEY"].flatMap { $0.isEmpty ? nil : $0 } ?? config?.token ?? ""
        guard !token.isEmpty else {
            return section(error: "No API key — set OPENROUTER_API_KEY or add sources.openrouter.token")
        }

        var request = URLRequest(url: URL(string: creditsURL)!)
        request.timeoutInterval = 15
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let httpResponse: HTTPURLResponse?
        do {
            let (body, response) = try await URLSession.shared.data(for: request)
            data = body
            httpResponse = response as? HTTPURLResponse
        } catch {
            return section(error: "Network error: \(error.localizedDescription)")
        }
        let status = httpResponse?.statusCode ?? -1
        guard status == 200 else {
            return section(error: status == 401 || status == 403
                ? "Key rejected (HTTP \(status))" : "HTTP \(status) from openrouter.ai")
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any] else {
            return section(error: "Response was not JSON")
        }
        return section(from: root)
    }

    /// Wire-format parser, exposed for `--parse-openrouter <fixture>`.
    /// Builds the section (gauges, or a notice when no cap is configured).
    static func section(from root: [String: Any]) -> SourceSection {
        guard let payload = root["data"] as? [String: Any] else {
            return section(error: "No data object in response")
        }
        var sectionTitle = title
        if payload["is_free_tier"] as? Bool == true { sectionTitle += " · free tier" }

        let usage = QuotaResponseParser.number(payload["usage"])
        guard let limit = QuotaResponseParser.number(payload["limit"]), limit > 0 else {
            var notice = "No spending cap configured"
            if let usage { notice += String(format: " · $%.2f used", usage) }
            return SourceSection(id: id, title: sectionTitle, notice: notice)
        }
        let used = usage ?? 0
        var gauge = Gauge(id: "openrouter-credits", label: "Credits",
                          pct: used / limit * 100, used: used, total: limit)
        gauge.clampToHundred()
        return SourceSection(id: id, title: sectionTitle, gauges: [gauge])
    }

    private static func section(error: String) -> SourceSection {
        SourceSection(id: id, title: title, errorMessage: error)
    }
}
