import XCTest
import AppKit
@testable import quotabar

// Wiring behind the inline settings rows: the panel's controls must push
// updated configs through `onApply` (which the app delegate saves and
// reacts to), re-mask key fields, and keep unrelated rows untouched.

final class InlinePanelTests: XCTestCase {

    private func findButtons(in view: NSView, id: String) -> [NSButton] {
        var found: [NSButton] = []
        for sub in view.subviews {
            if let button = sub as? NSButton, button.identifier?.rawValue == id {
                found.append(button)
            }
            found.append(contentsOf: findButtons(in: sub, id: id))
        }
        return found
    }

    private func findTextFields(in view: NSView, id: String) -> [NSTextField] {
        var found: [NSTextField] = []
        for sub in view.subviews {
            if let field = sub as? NSTextField, field.identifier?.rawValue == id {
                found.append(field)
            }
            found.append(contentsOf: findTextFields(in: sub, id: id))
        }
        return found
    }

    private func allViews(of panel: InlineSettingsPanel) -> [NSView] {
        panel.items().compactMap(\.view)
    }

    func testCheckboxTogglePushesUpdatedConfig() {
        let panel = InlineSettingsPanel(config: QuotaBarConfig())
        var applied: [QuotaBarConfig] = []
        panel.onApply = { applied.append($0) }

        let checkbox = findButtons(in: allViews(of: panel)[1], id: "claude").first
        XCTAssertNotNil(checkbox, "Claude checkbox missing from the sources grid")
        XCTAssertEqual(checkbox?.state, .off, "Claude starts disabled")

        checkbox?.state = .on
        NSApp.sendAction(checkbox!.action!, to: checkbox!.target, from: checkbox!)

        XCTAssertEqual(applied.count, 1)
        XCTAssertTrue(SettingsLogic.isSourceEnabled(applied[0], id: "claude"))
        XCTAssertEqual(applied[0].sources?.claude?.token,
                       SettingsLogic.keyValue(QuotaBarConfig(), id: "claude"),
                       "toggling must not create or change credentials")
    }

    func testPollRadioAppliesAndExcludesOthers() {
        let panel = InlineSettingsPanel(config: QuotaBarConfig())
        var applied: [QuotaBarConfig] = []
        panel.onApply = { applied.append($0) }

        let radios = findButtons(in: allViews(of: panel)[0], id: "10")
        XCTAssertEqual(radios.count, 1, "poll row must contain exactly one '10' radio")
        radios[0].state = .on
        NSApp.sendAction(radios[0].action!, to: radios[0].target, from: radios[0])

        XCTAssertEqual(applied.last?.pollMinutes, 10)
        let othersOn = findButtons(in: allViews(of: panel)[0], id: "5").first?.state == .on
        XCTAssertFalse(othersOn, "selecting one radio must clear the others")
    }

    func testKeyEditingLivesInTheAlertEditorNotTheMenu() {
        // Menu rows no longer host NSTextFields (no caret in a tracking
        // menu) — only the poll row, sources grid, and action items remain.
        let panel = InlineSettingsPanel(config: QuotaBarConfig())
        let allFields = allViews(of: panel).flatMap { findTextFields(in: $0, id: "zai") }
        XCTAssertTrue(allFields.isEmpty, "no editable key fields in the menu rows")
    }

    func testItemsIncludeOpenConfigAction() {
        let panel = InlineSettingsPanel(config: QuotaBarConfig())
        let openConfig = panel.items().first(where: { $0.title == "Open config.json…" })
        XCTAssertNotNil(openConfig)
        XCTAssertNotNil(openConfig?.target)
    }

    func testItemsIncludePasteKeysEditor() {
        let panel = InlineSettingsPanel(config: QuotaBarConfig())
        let pasteKeys = panel.items().first(where: { $0.title == "Paste API Keys…" })
        XCTAssertNotNil(pasteKeys, "key entry lives in the Paste API Keys editor")
        XCTAssertNotNil(pasteKeys?.target)
    }

    // MARK: key editing (Paste API Keys editor)

    private func findLabels(in view: NSView, containing text: String) -> [NSTextField] {
        var found: [NSTextField] = []
        for sub in view.subviews {
            if let field = sub as? NSTextField, !sub.isKind(of: NSButton.self),
               field.stringValue.contains(text) {
                found.append(field)
            }
            found.append(contentsOf: findLabels(in: sub, containing: text))
        }
        return found
    }

