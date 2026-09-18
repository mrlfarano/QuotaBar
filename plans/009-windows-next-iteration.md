# 009 — Windows: quiet tray, explicit freshness, measured footprint

Approved implementation — 2026-09-18. Windows 0.12.0 ships the Instrument
panel and approved interactions on the existing Electron foundation.
The panel is created on demand and destroyed on close. Provider adapters and
shared config contracts remain intact. Measurements and limitations are recorded
in [windows-performance.md](../docs/windows-performance.md). A native shell
comparison remains future exploration, not a completed performance claim.

User direction: Windows only; start with UI/UX and work backwards. Quiet tray
utility, details one click away. Prototype alternative foundations before deciding.

## Product decision

Evolve the product and retain its tested behavior. Decide whether to replace the
Windows shell after measuring equivalent implementations. A new shell need not
mean discarding provider knowledge, sanitized fixtures, parser contracts, config
compatibility, or authentication safeguards. JavaScript implementation reuse is
different from behavior reuse: a native port needs explicit provider work.

Resource use is a release criterion, not a cleanup phase. Minimize CPU, memory,
disk writes, and child-process launches subject to accurate quotas, explicit
freshness, accessible interaction, and safe credential handling. Do not save
memory by hiding stale data or introducing repeated process startup costs.

Historical constraint: plan 001 records rejection of a larger popover on macOS.
The user approved the Instrument summary panel for Windows. Retain the compact
native menu on right-click as a fallback.

Exploration feedback: color improved readability, but the uniform list still felt
too vanilla. Added an Instrument direction with a prominent pinned-provider dial
and compact secondary readings, plus a Signal strip alternative. These explore
identity and hierarchy with static graphics, without new data or polling. They
would require a custom panel/drawing surface rather than an unmodified native
context menu; benchmark that cost before selecting the production shell. The
earlier minimal menu remains available for comparison.

Provider logos now accompany names in the overview, details, and connection
management. Brand colors stay independent from quota status. Concept uses pinned
Lobe Icons 1.95.0 SVG assets for Codex, Claude, and Z.AI; production should bundle
only required assets and attribution rather than load an icon library or
fetch logos at runtime. Production bundles seven provider marks locally.
Source: https://github.com/lobehub/lobe-icons.

Approved next mockup pass: inline provider expansion, choosing the quota displayed
in the tray, exact reset timestamps, one-click pinning, optional low/recovery
alerts, actionable connection states, and pausing updates. These interactions are
were initially simulated in the concept. Production now connects them to
validated local IPC, persisted preferences, provider-specific refresh, Windows
balloon notifications, and existing credential settings. Preserve the approved
visual direction. Further additions require user approval.

Approved motion polish: provider details expand/collapse over 280 ms with easing
and a short fade. Reverse smoothly on repeated clicks, keep keyboard focus stable,
make collapsed controls inert, and disable transitions for reduced-motion users.
No looping animation or background animation timer.

## Work backwards from three questions

1. How much quota do I have left?
2. When does it reset, and how recent is this reading?
3. If unavailable, what specific action gets it working?

### Tray and first click

- Retain recognizable rings initially. Compare one limiting-quota ring against
  current dual rings at actual 16/20/24/32-pixel sizes and common Windows DPI.
  No animation; shape/text must distinguish low quota from unavailable data.
- Pin one provider. Keep identity stable. If falling back to another healthy
  provider, explicitly name it and retain the selected provider's stale/error
  state in the menu. Never imply a changed source is the pinned source.
- Tooltip: provider, actual window name, percent left, reset time, freshness.
  Weekly-only accounts must never be relabeled as five-hour accounts.
- First click: pinned provider, its relevant windows, then compact rows for
  other enabled providers. Stable ordering; no automatic priority reshuffling.
- Use percent **left** throughout overview. Used/limit counts belong in details.
  A provider row names the constraining window; never average unrelated limits.
- Use visible quota colors in numbers and bars: green at 76–100% left, amber at
  26–75%, red at 0–25%; gray for stale/unknown readings. Keep status text alongside
  color and support light/dark themes. User requested color in the concept.
- Refresh and Settings stay visible. Source choice moves to provider details.
  Raw responses, endpoint URLs, account IDs, and version information leave the
  daily reading path; retain necessary tools in diagnostics/advanced settings.
- Right-click retains a short native command menu including Quit. Keyboard
  access, Escape, focus restoration, screen readers, high contrast, tray overflow,
  taskbar edges, and mixed-DPI monitors are acceptance checks.

### Provider detail and setup

- Expand/open one provider for all limits, reset times, connection state, last
  successful fetch, and a provider-specific Refresh action.
