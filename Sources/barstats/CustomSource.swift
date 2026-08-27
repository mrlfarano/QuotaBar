import Foundation

// MARK: - Generic user-configured provider
//
// Points at any JSON endpoint reporting a used/limit pair (+ optional reset
// time), located via dot paths like "data.usage" or "items.0.remaining".

enum CustomSource {
    /// Resolve "a.b.0.c" against nested dictionaries/arrays. Returns a Double
    /// when the leaf is numeric (or a numeric string).
    static func value(at path: String, in root: [String: Any]) -> Double? {
        var node: Any = root
        for component in path.split(separator: ".").map(String.init) {
            switch node {
            case let dict as [String: Any]:
                guard let next = dict[component] else { return nil }
                node = next
            case let array as [Any]:
                guard let index = Int(component), array.indices.contains(index) else { return nil }
                node = array[index]
            default:
                return nil
            }
        }
        return QuotaResponseParser.number(node)
    }

    static func fetch(_ source: CustomSourceConfig) async -> SourceSection {
        guard !source.url.isEmpty,
              let url = URL(string: source.url) else {
            return section(source, error: "Invalid or missing url")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !source.token.isEmpty {
            request.setValue("Bearer \(source.token)", forHTTPHeaderField: "Authorization")
        }
        for (key, value) in source.headers ?? [:] {
            request.setValue(value, forHTTPHeaderField: key)
        }

        let data: Data
        do {
            let (body, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                return section(source, error: "HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
            }
            data = body
        } catch {
            return section(source, error: "Network error: \(error.localizedDescription)")
        }

        guard let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any] else {
            return section(source, error: "Response was not JSON")
        }
        // Limit is required; used defaults to limit − remaining-style payloads
        // are out of scope here — require both paths to resolve.
        guard let total = value(at: source.limitPath, in: root), total > 0 else {
            return section(source, error: "limitPath '\(source.limitPath)' not found or zero")
        }
        let used = value(at: source.usedPath, in: root) ?? 0
        let gauge = Gauge(id: source.id.lowercased(),
                          label: source.sectionTitle,
                          pct: used / total * 100,
                          used: used,
                          total: total,
                          resetAt: source.resetPath.flatMap { QuotaResponseParser.date(root[$0]) })
        return SourceSection(id: source.id.lowercased(),
                             title: source.sectionTitle,
                             gauges: [gauge])
    }

    private static func section(_ source: CustomSourceConfig, error: String) -> SourceSection {
        SourceSection(id: source.id.lowercased(), title: source.sectionTitle,
                      errorMessage: error)
    }
}
