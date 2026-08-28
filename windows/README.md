# QuotaBar for Windows

The Windows port of QuotaBar: the same sources, parsers, config format,
color bands, and dual-ring glyph as the macOS menu-bar app, living in the
Windows **system tray** (notification area) instead of the menu bar.

- **Same logic** — every provider source (Z.AI, Claude, Codex, Copilot,
  Antigravity, OpenRouter, GitHub, custom dot-path sources), the pinned +
  adaptive Z.AI parsers, credential auto-discovery, the refresh-token
  chains, and the `~/.quotabar/config.json` format are line-faithful ports
  of `Sources/quotabar/`. The offline `--parse*` outputs are byte-identical
  to the Swift binary on the shared fixtures in `../testdata/`, and the
  snapshot cache (`~/.quotabar/last-snapshot.json`) is interchangeable with
  the macOS app's.
- **Same visuals** — the tray glyph is the same concentric dual ring
  (outer = 5-hour quota, inner = weekly, band colors, filling clockwise from
  12 o'clock), and the tray menu mirrors the macOS menu: section headers,
  block-bar gauge rows, token counts, reset countdowns, the Status Bar
  Source picker, Refresh Now, Copy Raw Response, Discover Sources,
  Settings…, and the version row.

## Platform differences (honest list)

| macOS | Windows |
|-------|---------|
| Menu-bar item shows glyph **+ text** ("41% · ↻43m") | Tray icons are icon-only on Windows — the glyph's colors carry the band, and the escalating numbers + warning live in the live-updating tooltip |
| Attributed menu text (colored bars/percents inline) | Native menus can't color text; each gauge row carries a band-colored ring icon next to the mono block bar |
| `NSAlert` prompts | Native dialogs / small windows with the same copy |
| `~/.claude`, `~/.codex`, `~/.config/github-copilot`, … | Same literal paths (tilde = `%USERPROFILE%`), **plus** the Windows-native locations (`%LOCALAPPDATA%\opencode`, `%APPDATA%\github-copilot`, `%APPDATA%\Antigravity`, …) as discovery candidates |
| Antigravity process scan via `ps`/`lsof` | Same scan via `Get-CimInstance` / `Get-NetTCPConnection` (netstat fallback) |
| config saved 0600 | `chmod 600` is a no-op on NTFS; the file sits in your profile folder — set ACLs yourself if you share the machine |

## Known parity gaps (as of the macOS 0.11.0 dev cycle)

The macOS app's plan-007 changes land here in a follow-up pass:

- The tray still follows the old status logic — a Z.AI error replaces the
  rings instead of falling through to a healthy provider
  (`src/trayapp.js`, same bug macOS fixed in `StatusDisplay.swift`).
- Z.AI is not toggleable; `sources.zai` is ignored.
- No per-source status lines, key-clearing buttons, ↻ countdown glyph, or
  red-band center dot; escalations still read "41% · 43m".

## Run from source

Requires [Node.js](https://nodejs.org) ≥ 20. No runtime npm dependencies;
Electron is a dev dependency only.

```sh
cd windows
npm install
npm start             # real sources
npm run demo          # synthetic gauges, offline
npm test              # unit tests (ports of Tests/quotabarTests/)
node src/cli.js --parse ../testdata/payload_real.json   # offline parser checks
```

## Package a Windows build

```sh
cd windows
npm run package:win   # → out/QuotaBar-win32-x64/QuotaBar.exe
```

Works from macOS/Linux too — `@electron/packager` downloads the prebuilt
win32 Electron and needs no Windows machine. The unpacked folder (or its
zip) is the deliverable: copy `QuotaBar-win32-x64/` anywhere and run
`QuotaBar.exe`. Two cosmetic caveats: the exe keeps the default Electron
icon (rebranding needs `rcedit`/wine), and the binary is unsigned, so
SmartScreen shows "more info → Run anyway" on first launch.

## Layout

```
src/
  main.js            entry: --demo/--parse*/--probe dispatch, then the tray app
  trayapp.js         port of main.swift's AppDelegate: tray, menu, polling, cache
  ringicon.js        the dual-ring glyph rasterizer (same geometry as Visualization.swift)
  png.js             dependency-free PNG encoder for the glyphs
  cli.js             offline --parse*/--probe checks (byte-parity with the Swift binary)
  settingswindow.js  Settings… window (poll cadence, per-source toggles, keys)
  core/              the portable logic: config, parsers, sources, discovery, format
test/                ports of Tests/quotabarTests/ (node --test)
scripts/             packaging
```

`npm start` also runs on macOS/Linux for development — handy for verifying
changes without a Windows box, as the glyphs and menus are drawn by the
shared code.