- Connected with no reported quota is distinct from disconnected, 0% remaining,
  and unlimited. A numeric value alone cannot represent these states.
- Offline/temporary failure: keep last good value with “Last known” and age.
  Past reset: “Reset expected; awaiting update,” never invent a replenished quota.
- First run offers “Find existing connections” and a manual connection path.
  Returning users see cached readings promptly while due refreshes run.
- Each provider has its own connection row: connected, unavailable, off, or
  action required. Put its connect/repair action beside that state.
- Preserve fixed settings rows and keyboard focus from recent work. Maintain
  blank-secret retention, explicit clearing, validation, and atomic config saves.
- Common settings: providers, pinned provider, start at login, update frequency.
  Advanced settings remain available on demand. No “performance dashboard” in
  the everyday UI; gather performance evidence in development tooling.

## Feature experiments, ordered

| Experiment | User benefit | Cost rule / decision |
| --- | --- | --- |
| Short menu vs compact summary | Read remaining quota immediately | Default short menu; richer panel must earn both its space and lifetime |
| Explicit freshness + last good values | Trust readings during outages | Cache normalized provider data, not additional polling |
| Provider connection/repair flow | Understand and fix missing data | Discovery on setup or recovery; no continuous browser scans |
| Provider-specific refresh | Update the relevant account quickly | No refresh of unrelated providers; coalesce repeated requests |
| Single vs dual tray ring | Interpret quota at tiny sizes | Static rendering; retain actual window labels in tooltip/details |
| Optional low/reset notification | Avoid surprises | Later; off by default, threshold crossing only, deduplicate per window; no extra fetches |

Defer history charts, predictions, floating dashboards, cloud sync, extra providers,
and a public local API until a concrete user need justifies their ongoing cost.

## Observed implementation constraints

Evidence from current Windows source; these are code findings, not CPU measurements.

| Finding | Consequence | Smallest useful change to investigate |
| --- | --- | --- |
| `trayapp.js:pollTick` runs every 20 seconds and uses only `snapshot.fetchedAt`; `snapshot` is populated by Z.AI | With Z.AI off, absent or old cache makes every tick eligible to refresh all enabled sources; chosen five-minute interval can become twenty seconds | Decouple refresh scheduling from Z.AI first; then per-provider due times |
| `refreshNow` awaits providers sequentially and publishes the assembled result afterwards | Slow provider delays presentation of healthy results | Publish each provider independently; compare low bounded concurrency against sequential execution |
| `refreshNow` replaces rings with transient sync state | Routine updates temporarily hide useful last-known quota | Retain stable glyph; show refresh feedback only in open UI |
| `applyGlyph` encodes PNGs and `rebuild` creates the entire menu for every applied update | Work occurs even when visible values have not changed | Compare a small render key before generating images; build menu when opened or dirty |
| `runLaunchDiscovery` runs synchronously before cached UI; empty Z.AI token triggers browser scans even when Z.AI is disabled | Startup can block on unrelated filesystem work | Respect disabled providers; defer broad discovery; scope it to requested provider |
| Antigravity detects process and listening ports on each fetch using child commands | Recurring process launches are a measurable cost candidate | Reuse validated endpoint until failure; bounded rediscovery/backoff with PID and endpoint revalidation |
| Warm cache is Z.AI-specific | Other providers lack equivalent warm-start/freshness behavior | Separate versioned Windows provider cache; continue reading legacy cache |
| Settings BrowserWindow is created on demand and released on close | Already avoids a permanently open settings renderer | Preserve lifecycle; measure all remaining Electron processes |

Existing refresh coalescing, healthy fallback, tested parsers, atomic configuration
writes, and the provider fixtures are assets to preserve.

## UI requirements → internal state → local integration

Use an internal in-process interface first, not an always-running HTTP server.
Proposed state is additive Windows runtime state; do not silently change shared
fixtures or existing serialized model contracts.

| UI requirement | Minimum state/operation | Integration consequence |
| --- | --- | --- |
| Immediate reading on open | Provider ID, normalized gauges, last success, last attempt, status | Cache last successful data per provider; render cache without forcing a request |
| Reliable freshness | Independent next-due and retry times | One timer for earliest due provider; elapsed time alone never implies successful fetch |
| Refresh this provider | Refresh(provider ID), coalesced per provider | Isolated timeout/cancellation; unrelated providers keep their readings |
| Repair connection | Discover(provider ID), reason/action | Known credential locations first; broad scanning only on explicit setup/recovery |
| Read once, update only on change | Snapshot plus change notification | Use existing Electron IPC for windows; expose no credential-bearing view model |
| Quiet when not in use | Window visibility and power/session state | No hidden UI countdowns; update relative times on open; explicit tooltip cadence if retained |

