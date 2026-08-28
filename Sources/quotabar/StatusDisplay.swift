import Foundation

// MARK: - Status-display resolution (pure; unit-tested)
//
// Decides what the status bar shows: the selected source's gauges, a healthy
// fallback's gauges — an errored or empty selection falls through to the
// next healthy provider instead of hijacking the bar with its error — a
// short error line when nothing is healthy, or idle text at startup.

enum StatusDisplay: Equatable {
    case gauges([Gauge])
    case error(text: String)
    case idle(text: String)
}

enum StatusDisplayResolver {

    static func resolve(sections: [SourceSection], zaiSnapshot: Snapshot?,
                        mainSource: String?) -> StatusDisplay {
        let wanted = (mainSource ?? "zai").lowercased()
        if let match = sections.first(where: { $0.id == wanted && !$0.gauges.isEmpty }) {
            return .gauges(match.gauges)
        }
        if let fallback = sections.first(where: { !$0.gauges.isEmpty }) {
            return .gauges(fallback.gauges)
        }
        // Nothing healthy: surface the most relevant error — the selected
        // source's, else the z.ai snapshot's, else any section's.
        if let section = sections.first(where: { $0.id == wanted }),
           let message = section.errorMessage {
            return .error(text: errorText(id: section.id, message: message))
        }
        if let message = zaiSnapshot?.errorMessage {
            return .error(text: errorText(id: "zai", message: message))
        }
        if let section = sections.first(where: { $0.errorMessage != nil }),
           let message = section.errorMessage {
            return .error(text: errorText(id: section.id, message: message))
        }
        // Warm start: sections not built yet (right after launch), but the
        // cached z.ai snapshot still has numbers worth showing.
        if let snap = zaiSnapshot, !snap.gauges.isEmpty, snap.errorMessage == nil {
            return .gauges(snap.gauges)
        }
        if sections.isEmpty, zaiSnapshot?.gauges.isEmpty != false {
            return .idle(text: "quotabar…")
        }
        return .error(text: "⚠︎ no data")
    }

    /// One-line transient warning, e.g. "⚠︎ z.ai auth". Auth-shaped messages
    /// (rejected/missing token) say so; everything else names the source.
    static func errorText(id: String, message: String) -> String {
        let auth = message.contains("token") || message.contains("Unauthorized")
        return "⚠︎ \(displayName(id))\(auth ? " auth" : "")"
    }

    private static func displayName(_ id: String) -> String {
        id == "zai" ? "z.ai" : id
    }
}

// MARK: - Refresh coalescing (pure; unit-tested)

/// Coalesces refresh requests that arrive while a refresh is in flight, so
/// the last config change is never silently dropped — the in-flight cycle
/// finishes, then one more runs. Used from the main thread only.
final class RefreshCoordinator {

    private(set) var running = false
    private var requestedDuringFlight = false

    /// true when the caller should run the refresh; false means one is
    /// already running and this request was noted to re-run after it.
    func begin() -> Bool {
        if running {
            requestedDuringFlight = true
            return false
        }
        running = true
        return true
    }

    /// Ends the flight. true when a request arrived meanwhile and the
    /// caller should immediately start another cycle.
    func end() -> Bool {
        running = false
        let rerun = requestedDuringFlight
        requestedDuringFlight = false
        return rerun
    }
}
