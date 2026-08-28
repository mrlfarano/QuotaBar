import Foundation

// MARK: - Model

struct DetailEntry: Codable {
    var modelCode: String
    var usage: Double
}

struct Gauge: Codable {
    var id: String          // "fiveHour", "week", or "mcp"
    var label: String
    var pct: Double         // 0...100
    var used: Double? = nil     // tokens consumed, when the payload says so
    var total: Double? = nil    // window limit
    var resetAt: Date? = nil    // next window reset
    var details: [DetailEntry]? = nil  // per-model usage breakdown

    mutating func clampToHundred() {
        pct = min(max(pct, 0), 100)
    }
}

struct Snapshot: Codable {
    var fetchedAt: Date
    var rawJSON: String
    var gauges: [Gauge]
    var errorMessage: String?
    var usedScheme: String   // Authorization prefix accepted by the server, e.g. "Bearer " or ""
    var planLevel: String? = nil  // e.g. "max", from data.level
}

// MARK: - Config

struct GitHubSourceConfig: Codable {
    var enabled: Bool = true
    var token: String = ""   // optional; raises 60/hr → 5000/hr core limit
    // Optional so configs written before discovery existed still decode
    // (synthesized Codable requires non-optional keys to be present).
    var discovered: Bool? = nil
}

/// User-defined provider: any JSON endpoint reporting used/limit (+optional
/// reset), located via dot paths (dict keys or integer array indices).
struct CustomSourceConfig: Codable {
    var id: String
    var title: String? = nil     // menu header; defaults to id
    var url: String
    var token: String = ""       // optional; sent as "Authorization: Bearer …"
    var headers: [String: String]? = nil
    var usedPath: String = ""
    var limitPath: String
    var resetPath: String? = nil

    var sectionTitle: String { title ?? id }
}

struct SourcesConfig: Codable {
    var github: GitHubSourceConfig? = GitHubSourceConfig()
    var custom: [CustomSourceConfig]? = nil
    var claude: OAuthSourceConfig? = nil
    var codex: OAuthSourceConfig? = nil
    var openrouter: OAuthSourceConfig? = nil
    var copilot: OAuthSourceConfig? = nil
    var antigravity: OAuthSourceConfig? = nil
}

/// Credential holder for sources whose tokens come from CLI auth files
/// (Claude Code, Codex). An empty `token` means "read the CLI's own auth
/// file live at fetch time", which stays fresh whenever the CLI re-auths.
/// Non-empty `token`/`refreshToken` are refresh results we persist so a
/// rotated refresh token isn't lost.
struct OAuthSourceConfig: Codable {
    var enabled: Bool = true
    var token: String = ""
    var refreshToken: String? = nil
    var accountId: String? = nil
    var discovered: Bool = false
}

struct QuotaBarConfig: Codable {
    var zaiToken: String = ""
    var authScheme: String?
    var baseURL: String = "https://api.z.ai"
    var pollMinutes: Int = 5
    // Optional so configs written before sources existed still decode
    // (absent ⇒ defaults: GitHub on, no customs, status bar = z.ai).
    var sources: SourcesConfig? = nil
    /// Id of the provider shown on the status bar ("zai", "github", or a
    /// custom id). Absent ⇒ "zai".
    var mainSource: String? = nil
}

func resolvedToken(config: QuotaBarConfig) -> String {
    if let env = ProcessInfo.processInfo.environment["QUOTABAR_ZAI_TOKEN"], !env.isEmpty {
        return env
    }
    return config.zaiToken
}

/// pollMinutes comes from hand-editable JSON, so clamp it to a sane window.
func normalizedPollMinutes(_ value: Int) -> Int {
    min(max(value, 1), 60)
}

