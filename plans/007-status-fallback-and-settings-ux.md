# Plan 007 — Status-display correctness + settings/workflow UX

- **Planned by:** GLM-5.3 · **Executor:** GLM-5.3
- **Goal:** fix the two correctness bugs from the UI critique (a z.ai error
  hijacks the status bar even when another provider is healthy; a settings
  change arriving mid-refresh is silently dropped), make Z.AI a toggleable
  source like the rest, and close the workflow gaps (no per-source feedback,
  no way to delete a key, menu height ceiling, countdown ambiguity, a11y,
  stale docs).
- **Decisions:** settings move into a `Settings ▸` submenu (user-approved);
  the Windows port is explicitly deferred (same error-override bug exists in
  `windows/src/trayapp.js` — parity pass to follow).

## Phase 1 — status-display correctness

1. New `Sources/quotabar/StatusDisplay.swift` (pure, unit-tested):
   - `StatusDisplay` enum: `.gauges([Gauge])`, `.error(String)`, `.idle(String)`.
   - `StatusDisplayResolver.resolve(sections:zaiSnapshot:mainSource:)`:
     mainSource healthy → its gauges; else first healthy section (error
     states now fall through to a healthy provider — the fix); nothing
     healthy → short error from the mainSource section, else the z.ai
     snapshot, else any section; sections empty + cached z.ai snapshot →
     warm start; nothing at all → idle "quotabar…".
   - `RefreshCoordinator`: `begin()/end()` coalescing so a refresh request
     arriving mid-flight re-runs instead of being dropped.
2. `main.swift`: `updateStatusItem` becomes a switch over the resolver
   (delete `statusGauges`); `refreshNow` uses the coordinator; z.ai fetch +
   snapshot cache gated on the new toggle; `lastRefreshAt` replaces
   `snapshot.fetchedAt` for the "Updated" row.
3. `QuotaProvider.swift`: `SourcesConfig.zai: OAuthSourceConfig? = nil`
   (absent ⇒ enabled — additive schema, old configs decode unchanged).
4. `Settings.swift`: `zai` joins `toggleableSources` (first), gains
   enable-state cases, and `setKey` creates a fresh enabled entry only when
   absent (existing explicit opt-out survives, matching github/openrouter).

## Phase 2 — settings-block feedback

1. `SettingsLogic.sourceStatus(id:config:sections:)`: nil when disabled or
   healthy (calm by design), `⚠︎ <first sentence, ~40 chars>` on fetch
   error, section notice when gauge-less, "waiting…" otherwise. Rendered as
   a 10pt tertiary label under each checkbox in the 2-column grid.
2. Clear-key "×" borderless button on key rows with a stored value; fires
   `setKey(id, "")` + apply (the keep-if-empty rule only guards the text
   field). Removes a credential without hand-editing config.json.
3. Poll row appends a dynamic radio when the clamped cadence isn't one of
   the presets (hand-edited `45` no longer renders nothing-selected).

## Phase 3 — menu composition

1. Settings rows move under a `Settings ▸` item (`NSMenuItem.submenu`);
   panel retention unchanged. The disabled "Settings:" header row goes away.
2. Status Bar Source picker becomes `Status Bar Source ▸` with the existing
   checkmark items (same condition: >1 healthy section).
3. `truncated(_:max:)` (tail ellipsis, default 48) on section titles, error
   rows, notices — a long custom-source title can no longer stretch the
   panel. Picker entries truncate to 36.
4. Gauge-label padding becomes dynamic (max label width across sections,
   floor 13) so custom-source labels align.
5. Runtime verification (demo mode): submenu opens, controls work, menu
   stays open while editing a key field. Fallback if text fields misbehave
   in a submenu: keep key rows flat, submenus for toggles only.

## Phase 4 — glyph, a11y, docs

1. `EscalationText.text(gauge:)` (pure, tested): green `↻2h47m`, yellow
   `41% · ↻43m`, red `8% · ↻12m ⚠︎` — `↻` marks the countdown as
   time-until-reset, not quota-left.
2. `dualRingImage` fills a center dot when the outer band is red — a shape
   channel alongside color (colorblind-safe).
