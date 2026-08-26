import AppKit

// MARK: - Ring view

final class RingView: NSView {
    var fraction: Double = 1 { didSet { needsDisplay = true } }
    var color: NSColor = .systemGreen { didSet { needsDisplay = true } }
    var ringWidth: CGFloat = 5 { didSet { needsDisplay = true } }

    override func draw(_ dirtyRect: NSRect) {
        let bounds = self.bounds.insetBy(dx: ringWidth / 2 + 1, dy: ringWidth / 2 + 1)
        strokeRing(in: bounds, fraction: fraction, color: color,
                   lineWidth: ringWidth, trackColor: .quaternaryLabelColor,
                   flipped: false)
    }
}

// MARK: - Gauge card

final class GaugeCard: NSView {
    private let ring = RingView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let statusLabel = NSTextField(labelWithString: "")
    private let resetLabel = NSTextField(labelWithString: "")
    private let tokensLabel = NSTextField(labelWithString: "")
    private var detailRows: [NSTextField] = []

    private var gauge: Gauge?

    init(gauge: Gauge) {
        super.init(frame: .zero)
        self.gauge = gauge

        ring.fraction = gauge.remainingPct / 100
        ring.color = gauge.band.color
        ring.ringWidth = gauge.id == "mcp" ? 3.5 : 5
        ring.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.stringValue = gauge.label
        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textColor = .labelColor
        statusLabel.font = .monospacedDigitSystemFont(ofSize: 20, weight: .bold)
        statusLabel.textColor = gauge.band.color
        resetLabel.font = .systemFont(ofSize: 12)
        resetLabel.textColor = .secondaryLabelColor
        tokensLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        tokensLabel.textColor = .tertiaryLabelColor

        for field in [titleLabel, statusLabel, resetLabel, tokensLabel] {
            field.translatesAutoresizingMaskIntoConstraints = false
        }
        for field in [titleLabel, statusLabel, resetLabel, tokensLabel] {
            addSubview(field)
        }
        addSubview(ring)

        let textColumn = [titleLabel, statusLabel, resetLabel, tokensLabel]
        NSLayoutConstraint.activate([
            ring.leadingAnchor.constraint(equalTo: leadingAnchor),
            ring.centerYAnchor.constraint(equalTo: centerYAnchor),
            ring.widthAnchor.constraint(equalToConstant: gauge.id == "mcp" ? 40 : 54),
            ring.heightAnchor.constraint(equalToConstant: gauge.id == "mcp" ? 40 : 54),
            titleLabel.leadingAnchor.constraint(equalTo: ring.trailingAnchor, constant: 12),
            titleLabel.topAnchor.constraint(equalTo: ring.topAnchor, constant: 2),
            statusLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: ring.centerYAnchor, constant: 2),
            resetLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            tokensLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            resetLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 2),
            tokensLabel.topAnchor.constraint(equalTo: resetLabel.bottomAnchor, constant: 1),
            tokensLabel.bottomAnchor.constraint(lessThanOrEqualTo: ring.bottomAnchor, constant: 2),
        ])
        _ = textColumn

        updateText()
        rebuildDetails()
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    func update(gauge: Gauge) {
        self.gauge = gauge
        ring.fraction = gauge.remainingPct / 100
        ring.color = gauge.band.color
        updateText()
        rebuildDetails()
    }

    /// Called every second while the popover is open.
    func tick() {
        updateText()
    }

    private func updateText() {
        guard let gauge else { return }
        statusLabel.stringValue = "\(Int(gauge.remainingPct.rounded()))% left"
        resetLabel.stringValue = resetText(gauge.resetAt) ?? ""
        if let used = gauge.used, let total = gauge.total, total > 0 {
            let unit = gauge.id == "mcp" ? "times" : "tokens"
            tokensLabel.stringValue = "\(compactCount(used)) / \(compactCount(total)) \(unit) used"
        } else {
            tokensLabel.stringValue = ""
        }
    }

    private func rebuildDetails() {
        detailRows.forEach { $0.removeFromSuperview() }
        detailRows.removeAll()
        guard let details = gauge?.details?.sorted(by: { $0.usage > $1.usage }).prefix(3),
              details.first(where: { $0.usage > 0 }) != nil else { return }
        var previous: NSView = tokensLabel
        for entry in details where entry.usage > 0 {
            let row = NSTextField(labelWithString: "\(entry.modelCode)  ·  \(compactCount(entry.usage))")
            row.font = .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular)
            row.textColor = .tertiaryLabelColor
            row.translatesAutoresizingMaskIntoConstraints = false
            addSubview(row)
            NSLayoutConstraint.activate([
                row.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor, constant: 8),
                row.topAnchor.constraint(equalTo: previous.bottomAnchor, constant: 1),
            ])
            detailRows.append(row)
            previous = row
        }
    }
}