enum ConfigStore {
    static var configFileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".quotabar/config.json")
    }

    static func load() -> QuotaBarConfig {
        guard let data = try? Data(contentsOf: configFileURL),
              !data.isEmpty,
              let decoded = try? JSONDecoder().decode(QuotaBarConfig.self, from: data) else {
            return QuotaBarConfig()
        }
        return decoded
    }

    static func save(_ config: QuotaBarConfig) {
        let directory = configFileURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(config)
            try data.write(to: configFileURL, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configFileURL.path)
        } catch {
            FileHandle.standardError.write(Data("quotabar: failed saving config: \(error.localizedDescription)\n".utf8))
        }
    }
}

// MARK: - Z.AI coding-plan source
//
// Mirrors the official dashboard (z.ai/manage-apikey/coding-plan/personal/usage):
//   axios baseURL "https://api.z.ai/api", Authorization: "Bearer " + token
//   (token is the browser localStorage key "z-ai-open-platform-token-production"),
//   headers refer + Accept-Language. The community "no Bearer" variant is kept
//   as a fallback candidate.

enum ZaiSource {
    static let quotaPath = "/api/monitor/usage/quota/limit"

    static func fetchSnapshot(config: QuotaBarConfig) async -> Snapshot {
        let token = resolvedToken(config: config)
        guard !token.isEmpty else {
            return Snapshot(fetchedAt: Date(), rawJSON: "", gauges: [],
                            errorMessage: "No token configured — Set Token…", usedScheme: "")
        }
        let environment = ProcessInfo.processInfo.environment
        let base = environment["QUOTABAR_ZAI_BASE"] ?? config.baseURL

        var schemes: [String] = []
        if let remembered = config.authScheme { schemes.append(remembered) }
        for candidate in ["Bearer ", ""] where !schemes.contains(candidate) { schemes.append(candidate) }

        var sawAuthFailure = false
        // The coding-plan dashboard requests this endpoint with type=2; the
        // response then contains exactly the 5-hour (unit 3) and weekly
        // (unit 6) token limits. Fall back to an unparameterized request if
        // that ever comes back empty.
        for addType in [true, false] {
            var parts = base + quotaPath
            if addType { parts += "?type=2" }
            guard let url = URL(string: parts) else {
                return snapshot(error: "Bad base URL \(base)")
            }

            for scheme in schemes {
                var request = URLRequest(url: url)
                request.timeoutInterval = 20
                request.setValue(scheme + token, forHTTPHeaderField: "Authorization")
                request.setValue("en-US,en", forHTTPHeaderField: "Accept-Language")
                request.setValue("application/json;charset=utf-8", forHTTPHeaderField: "Content-Type")
                request.setValue("https://z.ai/manage-apikey/coding-plan/personal/usage",
                                 forHTTPHeaderField: "refer")

                let data: Data
                let httpResponse: HTTPURLResponse?
                do {
                    let (body, response) = try await URLSession.shared.data(for: request)
                    data = body
                    httpResponse = response as? HTTPURLResponse
                } catch {
                    return snapshot(error: "Network error: \(error.localizedDescription)")
                }

                let status = httpResponse?.statusCode ?? -1
                guard status == 200 else {
                    if status == 401 || status == 403 {
                        sawAuthFailure = true
                        continue
                    }
                    return snapshot(error: "HTTP \(status) from \(url.host ?? base)")
                }

                let text = String(data: data, encoding: .utf8) ?? ""
                guard let object = try? JSONSerialization.jsonObject(with: data),
                      let root = object as? [String: Any] else {
                    return snapshot(raw: text, error: "Response was not JSON")
                }

                let success = root["success"] as? Bool ?? true
                let code = root["code"] as? Int ?? 0
                let message = root["msg"] as? String ?? ""

                if code == 401 || message.lowercased().contains("token expired") {
                    sawAuthFailure = true
                    continue
                }
                if !success {
                    return snapshot(raw: pretty(text), error: message.isEmpty ? "API rejected the request" : message)
                }

                let gauges = QuotaResponseParser.gauges(from: root)
                if gauges.isEmpty && addType { continue } // retry without type=2
                if gauges.isEmpty {
                    return Snapshot(fetchedAt: Date(), rawJSON: pretty(text), gauges: [],
                                    errorMessage: "Connected, but no usage limits in response",
                                    usedScheme: scheme, planLevel: QuotaResponseParser.planLevel(from: root))
                }
                return Snapshot(fetchedAt: Date(), rawJSON: pretty(text), gauges: gauges,
                                errorMessage: nil, usedScheme: scheme,
                                planLevel: QuotaResponseParser.planLevel(from: root))
            }
            if sawAuthFailure { break } // no point retrying auth with different params
        }

        if sawAuthFailure {
            return snapshot(error: "Unauthorized — token rejected (tried header styles)")
        }
        return snapshot(error: "Request failed")
    }

