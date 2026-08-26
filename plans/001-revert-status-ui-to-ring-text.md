# Plan 001 — Revert status UI to v0.2 (ring + colored text bar, dropdown menu)

- **Planned by:** GLM-5.3 (planning session)
- **Executor:** GLM-5.3-Flash (task execution)
- **State:** ready for execution
- **App changes by planner:** none (this document is the only artifact)

## Context

The app currently runs v0.4 (battery bars in the status bar + click popover),
which the user rejected. This plan restores **v0.2**: the state after the
first color-band pass — a small ring image + multi-color attributed text in
the status bar, and a dropdown menu with colored block bars. v0.2 predates
the capsule background, emoji chips, battery bars, escalation logic, and the
popover. The networking/parser layer (QuotaProvider.swift) is **unchanged**
by this plan: pinned schema with planLevel, MCP gauge, display order, and the
recently added per-model `details` field all stay (details is unused by v0.2
UI but harmless and forward-looking).

There is no git history — v0.4 code is on disk, v0.2 exists only as this
spec. Follow it exactly; where this doc says "target spec", write fresh code
to that spec rather than trying to preserve v0.4 structures.

## Scope

| In scope | Out of scope |
|---|---|
| `Sources/barstats/main.swift` (rewrite to v0.2 behavior) | Any new features |
| `Sources/barstats/Visualization.swift` (rewrite to v0.2 spec) | Popover, capsule, battery bars, emoji, escalation |
| Delete `Sources/barstats/PopoverController.swift` | Parser/network changes |
| `git init` + commits, `testdata/` fixtures | README redesign (only update the mock section) |

## Step 0 — git baseline (do this first)

```sh
cd /Users/la/barstats
git init
printf '.build/\nbuild/\n.DS_Store\n' > .gitignore   # replace existing .gitignore content
git add -A && git commit -m "v0.4 battery bars + popover (rejected by user)"
git tag v0.4-rejected
```

Both states must stay recoverable; the final revert gets its own commit/tag.

## Step 1 — test fixtures

Create `testdata/` with these exact files (they pin parser behavior):

`testdata/payload_a.json` (adaptive: flat percents)
```json
{"success":true,"code":200,"data":{"current_five_hour_usage_percent":42.5,"weekly_usage_percent":13.7,"resets_at":1787890000000}}
```
`testdata/payload_b.json` (adaptive: nested ratios)
```json
{"success":true,"data":{"quota":{"fiveHourWindow":{"used_ratio":0.37},"week":{"usedRatio":0.52}}}}
```
`testdata/payload_c.json` (adaptive: totals decoy — percent must win over token counts)
```json
{"success":true,"data":{"week":{"total_tokens":140000,"used_tokens":42000,"percent_used":0.3},"hour_cycle":{"usage_percent":66}}}
```
`testdata/payload_real.json` (pinned official schema incl. MCP + level)
```json
{"code":200,"success":true,"data":{"level":"max","limits":[
  {"type":"TIME_LIMIT","unit":5,"percentage":3,"currentValue":139,"remaining":3861,"usage":4000,"nextResetTime":1788719742998,"usageDetails":[{"modelCode":"search-prime","usage":134},{"modelCode":"web-reader","usage":5}]},
  {"type":"TOKENS_LIMIT","unit":3,"percentage":2,"nextResetTime":1787793577380},
  {"type":"TOKENS_LIMIT","unit":6,"percentage":1,"nextResetTime":1788201342998}]}}
```

## Step 2 — `Sources/barstats/Visualization.swift` target spec

Keep only these public symbols (delete `batteryBarsImage`, `strokeRing`,
and anything popover-related):

1. `enum UsageBand { green, yellow, red }`
   - `static func of(remainingPct: Double) -> UsageBand`: clamp 0–100,
     round; `≥ 76 → .green`, `≥ 26 → .yellow`, else `.red`.
   - `var color: NSColor`: `.systemGreen` / `.systemYellow` / `.systemRed`.
   - **No `emoji` property.**
2. `extension Gauge { var remainingPct: Double; var band: UsageBand }`
   (remainingPct = clamp(100 − pct, 0, 100)).
3. `enum StatusText` with `base` (regular) and `emphasis` (semibold) fonts:
   `NSFont.monospacedDigitSystemFont(ofSize: 13, weight:)`, and
   `static func run(_ text: String, color: NSColor, font: NSFont = base) -> NSAttributedString`.
4. `func shortReset(_ date: Date?) -> String?` — seconds remaining; ≥60 min
   → `"2h47m"` (minutes zero-padded, e.g. `2h05m`), else `"47m"`; `nil` if
   date is nil or past.
5. `func ringImage(fraction: Double, color: NSColor, diameter: CGFloat = 14) -> NSImage`
   - `NSImage(size:)` + `lockFocus()` (**unflipped**), lineWidth 3,
     inset = lineWidth/2 + 1.
   - Track: full oval stroked in `.tertiaryLabelColor`.
   - Arc: `appendArc(withCenter:radius:startAngle: 90, endAngle: 90 − 360·fraction, clockwise: true)`,
     round cap, band color; skip when fraction ≤ 0.01.
   - `image.isTemplate = false`.
6. `func coloredBlocks(pct: Double, band: UsageBand, width: Int = 12) -> NSAttributedString`
   — `"█"×filled` in band color + `"░"×rest` in `.tertiaryLabelColor`,
   monospaced-digit font size 12.

## Step 3 — `Sources/barstats/main.swift` target spec