// MARK: - Popover content

final class PopoverController: NSViewController {

    private let headerTitle = NSTextField(labelWithString: "Z.AI Coding Plan")
    private let headerSubtitle = NSTextField(labelWithString: "")
    private let cardsStack = NSStackView()
    private let footerLabel = NSTextField(labelWithString: "")
    private let footerButtons = NSStackView()
    private var cards: [GaugeCard] = []
    private var timer: Timer?
    private var snapshot: Snapshot?
    private var fetchedAt: Date?

    override func loadView() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 330, height: 320))

        headerTitle.font = .systemFont(ofSize: 15, weight: .bold)
        headerTitle.textColor = .labelColor
        headerSubtitle.font = .systemFont(ofSize: 11)
        headerSubtitle.textColor = .secondaryLabelColor

        let header = NSStackView(views: [headerTitle, headerSubtitle])
        header.orientation = .horizontal
        header.spacing = 6
        header.alignment = .firstBaseline
        header.distribution = .fill

        cardsStack.orientation = .vertical
        cardsStack.alignment = .leading
        cardsStack.spacing = 14

        footerLabel.font = .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular)
        footerLabel.textColor = .tertiaryLabelColor

        footerButtons.orientation = .horizontal
        footerButtons.spacing = 8

        let root = NSStackView(views: [header, cardsStack, footerLabel, footerButtons])
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 14
        root.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 14, right: 16)
        root.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            root.topAnchor.constraint(equalTo: container.topAnchor),
            root.bottomAnchor.constraint(lessThanOrEqualTo: container.bottomAnchor, constant: -4),
        ])
        view = container
    }

    /// Rebuild cards from the latest snapshot and hook up footer actions.
    func present(snapshot: Snapshot?, config: BarStatsConfig, target: AnyObject?,
                 actions: [(String, Selector)]) {
        self.snapshot = snapshot
        fetchedAt = snapshot?.fetchedAt

        if let level = snapshot?.planLevel {
            headerSubtitle.stringValue = "(\(level)) · \(URL(string: config.baseURL)?.host ?? config.baseURL)"
        } else {
            headerSubtitle.stringValue = URL(string: config.baseURL)?.host ?? config.baseURL
        }

        cards.forEach { $0.removeFromSuperview() }
        cards.removeAll()
        if let snap = snapshot {
            for gauge in snap.gauges {
                let card = GaugeCard(gauge: gauge)
                card.translatesAutoresizingMaskIntoConstraints = false
                cardsStack.addArrangedSubview(card)
                card.widthAnchor.constraint(lessThanOrEqualToConstant: 300).isActive = true
                cards.append(card)
            }
            if snap.gauges.isEmpty {
                let empty = NSTextField(labelWithString: snap.errorMessage ?? "No usage data yet")
                empty.textColor = .secondaryLabelColor
                empty.font = .systemFont(ofSize: 12)
                cardsStack.addArrangedSubview(empty)
            }
        } else {
            let empty = NSTextField(labelWithString: "No data yet")
            empty.textColor = .secondaryLabelColor
            cardsStack.addArrangedSubview(empty)
        }

        footerButtons.views.forEach { $0.removeFromSuperview() }
        for (title, selector) in actions {
            let button = NSButton(title: title, target: target, action: selector)
            button.controlSize = .small
            button.bezelStyle = .roundRect
            footerButtons.addArrangedSubview(button)
        }

        updateFooter(pollMinutes: config.pollMinutes)
        startTimer()
        view.layoutSubtreeIfNeeded()
        preferredContentSize = view.fittingSize
    }

    func close() {
        timer?.invalidate()
        timer = nil
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.cards.forEach { $0.tick() }
            }
        }
    }

    private func updateFooter(pollMinutes: Int) {
        guard let fetchedAt else {
            footerLabel.stringValue = ""
            return
        }
        let age = Int(Date().timeIntervalSince(fetchedAt))
        let ageText: String
        if age < 60 { ageText = age <= 5 ? "just now" : "\(age)s ago" }
        else { ageText = "\(age / 60)m ago" }
        footerLabel.stringValue = "Updated \(ageText) · poll \(pollMinutes)m"
    }
}
