# 007 — Status-bar fallback, settings feedback, config parity (v0.11)

## Goal

Fix the six findings from the UI/UX critique of the inline-settings build
(2026-08-28). The unifying theme: the app is multi-provider in its menu but
Z.AI-first in its status item, error surface, and settings — and the
inline-in-NSMenu settings block applies changes that the UI can't confirm.

| Critique finding | Phase |
|---|---|
| Z.AI error overrides healthy `mainSource`/fallback in the status bar | 1 |
| `onApply` refresh silently swallowed while a fetch is in flight | 2 |
| Z.AI cannot be disabled; missing token = permanent `⚠︎ z.ai auth` | 3 |
| Settings changes need close+reopen to show; no per-source status; keys undeletable; custom pollMinutes shows no radio | 4 |
| Key fields arbitrary (Copilot "paste" is JSON-only) | 5 |
| Menu width/height hygiene, alignment, a11y, countdown ambiguity, stale screenshot | 6, 7, 8 |

## Non-goals

- **Popover/window settings migration.** Revisit after these land — the
  feedback loop (Phase 2) and per-source status (Phase 4) remove most of
  the pain that motivated it. Deciding now would be churn.
- **Custom-source editor UI** — stays JSON-first (`Open config.json…`).
- **Colorblind glyph redesign** — needs visual-design work, not a quick
  patch; arc length + red-state ⚠︎ partially cover. Deferred deliberately.
- **OAuth in-app sign-in** — existing roadmap item, unchanged.

## Phase 1 — Status presentation extracted + real fallback (S)

**Problem.** `updateStatusItem` (`main.swift:354-358`) early-returns on the
Z.AI snapshot's error, so the fallback promise in `statusGauges`
(`main.swift:368-377`) is unreachable when Z.AI *errors* (vs. empty), and a
healthy `mainSource` is masked by `⚠︎ z.ai auth`.

**Change.** New `Sources/quotabar/StatusPresentation.swift` — the decision
becomes a pure, unit-tested function:

```swift
enum StatusPresentation: Equatable {
    case glyph(gauges: [Gauge], warningBadge: Bool)  // badge = fell back / degraded
    case error(text: String)
    case idle                                          // no snapshot yet
}

static func decide(mainSource: String?, sections: [SourceSection],
                   zaiError: String?) -> StatusPresentation
```

Rules (healthy = section with gauges; wanted = `mainSource ?? "zai"`):

1. healthy(wanted) exists → `.glyph(wanted, badge: zaiError != nil && wanted != "zai")`
2. else any healthy section → `.glyph(that, badge: true)` — this is the
   README's promised fallback, finally real
3. else `zaiError` → `.error(text)` where text names the *failing source*
   (`"⚠︎ Z.AI auth"` / `"⚠︎ Z.AI"`), not hardcoded z.ai when the user's
   selected source is what failed — derive from `wanted`'s title
4. else `.idle` (`"quotabar…"`)

`updateStatusItem` rewires to `decide(...)`; `escalationTitle` appends a
tertiary `" ⚠︎"` run when `warningBadge`; the tooltip appends the Z.AI
error line (instead of hiding it from the bar entirely). Demo mode
bypasses `decide` unchanged.

**Tests.** New `Tests/quotabarTests/StatusPresentationTests.swift` — the
four rules above + "zai healthy → badge false" + "default source errored,
claude healthy → claude's gauges" (the exact scenario the README claims).

**Evidence.** `swift build && swift test`; visual `--demo` pass (demo path
must render identically to today).

## Phase 2 — Refresh re-arm (S)

**Problem.** `onApply` → `refreshNow()` hits `guard !refreshing`
(`main.swift:252`) and the change waits for `pollTick`'s age check — up to
`pollMinutes` (default 5 min) with zero feedback. Looks exactly like a
rejected key.

**Change.** Extract a tiny `RefreshGate` (pure struct, new file or
`QuotaProvider.swift`):

```swift
struct RefreshGate {
    private(set) var isRefreshing = false
    private var requestedDuringRefresh = false
    mutating func begin() -> Bool        // false if already active; marks request
    mutating func end() -> Bool          // true if a rerun was requested
}
```

`AppDelegate.refreshNow` uses it; `end()` returning true re-kicks
`Task { @MainActor in await refreshNow() }`. Behavior: at most one queued
rerun — no unbounded loop if fetches keep failing.