    private static func snapshot(raw: String = "", error: String) -> Snapshot {
        Snapshot(fetchedAt: Date(), rawJSON: raw, gauges: [], errorMessage: error, usedScheme: "")
    }

    private static func pretty(_ text: String) -> String {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let out = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
              let str = String(data: out, encoding: .utf8) else { return text }
        return str
    }
}

// MARK: - Response parsing
//
// Pinned to the official dashboard contract:
//   { code, success, data: { limits: [ { type, unit, percentage, currentValue,
//       usage, usageDetails, nextResetTime } ] } }
// unit 3 = 5-hour token window, unit 6 = weekly token window.
// Falls back to keyword-based adaptive parsing if the shape ever changes.

enum QuotaResponseParser {

    static func gauges(from root: [String: Any]) -> [Gauge] {
        if let pinned = pinnedGauges(from: root).gauges, !pinned.isEmpty { return pinned }
        return QuotaParser.gauges(from: root)
    }

    static func planLevel(from root: [String: Any]) -> String? {
        (root["data"] as? [String: Any])?["level"] as? String
    }

    private static func pinnedGauges(from root: [String: Any]) -> (gauges: [Gauge]?, level: String?) {
        guard let data = root["data"] as? [String: Any],
              let limits = data["limits"] as? [[String: Any]] else { return (nil, nil) }

        var result: [Gauge] = []
        for limit in limits {
            guard let unit = number(limit["unit"]).map(Int.init) else { continue }
            let gaugeID: String
            let label: String
            switch unit {
            case 3: gaugeID = "fiveHour"; label = "5-hour window"
            case 6: gaugeID = "week"; label = "Weekly limit"
            case 5: gaugeID = "mcp"; label = "MCP monthly"
            default: continue
            }
            var gauge = Gauge(id: gaugeID,
                              label: label,
                              pct: number(limit["percentage"]) ?? 0,
                              used: number(limit["currentValue"])
                                  ?? number(limit["usage"]).flatMap { total in
                                      number(limit["remaining"]).map { total - $0 }
                                  },
                              total: number(limit["usage"]),
                              resetAt: date(limit["nextResetTime"]),
                              details: detailEntries(limit["usageDetails"]))
            gauge.clampToHundred()
            result.append(gauge)
        }
        let displayOrder = ["fiveHour", "week", "mcp"]
        result.sort { lhs, rhs in
            let l = displayOrder.firstIndex(of: lhs.id) ?? Int.max
            let r = displayOrder.firstIndex(of: rhs.id) ?? Int.max
            return l < r
        }
        return (result, data["level"] as? String)
    }

    private static func detailEntries(_ any: Any?) -> [DetailEntry]? {
        guard let array = any as? [[String: Any]], !array.isEmpty else { return nil }
        let entries = array.compactMap { entry -> DetailEntry? in
            guard let code = entry["modelCode"] as? String,
                  let usage = number(entry["usage"]) else { return nil }
            return DetailEntry(modelCode: code, usage: usage)
        }
        return entries.isEmpty ? nil : entries
    }

    // Tolerant leaf conversions (internal so custom sources reuse them).

