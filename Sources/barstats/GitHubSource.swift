import Foundation

// MARK: - Source framework
//
// Each external source surfaces as one menu section. The z.ai source stays
// the only source driving the status bar and the snapshot cache, so a
// secondary source failing can never disturb the primary display.

struct SourceSection {
    var title: String
    var gauges: [Gauge] = []
    var errorMessage: String? = nil
}

// MARK: - GitHub API rate limit
//
// GET https://api.github.com/rate_limit → resources.core {limit, remaining,
// reset, used}. Unauthenticated calls get a 60/hr core budget; an optional
// token raises it to 5000/hr. Verified live 2026-08-26.

enum GitHubSource {
    static let endpoint = URL(string: "https://api.github.com/rate_limit")!

    static func fetch(token: String?) async -> SourceSection {
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 15
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let httpResponse: HTTPURLResponse?
        do {
            let (body, response) = try await URLSession.shared.data(for: request)
            data = body
            httpResponse = response as? HTTPURLResponse
        } catch {
            return section(error: "Network error: \(error.localizedDescription)")
        }
        guard (httpResponse?.statusCode ?? -1) == 200 else {
            return section(error: "HTTP \(httpResponse?.statusCode ?? -1) from api.github.com")
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any],
              let resources = root["resources"] as? [String: Any],
              let core = resources["core"] as? [String: Any],
              let limit = core["limit"] as? Double,
              let used = core["used"] as? Double,
              let reset = core["reset"] as? Double else {
            return section(error: "Could not read resources.core from response")
        }

        let gauge = Gauge(
            id: "gh-core",
            label: "Core requests",
            pct: limit > 0 ? used / limit * 100 : 0,
            used: used,
            total: limit,
            resetAt: Date(timeIntervalSince1970: reset))
        return SourceSection(title: "GitHub API · rate limit", gauges: [gauge])
    }

    private static func section(error: String) -> SourceSection {
        SourceSection(title: "GitHub API · rate limit", errorMessage: error)
    }
}