Scheduler behavior: respect provider rate limits and Retry-After; capped backoff
for transient failures; avoid credential retry loops; coalesce overdue work after
resume without a request burst. Disabled providers schedule nothing. Start with
known due times before adding activity monitoring or broad filesystem watchers.
Any battery/locked-session slowdown must expose freshness and preserve an agreed
maximum age; “lower CPU” must not mean silently obsolete data.

Antigravity's local API remains a client dependency. A native shell may replace
process/port scripts with Windows APIs only after measurement establishes value.
Cache validity includes process identity/endpoint failure; do not trust PID reuse.
Keep tokens in memory only where needed and out of diagnostics. External CLI and
browser credential files remain read-only.

## Foundation comparison

| Candidate | Reuse | What the prototype must establish |
| --- | --- | --- |
| Optimized Electron + native menu | Existing JS providers, tests, settings | Correct polling; tray-only process footprint; cost after opening/closing settings |
| C#/.NET Windows Forms NotifyIcon + native UI | Fixtures, behavior, config contract; provider code requires porting or temporary bridge | Real idle savings, readable native menu/details, accessibility, deployment footprint |
| Tauri/Rust + on-demand WebView2 | UI markup concepts; Node providers do not carry over automatically | Only pursue if native UI cannot meet approved design and measured WebView lifecycle is acceptable |

Prototype Electron and .NET first using identical synthetic snapshots and UI
actions. Shell-only results reveal shell costs, not complete application costs.
Before a migration decision, port one representative provider with auth refresh,
run fixture/contract tests, and include its cost. Do not count a permanent Node
sidecar as “free”; measure whole process tree. Avoid three simultaneous full ports.

Native tray support is documented in
[Windows Forms NotifyIcon](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls/notifyicon-component-overview-windows-forms).
Electron recommends avoiding main-thread blocking and unnecessary startup work in
[its performance guide](https://www.electronjs.org/docs/latest/tutorial/performance).
Tauri uses WebView2 on Windows according to its
[process model](https://v2.tauri.app/concept/process-model/); that alone does not
establish a memory or CPU win for QuotaBar.

## Measurement and decision gates

No CPU/RAM savings are claimed yet. Proposed starting budgets, to validate on this
machine: closed-UI CPU under 0.1% of total machine capacity averaged over 15 minutes
including scheduled work; warm cached menu p95 under 100 ms; normalized provider
data under 1 MiB with an explicit maximum custom-source count/size policy. Set a
whole-process memory budget from the first measured baseline, not a framework claim.

Measure release builds, same provider fixtures and cadence, at least three runs:

1. Cold launch, tray only; startup time and peak private bytes.
2. Fifteen-minute warm idle with one and several providers; cumulative CPU time,
   private bytes, working set, disk/network activity, and child-process launches.
3. Open/close menu and settings twenty times; interaction latency, peak memory,
   and retained memory after settling. No monotonic retained-memory growth.
4. Z.AI disabled with no cache and with old cache; count actual requests.
5. Offline, auth failure, rate limiting, sleep/resume, missing Antigravity, and
   reset boundary; no retry storms and honest stale/unknown states.

Include all child processes; sample infrequently enough not to dominate CPU.
Report CPU-seconds/minute alongside CPU percentage and processor count. Record
machine, Windows/runtime versions, build, provider mix, polling interval, sample
method, and median/range. Demo mode animates data and still performs launch
discovery today: use isolated synthetic fixtures/profile, not the current demo as
the quiet-idle benchmark. Never scan real credentials in a synthetic benchmark.

Suggested migration threshold: sustained >=50% reduction in whole-process idle
private bytes with no CPU, freshness, accessibility, or interaction regression,
or failure of a required budget that optimized Electron cannot resolve. This is
a proposed decision rule, not an empirical result. If both pass, weigh absolute
savings against remaining provider-porting and maintenance cost.

## Iteration loop

1. Review menu/summary mockups and healthy, low, stale, no-data, and setup states.
2. Establish baseline and fix the provider-independent polling defect with a
   deterministic clock/request-count regression test.
3. Implement the smallest approved UI change against existing data. Measure again.
4. Compare matched Electron/.NET shell prototypes; validate representative provider.
5. Keep or replace shell based on measurements. Migrate incrementally with config
   compatibility, rollback, and existing parser checks intact.

Every shipped experiment records: user task, interaction improvement, CPU/memory
delta, validation, and keep/revise/remove decision. No runtime changes or platform
migration are implied by this exploration draft.
