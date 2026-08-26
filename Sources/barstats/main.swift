import AppKit

// MARK: - Entry point

let demoMode = CommandLine.arguments.contains("--demo")

// Offline parser check: barstats --parse payload.json -> "fiveHour=42% week=14%"
if CommandLine.arguments.contains("--parse"), let file = CommandLine.arguments.last {
    if let data = FileManager.default.contents(atPath: file),
       let object = try? JSONSerialization.jsonObject(with: data),
       let root = object as? [String: Any] {
        let gauges = QuotaResponseParser.gauges(from: root)
        let lines = gauges.map { gauge -> String in
            var text = "\(gauge.id)=\(Int(gauge.pct.rounded()))%"
            if let used = gauge.used, let total = gauge.total { text += " [\(used)/\(total)]" }
            if let reset = gauge.resetAt { text += " resets@\(Int(reset.timeIntervalSince1970))" }
            return text
        }
        print(lines.joined(separator: " "))
        exit(gauges.isEmpty ? 1 : 0)
    }
    FileHandle.standardError.write(Data("barstats --parse: could not read \(file)\n".utf8))
    exit(2)
}

let app = NSApplication.shared
let delegate = AppDelegate(demoMode: demoMode)
app.delegate = delegate
app.setActivationPolicy(.accessory) // menu-bar only, no Dock icon

if CommandLine.arguments.contains("--probe") {
    let config = ConfigStore.load()
    guard !resolvedToken(config: config).isEmpty else {
        FileHandle.standardError.write(Data("barstats --probe: no token. Set BARSTATS_ZAI_TOKEN or ~/.barstats/config.json\n".utf8))
        exit(2)
    }
    Task {
        let snap = await ZaiSource.fetchSnapshot(config: config)
        print("gauges:", snap.gauges.map { "\($0.id)=\(Int($0.pct))%" }.joined(separator: " "))
        print("authScheme:", snap.usedScheme.trimmingCharacters(in: .whitespaces) == "" ? "(raw)" : snap.usedScheme.trimmingCharacters(in: .whitespaces))
        if let msg = snap.errorMessage { print("error:", msg) }
        print("--- raw ---")
        print(snap.rawJSON.isEmpty ? "(none)" : snap.rawJSON)
        exit(snap.errorMessage == nil && !snap.gauges.isEmpty ? 0 : 1)
    }
    dispatchMain()
} else {
    app.run()
}

