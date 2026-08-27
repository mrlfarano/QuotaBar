import Foundation

// MARK: - Google Antigravity source (local-only)
//
// Google retired Gemini CLI for individuals in June 2026 and the remote
// cloudcode-pa quota endpoints deny personal accounts, so this source reads
// the quota the Antigravity IDE itself exposes on a local Connect-RPC
// endpoint while it runs (same mechanism as the IDE's own UI):
//   POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus
//   X-Codeium-Csrf-Token: <token from the process args>, body {"metadata":{}}
// Response: userStatus.cascadeModelConfigData.clientModelConfigs[] with
// per-model quotaInfo {remainingFraction, resetTime}, plus plan tier and
// account email. No network leaves the machine; nothing is read from the
// Keychain. When the app isn't running the section says so instead of
// guessing. The IDE's persisted state DB stores its quota blob encrypted,
// so the running-process probe is the only honest source.

enum AntigravitySource {
    static let id = "antigravity"
    static let title = "Antigravity · usage"
    static let getUserStatusPath = "/exa.language_server_pb.LanguageServerService/GetUserStatus"

    static func fetch(config: OAuthSourceConfig?) async -> SourceSection {
        guard let process = detectProcess() else {
            return section(error: "Antigravity not running — open the app to see quota")
        }
        let ports = listeningPorts(pid: process.pid)
        var attempts: [(url: String, csrf: String?)] = []
        for port in ports where process.csrfToken != nil {
            attempts.append(("https://127.0.0.1:\(port)\(getUserStatusPath)", process.csrfToken))
        }
        if let port = process.extensionPort {
            for token in [process.extensionCsrfToken, process.csrfToken].compactMap({ $0 }) {
                attempts.append(("http://127.0.0.1:\(port)\(getUserStatusPath)", token))
            }
        }
        guard !attempts.isEmpty else {
            return section(error: "Antigravity is running but exposes no local endpoint (try restarting the app)")
        }

        for attempt in attempts {
            guard let url = URL(string: attempt.url) else { continue }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 5
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let csrf = attempt.csrf, !csrf.isEmpty {
                request.setValue(csrf, forHTTPHeaderField: "X-Codeium-Csrf-Token")
            }
            request.httpBody = Data("{\"metadata\":{}}".utf8)

            guard let (data, response) = try? await localSession.data(for: request),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let root = object as? [String: Any] else { continue }
            return section(from: root)
        }
        return section(error: "Antigravity's local endpoint answered but rejected the probe (app update?)")
    }

    /// Wire-format parser, exposed for `--parse-antigravity <fixture>`.
    static func section(from root: [String: Any]) -> SourceSection {
        guard (root["code"] as? Int ?? 0) == 0 || root["code"] == nil else {
            return section(error: "Local API error code \(root["code"] ?? "?")")
        }
        guard let userStatus = root["userStatus"] as? [String: Any] else {
            return section(error: "No userStatus in response")
        }
        let sectionTitle: String
        if let tier = planTier(userStatus) {
            sectionTitle = "Antigravity (\(tier)) · usage"
        } else {
            sectionTitle = title
        }

        let configs = ((userStatus["cascadeModelConfigData"] as? [String: Any])?["clientModelConfigs"]) as? [[String: Any]] ?? []
        struct Row { let label: String; let remaining: Double; let resetAt: Date? }
        var gemini: [Row] = []
        var claudeGPT: [Row] = []
        for configEntry in configs {
            guard let label = configEntry["label"] as? String,
                  let quota = configEntry["quotaInfo"] as? [String: Any],
                  let remaining = QuotaResponseParser.number(quota["remainingFraction"]) else { continue }
            let lower = label.lowercased()
            let row = Row(label: label, remaining: remaining,
                          resetAt: QuotaResponseParser.date(quota["resetTime"]))
            if lower.contains("gemini") && !["lite", "image", "tab"].contains(where: { lower.contains($0) }) {
                gemini.append(row)
            } else if lower.contains("claude") || lower.contains("gpt") {
                claudeGPT.append(row)
            }
        }

        // Each pool reports its most-constrained member; agents share the pool.
        var gauges: [Gauge] = []
        for (rows, gaugeID, label) in [(gemini, "antigravity-gemini", "Gemini quota"),
                                       (claudeGPT, "antigravity-claude-gpt", "Claude + GPT quota")] where !rows.isEmpty {
            guard let worst = rows.min(by: { $0.remaining < $1.remaining }) else { continue }
            var gauge = Gauge(id: gaugeID, label: label,
                              pct: (1 - worst.remaining) * 100, resetAt: worst.resetAt)
            gauge.clampToHundred()
            gauges.append(gauge)
        }
        if gauges.isEmpty {
            return SourceSection(id: id, title: sectionTitle,
                                 notice: "Connected, but no usage fractions reported yet")
        }
        return SourceSection(id: id, title: sectionTitle, gauges: gauges)
    }