Keep unchanged from current code: the `--parse` / `--probe` CLI blocks,
AppDelegate cache helpers (`cacheURL`, save/loadCachedSnapshot), polling
(`pollTick`, `refreshNow`, `applySnapshot` including the authScheme
remembering), `copyRaw`, `setToken` (alert text about
`z-ai-open-platform-token-production` stays), config store usage, and the
helper funcs `pad(toWidth:)`, `compactCount`, `resetText`.

Rewrite the UI layer to:

- **Status item**: still created inside `applicationDidFinishLaunching`
  (never as a property initializer — items created before the accessory
  policy is set can fail to register). `menu.delegate = self` and
  `statusItem.menu = menu`. Remove: button target/action wiring,
  `sendAction(on:)`, appearance KVO, popover/utility-menu code, `--autopen`
  popover variant (an `--autopen` that calls `menu.popUp` may be kept as a
  dev flag; optional).
- **`updateStatusItem()`**: replaces battery-bar logic.
  - Demo: if snapshot exists → ring image for `fiveHour` + attributed text +
    `" (demo)"` suffix in `.quaternaryLabelColor`; else plain title `Z·demo`.
  - Error: plain title `"⚠︎ z.ai auth"` when message contains "token" or
    "Unauthorized", else `"⚠︎ z.ai"`.
  - Normal: `button.image = ringImage(fraction: five.remainingPct/100,
    color: five.band.color)`; `button.attributedTitle` = runs:
    `"5h "` `.secondaryLabelColor` → `"\(Int(remaining))% left"` band color +
    emphasis font → `" · \(shortReset)"` `.tertiaryLabelColor` (when reset
    known) → `" · wk "` secondary → weekly `"\(remaining)% left"` in weekly
    band color (regular weight).
  - `button.toolTip`: per gauge "label: X% used (u/t tokens) · reset text".
  - Weekly-only fallback (no fiveHour) shows the weekly run alone.
- **`setTransient(_:)`**: `image = nil`, plain secondaryLabel title.
- **`rebuild(reason:)`**: calls `updateStatusItem()` then rebuilds the whole
  menu from scratch (safe while closed): subtitle row
  `"Z.AI Coding Plan (max) · api.z.ai"` (planLevel in parens when present)
  or `"Demo data (--demo)"`; optional error row; per-gauge **enabled=false
  attributed** row: `label.pad(toWidth: 13) + "  "` secondary (menu font:
  monospaced digit 13) + `coloredBlocks(pct:band:)` +
  `"  \(pct)% used · \(left)% left"` in band color; then detail row
  `"    \(compact)/\(compact) tokens · Resets in …"` tertiary; then the
  "Updated" row with `representedObject = "updated-row"`; separator;
  Refresh Now ⌘R / Copy Raw Response (when rawJSON non-empty, non-demo) /
  Set Token… (non-demo) / Quit ⌘Q.
- **`menuNeedsUpdate(_:)` — CRITICAL PITFALL**: never call `rebuild()` or
  `removeAllItems()` here; mutating items while the menu is tracking
  cancels the popup instantly. Only update the `updated-row` item's title
  in place ("Updated HH:MM (Xm ago), poll Nm" / "No data yet").
- **Demo data**: `demoGauges` = fiveHour pct 24, used 28_800, total 120_000,
  resetAt now+2h47m; week pct 58, 34_800/60_000, now+4d3h; mcp pct 3, 139/4_000,
  now+9d. `demoAdvance()` sweeps pct +1.5 per 20s tick (wrap at 100), keeps
  `used` scaled to total, refreshes resetAt when it nears expiry.

## Step 4 — delete `Sources/barstats/PopoverController.swift`

## Step 5 — build & acceptance (all must pass)

1. `swift build` — 0 errors, 0 warnings.
2. `--parse` outputs match exactly (script them):
   | fixture | expected stdout |
   |---|---|
   | payload_a.json | `fiveHour=43% week=14%` |
   | payload_b.json | `fiveHour=37% week=52%` |
   | payload_c.json | `fiveHour=66% week=30%` |
   | payload_real.json | `fiveHour=2% resets@1787793577 week=1% resets@1788201342 mcp=3% [139/4000] resets@1788719742` |
3. `BARSTATS_ZAI_TOKEN=bogus .build/debug/barstats --probe` →
   `error: Unauthorized — token rejected (tried header styles)`, exit 1.
4. Demo check: run `.build/debug/barstats --demo &`, then
   `screencapture -x /tmp/revert-demo.png` — status bar must show a ring +
   `5h 76% left · 2h47m · wk 42% left (demo)`. Attach the path as evidence.
5. Real check: `scripts/make-app.sh && open build/BarStats.app`; after ~5s
   `~/.barstats/last-snapshot.json` shows `gauges=3 err=none` and the bar
   shows the live ring + text (token already configured).
6. Commit: `git add -A && git commit -m "v0.2 restored: ring + colored text bar, dropdown menu" && git tag v0.2-restored`.

**Manual check for the user (cannot be automated here):** clicking the item
opens the dropdown; the Updated row ticks while open; right-click does
nothing special (no utility menu in v0.2).

## Notes for the executor

- The status bar ring previously rendered correctly with `lockFocus()`
  (bitmap-backed). Do not switch to `NSImage(size:flipped:drawingHandler:)`
  — it proved unreliable in NSStatusBarButton.
- Do not set `button.attributedTitle` to an empty string alongside an image.
- `NSFont.monospacedDigitSystemFont` requires the `weight:` argument on this
  toolchain.
- README: update only the status-bar mock in the overview code block to the
  v0.2 line (`[◉] 5h 76% left · 2h47m · wk 42% left` + dropdown menu rows);
  leave the rest.
