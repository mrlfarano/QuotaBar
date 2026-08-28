# Changelog

All notable changes to QuotaBar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/)-ish (`MAJOR.MINOR` while pre-1.0).

## [Unreleased]

### Fixed

- **An errored source no longer hijacks the status bar.** A failing Z.AI
  token (or any selected source's error) now falls through to the next
  healthy provider's rings; the warning only takes over when nothing is
  healthy — and then it names the failing source. The README's fallback
  promise now holds for error states, not just empty ones.
- **Settings changes landing mid-refresh are no longer dropped.** Pasting a
  key while a fetch was in flight left it unfetched until the next poll
  (up to `pollMinutes`); refreshes now re-run when one arrives mid-flight.
- **An open menu is no longer dismissed by background updates.** Repainting
  the status item while its menu tracked (demo tick, a refresh completing
  mid-menu) canceled the popup; repaints now defer until the menu closes.
- **Pasted keys are no longer lost when the menu closes.** Menu tracking can
  swallow Return and closing the menu (or Escape) tears a key field down
  without an end-editing event — a pasted token silently vanished. Pending
  key edits are now committed the moment the menu closes (found live during
  the 0.11.0 build pass: a real paste never reached the config).
- **Key entry moved out of the menu into a standard editor window.** Text
  fields inside a tracking NSMenu never get a field editor — the menu
  window refuses key status even with the app active, so clicking a key
  field showed no caret and typing/paste went nowhere (reported live).
  Settings ▸ now has **Paste API Keys…**, a small editor with all three
  fields: real caret and paste, Return saves, Escape cancels, empty keeps,
  × removes. The commit-on-close sweep from the previous fix was retired
  with the menu fields it guarded.

### Added

- **Z.AI token discovery** — Discover Sources (and the launch scan) now
  finds the z.ai dashboard token where it already lives: browser
  localStorage. Chromium-family browsers are read from their on-disk
  LevelDB (Chrome, Canary, Chromium, Brave, Edge, Arc, Comet — ASCII and
  UTF-16LE records), Firefox from its per-profile SQLite. Also picks up
  the Claude Code bridge (`ANTHROPIC_BASE_URL` on z.ai →
  `ANTHROPIC_AUTH_TOKEN`; real Anthropic tokens are never touched).
  Safari's storage is TCC-protected and deliberately skipped — reading it
  would prompt for Full Disk Access. Only fills an empty slot; user-set
  tokens are never overwritten.
- **Z.AI is toggleable** like every other source — the app is fully usable
  with no Z.AI account at all. `sources.zai` absent means enabled (old
  configs decode unchanged); toggling never touches the stored token.
- **Per-source status lines** under the settings checkboxes — a fetch
  error (first sentence, 40-char cap), a notice, or a waiting hint; healthy
  and disabled sources stay silent.
- **Key clearing** — a × button on key fields with a stored value removes
  the credential outright (empty field still means "keep").
- **Settings… ▸ submenu** (⌘,) and **Status Bar Source ▸** — settings left
  the flat menu so a full provider list can't overflow the screen (menus
  don't scroll) and sits where people expect it.
- **Countdown disambiguation** — status-bar countdowns now carry a ↻ glyph
  (`↻9h24m` = resets in 9h24m, not "9h24m of quota left"); red bands always
  show the ⚠︎, with or without a countdown.
- **Colorblind-safe critical state** — a filled center dot joins the red
  ring, a shape channel alongside color.
- **VoiceOver labels** on gauge rows (readable summaries instead of block
  characters), and the status-item tooltip now carries the ring legend and
  per-gauge "% left".
- Long section titles, errors, and notices truncate (48 chars; 36 in the
  picker) so one verbose custom source can't stretch the panel; gauge-label
  alignment adapts to the longest current label. Poll cadences outside the
  presets render as their own radio instead of nothing-selected.
- **Inline settings in the dropdown** — poll cadence (radio row), per-source
  on/off checkboxes, and the directly pasted keys (Z.AI, GitHub, OpenRouter)
  live in the status-item menu itself; there is no separate settings window.
  The menu stays open while you adjust, every change applies live (saved to
  the same 0600 config, sources refresh immediately), and the data rows
  catch up once the menu closes. Stored keys display masked (`********` +
  the last 5 characters, fixed star count so the length never leaks);
  clicking a field clears it for a fresh paste, leaving it empty keeps the
  stored value, and changing the Z.AI key re-probes the Authorization header
  styles. **Open config.json…** stays for the JSON-only parts (custom
  sources, OAuth-managed tokens).
- **Windows port** (`windows/`) — the same sources, parsers, config file,
  discovery rules, color bands, and dual-ring glyph as a Windows
  system-tray app (Electron; native tray menus, runtime-generated glyphs).
  Offline `--parse*` output is byte-identical to the macOS binary on the
  shared fixtures; unit tests ported to `node --test`; `npm run package:win`
  builds `QuotaBar.exe` from any OS. Tray icons being icon-only on Windows,
  the escalating numbers live in the live tooltip instead of beside the
  glyph. *Known parity gap: the Windows tray still has the old
  error-overrides-rings status logic and no Z.AI toggle — macOS fixes from
  this release land there in a follow-up.*
- Version row in the menu footer ("QuotaBar v0.10.0"; "(dev build)" when run
  from source without a bundle).

### Removed

- The **Settings…** window (⌘,) — its poll, source, and key fields moved
  into the dropdown's settings rows.
- The **Set Token…** menu item — key entry lives in the menu's key fields
  now, with the z.ai instructions kept in the key field's tooltip. A
  rejected key surfaces as ⚠︎ z.ai auth instead of a modal alert.
- Bare-letter menu shortcuts (R, D, Q) — they would fire while typing in the
  inline key fields; Refresh, Discover, and Quit now require ⌘.

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