**Tests.** `RefreshGateTests` — begin/end idle, request-during-active
reruns exactly once, second request during rerun window queues again.

**Evidence.** `swift test`; manual: paste a key while a slow source is
mid-sync → data appears within seconds of the sync finishing.

## Phase 3 — Z.AI becomes a toggleable source (M)

**Problem.** `toggleableSources` (`Settings.swift:21-28`) has no `zai`;
`refreshNow` fetches Z.AI unconditionally (`main.swift:272`). Non-Z.AI
users get a permanent error surface they cannot dismiss.

**Change.**

- `QuotaProvider.swift`: `struct ZaiSourceConfig: Codable { var enabled: Bool = true }`;
  `SourcesConfig.zai: ZaiSourceConfig? = nil` — absent ⇒ enabled, so every
  existing config decodes unchanged (same optionality pattern as `github`).
- `Settings.swift`: `toggleableSources` gains `("zai", "Z.AI Coding Plan")`
  first; `isSourceEnabled`/`setSourceEnabled` gain the `zai` case
  (`?? true` default).
- `main.swift` `refreshNow`: gate the Z.AI fetch on
  `SettingsLogic.isSourceEnabled(config, id: "zai")`. When disabled: no zai
  section, and `applySnapshot(Snapshot(fetchedAt: Date(), rawJSON: "",
  gauges: [], errorMessage: nil, usedScheme: ""))` — the cache, "Updated"
  row, and Phase-1 fallthrough keep working; "Copy Raw Response" hides
  itself (rawJSON empty). The Z.AI key field stays in settings so
  re-enabling + pasting is one round-trip.
- **Config compat:** the Windows port reads the same `config.json`. Verify
  `windows/src/core/config.js` tolerates the new optional `sources.zai`
  (unknown-field behavior) as part of this phase; behavioral parity is
  Phase 7, not a blocker.

**Tests.** `SettingsTests` — legacy config (no `zai` key) decodes enabled;
`setSourceEnabled("zai", false)` writes only `sources.zai.enabled` and
leaves `zaiToken`/`authScheme` untouched; round-trip on/off.

**Evidence.** `swift test`; manual demo-adjacent pass with zai off:
status bar falls to the next healthy source, no ⚠︎ transient.

## Phase 4 — Settings block feedback (M)

**Problem.** (a) Toggling a source gives no in-place feedback; credentials
problems surface one close-reopen-fetch cycle later. (b) Stored keys
cannot be deleted from the UI. (c) A hand-edited `pollMinutes: 45`
renders with no radio selected (Windows port already solves this —
`windows/src/settingswindow.js:127-132`).

**Change.** All in `Settings.swift` + the `rebuild` call site:

- `InlineSettingsPanel.init(config:sections:)` (default `[]` so existing
  tests compile); `rebuild` passes current `sections`.
- `SettingsLogic.sourceStatus(enabled:section:) -> String?` — `nil`
  (disabled / nothing to say), `"✓"` (has gauges), `"⚠︎"` (errorMessage),
  `"…"` (enabled, no data). Rendered as a tertiary label beside each
  checkbox (grid becomes 4 columns: check, status, check, status).
- Key rows gain a small bordered `×` button, visible only when a key is
  stored. Action: `setKey(id, "")` + `apply()` + re-mask to empty. The
  empty-keeps-stored semantics of `controlTextDidEndEditing` stay; `×` is
  the explicit delete path. `setKey("")` already clears `authScheme` for
  zai (re-probe on next paste).
- Poll radios: when `normalizedPollMinutes` ∉ `pollChoices`, append a
  selected radio for the actual value.

**Tests.** `InlinePanelTests`/`SettingsTests` — status strings for all
four states; `×` pushes an empty key and the field re-masks empty;
`pollMinutes: 45` renders a selected "45" radio; zai checkbox present and
on by default.

**Evidence.** `swift test`; manual pass: toggle Claude on with no
credentials → `"…"`/`"⚠︎"` visible immediately in the settings row.

## Phase 5 — Copilot key field (S)

**Problem.** README's provider table says Copilot credentials can be
"pasted", but the only paste target is JSON — while Z.AI/GitHub/OpenRouter
have menu fields.

