import AppKit

// MARK: - Settings window
//
// UI for the config fields people otherwise hand-edit in
// ~/.quotabar/config.json: poll cadence and per-source on/off. Every change
// applies live — saved via ConfigStore (keeps 0600) and pushed to the app
// delegate through `onApply`, which rebuilds the menu and refreshes sources.
// Custom sources and tokens stay JSON-first, reachable via "Open config.json…".

final class SettingsWindowController: NSWindowController {

    static let pollChoices = [1, 2, 5, 10, 15, 30]

    static let toggleableSources: [(id: String, title: String)] = [
        ("github", "GitHub API"),
        ("claude", "Claude Pro/Max"),
        ("codex", "Codex / ChatGPT"),
        ("openrouter", "OpenRouter"),
        ("copilot", "GitHub Copilot"),
        ("antigravity", "Antigravity"),
    ]

    /// Invoked on the main thread after each change with the updated config.
    var onApply: ((QuotaBarConfig) -> Void)?

    private var config: QuotaBarConfig
    private let pollPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private var sourceChecks: [String: NSButton] = [:]

    init(config: QuotaBarConfig) {
        self.config = config
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 236),
            styleMask: [.titled, .closable],
            backing: .buffered, defer: false)
        window.title = "QuotaBar Settings"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        for minutes in Self.pollChoices { pollPopup.addItem(withTitle: "\(minutes)") }
        window.contentView = buildContent()
        window.center()
        syncControls()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// Re-read all controls from the given config (used on each reopen).
    func refresh(from config: QuotaBarConfig) {
        self.config = config
        syncControls()
    }

    // MARK: enable-state logic (pure; unit-tested)

    /// Mirrors the fetch gates in AppDelegate: GitHub polls unless explicitly
    /// disabled; OAuth-backed sources only poll when explicitly enabled.
    static func isSourceEnabled(_ config: QuotaBarConfig, id: String) -> Bool {
        switch id {
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

    // MARK: UI

    private func buildContent() -> NSView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        stack.translatesAutoresizingMaskIntoConstraints = false

        pollPopup.target = self
        pollPopup.action = #selector(changedPoll(_:))
        let pollRow = NSStackView(views: [
            NSTextField(labelWithString: "Poll menu data every"),
            pollPopup,
            NSTextField(labelWithString: "minutes"),
        ])
        pollRow.orientation = .horizontal
        pollRow.spacing = 6

        let sourcesLabel = NSTextField(labelWithString: "Sources")
        sourcesLabel.font = .boldSystemFont(ofSize: NSFont.smallSystemFontSize)

        let grid = NSGridView(numberOfColumns: 2, rows: 0)
        grid.rowSpacing = 6
        grid.columnSpacing = 24
        var row: [NSView] = []
        for source in Self.toggleableSources {
            let check = NSButton(checkboxWithTitle: source.title, target: self,
                                 action: #selector(toggledSource(_:)))
            check.identifier = NSUserInterfaceItemIdentifier(source.id)
            sourceChecks[source.id] = check
            row.append(check)
            if row.count == 2 {
                grid.addRow(with: row)
                row = []
            }
        }
        if !row.isEmpty { grid.addRow(with: row) }

        let openConfig = NSButton(title: "Open config.json…", target: self,
                                  action: #selector(openConfigFile(_:)))
        openConfig.bezelStyle = .rounded

        stack.addArrangedSubview(pollRow)
        stack.addArrangedSubview(sourcesLabel)
        stack.addArrangedSubview(grid)
        stack.setCustomSpacing(14, after: sourcesLabel)
        stack.addArrangedSubview(openConfig)

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 236))
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor),
        ])
        return container
    }

    private func syncControls() {
        let minutes = normalizedPollMinutes(config.pollMinutes)
        if pollPopup.item(withTitle: "\(minutes)") == nil {
            pollPopup.addItem(withTitle: "\(minutes)")
        }
        pollPopup.selectItem(withTitle: "\(minutes)")
        for (id, check) in sourceChecks {
            check.state = Self.isSourceEnabled(config, id: id) ? .on : .off
        }
    }

    private func apply() {
        ConfigStore.save(config)
        onApply?(config)
    }

    // MARK: actions

    @objc private func changedPoll(_ sender: NSPopUpButton) {
        guard let title = sender.titleOfSelectedItem, let minutes = Int(title) else { return }
        config.pollMinutes = normalizedPollMinutes(minutes)
        apply()
    }

    @objc private func toggledSource(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        config = Self.setSourceEnabled(config, id: id, enabled: sender.state == .on)
        apply()
    }

    @objc private func openConfigFile(_ sender: NSButton) {
        NSWorkspace.shared.open(ConfigStore.configFileURL)
    }
}
