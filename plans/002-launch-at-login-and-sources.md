# Plan 002 — Launch at login + source framework + GitHub source

- **Planned by:** GLM-5.3 (planning session)
- **Executor:** GLM-5.3 (no Flash runtime wired into this session; user
  directed /goal execution here — same precedent as plan 001 delivery)
- **State:** executed alongside this document

## Context

v0.2 (ring + colored text, tagged `v0.2-restored`) is the accepted MVP. This
plan adds: (a) launch-at-login via LaunchAgent, (b) a multi-source menu so
the "barstats = many sources" premise becomes real, with **GitHub API rate
limit** as the second source (zero credentials, documented JSON, fits the
gauge model: `resources.core {limit, remaining, reset, used}` — verified
live 2026-08-26). The status bar stays z.ai-only (primary, calm); secondary
sources appear as additional menu sections only.

## Scope

| In | Out |
|---|---|
| `scripts/install-login.sh`, `scripts/uninstall-login.sh` | Status-bar redesign (explicitly parked) |
| `Sources/barstats/GitHubSource.swift` (SourceSection + GitHubSource) | Popover/battery UI (rejected) |
| `QuotaProvider.swift`: SourcesConfig (backward-compatible optional) | Changes to z.ai parsing/fixtures |
| `main.swift`: sections list, menu renders per-source sections | Per-source status-bar gauges |
| README, git commit, private GitHub remote via `gh`, push | |

## Design decisions

- **Backward-compatible config**: `BarStatsConfig.sources: SourcesConfig?`
  is optional — old `~/.barstats/config.json` (no `sources` key) decodes
  fine and the z.ai token is preserved. Absent config ⇒ GitHub source ON
  (user asked for more sources); disable via
  `{"sources":{"github":{"enabled":false}}}`.
- **SourceSection** = `{title, gauges, errorMessage}`; the menu renders one
  section per source; z.ai remains the only cached/status-bar source so a
  GitHub outage can never affect the primary display.
- **LaunchAgent**: label `com.la.barstats`, app copied to
  `~/Applications/BarStats.app` (stable path, no sudo), `RunAtLoad` only —
  quitting the app stays quit until next login (no KeepAlive surprise).

## Implementation steps

1. `QuotaProvider.swift`: add
   `GitHubSourceConfig {enabled=true, token=""}`, `SourcesConfig {github?}`,
   `sources: SourcesConfig?` on BarStatsConfig.
2. New `GitHubSource.swift`:
   - `struct SourceSection { title; gauges=[Gauge]; errorMessage? }`
   - `GitHubSource.fetch(token:) async -> SourceSection`:
     `GET https://api.github.com/rate_limit`, `Accept: application/vnd.github+json`,
     optional `Authorization: Bearer <token>` (60/hr → 5000/hr).
     Parse `resources.core`: gauge `id "gh-core"`, label "Core requests",
     `pct = used/limit*100`, `used`, `total=limit`, `resetAt` from epoch-s
     `reset`. Non-200 / decode failure / network error → section error text.
3. `main.swift`:
   - `private var sections: [SourceSection] = []`.
   - `refreshNow()` (real): `async let` z.ai + GitHub, build sections,
     then `applySnapshot(zai)` (status bar + cache unchanged).
   - Demo: sections = z.ai demo + GitHub demo (pct 8, reset +40m).
   - `rebuild()`: header row per section, then error-or-gauges rows exactly
     in v0.2 row style; Updated row + actions unchanged; empty-sections
     fallback row "No data yet".
4. Login scripts per design above; install = build, copy app, write plist,
   `launchctl bootstrap gui/$UID`.
5. README: launch-at-login + GitHub source + config knobs.

## Acceptance gates

1. `swift build` — 0 errors, 0 warnings; all 4 `testdata/` fixture outputs
   unchanged (z.ai parsing untouched).
2. Old config decode: existing `~/.barstats/config.json` keeps working
   (token intact — verified by live refresh after relaunch).
3. Demo screenshot: status bar unchanged shape (`◉ 5h … (demo)`).
4. Live: menu sections exist (z.ai + GitHub) — evidence via
   `last-snapshot.json` (z.ai ok) + GitHubSource verified by the same code
   path used by curl check; screenshot of status bar.
5. `launchctl print gui/$(id -u)/com.la.barstats` shows running state;
   `launchctl kickstart` restarts the app; process path is
   `~/Applications/BarStats.app`.
6. `git commit`; `gh repo create barstats --private --source . --push`
   succeeds; `git remote -v` + `git log origin/master` confirm push.
