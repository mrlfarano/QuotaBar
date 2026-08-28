import AppKit

// MARK: - Inline menu settings
//
// The status-item dropdown hosts its own settings panel — there is no
// separate settings window. The rows are NSMenuItems with attached views:
// poll-cadence radios and per-source checkboxes (with a one-line status
// under each when something is wrong). Text editing can't live in a menu —
// menu tracking windows never become key, so an NSTextField there gets no
// caret and typing goes nowhere — so key entry happens in "Paste API
// Keys…", a small standard editor (Return saves, Escape cancels, empty
// keeps, × removes). Every change applies live through `onApply`, which
// saves via ConfigStore (keeps 0600) and refreshes sources; the menu is
// only rebuilt after it closes. Custom sources and the OAuth-managed
// tokens stay JSON-first, reachable via "Open config.json…".

/// Pure settings logic behind the menu rows (unit-tested).
enum SettingsLogic {

    static let pollChoices = [1, 2, 5, 10, 15, 30]

    static let toggleableSources: [(id: String, title: String)] = [
        ("zai", "Z.AI Coding Plan"),
        ("github", "GitHub API"),
        ("claude", "Claude Pro/Max"),
        ("codex", "Codex / ChatGPT"),
        ("openrouter", "OpenRouter"),
        ("copilot", "GitHub Copilot"),
        ("antigravity", "Antigravity"),
    ]

    static let keyFields: [(id: String, title: String, tooltip: String)] = [
        ("zai", "Z.AI",
         "Discover Sources (⌘D) scans browser localStorage for the z.ai token "
         + "first — pasting here is the fallback: z.ai → usage page → DevTools → "
         + "Application → Local Storage → \"z-ai-open-platform-token-production\". "
         + "Stored in ~/.quotabar/config.json (owner-only)."),
        ("github", "GitHub",
         "Optional personal-access token; raises the core rate limit from 60/hr to 5,000/hr."),
        ("openrouter", "OpenRouter",
         "OpenRouter API key (sk-or-…)."),
    ]

    /// Stars for everything but the last 5 characters, so a stored key is
    /// recognizable without being readable. The star count is fixed — the
    /// mask must not leak the key's length.
    static func maskedKey(_ key: String) -> String {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > 5 else { return String(repeating: "*", count: trimmed.count) }
        return String(repeating: "*", count: 8) + trimmed.suffix(5)
    }

    /// Stored value behind a key field ("" when unset).
    static func keyValue(_ config: QuotaBarConfig, id: String) -> String {
        switch id {
        case "zai": return config.zaiToken
        case "github": return config.sources?.github?.token ?? ""
        case "openrouter": return config.sources?.openrouter?.token ?? ""
        default: return ""
        }
    }

    /// Store one key. Z.AI also drops the remembered auth scheme so the next
    /// fetch re-probes header styles. Source structs are created on demand —
    /// pasting a key reads as intent to use the source, so a fresh struct
    /// carries the enabled-by-default state; an existing one keeps its
    /// `enabled` flag and other credentials untouched.
    static func setKey(_ config: QuotaBarConfig, id: String, key: String) -> QuotaBarConfig {
        var config = config
        switch id {
        case "zai":
            config.zaiToken = key
            config.authScheme = nil
            // Fresh entry carries the enabled default; an existing one keeps
            // its flag (an explicit opt-out survives key entry, as with the
            // other key fields).
            if config.sources == nil { config.sources = SourcesConfig() }
            if config.sources?.zai == nil { config.sources?.zai = OAuthSourceConfig() }
        case "github":
            if config.sources == nil { config.sources = SourcesConfig() }
            var github = config.sources?.github ?? GitHubSourceConfig()
            github.token = key
            config.sources?.github = github
        case "openrouter":
            if config.sources == nil { config.sources = SourcesConfig() }
            var openrouter = config.sources?.openrouter ?? OAuthSourceConfig()
            openrouter.token = key
            config.sources?.openrouter = openrouter
        default: break
        }
        return config
    }

    // MARK: enable-state logic (pure; unit-tested)

