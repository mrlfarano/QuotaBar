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

    func testKeyFieldSavesAndReMasks() {
        var config = QuotaBarConfig()
        config.zaiToken = "existing-token-abcde"
        let panel = InlineSettingsPanel(config: config)
        var applied: [QuotaBarConfig] = []
        panel.onApply = { applied.append($0) }

        let field = findTextFields(in: allViews(of: panel)[2], id: "zai").first
        XCTAssertNotNil(field, "Z.AI key field missing")
        XCTAssertEqual(field?.stringValue, "********abcde", "field starts masked")

        // Fresh paste: entering clears, a candidate is stored re-masked.
        panel.controlTextDidBeginEditing(
            Notification(name: NSControl.textDidBeginEditingNotification, object: field!))
        XCTAssertEqual(field?.stringValue, "")
        field?.stringValue = " brand new key "
        panel.controlTextDidEndEditing(
            Notification(name: NSControl.textDidEndEditingNotification, object: field!))
        XCTAssertEqual(applied.last?.zaiToken, "brand new key")
        XCTAssertNil(applied.last?.authScheme, "new Z.AI key must re-probe header styles")
        XCTAssertEqual(field?.stringValue, "********w key", "re-masked after save")

        // Leaving the field empty restores the stored value untouched.
        panel.controlTextDidBeginEditing(
            Notification(name: NSControl.textDidBeginEditingNotification, object: field!))
        panel.controlTextDidEndEditing(
            Notification(name: NSControl.textDidEndEditingNotification, object: field!))
        XCTAssertEqual(applied.last?.zaiToken, "brand new key", "empty entry keeps the stored key")
        XCTAssertEqual(applied.count, 1, "no spurious apply for the empty round-trip")
    }

    func testItemsIncludeOpenConfigAction() {
        let panel = InlineSettingsPanel(config: QuotaBarConfig())
        let openConfig = panel.items().first(where: { $0.title == "Open config.json…" })
        XCTAssertNotNil(openConfig)
        XCTAssertNotNil(openConfig?.target)
    }

    // MARK: clear-key buttons

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

    func testClearKeyButtonRemovesStoredKey() {
        var config = QuotaBarConfig()
        config.zaiToken = "stored-key-abcde"
        let panel = InlineSettingsPanel(config: config)
        var applied: [QuotaBarConfig] = []
        panel.onApply = { applied.append($0) }

        let clear = findButtons(in: allViews(of: panel)[2], id: "zai").first
        XCTAssertNotNil(clear, "a stored key gets the × clear button")

        NSApp.sendAction(clear!.action!, to: clear!.target, from: clear!)
        XCTAssertEqual(applied.count, 1)
        XCTAssertEqual(applied[0].zaiToken, "", "× removes the key outright")
    }

    func testClearKeyButtonAbsentWithoutStoredKey() {
        let panel = InlineSettingsPanel(config: QuotaBarConfig())
        XCTAssertNil(findButtons(in: allViews(of: panel)[2], id: "zai").first,
                     "nothing to clear — no button")
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