    private static func planTier(_ userStatus: [String: Any]) -> String? {
        if let tier = ((userStatus["userTier"] as? [String: Any])?["name"] as? String),
           !tier.isEmpty { return tier }
        if let plan = (((userStatus["planStatus"] as? [String: Any])?["planInfo"] as? [String: Any])?["planName"] as? String),
           !plan.isEmpty { return plan }
        return nil
    }

    // MARK: process discovery

    private struct ProcessInfoMatch {
        var pid: Int
        var csrfToken: String?
        var extensionPort: Int?
        var extensionCsrfToken: String?
    }

    /// Antigravity's language_server (or the `agy` CLI). Matched on the
    /// binary name plus the app-data marker so other Codeium-lineage tools
    /// are not picked up.
    private static func detectProcess() -> ProcessInfoMatch? {
        guard let output = runCommand("/bin/ps", ["-axo", "pid=,command="]) else { return nil }
        for line in output.split(separator: "\n") {
            let text = String(line).trimmingCharacters(in: .whitespaces)
            let isLanguageServer = text.contains("language_server") || text.contains("language-server")
            let isMarked = text.lowercased().contains("antigravity") || text.contains("--app_data_dir antigravity")
            let isCLI = text.range(of: "(^|[ /])agy( |$)", options: .regularExpression) != nil
            guard (isLanguageServer && isMarked) || isCLI else { continue }
            let parts = text.split(separator: " ", maxSplits: 1)
            guard let pid = Int(parts[0]) else { continue }
            return ProcessInfoMatch(
                pid: pid,
                csrfToken: flagValue("csrf_token", in: text),
                extensionPort: flagValue("extension_server_port", in: text).flatMap(Int.init),
                extensionCsrfToken: flagValue("extension_server_csrf_token", in: text))
        }
        return nil
    }

    private static func flagValue(_ flag: String, in command: String) -> String? {
        guard let range = command.range(of: "--\(flag)[= ]([^ ]+)", options: .regularExpression) else { return nil }
        return String(command[range]).replacingOccurrences(of: "--\(flag)=", with: "")
            .replacingOccurrences(of: "--\(flag) ", with: "")
    }

    private static func listeningPorts(pid: Int) -> [Int] {
        guard let output = runCommand("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", String(pid)]) else { return [] }
        var ports: [Int] = []
        for line in output.split(separator: "\n") {
            guard let port = line.split(separator: " ").last else { continue }
            // Address column looks like 127.0.0.1:45971 or *:45971.
            guard let colon = port.lastIndex(of: ":"), let number = Int(port[port.index(after: colon)...]) else { continue }
            if !ports.contains(number) { ports.append(number) }
        }
        return ports
    }

    private static func runCommand(_ path: String, _ arguments: [String]) -> String? {
        let process = Foundation.Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(data: data, encoding: .utf8)
    }

    // MARK: local HTTPS session (self-signed cert on localhost)

    private static let localSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 15
        return URLSession(configuration: config, delegate: LocalhostTrustDelegate(), delegateQueue: nil)
    }()

    private final class LocalhostTrustDelegate: NSObject, URLSessionDataDelegate {
        func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
                  let trust = challenge.protectionSpace.serverTrust,
                  ["127.0.0.1", "localhost", "::1"].contains(challenge.protectionSpace.host) else {
                completionHandler(.performDefaultHandling, nil)
                return
            }
            completionHandler(.useCredential, URLCredential(trust: trust))
        }
    }

    private static func section(error: String) -> SourceSection {
        SourceSection(id: id, title: title, errorMessage: error)
    }
}