    /// Mirrors the fetch gates in AppDelegate: Z.AI and GitHub poll unless
    /// explicitly disabled; OAuth-backed sources only poll when explicitly
    /// enabled (discovery or a pasted key creates that entry).
    static func isSourceEnabled(_ config: QuotaBarConfig, id: String) -> Bool {
        switch id {
        case "zai": return config.sources?.zai?.enabled ?? true
        case "github": return config.sources?.github?.enabled ?? true
        case "claude": return config.sources?.claude?.enabled ?? false
        case "codex": return config.sources?.codex?.enabled ?? false
        case "openrouter": return config.sources?.openrouter?.enabled ?? false
        case "copilot": return config.sources?.copilot?.enabled ?? false
        case "antigravity": return config.sources?.antigravity?.enabled ?? false
        default: return false
        }
    }

    /// Toggle one source without disturbing its stored credentials or
    /// discovery state (mutates only `enabled`, creating the struct if needed).
    static func setSourceEnabled(_ config: QuotaBarConfig, id: String, enabled: Bool) -> QuotaBarConfig {
        var config = config
        if config.sources == nil { config.sources = SourcesConfig() }
        func oauth(_ current: OAuthSourceConfig?) -> OAuthSourceConfig {
            var source = current ?? OAuthSourceConfig()
            source.enabled = enabled
            return source
        }
        switch id {
        case "zai":
            let source = oauth(config.sources?.zai)
            config.sources?.zai = source
        case "github":
            var github = config.sources?.github ?? GitHubSourceConfig()
            github.enabled = enabled
            config.sources?.github = github
        case "claude":
            let source = oauth(config.sources?.claude)
            config.sources?.claude = source
        case "codex":
            let source = oauth(config.sources?.codex)
            config.sources?.codex = source
        case "openrouter":
            let source = oauth(config.sources?.openrouter)
            config.sources?.openrouter = source
        case "copilot":
            let source = oauth(config.sources?.copilot)
            config.sources?.copilot = source
        case "antigravity":
            let source = oauth(config.sources?.antigravity)
            config.sources?.antigravity = source
        default: break
        }
        return config
    }

    // MARK: per-source status lines (pure; unit-tested)

    /// One-line status under a source's checkbox. Calm by design: disabled
    /// and healthy sources show nothing; only problems and pending first
    /// fetches speak up.
    static func sourceStatus(id: String, config: QuotaBarConfig,
                             sections: [SourceSection]) -> String? {
        guard isSourceEnabled(config, id: id) else { return nil }
        guard let section = sections.first(where: { $0.id == id }) else {
            return "waiting for first fetch"
        }
        if let message = section.errorMessage {
            return "⚠︎ \(shortStatus(message))"
        }
        if section.gauges.isEmpty {
            if let notice = section.notice { return shortStatus(notice) }
            return "waiting for data"
        }
        return nil
    }

