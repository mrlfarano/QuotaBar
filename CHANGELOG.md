# Changelog

All notable changes to QuotaBar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/)-ish (`MAJOR.MINOR` while pre-1.0).

## [0.10.0] - 2026-08-27

### Added

- **CI on every push and pull request** — release build, all ten offline
  `--parse-*` fixture checks, `swift test`, and the app-bundle build run on
  `macos-15`; the README badge now tracks CI instead of the release workflow.
- **App icon** — the status bar's dual-ring glyph rendered onto a dark tile
  by `scripts/make-icon.sh`; bundled as `Resources/AppIcon.icns`, so released
  builds stop showing the generic executable icon.
- **Unit tests** — `Tests/quotabarTests/` (16 tests) covering the color-band
  thresholds, the pinned and adaptive Z.AI parsers, tolerant leaf
  conversions, epoch/ISO8601 reset parsing, custom-source dot paths, and
  countdown formatting. `swift test` runs in CI; `shortReset`/`resetText`
  take an injectable clock so countdown tests are deterministic.
- README header shows the app icon.

## [0.9.0] - 2026-08-27

### Added

- **GitHub Copilot source** — monthly premium requests (used vs entitlement,
  reset date) via the Copilot extension's own internal endpoints. Token chain:
  config → opencode auth.json → VS Code hosts/apps.json; discovered
  automatically when those files exist.
- **OpenRouter source** — credits used vs limit (USD) via the official
  `/api/v1/credits` API; key picked up from `OPENROUTER_API_KEY`. No-cap
  accounts get an honest notice row instead of a fake ring.
- **Antigravity source** — Gemini + Claude/GPT pool quotas and plan tier read
  from the running app's local endpoint (`127.0.0.1` Connect-RPC with the
  process's CSRF token; self-signed cert trusted for localhost only). Local
  machine only; says "open the app" when Antigravity isn't running. (Google
  retired Gemini CLI for individuals in June 2026 — Antigravity is the
  Google slot now.)
- `SourceSection.notice` — non-error info rows in the menu.
- Probe/parse dispatch generalized; new offline checks `--parse-copilot`,
  `--parse-openrouter`, `--parse-antigravity` with fixtures.

## [0.8.0] - 2026-08-27

### Added

- **Claude Pro/Max source** — 5-hour + weekly utilization via Claude Code's
  OAuth session (`api.anthropic.com/api/oauth/usage`, beta
  `oauth-2025-04-20`). Token chain: config → `~/.claude/.credentials.json`
  (read live) → refresh via `api.anthropic.com/v1/oauth/token`; a clear
  "run `claude` once to re-authenticate" error when re-auth is needed.
- **Codex source** — 5-hour + weekly windows via the Codex CLI's stored
  ChatGPT OAuth token (`chatgpt.com/backend-api/wham/usage` +
  `ChatGPT-Account-Id`). Refresh on 401 via `auth.openai.com`; rotated
  tokens persist in QuotaBar's config, the CLI's auth file is never written.
- **Auto-discovery** — at launch and via **Discover Sources** (⌘D): enables
  `claude`/`codex` when their CLI credential files exist and picks up
  `GH_TOKEN`/`GITHUB_TOKEN` for GitHub. Never touches `enabled: false`
  entries or user-set tokens; no Keychain access.
- Offline checks `--parse-claude` / `--parse-codex`, live checks
  `--probe claude` / `--probe codex`; fixtures in `testdata/`.
- Open-source setup: MIT LICENSE, CI release builds, issue templates.

## [0.7.0] - 2026-08-27

### Changed

- **Project renamed barstats → QuotaBar** (repo, bundle, LaunchAgent,
  config dir, env vars). GitHub redirects the old URL; `~/.barstats` config
  migrates per README.

## [0.6.0] - 2026-08-27

### Added

- Configurable providers: **custom sources** — any JSON endpoint reporting
  used/limit (+optional reset) via dot paths, no recompile needed.
- **Status Bar Source** picker: choose which provider drives the menu-bar
  rings (`mainSource`), with graceful fallback when it fails.
- GitHub source gained an optional token (60/hr → 5000/hr).

## [0.5.0] - 2026-08-27

### Added

- **Concentric dual-ring status item** (approved design "B2"): outer ring =
  5-hour quota, inner ring = weekly quota, both colored by remaining band.
- Escalating text: countdown-only when green, colored percent from yellow,
  warning glyph on red.

### Fixed

- Unreadable countdown text in some states (label color contrast).

## [0.1.0 – 0.4.x] - 2026-08 (prototypes)

- First Z.AI coding-plan gauges; a battery-bar/popover UI iteration that was
  rejected and reverted to the ring + text bar; dropdown menu with raw
  response, token entry; launch-at-login framework and the generic source
  layer.

[0.10.0]: https://github.com/mrlfarano/QuotaBar/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/mrlfarano/QuotaBar/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/mrlfarano/QuotaBar/compare/91fac68...v0.8.0
[0.7.0]: https://github.com/mrlfarano/QuotaBar/compare/v0.6...91fac68
[0.6.0]: https://github.com/mrlfarano/QuotaBar/compare/v0.5...v0.6
[0.5.0]: https://github.com/mrlfarano/QuotaBar/compare/67876d0...27ba712