**Change.** `SettingsLogic.keyFields` += `("copilot", "Copilot",
"GitHub OAuth token (ghu_…). Usually auto-discovered from editor/opencode
sign-ins — a pasted token takes priority.")`; `setKey` case stores into
`sources.copilot.token` (creating `OAuthSourceConfig` on demand).
No source change needed: `CopilotSource.candidateToken`
(`CopilotSource.swift:117-122`) already prefers the config token.

**Tests.** `setKey` copilot round-trip; masked initial value.

## Phase 6 — Menu hygiene (M)

**Change.** Pure helpers + call sites in `main.swift`:

- `menuClamp(_ s: String, max: Int = 64)` — ellipsis-truncate section
  titles, error rows, notices, and Status-Bar-Source picker titles (one
  long error currently stretches the whole NSMenu).
- `menuLabelWidth(_ labels: [String]) -> Int` — `min(max(longest, 13), 20)`,
  all gauge rows padded to it (replaces the fixed `pad(toWidth: 13)` at
  `main.swift:466`, which misaligns any custom label > 13 chars).
- `MenuHeightPolicy.includeDetailRows(sectionCount:gaugeCount:screenHeight:)`
  — project total rows (header + gauges×2 + separator per section, ~8
  settings rows, ~4 footer/picker); if projected > ~34 rows or >
  screenHeight−48, drop the tertiary detail rows (counts line) first.
  Called from `rebuild` with `NSScreen.main`. Menus don't scroll; Quit
  must stay reachable on a 13" screen with all 8 sources live.
- Green-state countdown disambiguation: `escalationTitle` green branch
  renders `"↻ \(short)"` (reset-in, not time-left). Visual gate on the ↻
  glyph (U+21BB) in `--demo`; fallback `"in \(short)"`.
- **A11y spike (≤30 min):** determine which mechanism sets a spoken label
  on attributed NSMenuItems on macOS 13 (NSMenuItem NSAccessibility
  conformance vs. attributed-string accessibility attribute). Ship
  `gaugeAccessibilityLabel(gauge:)` ("Claude, 41% used, 59% left, resets
  in 43m") with whichever works; if none does cleanly, skip and note it —
  don't ship a hack.

**Tests.** `menuClamp`, `menuLabelWidth`, `MenuHeightPolicy` (900pt screen
× worst case 8 sections → detail rows dropped; 1512pt → kept).

**Evidence.** `swift test`; `--demo` visual pass; worst-case menu rendered
against a 13"-class screen height.

## Phase 7 — Windows port parity (S, independent)

Same `config.json`, so behavior should match where users can tell:
`windows/src/core/settings.js` TOGGLEABLE_SOURCES += zai (same default-on),
`trayapp.js` gates `fetchZai` + adopts the Phase-1 statusbar decision
(its `statusGauges` at `trayapp.js:232-237` has the same early-return
bug), config defaults tolerate `sources.zai`. No macOS phase depends on
this.

**Evidence.** `cd windows && npm test` (node --test port).

## Phase 8 — Docs + changelog (S)

- Regenerate `docs/screenshot-menu.png` from a live menu (demo + the
  settings block visible) — current image still shows the removed
  "Set Token…" item and contradicts the README text below it.
- README: Configuration section (Z.AI toggleable, ×-to-delete keys,
  per-source status marks, ↻ meaning), Copilot row's "or paste" becomes
  true, fallback sentence now accurate.
- CHANGELOG under Unreleased, one bullet per phase.

## Sequencing & verification

1 → 8; one phase per change, `swift build && swift test` green before the
next (experiment-loop: one meaningful variable at a time). Phases 1–2 fix
the two interaction bugs; 3 removes the Z.AI-centrism; 4–5 close config
parity; 6 is polish; 7 parity; 8 documents. No `--probe`/`--parse*`
signatures change.

## Risks / open questions

- NSTextField-in-NSMenu fragility (Esc mid-edit closes the menu) is
  **unchanged** here — deliberate; the popover question is deferred until
  Phases 2+4 land and we can judge what still hurts.
- NSMenuItem a11y API is unverified on macOS 13 → spike with a skip
  option.
- ↻ may not render in the menu-bar font → visual gate + text fallback.
- MenuHeightPolicy heuristic could hide detail rows on short screens —
  threshold conservative; per-gauge percent rows always stay.
- `sources.zai` schema addition vs. Windows loader — verified in Phase 3,
  fixed in Phase 7 if needed.