    static func number(_ any: Any?) -> Double? {
        guard let any else { return nil }
        // `any is Bool` is true for NSNumber 0/1 too (bridging), which would
        // discard legitimate percentage values of 1. Real JSON booleans are
        // CFBoolean — a distinct CF type from CFNumber.
        if CFGetTypeID(any as CFTypeRef) == CFBooleanGetTypeID() { return nil }
        if let double = any as? Double { return double }
        if let int = any as? Int { return Double(int) }
        if let string = any as? String {
            if let direct = Double(string) { return direct }
            if string.hasSuffix("%"), let stripped = Double(string.dropLast()) { return stripped }
        }
        return nil
    }

    static func date(_ any: Any?) -> Date? {
        if let double = number(any) {
            if double > 1_000_000_000_000 { return Date(timeIntervalSince1970: double / 1000) } // epoch ms
            if double > 1_000_000_000 { return Date(timeIntervalSince1970: double) }             // epoch s
            return nil
        }
        if let string = any as? String, !string.isEmpty {
            for formatter in [Self.isoFractional, Self.iso] {
                if let parsed = formatter.date(from: string) { return parsed }
            }
        }
        return nil
    }

    private static let iso = ISO8601DateFormatter()
    private static let isoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

// MARK: - Adaptive fallback parser
//
// Keyword-based leaf walk, used only when the pinned contract is absent.

enum QuotaParser {

    static func gauges(from root: [String: Any]) -> [Gauge] {
        var leaves: [(path: String, value: Double)] = []
        walk(root, "") { leaves.append(($0, $1)) }

        func pick(anyOf keywords: [String], excluding excluded: [String]) -> Gauge? {
            let matches = leaves.filter { leaf in
                let p = leaf.path
                if excluded.contains(where: { p.contains($0) }) { return false }
                return keywords.contains { p.contains($0) }
            }
            guard let best = preferred(matches) else { return nil }
            var gauge = Gauge(id: "", label: "", pct: normalize(best.value),
                              used: nil, total: nil, resetAt: nil)
            gauge.clampToHundred()
            return gauge
        }

        var result: [Gauge] = []
        if var five = pick(anyOf: ["5h", "five", "four", "hour", "cycle"], excluding: ["week", "wk"]) {
            five.id = "fiveHour"
            five.label = "5-hour window"
            result.append(five)
        }
        if var week = pick(anyOf: ["week", "wk"], excluding: []) {
            week.id = "week"
            week.label = "Weekly limit"
            result.append(week)
        }
        return result
    }

    private static func preferred(_ matches: [(path: String, value: Double)]) -> (path: String, value: Double)? {
        guard !matches.isEmpty else { return nil }
        return matches.sorted { score($0.path) < score($1.path) }.first
    }

    private static func score(_ path: String) -> Int {
        var s = path.count
        for good in ["percent", "pct", "rate", "ratio", "limit", "used", "remain"] {
            if path.contains(good) { s -= 500 }
        }
        for bad in ["total", "count", "amount"] {
            if path.contains(bad) { s += 300 }
        }
        return s
    }

    private static func normalize(_ value: Double) -> Double {
        if value > 0 && value <= 1 { return value * 100 }
        return value
    }

    private static func walk(_ node: Any, _ path: String, _ sink: (String, Double) -> Void) {
        // See number(): skip only real JSON booleans, not numeric 0/1.
        if CFGetTypeID(node as CFTypeRef) == CFBooleanGetTypeID() { return }
        switch node {
        case let dict as [String: Any]:
            for (key, child) in dict {
                let childPath = path.isEmpty ? key.lowercased() : "\(path)/\(key.lowercased())"
                walk(child, childPath, sink)
            }
        case let array as [Any]:
            for child in array { walk(child, "\(path)[]", sink) }
        case let double as Double:
            sink(path, double)
        case let int as Int:
            sink(path, Double(int))
        case let string as String:
            if let direct = Double(string) {
                sink(path, direct)
            } else if string.hasSuffix("%"), let stripped = Double(string.dropLast()) {
                sink(path, stripped)
            }
        default:
            break
        }
    }
}