    /// First sentence of a message, capped with an ellipsis — long errors
    /// must not widen the whole settings block.
    static func shortStatus(_ message: String, max: Int = 40) -> String {
        let first = message.split(whereSeparator: \.isNewline).first.map(String.init) ?? message
        let trimmed = first.trimmingCharacters(in: .whitespaces)
        guard trimmed.count > max else { return trimmed }
        return String(trimmed.prefix(max - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    // MARK: key editing (pure; unit-tested)

    /// What one field's state in the Paste API Keys editor means.
    enum KeyEdit: Equatable {
        case keep                       // untouched, empty, or still the mask
        case set(String)
        case clear
    }

    /// Text editing inside a tracking NSMenu is a dead end (no caret, no
    /// field editor — the window never becomes key), so keys are edited in
    /// a standard alert window; this is the pure decision behind each row.
    static func resolveKeyEdit(current: String, fieldText: String,
                                clearRequested: Bool) -> KeyEdit {
        if clearRequested { return .clear }
        let trimmed = fieldText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == maskedKey(current) { return .keep }
        return .set(trimmed)
    }
}

/// Builds the settings rows embedded at the bottom of the status menu.
/// One instance per menu build; replaced whenever the menu is rebuilt.
final class InlineSettingsPanel: NSObject {

    private static let panelWidth: CGFloat = 320

    /// Invoked on the main thread after each change with the updated config.
    var onApply: ((QuotaBarConfig) -> Void)?

    private var config: QuotaBarConfig
    /// Last fetch results, for the per-source status lines.
    private var sections: [SourceSection]
    private var pollRadios: [NSButton] = []
    /// Transient state of the open Paste API Keys editor.
    private var keyEditorFields: [String: NSTextField] = [:]
    private var clearRequestedIds: Set<String> = []

    init(config: QuotaBarConfig, sections: [SourceSection] = []) {
        self.config = config
        self.sections = sections
    }

    /// The settings block: header row is added by the caller so it matches
    /// the other disabled menu headers.
    func items() -> [NSMenuItem] {
        var items: [NSMenuItem] = [
            viewItem(pollRow()),
            viewItem(sourcesGrid()),
        ]
        let pasteKeys = NSMenuItem(title: "Paste API Keys…",
                                   action: #selector(editKeys(_:)), keyEquivalent: "")
        pasteKeys.target = self
        items.append(pasteKeys)
        let openConfig = NSMenuItem(title: "Open config.json…",
                                    action: #selector(openConfigFile(_:)), keyEquivalent: "")
        openConfig.target = self
        items.append(openConfig)
        return items
    }

    // MARK: rows

    private func viewItem(_ view: NSView) -> NSMenuItem {
        let item = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        item.view = view
        return item
    }

    /// Wraps content in a fixed-width container so every settings row shares
    /// the menu panel's width; height comes from the content's constraints.
    private func panel(_ content: NSView) -> NSView {
        content.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView(frame: NSRect(x: 0, y: 0, width: Self.panelWidth, height: 10))
        container.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: container.topAnchor, constant: 4),
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 18),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -18),
            content.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -4),
        ])
        container.frame.size.height = container.fittingSize.height
        return container
    }

    private func pollRow() -> NSView {
        let small = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        let label = NSTextField(labelWithString: "Poll every")
        label.font = small
        let row = NSStackView(views: [label])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 2
        let active = normalizedPollMinutes(config.pollMinutes)
        // Hand-edited cadences outside the presets get their own radio so
        // the row never shows nothing-selected.
        var choices = SettingsLogic.pollChoices
        if !choices.contains(active) {
            choices.append(active)
            choices.sort()
        }
        for minutes in choices {
            let radio = NSButton(radioButtonWithTitle: "\(minutes)",
                                 target: self, action: #selector(changedPoll(_:)))
            radio.controlSize = .small
            radio.font = small
            radio.identifier = NSUserInterfaceItemIdentifier("\(minutes)")
            radio.state = active == minutes ? .on : .off
            pollRadios.append(radio)
            row.addArrangedSubview(radio)
        }
        let unit = NSTextField(labelWithString: "min")
        unit.font = small
        row.addArrangedSubview(unit)
        return panel(row)
    }

    private func sourcesGrid() -> NSView {
        let grid = NSGridView(numberOfColumns: 2, rows: 0)
        grid.rowSpacing = 4
        grid.columnSpacing = 18
        var row: [NSView] = []
        for source in SettingsLogic.toggleableSources {
            let check = NSButton(checkboxWithTitle: source.title,
                                 target: self, action: #selector(toggledSource(_:)))
            check.controlSize = .small
            check.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
            check.identifier = NSUserInterfaceItemIdentifier(source.id)
            check.state = SettingsLogic.isSourceEnabled(config, id: source.id) ? .on : .off
            let cell = NSStackView(views: [check])
            cell.orientation = .vertical
            cell.alignment = .leading
            cell.spacing = 0
            // Problem/pending status under the checkbox; empty label keeps
            // row heights even when everything is calm.
            let status = NSTextField(labelWithString: SettingsLogic.sourceStatus(
                id: source.id, config: config, sections: sections) ?? "")
            status.font = .systemFont(ofSize: 10)
            status.textColor = .tertiaryLabelColor
            status.lineBreakMode = .byTruncatingTail
            cell.addArrangedSubview(status)
            row.append(cell)
            if row.count == 2 {
                grid.addRow(with: row)
                row = []
            }
        }
        if !row.isEmpty { grid.addRow(with: row) }
        return panel(grid)
    }

    // MARK: key editing

    /// Paste API Keys… — a standard editor window. Menus can't host text
    /// editing (no caret in a tracking menu), and a real window gets all
    /// of it for free: caret, paste, Return saves, Escape cancels. Fields
    /// are prefilled with the mask; × queues a removal; empty keeps the
    /// stored key.
    @objc private func editKeys(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "API keys"
        alert.informativeText = "Paste over a field to replace its key — leave empty to keep it. Stored in ~/.quotabar/config.json (owner-only)."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        var fields: [String: NSTextField] = [:]
        var clears: Set<String> = []
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        for field in SettingsLogic.keyFields {
            let current = SettingsLogic.keyValue(config, id: field.id)
            let label = NSTextField(labelWithString: field.title)
            label.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
            label.toolTip = field.tooltip

            let input = NSTextField(string: current.isEmpty ? "" : SettingsLogic.maskedKey(current))
            input.placeholderString = current.isEmpty ? "paste key…" : ""
            input.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
            input.toolTip = field.tooltip
            input.identifier = NSUserInterfaceItemIdentifier(field.id)
            input.widthAnchor.constraint(equalToConstant: 210).isActive = true
            fields[field.id] = input

            var views: [NSView] = [label, input]
            if !current.isEmpty {
                let clear = NSButton(title: "×", target: self, action: #selector(clearKeyRequested(_:)))
                clear.isBordered = false
                clear.toolTip = "Remove the stored key"
                clear.identifier = NSUserInterfaceItemIdentifier(field.id)
                views.append(clear)
            }
            let row = NSStackView(views: views)
            row.orientation = .horizontal
            row.alignment = .centerY
            row.spacing = 8
            stack.addArrangedSubview(row)
        }
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 10))
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 4),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -4),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -4),
        ])
        container.frame.size.height = container.fittingSize.height
        alert.accessoryView = container
        alert.window.initialFirstResponder = fields[SettingsLogic.keyFields.first?.id ?? "zai"]

        NSApp.activate(ignoringOtherApps: true)  // same activation the Discover alert uses
        clearRequestedIds = clears
        keyEditorFields = fields
        guard alert.runModal() == .alertFirstButtonReturn else {
            clearRequestedIds = []
            keyEditorFields = [:]
            return
        }
        clears = clearRequestedIds
        clearRequestedIds = []
        keyEditorFields = [:]

        if let updated = updatedConfig(fields: fields, clears: clears) {
            config = updated
            apply()
        }
    }

    @objc private func clearKeyRequested(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue,
              let input = keyEditorFields[id] else { return }
        clearRequestedIds.insert(id)
        input.stringValue = ""
        input.placeholderString = "will be removed"
    }

    /// Pure-ish seam for the Save path (unit-tested): resolves every
    /// field into a key edit and returns the updated config, or nil when
    /// nothing changed.
    func updatedConfig(fields: [String: NSTextField], clears: Set<String>) -> QuotaBarConfig? {
        var updated = config
        var changed = false
        for field in SettingsLogic.keyFields {
            guard let input = fields[field.id] else { continue }
            let current = SettingsLogic.keyValue(config, id: field.id)
            switch SettingsLogic.resolveKeyEdit(current: current,
                                                fieldText: input.stringValue,
                                                clearRequested: clears.contains(field.id)) {
            case .keep:
                continue
            case .set(let key):
                updated = SettingsLogic.setKey(updated, id: field.id, key: key)
                changed = true
            case .clear:
                updated = SettingsLogic.setKey(updated, id: field.id, key: "")
                changed = true
            }
        }
        return changed ? updated : nil
    }

    // MARK: actions

    @objc private func changedPoll(_ sender: NSButton) {
        guard let raw = sender.identifier?.rawValue, let minutes = Int(raw) else { return }
        config.pollMinutes = normalizedPollMinutes(minutes)
        for radio in pollRadios where radio !== sender { radio.state = .off }
        apply()
    }

    @objc private func toggledSource(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        config = SettingsLogic.setSourceEnabled(config, id: id, enabled: sender.state == .on)
        apply()
    }

    @objc private func openConfigFile(_ sender: Any?) {
        NSWorkspace.shared.open(ConfigStore.configFileURL)
    }

    private func apply() {
        onApply?(config)
    }
}