3. Tooltip: first line `outer ring = 5-hour window · inner ring = weekly
   limit`; per-gauge lines gain "% left".
4. `AccessibleMenuItem` (NSMenuItem subclass overriding
   `accessibilityLabel()`) for gauge rows — NSMenuItem has no native label
   property. Verified with Accessibility Inspector; fallback: fold the
   summary into the plain-text detail row.
5. Docs: fresh demo screenshot replaces `docs/screenshot-menu.png` (current
   one shows the removed "Set Token…" item); README updated (fallback
   promise now covers errored sources, Z.AI toggleable, Settings ▸, key
   clearing); CHANGELOG Unreleased entries; windows/README notes the
   deferred parity debt.

## Acceptance gates

1. `swift build -c release` 0 errors/0 warnings; `swift test` green with the
   new suites (resolver matrix incl. both bug regression tests, refresh
   coordinator semantics, zai toggle/back-compat decode, sourceStatus,
   clear-key wiring, custom poll radio, escalation strings).
2. Demo-mode runtime pass: healthy-fallback status bar, Settings ▸ fully
   interactive, worst-case menu fits a 13"-class display (screenshots kept
   as evidence).
3. Old `config.json` decodes unchanged (unit test); no migration code.

### Verification log (2026-08-28)

- Gate 1: 58 tests green (baseline was 32).
- Gate 2 (partial): main menu + Settings ▸ submenu rendered and interacted
  with in a live demo pass — all controls present (poll radios with correct
  selection, source grid with correct check states, three key fields, Open
  config.json…), submenu opens from a real click, demo menu panel ≈446px
  tall. **Not live-verified:** focus/typing inside a key field while the
  submenu is open — synthetic-input focus drift made this untestable from
  the agent harness. Covered indirectly by the documented view-in-menu
  event contract (NSMenuItem.h), the identical mechanism of the previously
  shipped flat key fields, and unit tests of the edit round-trip. Author's
  30-second manual check recommended; fallback (key rows flat, rest in
  submenu) defined in Phase 3 step 5.
- Bonus bug found and fixed during verification: repainting the status item
  while its menu is open cancels menu tracking (demo tick / a live refresh
  completing mid-menu dismissed the user's open menu). `rebuild()` now
  defers the status repaint to `menuDidClose` and `refreshNow()` skips its
  transient "…sync" text while the menu is open.
- Phase 4 a11y verified structurally: System Events reads the demo menu's
  gauge rows with their full labels ("Demo data (--demo), 5-hour window:
  24% used, 76% left, Resets in 2h 43m") — exactly what VoiceOver gets.
- The live escalation text was read off the running demo bar as
  `73% · ↻2h46m demo`, confirming the ↻ glyph renders.
- README screenshot: recaptured during the 0.11.0 build pass — a live-mode
  menu (fresh install, no Z.AI token: the bar shows GitHub's rings, the
  Phase 1 fallback demonstrated in the image itself) with the Settings ▸
  arrow and v0.11.0 footer; saved to docs/screenshot-menu.png.
- Build pass (2026-08-28, later): `make-app.sh VERSION=0.11.0` bundle built
  and run live. The fresh-install status bar read `0% · ↻2h07m ⚠︎` —
  GitHub's rings with the new escalation text — where 0.10.0 showed
  `⚠︎ z.ai auth`: the fallback fix verified in real mode. The Settings ▸
  submenu was driven via System Events: opened, and its full control tree
  enumerated (6 poll radios, 7 source checkboxes with status labels, 3 key
  text fields, Open config.json…). Field typing could not be exercised —
  synthetic/AX input never receives first-responder status in a tracking
  NSMenu's field editor (tried AX set-focused, AX click, keystroke; the
  field editor only engages for real hardware mouse-down). Author's manual
  paste remains the final gate for that single interaction.

## Out of scope

Windows port parity (same fixes needed in `windows/src/trayapp.js` +
`settingswindow.js` — follow-up plan); per-source poll cadence; OAuth sign-in
for z.ai; changing the ring-vs-blocks fill direction (battery vs progress —
documented instead).
