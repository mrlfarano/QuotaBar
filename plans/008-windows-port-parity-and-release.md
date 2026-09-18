# 008 — Windows port: 0.11 parity and first Windows release

## Current status — 2026-09-18

Windows parity implementation, packaging, and automated test suites are complete
in the working branch. Core tests, real Electron settings/tray integration, and
packaged CLI checks pass locally. Node.js 22.12+ is required by Electron 44.
CI now targets `main`, captures Swift fixture output on macOS, and compares all
ten Windows outputs byte-for-byte. Release jobs run tests before uploading.

Windows discovery refreshes silently. Settings includes advanced provider
credentials, tray selection, endpoint options, and custom-source editing with
inline validation. Blank secrets preserve refreshed credentials; config saves
replace the file atomically so failed writes retain the previous configuration.

Live checks: Z.AI, GitHub, and Codex returned quotas. Claude authenticated but
returned null quota buckets. Copilot/OpenRouter credentials and a running
Antigravity instance were unavailable. Auth-refresh paths are covered with
synthetic responses; the live sessions did not require refresh.

Windows startup registration/removal was checked using a temporary registry
entry. The user's existing QuotaBar startup entry remains intact. Final
sign-out/sign-in verification is explicitly delegated to the user.

The sections below preserve the original implementation plan and historical
baseline; they are not an outstanding-work checklist. Current verification
commands and limitations live in `windows/README.md`.

## Original goal

The Windows port (`windows/`, merged in 0.11.0) runs and its 27 unit tests
pass, but it behaves like the 0.10 macOS app: the tray still has the
error-overrides-rings status logic, Z.AI is not toggleable (and the config
loader silently strips `sources.zai` on save), none of the 0.11.0 settings
feedback / glyph / tooltip polish landed, and — biggest gap — discovery
cannot find the z.ai browser token at all, the headline 0.11.0 feature and
the flagship credential. Nothing builds the port in CI and no Windows
release artifact exists.

This plan brings `windows/` to full behavioral parity with macOS 0.11.0 and
ships it: CI on both OSes, a packaged `QuotaBar.exe` wearing the app icon,
and the release workflow attaching the Windows zip next to the macOS one.

## Historical baseline (2026-09-08)

- `cd windows && node --test` — **27/27 pass** on the dev Windows box
  (Node 24.20.0). `--parse*` byte-parity with the Swift binary is claimed
  by `cli.js` and unchanged by everything below.
- At baseline, `node_modules` was absent on the dev box — `npm install` before any GUI
  run (`npm start` / `npm run demo`).
- Confirmed gaps, in the code:

| # | Gap | Evidence |
|---|-----|----------|
| 1 | Z.AI error hijacks the tray; no healthy fallback | `windows/src/trayapp.js:218-223` early-returns on `snapshot.errorMessage`; `statusGauges` (`:233-240`) unreachable on error — the bug macOS fixed in `StatusDisplay.swift:16-49` |
| 2 | Settings applies landing mid-refresh are dropped | `trayapp.js:110` `if (this.refreshing) return` — macOS fixed via `RefreshCoordinator` (`StatusDisplay.swift:68-92`) |
| 3 | Z.AI not toggleable | `fetchZai` unconditional (`trayapp.js:129`); no `zai` case in `isSourceEnabled` (`core/settings.js:85-96`) or `TOGGLEABLE_SOURCES` (`:10-17`) |
| 4 | `sources.zai` silently stripped on config round-trip | `validateSources` copies only known keys (`core/config.js:80-104`) — a macOS-written config loses its Z.AI toggle the next time Windows saves. Exactly the risk plan-007 Phase 3 flagged |
| 5 | No per-source status lines in Settings | `settingswindow.js:81-90` ships only `enabled` flags |
| 6 | Keys can't be deleted | `settings:set-key` returns early on empty (`settingswindow.js:69`); no × button |
| 7 | No Copilot paste field | `KEY_FIELDS` (`settings.js:21-29`) — macOS added it in plan-007 Phase 5 |
| 8 | No red-band center dot (colorblind shape channel) | `ringicon.js` has no dot; reference is `Visualization.swift:102-108` (4×4 filled oval on the 20-canvas) |
| 9 | No ↻ countdown disambiguation, tooltip legend, "% left" | tooltip built inline in `applyGlyph` (`trayapp.js:264-273`); reference `EscalationText` (`Visualization.swift:48-59`) |
| 10 | No menu clamping / adaptive label width | `trayapp.js:317` pads to a fixed 13; macOS clamps 48/36 and pads to the longest current label |
| 11 | **No Z.AI token discovery at all** | `core/discovery.js` (143 lines) has zero z.ai logic — no Chromium LevelDB / Firefox SQLite scan, no Claude bridge. Reference: `Discovery.swift:169-299` |
| 12 | No launch-at-login | macOS ships `scripts/install-login.sh`; Windows equivalent (`app.setLoginItemSettings`) unused |
| 13 | CI never builds the port; no Windows release artifact | `.github/workflows/ci.yml` = Swift on macos-15 only; `release.yml` zips `QuotaBar.app` only |
| 14 | exe wears the default Electron icon; version 0.10.0 | `windows/package.json`, `scripts/package-win.js` (rcedit needs wine off-Windows — native on windows-latest) |

