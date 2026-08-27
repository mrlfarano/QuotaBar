import AppKit

// MARK: - Entry point

let demoMode = CommandLine.arguments.contains("--demo")

// Offline parser check: barstats --parse payload.json -> "fiveHour=42% week=14%"
if CommandLine.arguments.contains("--parse"), let file = CommandLine.arguments.last {
    if let data = FileManager.default.contents(atPath: file),
       let object = try? JSONSerialization.jsonObject(with: data),
       let root = object as? [String: Any] {
        let gauges = QuotaResponseParser.gauges(from: root)
        func parseNum(_ value: Double) -> String {
            value == value.rounded() ? String(Int(value)) : String(value)
        }
        let lines = gauges.map { gauge -> String in
            var text = "\(gauge.id)=\(Int(gauge.pct.rounded()))%"
            if let used = gauge.used, let total = gauge.total { text += " [\(parseNum(used))/\(parseNum(total))]" }
            if let reset = gauge.resetAt { text += " resets@\(Int(reset.timeIntervalSince1970))" }
            return text
        }
        print(lines.joined(separator: " "))
        exit(gauges.isEmpty ? 1 : 0)
    }
    FileHandle.standardError.write(Data("barstats --parse: could not read \(file)\n".utf8))
    exit(2)
}

// Offline custom-source check: barstats --parse-custom config.json payload.json
if CommandLine.arguments.contains("--parse-custom"), CommandLine.arguments.count >= 4 {
    func loadJSON(_ path: String) -> [String: Any]? {
        guard let data = FileManager.default.contents(atPath: path),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any] else { return nil }
        return dict
    }
    let configPath = CommandLine.arguments[2]
    let payloadPath = CommandLine.arguments[3]
    guard var sourceDict = loadJSON(configPath), let payload = loadJSON(payloadPath),
          (sourceDict["id"] as? String) != nil else {
        FileHandle.standardError.write(Data("barstats --parse-custom: bad inputs\n".utf8))
        exit(2)
    }
    if (sourceDict["title"] is String) == false { sourceDict["title"] = nil }
    sourceDict["usedPath"] = (sourceDict["usedPath"] as? String) ?? ""
    sourceDict["limitPath"] = (sourceDict["limitPath"] as? String) ?? ""
    guard let encoded = try? JSONSerialization.data(withJSONObject: sourceDict),
          let source = try? JSONDecoder().decode(CustomSourceConfig.self, from: encoded) else {
        FileHandle.standardError.write(Data("barstats --parse-custom: cannot decode\n".utf8))
        exit(2)
    }
    let used = CustomSource.value(at: source.usedPath, in: payload)
    let total = CustomSource.value(at: source.limitPath, in: payload)
    guard let total, total > 0 else {
        print("error: limitPath '\(source.limitPath)' not found or zero")
        exit(1)
    }
    let u = used ?? 0
    print("\(source.id)=\(Int(u / total * 100))% [\(u)/\(total)]")
    exit(0)
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

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    private var statusItem: NSStatusItem!
    private let menu = NSMenu()
    private var config = ConfigStore.load()
    private var snapshot: Snapshot?
    private var sections: [SourceSection] = []
    private var refreshing = false
    private let demoMode: Bool
    private var demoGauges: [Gauge] = [
        Gauge(id: "fiveHour", label: "5-hour window", pct: 24, used: 28_800, total: 120_000,
              resetAt: Date().addingTimeInterval(2 * 3600 + 47 * 60)),
        Gauge(id: "week", label: "Weekly limit", pct: 58, used: 34_800, total: 60_000,
              resetAt: Date().addingTimeInterval(4 * 86400 + 3 * 3600)),
        Gauge(id: "mcp", label: "MCP monthly", pct: 3, used: 139, total: 4_000,
              resetAt: Date().addingTimeInterval(9 * 86400)),
    ]

    init(demoMode: Bool) {
        self.demoMode = demoMode
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Created here so the accessory activation policy is already applied;
        // items created before it can fail to register with the system.
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "barstats…"
        menu.delegate = self
        statusItem.menu = menu
        loadCachedSnapshot()
        rebuild(reason: "launch")
        Task { @MainActor in await refreshNow() }
        Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            self?.pollTick()
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
        if demoMode {
            sections = [
                SourceSection(id: "zai", title: "Demo data (--demo)", gauges: demoGauges),
                SourceSection(id: "github", title: "GitHub API · rate limit (demo)",
                              gauges: [Gauge(id: "gh-core", label: "Core requests",
                                             pct: 8, used: 5, total: 60,
                                             resetAt: Date().addingTimeInterval(40 * 60))]),
            ]
            let snap = Snapshot(fetchedAt: Date(), rawJSON: "", gauges: demoGauges,
                                errorMessage: nil, usedScheme: "")
            applySnapshot(snap)
            return
        }

        async let zaiSnap = ZaiSource.fetchSnapshot(config: config)
        var built: [SourceSection] = []
        let zai = await zaiSnap
        let host = URL(string: config.baseURL)?.host ?? config.baseURL
        let level = zai.planLevel.map { " (\($0))" } ?? ""
        built.append(SourceSection(id: "zai", title: "Z.AI Coding Plan\(level) · \(host)",
                                   gauges: zai.gauges,
                                   errorMessage: zai.errorMessage))
        if config.sources?.github?.enabled ?? true {
            built.append(await GitHubSource.fetch(token: config.sources?.github?.token))
        }
        for custom in config.sources?.custom ?? [] {
            built.append(await CustomSource.fetch(custom))
        }
        sections = built
        applySnapshot(zai)
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

    /// Paint the status item: concentric dual-ring glyph + escalating text
    /// (green = countdown only; yellow/red add the colored percent).
    private func updateStatusItem() {
        if demoMode {
            if let snap = snapshot, snap.gauges.contains(where: { $0.id == "fiveHour" }) {
                applyGlyph(snap: snap, demo: true)
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
        guard snap.gauges.contains(where: { $0.id == "fiveHour" || $0.id == "week" }) else {
            setTransient("z.ai")
            return
        }
        applyGlyph(snap: snap, demo: false)
    }

    /// Gauges driving the status bar: the source selected by config.mainSource
    /// (or "zai" default), falling back to z.ai, then any healthy section.
    private var statusGauges: [Gauge]? {
        let wanted = (config.mainSource ?? "zai").lowercased()
        if let match = sections.first(where: { $0.id == wanted && !$0.gauges.isEmpty }) {
            return match.gauges
        }
        if let zai = sections.first(where: { $0.id == "zai" && !$0.gauges.isEmpty }) {
            return zai.gauges
        }
        return sections.first(where: { !$0.gauges.isEmpty })?.gauges
    }

    private func applyGlyph(snap: Snapshot, demo: Bool) {
        guard let button = statusItem.button else { return }
        let gauges = demo ? snap.gauges : statusGauges ?? snap.gauges
        guard !gauges.isEmpty else { setTransient("⚠︎ no data"); return }
        let primary = gauges[0]
        let secondary = gauges.count > 1 ? gauges[1] : nil
        button.image = dualRingImage(fiveRemaining: primary.remainingPct,
                                     fiveBand: primary.band,
                                     weekRemaining: secondary?.remainingPct,
                                     weekBand: secondary?.band)
        button.attributedTitle = escalationTitle(for: primary, demo: demo)
        var tip = "Z.AI Coding Plan"
        for gauge in gauges {
            tip += "\n\(gauge.label): \(Int(gauge.pct.rounded()))% used"
            if let used = gauge.used, let total = gauge.total {
                tip += " (\(compactCount(used))/\(compactCount(total)) tokens)"
            }
            if let reset = resetText(gauge.resetAt) { tip += " · \(reset)" }
        }
        button.toolTip = tip
    }

    /// Escalating text: calm when green, numbers when it matters.
    private func escalationTitle(for gauge: Gauge, demo: Bool) -> NSAttributedString {
        let composed = NSMutableAttributedString()
        let remaining = Int(gauge.remainingPct.rounded())
        let short = shortReset(gauge.resetAt)
        switch gauge.band {
        case .green:
            composed.append(StatusText.run(short ?? "\(remaining)%",
                                           color: .labelColor))
        case .yellow, .red:
            composed.append(StatusText.run("\(remaining)%", color: gauge.band.color,
                                           font: StatusText.emphasis))
            if let short {
                let warning = gauge.band == .red ? " ⚠︎" : ""
                composed.append(StatusText.run(" · \(short)\(warning)",
                                               color: .labelColor))
            }
        }
        if demo {
            composed.append(StatusText.run(" demo", color: .tertiaryLabelColor))
        }
        return composed
    }

    /// Full-strength text for transient/error states.
    private func setTransient(_ text: String) {
        guard let button = statusItem.button else { return }
        button.image = nil
        button.toolTip = nil
        button.attributedTitle = NSAttributedString(
            string: text,
            attributes: [.font: StatusText.base, .foregroundColor: NSColor.labelColor])
    }

    // MARK: menu

    /// Recompute every menu row from current state. Called on updates; the
    /// menu is closed whenever this runs, so rebuilding from scratch is safe.
    private func rebuild(reason: String) {
        updateStatusItem()

        menu.removeAllItems()

        if sections.isEmpty {
            menu.addItem(disabledItem("No data yet"))
        }
        for section in sections {
            menu.addItem(disabledItem(section.title))
            if let message = section.errorMessage {
                menu.addItem(disabledItem("⚠︎ \(message)"))
            } else if section.gauges.isEmpty {
                menu.addItem(disabledItem("Waiting for data"))
            }
            for gauge in section.gauges {
                let menuFont = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .regular)
                let row = NSMutableAttributedString()
                row.append(StatusText.run(gauge.label.pad(toWidth: 13) + "  ",
                                          color: .secondaryLabelColor, font: menuFont))
                row.append(coloredBlocks(pct: gauge.pct, band: gauge.band))
                row.append(StatusText.run("  \(Int(gauge.pct.rounded()))% used · \(Int(gauge.remainingPct.rounded()))% left",
                                          color: gauge.band.color, font: menuFont))
                menu.addItem(attributedDisabledItem(row))

                var detail = ""
                if let used = gauge.used, let total = gauge.total, total > 0 {
                    let unit = gauge.id.hasPrefix("gh") ? "requests" : "tokens"
                    detail = "\(compactCount(used)) / \(compactCount(total)) \(unit)"
                }
                if let reset = resetText(gauge.resetAt) {
                    detail += detail.isEmpty ? "" : " · "
                    detail += reset
                }
                if !detail.isEmpty {
                    menu.addItem(attributedDisabledItem(
                        StatusText.run("    \(detail)", color: .tertiaryLabelColor, font: menuFont)))
                }
            }
            menu.addItem(.separator())
        }
        if snapshot != nil {
            let updatedRow = disabledItem("Updated —")
            updatedRow.representedObject = "updated-row"
            menu.addItem(updatedRow)
        }

        // Status-bar source picker: every section that currently has data.
        let healthyIds = sections.filter { !$0.gauges.isEmpty }.map { $0.id }
        if healthyIds.count > 1 {
            menu.addItem(disabledItem("Status Bar Source:"))
            let active = (config.mainSource ?? "zai").lowercased()
            for id in healthyIds {
                let name = sections.first(where: { $0.id == id })?.title ?? id
                let item = NSMenuItem(title: name, action: #selector(selectMainSource(_:)), keyEquivalent: "")
                item.representedObject = id
                item.target = self
                item.state = id == active ? .on : .off
                menu.addItem(item)
            }
            menu.addItem(.separator())
        }

        let refreshItem = NSMenuItem(title: "Refresh Now", action: #selector(refreshMenuItem(_:)), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        if !demoMode, snapshot?.rawJSON.isEmpty == false {
            let copy = NSMenuItem(title: "Copy Raw Response", action: #selector(copyRaw(_:)), keyEquivalent: "")
            copy.target = self
            menu.addItem(copy)
        }

        if !demoMode {
            let token = NSMenuItem(title: "Set Token…", action: #selector(setToken(_:)), keyEquivalent: "")
            token.target = self
            menu.addItem(token)
        }

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit barstats", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        // Refresh only volatile text in place. Calling rebuild() here would
        // removeAllItems() while the menu is tracking, which cancels the popup.
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        for item in menu.items where item.representedObject as? String == "updated-row" {
            if let snap = snapshot {
                let age = Int(Date().timeIntervalSince(snap.fetchedAt) / 60)
                item.title = "Updated \(formatter.string(from: snap.fetchedAt)) (\(age <= 0 ? "just now" : "\(age)m ago")), poll \(config.pollMinutes)m"
            } else {
                item.title = "No data yet"
            }
        }
    }

    private func attributedDisabledItem(_ attributed: NSAttributedString) -> NSMenuItem {
        let item = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        item.attributedTitle = attributed
        item.isEnabled = false
        return item
    }

    private func disabledItem(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    // MARK: actions

    @objc private func selectMainSource(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        config.mainSource = id
        ConfigStore.save(config)
        rebuild(reason: "main-source")
    }

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