    func testResolveKeyEditSetKeepClear() {
        XCTAssertEqual(SettingsLogic.resolveKeyEdit(current: "old-key-abcde",
                                                    fieldText: "brand-new-key-1",
                                                    clearRequested: false), .set("brand-new-key-1"))
        XCTAssertEqual(SettingsLogic.resolveKeyEdit(current: "old-key-abcde",
                                                    fieldText: "  brand-new-key-1  ",
                                                    clearRequested: false), .set("brand-new-key-1"),
                       "pasted whitespace is trimmed")
        XCTAssertEqual(SettingsLogic.resolveKeyEdit(current: "old-key-abcde",
                                                    fieldText: "",
                                                    clearRequested: false), .keep,
                       "empty keeps the stored key")
        XCTAssertEqual(SettingsLogic.resolveKeyEdit(current: "old-key-abcde",
                                                    fieldText: "********abcde",
                                                    clearRequested: false), .keep,
                       "an untouched mask keeps the stored key")
        XCTAssertEqual(SettingsLogic.resolveKeyEdit(current: "old-key-abcde",
                                                    fieldText: "anything",
                                                    clearRequested: true), .clear,
                       "the × button overrides the field text")
        XCTAssertEqual(SettingsLogic.resolveKeyEdit(current: "",
                                                    fieldText: "",
                                                    clearRequested: false), .keep)
    }

    private func field(_ id: String, _ text: String) -> (String, NSTextField) {
        (id, NSTextField(string: text))
    }

    func testUpdatedConfigAppliesEveryKindOfEdit() {
        var config = QuotaBarConfig()
        config.zaiToken = "old-zai-abcde"
        config = SettingsLogic.setKey(config, id: "github", key: "gh-old-key-12345")
        let panel = InlineSettingsPanel(config: config)

        let updated = panel.updatedConfig(fields: [
            field("zai", "********abcde"),          // mask untouched, but × pressed
            field("github", "gh-fresh-98765"),       // replacement
            field("openrouter", "sk-or-v1-fresh-1"), // new key
        ].reduce(into: [String: NSTextField]()) { $0[$1.0] = $1.1 }, clears: ["zai"])

        XCTAssertNotNil(updated)
        XCTAssertEqual(updated?.zaiToken, "", "× wins over the untouched mask")
        XCTAssertEqual(updated?.sources?.github?.token, "gh-fresh-98765")
        XCTAssertEqual(updated?.sources?.openrouter?.token, "sk-or-v1-fresh-1")
        XCTAssertNil(updated?.authScheme, "a changed Z.AI key re-probes header styles")

        // Nothing changed → nil.
        XCTAssertNil(InlineSettingsPanel(config: QuotaBarConfig()).updatedConfig(
            fields: [field("zai", ""), field("github", ""), field("openrouter", "")]
                .reduce(into: [String: NSTextField]()) { $0[$1.0] = $1.1 },
            clears: []))
    }

    // MARK: poll cadence

    func testCustomPollCadenceGetsItsOwnRadio() {
        var config = QuotaBarConfig()
        config.pollMinutes = 45
        let panel = InlineSettingsPanel(config: config)
        var applied: [QuotaBarConfig] = []
        panel.onApply = { applied.append($0) }

        let pollRow = allViews(of: panel)[0]
        let custom = findButtons(in: pollRow, id: "45")
        XCTAssertEqual(custom.count, 1, "hand-edited 45m shows as its own radio")
        XCTAssertEqual(custom[0].state, .on)

        NSApp.sendAction(custom[0].action!, to: custom[0].target, from: custom[0])
        XCTAssertEqual(applied.last?.pollMinutes, 45)
    }

    // MARK: per-source status lines

    func testFetchErrorAppearsUnderItsCheckbox() {
        var config = QuotaBarConfig()
        config = SettingsLogic.setSourceEnabled(config, id: "claude", enabled: true)
        let sections = [SourceSection(id: "claude", title: "Claude",
                                      errorMessage: "run `claude` once to re-authenticate")]
        let panel = InlineSettingsPanel(config: config, sections: sections)

        XCTAssertFalse(findLabels(in: allViews(of: panel)[1],
                                  containing: "run `claude` once").isEmpty,
                       "the settings grid carries the short error")
    }
}