## Non-goals

- **Code signing** — no cert budget; SmartScreen "more info → Run anyway"
  note stays in the READMEs.
- **Installer (NSIS/MSI)** — the portable folder + zip stays the
  deliverable; revisit if users ask.
- **Auto-update** — no update story on macOS either; unchanged roadmap.
- **Porting the inline-in-menu settings layout** — Windows already uses a
  real window, and macOS 0.11.0 ended up moving key entry back into a small
  editor window too. The window stays; it gains the 0.11.0 feedback
  features instead.
- **Menu accessibility labels** — Electron menu items expose no acc-label
  API on Windows; documented as an honest gap in `windows/README`, no hack.

## Phase 1 — Status resolution + refresh coalescing (M)

**Problem.** Gaps 1–2: a failing Z.AI token masks every healthy provider's
rings, and a config change landing mid-fetch waits up to `pollMinutes`
with zero feedback (indistinguishable from a rejected key).

**Change.** New pure module `src/core/statusdisplay.js`, a line-faithful
port of `StatusDisplay.swift`:

- `resolve(sections, zaiSnapshot, mainSource)` → `{kind:'gauges', gauges}`
  | `{kind:'error', text}` | `{kind:'idle', text}` — rules in order:
  wanted (`mainSource ?? 'zai'`) healthy → its gauges; any healthy section
  → its gauges (the README's promised fallback, finally real); wanted's
  `errorMessage` → error naming *that* source; zai snapshot error →
  "⚠︎ z.ai[auth]"; any section error; warm-start cached zai gauges;
  `sections` empty → idle "quotabar…"; else "⚠︎ no data".
- `errorText(id, message)` — auth-shaped messages (token/Unauthorized) get
  the ` auth` suffix; `zai` renders as `z.ai`.
- `RefreshCoordinator` with `begin()`/`end()` — at most one queued rerun.

`trayapp.js` rewires `updateTray` to the resolver (demo path untouched)
and `refreshNow` to the coordinator (`end() === true` → re-run once).

**Tests.** `test/statusdisplay.test.js` — the four resolution rules +
"selected source errored, claude healthy → claude's gauges" + warm start +
error naming; coordinator: idle, request-during-flight reruns exactly
once, second request during the rerun queues again.

**Evidence.** `npm test`; manual: bad `zaiToken` + healthy `GH_TOKEN` →
GitHub rings in the tray, tooltip names the z.ai error.

## Phase 2 — Z.AI toggleable + config round-trip fix (S)

**Problem.** Gap 3–4: non-Z.AI users get a permanent error surface they
cannot dismiss, and the two platforms corrupt each other's `sources.zai`.

**Change.**

- `core/config.js`: `validateZaiSource` accepts `{enabled: boolean}` under
  `sources.zai` (absent ⇒ enabled — same optionality pattern as `github`);
  `validateSources` passes it through instead of dropping it.
- `core/settings.js`: `TOGGLEABLE_SOURCES` gains `{id:'zai',
  title:'Z.AI Coding Plan'}` first; `isSourceEnabled`/`setSourceEnabled`
  gain the `zai` case (`?? true` default; toggling never touches
  `zaiToken`/`authScheme`).
- `trayapp.js refreshNow`: gate `fetchZai` on
  `isSourceEnabled(config,'zai')`; when disabled push an empty zai section
  and an empty snapshot (`rawJSON: ''`, no error) so the cache, Updated
  row, and Phase-1 fallthrough keep working and Copy Raw hides itself.

**Tests.** legacy config without `zai` decodes enabled; macOS-style config
round-trips with `sources.zai` intact; toggle writes only `enabled` and
leaves `zaiToken` untouched.

**Evidence.** `npm test`; manual pass with zai off → tray falls to the
next healthy source, no ⚠︎ transient.

## Phase 3 — Settings feedback: status lines, × clearing, Copilot key (M)

**Problem.** Gaps 5–7.

**Change.**

- Port `SettingsLogic.sourceStatus` into `core/settings.js`:
  `(enabled, section)` → `undefined` (disabled/silent), `'✓'` (gauges),
  `'⚠︎ ' + first sentence ≤40 chars` (error), section `notice`, `'…'`
  (enabled, no data). `openSettingsWindow` gains `sections` (re-synced on
  every open/reopen); each checkbox row renders the status beside it.
- Key rows gain a × button, visible only when a key is stored →
  `settings:clear-key` → `setKey(id, '')` + re-mask to empty (empty blur
  still means "keep"). `setKey('')` already drops `authScheme` for zai.
- `KEY_FIELDS` += `copilot` with the macOS tooltip copy; `setKey` stores
  `sources.copilot.token` (the source already prefers the config token
  over discovered files).

**Tests.** `sourceStatus` all states; × clears and re-masks empty;
`setKey` copilot round-trip + masked initial value.

**Evidence.** `npm test`; manual: enable Claude with no `~/.claude` →
`…`/`⚠︎` visible immediately in its row.

## Phase 4 — Glyph & text parity: red dot, ↻, tooltip legend, menu hygiene (M)

**Problem.** Gaps 8–10.

**Change.**

- `ringicon.js`: filled center dot (radius 2 on the `CANVAS = 20`
  reference, scaled like the rings, band-colored) when the primary band is
  red — the colorblind shape channel.
- Tooltip builder extracted into a pure function (testable): ↻ prefix on
  countdowns (reset-in, not quota-left), red bands always carry ⚠︎ with
  or without a countdown, first line = driving source title + legend
  (`outer 5h · inner weekly`), per-gauge `% left`; truncates with … at
  `TOOLTIP_MAX`.
- `menuClamp(s, max=48)` + picker clamp 36 + label width =
  `max(longest current label, 13)` ported into `core/format.js` and
  applied in `buildMenu` (section titles, errors, notices, picker rows,
  gauge padding).

**Tests.** clamp/width helpers; tooltip builder green/yellow/red + long
source truncation; dot rasterizes (nonzero alpha at center pixel) for red
and stays transparent otherwise.

**Evidence.** `npm test`; `npm run demo` visual pass — the sweep reaches
red, the dot appears alongside the red ring.

## Phase 5 — Z.AI token discovery: browser scan + Claude bridge (L)

**Problem.** Gap 11: on Windows a fresh user must hand-extract localStorage
from DevTools — the port's single biggest functional deficit.

**Change.** New pure module `src/core/zaitoken.js` — byte-faithful port of
`Discovery.swift:246-299`: `extractToken(buffer, key)` probes both ASCII
and UTF-16LE encodings of the key and takes the first plausible run
(≥20 printable chars, interleaved NULs handled) in a 512-byte window.

Browser roots (existence-tolerant, first hit wins):

- Chromium family, `%LOCALAPPDATA%\<vendor>\User Data\<profile>\Local
  Storage\leveldb` — vendors: `Google\Chrome`, `Google\Chrome Canary`,
  `Chromium`, `BraveSoftware\Brave-Browser`, `Microsoft\Edge`; Arc/Comet
  at their best-known Windows roots (absence tolerated — discovery is
  best-effort).
- Firefox: `%APPDATA%\Mozilla\Firefox\Profiles\<profile>\webappsstore.sqlite`
  (same plain-TEXT runs, same extraction).
- Claude bridge: `~/.claude/settings.json` with
  `env.ANTHROPIC_BASE_URL` containing `z.ai` → `ANTHROPIC_AUTH_TOKEN`
  (≥20 chars); a real Anthropic base URL is never touched.

`runDiscovery` gains the zai pass with macOS-matching outcome lines —
fills only an empty `zaiToken` and never overwrites a user-set token. The
Z.AI toggle gates fetching; discovery can fill an empty credential while disabled.

**Tests.** fixture tree with synthetic `.log`/`.ldb` bytes (ASCII +
UTF-16LE records), SQLite bytes, bridge settings fixtures (z.ai base →
picked up; anthropic.com base → skipped), never-overwrite + disabled
rules — port of `ZaiDiscoveryTests`.

**Evidence.** `npm test`; manual on the dev box: Discover Sources finds
the token when an installed browser has one (fixture tests carry the
proof regardless).

## Phase 6 — Start at login (S)

**Problem.** Gap 12.

**Change.** Settings checkbox "Start at login" backed by
`app.setLoginItemSettings`/`getLoginItemSettings` (registry-backed;
re-read on every settings open so external changes reflect). The registry
is the source of truth — no config field.

**Evidence.** manual on the dev box: check → reboot/logon cycle → tray
present; uncheck → absent.

## Phase 7 — Ship: version, icon, CI, release artifacts, docs (M)

**Problem.** Gaps 13–14.

**Change.**

- `windows/package.json` → `0.11.0` (parity release).
- Icon: script generates `windows/build/QuotaBar.ico` from
  `docs/icon-1024.png` (16–256 multi-size; committed artifact, generator
  in `windows/scripts/`); `package-win.js` gains `icon` +
  `win32metadata` (ProductName, version, copyright) — native on
  Windows runners, no wine.
- `ci.yml`: add a `windows-latest` job — Node 22, `npm ci` (cache the
  Electron download keyed on `package-lock.json`), `npm test`, the full
  `--parse*` fixture sweep against `../testdata` (byte-parity is a
  standing invariant), and a `package:win` smoke build.
- `release.yml`: same Windows job, uploading
  `QuotaBar-<tag>-win32-x64.zip` to the same GitHub release as the macOS
  zip.
- Docs: `windows/README.md` drops its "Known parity gaps" section (all
  closed) and the rcedit/wine caveat; root README's Windows paragraph
  updated; CHANGELOG entry per phase.

**Evidence.** green CI matrix on the PR; a tagged dry-run build attaches
both zips to one release; exe icon + version metadata verified on the
dev box.

## Sequencing & verification

1 → 7, one phase per change, `npm test` green before the next, and the
`--parse*` outputs untouched throughout. Phases 1–2 fix the interaction
bugs; 3–4 close feedback/visual parity; 5 is the flagship feature; 6 is
tiny; 7 ships. Phases 5–6 are independent of 1–4 if they land in parallel
branches.

## Risks / open questions

- Arc/Comet Windows install roots are less standardized than Chrome/Edge —
  scan best-known candidates and tolerate absence; the paste field remains
  the fallback, so discovery failure only costs convenience.
- Tooltip's 128-char limit vs legend + per-gauge lines — builder
  truncates; whether the legend survives long menus gets decided in
  Phase 4 with real data.
- LevelDB compaction: the token may live in a `.ldb` under pending logs —
  reading every file in the directory (as macOS does) covers it; locked
  files are skipped non-fatally (Electron runs with user rights, browsers
  may hold locks while running — same on macOS, tolerated there).
- `windows-latest` downloads ~100 MB of Electron per CI run — cache it.
- Signing/SmartScreen unchanged — unsigned bundle, README keeps the
  "Run anyway" note.