// MARK: - App delegate / status item controller

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {

    private var statusItem: NSStatusItem!
    private let menu = NSMenu()
    private var config = ConfigStore.load()
    private var snapshot: Snapshot?
    private var refreshing = false

    private let popover: NSPopover = {
        let popover = NSPopover()
        popover.behavior = .transient
        return popover
    }()
    private let popoverController = PopoverController()
    private var appearanceObservation: NSKeyValueObservation?
    private var demoGauges: [Gauge] = [
        Gauge(id: "fiveHour", label: "5-hour window", pct: 58, used: 69_600, total: 120_000,
              resetAt: Date().addingTimeInterval(2 * 3600 + 47 * 60),
              details: [DetailEntry(modelCode: "glm-5.3", usage: 41_000),
                        DetailEntry(modelCode: "glm-5.3-flash", usage: 18_900),
                        DetailEntry(modelCode: "glm-5.2", usage: 9_700)]),
        Gauge(id: "week", label: "Weekly limit", pct: 85, used: 51_000, total: 60_000,
              resetAt: Date().addingTimeInterval(4 * 86400 + 3 * 3600),
              details: [DetailEntry(modelCode: "glm-5.3", usage: 30_100),
                        DetailEntry(modelCode: "glm-5.3-flash", usage: 12_400),
                        DetailEntry(modelCode: "glm-5.2", usage: 8_500)]),
        Gauge(id: "mcp", label: "MCP monthly", pct: 3, used: 139, total: 4_000,
              resetAt: Date().addingTimeInterval(9 * 86400),
              details: [DetailEntry(modelCode: "search-prime", usage: 134),
                        DetailEntry(modelCode: "web-reader", usage: 5)]),
    ]

    init(demoMode: Bool) {
        self.demoMode = demoMode
    }
    private let demoMode: Bool

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Created here so the accessory activation policy is already applied;
        // items created before it can fail to register with the system.
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.imagePosition = .imageLeft
        statusItem.button?.target = self
        statusItem.button?.action = #selector(statusItemClicked(_:))
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        if ProcessInfo.processInfo.environment["BARSTATS_DEBUG"] != nil {
            NSLog("barstats launched, button=%@", String(describing: statusItem.button))
        }
        buildUtilityMenu()
        loadCachedSnapshot()
        rebuild(reason: "launch")
        Task { @MainActor in await refreshNow() }
        Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            self?.pollTick()
        }
        // Redraw the drawn bars when the system appearance flips.
        appearanceObservation = NSApp.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.rebuild(reason: "appearance") }
        }
        if CommandLine.arguments.contains("--autopen") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.showPopover()
            }
        }
    }

    // MARK: polling

    private func pollTick() {
        if demoMode {
            demoAdvance()
            rebuild(reason: "demo-tick")
            return
        }
        guard let snap = snapshot else { Task { @MainActor in await refreshNow() }; return }
        let age = Date().timeIntervalSince(snap.fetchedAt)
        if age >= Double(max(1, config.pollMinutes)) * 60 {
            Task { @MainActor in await refreshNow() }
        }
    }

    private func demoAdvance() {
        // Sweep upward so all color bands appear over time.
        for index in demoGauges.indices {
            var gauge = demoGauges[index]
            gauge.pct = gauge.pct >= 100 ? 0 : gauge.pct + 1.5
            if let total = gauge.total { gauge.used = total * gauge.pct / 100 }
            if let reset = gauge.resetAt, reset.timeIntervalSinceNow < 120 {
                gauge.resetAt = Date().addingTimeInterval(gauge.id == "fiveHour" ? 5 * 3600 : 7 * 86400)
            }
            demoGauges[index] = gauge
        }
        snapshot = Snapshot(
            fetchedAt: Date(),
            rawJSON: "",
            gauges: demoGauges,
            errorMessage: nil,
            usedScheme: "")
    }

    @objc private func refreshMenuItem(_ sender: Any?) {
        Task { @MainActor in await refreshNow() }
    }

    @MainActor private func refreshNow() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        if !demoMode {
            setTransient("…sync")
        }
        let snap: Snapshot
        if demoMode {
            snap = Snapshot(fetchedAt: Date(), rawJSON: "", gauges: demoGauges, errorMessage: nil, usedScheme: "")
        } else {
            snap = await ZaiSource.fetchSnapshot(config: config)
        }
        applySnapshot(snap)
    }

    @MainActor private func applySnapshot(_ snap: Snapshot) {
        snapshot = snap
        saveCachedSnapshot(snap)
        // Remember whichever Authorization style the server accepted.
        if snap.errorMessage == nil, !snap.gauges.isEmpty, config.authScheme != snap.usedScheme {
            config.authScheme = snap.usedScheme
            ConfigStore.save(config)
        }
        rebuild(reason: "applied")
    }

    // MARK: cache

    private var cacheURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".barstats/last-snapshot.json")
    }

    private func saveCachedSnapshot(_ snap: Snapshot) {
        guard !demoMode, let data = try? JSONEncoder().encode(snap) else { return }
        try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: cacheURL, options: [.atomic])
    }

    private func loadCachedSnapshot() {
        guard !demoMode,
              let data = try? Data(contentsOf: cacheURL),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
        snapshot = snap
    }

    // MARK: rendering

    /// Battery bars + escalation text. Green shows just the reset countdown;
    /// yellow/red add the remaining percent in the band color.
    private func updateStatusItem() {
        if demoMode {
            if let snap = snapshot, let five = snap.gauges.first(where: { $0.id == "fiveHour" }) {
                applyBars(five: five, week: snap.gauges.first(where: { $0.id == "week" }),
                          all: snap.gauges, demo: true)
            } else {
                setTransient("Z·demo")
            }
            return
        }
        guard let snap = snapshot else { setTransient("barstats…"); return }
        if let message = snap.errorMessage {
            setTransient(message.contains("token") || message.contains("Unauthorized")
                         ? "⚠︎ z.ai auth" : "⚠︎ z.ai")
            return
        }
        guard let five = snap.gauges.first(where: { $0.id == "fiveHour" }) else {
            setTransient("z.ai")
            return
        }
        applyBars(five: five, week: snap.gauges.first(where: { $0.id == "week" }),
                  all: snap.gauges, demo: false)
    }

    private func applyBars(five: Gauge, week: Gauge?, all: [Gauge], demo: Bool) {
        guard let button = statusItem.button else { return }
        button.image = batteryBarsImage(fiveRemaining: five.remainingPct / 100,
                                        fiveBand: five.band,
                                        weekRemaining: week?.remainingPct,
                                        weekBand: week?.band)
        button.attributedTitle = escalationTitle(for: five, demo: demo)
        var tip = "Z.AI Coding Plan"
        for gauge in all {
            tip += "\n\(gauge.label): \(Int(gauge.pct.rounded()))% used"
            if let used = gauge.used, let total = gauge.total {
                tip += " (\(compactCount(used))/\(compactCount(total)) tokens)"
            }
            if let reset = resetText(gauge.resetAt) { tip += " · \(reset)" }
        }
        button.toolTip = tip
    }

    /// Escalating text next to the bars: calm when green, numbers when it matters.
    private func escalationTitle(for five: Gauge, demo: Bool) -> NSAttributedString {
        let composed = NSMutableAttributedString()
        let remaining = Int(five.remainingPct.rounded())
        let short = shortReset(five.resetAt)
        switch five.band {
        case .green:
            let text = short ?? "\(remaining)%"
            composed.append(StatusText.run(text, color: .secondaryLabelColor))
        case .yellow, .red:
            composed.append(StatusText.run("\(remaining)%", color: five.band.color,
                                           font: StatusText.emphasis))
            if let short {
                composed.append(StatusText.run(" · \(short)", color: .secondaryLabelColor))
            }
        }
        if demo {
            composed.append(StatusText.run(" demo", color: .tertiaryLabelColor))
        }
        return composed
    }

    /// Plain text for transient/error states.
    private func setTransient(_ text: String) {
        guard let button = statusItem.button else { return }
        button.image = nil
        button.toolTip = nil
        button.attributedTitle = NSAttributedString(
            string: text,
            attributes: [.font: StatusText.base, .foregroundColor: NSColor.secondaryLabelColor])
    }

    private func rebuild(reason: String) {
        updateStatusItem()
        if popover.isShown {
            popoverController.present(snapshot: snapshot, config: config, target: self,
                                      actions: popoverActions)
        }
    }

    // MARK: popover + utility menu

    private var popoverActions: [(String, Selector)] {
        [("Refresh", #selector(refreshMenuItem(_:))),
         ("Raw JSON", #selector(copyRaw(_:)))]
        + (demoMode ? [] : [("Token…", #selector(setToken(_:)))])
        + [("Quit", #selector(NSApplication.terminate(_:)))]
    }

    private func buildUtilityMenu() {
        menu.removeAllItems()
        let refreshItem = NSMenuItem(title: "Refresh Now", action: #selector(refreshMenuItem(_:)), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)
        if !demoMode {
            let copy = NSMenuItem(title: "Copy Raw Response", action: #selector(copyRaw(_:)), keyEquivalent: "")
            copy.target = self
            menu.addItem(copy)
            let token = NSMenuItem(title: "Set Token…", action: #selector(setToken(_:)), keyEquivalent: "")
            token.target = self
            menu.addItem(token)
        }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit barstats", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
    }

    private func showPopover() {
        guard let button = statusItem.button else { return }
        popover.contentViewController = popoverController
        popover.delegate = self
        popoverController.present(snapshot: snapshot, config: config, target: self,
                                  actions: popoverActions)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    }

    @objc private func statusItemClicked(_ sender: Any?) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            if let button = statusItem.button {
                menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 6), in: button)
            }
            return
        }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            showPopover()
        }
    }

    func popoverWillShow(_ notification: Notification) {
        // Fresh data + fresh cards every time the panel opens.
        popoverController.present(snapshot: snapshot, config: config, target: self,
                                  actions: popoverActions)
    }

    func popoverDidClose(_ notification: Notification) {
        popoverController.close()
    }

    // MARK: actions

    @objc private func copyRaw(_ sender: Any?) {
        let text = snapshot?.rawJSON.isEmpty == false ? snapshot!.rawJSON : (snapshot?.errorMessage ?? "")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    @objc private func setToken(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "Z.AI credential for usage queries"
        alert.informativeText = """
        Get the token the z.ai dashboard itself uses:
        1. Sign in at z.ai and open the usage page
           (z.ai/manage-apikey/coding-plan/personal/usage)
        2. DevTools → Application → Local Storage → https://z.ai
        3. Copy the value of "z-ai-open-platform-token-production" and paste it here.
        Stored locally in ~/.barstats/config.json with owner-only permissions.
        """
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 24))
        field.placeholderString = "token / api key"
        alert.accessoryView = field
        alert.addButton(withTitle: "Save & Test")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let candidate = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty else { return }

        setTransient("…checking token")
        Task { @MainActor in
            var trial = config
            trial.zaiToken = candidate
            trial.authScheme = nil
            let snap = await ZaiSource.fetchSnapshot(config: trial)
            if snap.errorMessage?.lowercased().contains("authoriz") == true
                || snap.errorMessage?.lowercased().contains("token") == true {
                let fail = NSAlert()
                fail.messageText = "Token rejected"
                fail.informativeText = snap.errorMessage ?? "Authorization failed."
                fail.runModal()
                rebuild(reason: "token-rejected")
                return
            }
            config = trial
            config.authScheme = snap.usedScheme
            ConfigStore.save(config)
            applySnapshot(snap)
        }
    }
}

// MARK: - Formatting helpers

extension String {
    func pad(toWidth width: Int) -> String {
        count >= width ? self : padding(toLength: width, withPad: " ", startingAt: 0)
    }
}

func compactCount(_ value: Double) -> String {
    if value >= 1_000_000 { return String(format: "%.1fM", value / 1_000_000) }
    if value >= 1_000 { return String(format: "%.1fk", value / 1_000) }
    return value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
}

func resetText(_ date: Date?) -> String? {
    guard let date else { return nil }
    let interval = date.timeIntervalSinceNow
    if interval <= 0 { return "Reset time reached" }
    let hours = Int(interval) / 3600
    let minutes = (Int(interval) % 3600) / 60
    if hours > 0 { return "Resets in \(hours)h \(minutes)m" }
    return "Resets in \(minutes)m"
}
