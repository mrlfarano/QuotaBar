# Repository Guidelines

## Project Structure & Module Organization

QuotaBar provides a macOS menu-bar app and a Windows system-tray port.
- `Sources/quotabar/`: Swift entry point, provider sources, settings, discovery, and visualization.
- `Tests/quotabarTests/`: XCTest suites.
- `windows/src/`: Electron UI; `core/` contains portable logic and `core/sources/` contains providers.
- `windows/test/`: Node.js tests; `testdata/`: shared, sanitized JSON fixtures.
- `Resources/` and `docs/`: icons, screenshots, and design assets.
- `scripts/` and `windows/scripts/`: packaging helpers; `plans/`: architecture and provider contracts.

## Build, Test, and Development Commands

macOS requires Swift 5.9+ and macOS 13+. Run from repository root:
- `swift build -c release`: compile release executable.
- `swift test`: run XCTest suites.
- `.build/release/quotabar --demo`: launch with synthetic gauges.
- `.build/release/quotabar --parse testdata/payload_real.json`: check parsing offline.
- `./scripts/make-app.sh`: create `build/QuotaBar.app`.

Windows development requires Node.js 22.12+. Run from `windows/`:
- `npm ci`: install locked dependencies.
- `npm start` / `npm run demo`: launch live / synthetic sources.
- `npm test`: run Node's built-in test runner.
- `npm run package:win`: create `out/QuotaBar-win32-x64/QuotaBar.exe`.

## Coding Style & Naming Conventions

Follow surrounding code: Swift uses four-space indentation, PascalCase types/files, and camelCase members. JavaScript uses two spaces, ES modules, single quotes, and semicolons. No formatter or linter is configured.

Keep Swift dependency-free (AppKit/Foundation) and avoid runtime npm dependencies. Swift providers use enums with static asynchronous `fetch` methods returning `SourceSection`; report failures through `errorMessage`. Preserve behavior across platforms.

## Testing Guidelines

Name Swift suites `*Tests.swift` with `test*` methods; name JavaScript suites `*.test.js`. Parser changes require sanitized fixtures, deterministic `--parse-*` output, and unit coverage. Keep Swift and JavaScript outputs consistent on shared fixtures. No numeric coverage threshold is configured. Run relevant suites and offline checks; manually verify UI changes with demo mode.

## Commit & Pull Request Guidelines

History uses short descriptive subjects, sometimes prefixed with `Tests:`, `CI:`, or `README:`. Follow that pattern. Branch from `main`; keep each PR focused on one source or feature. Use the PR template's What and How I verified sections. Include parse output and redacted `--probe <source>` output for live-source changes; attach screenshots for UI changes.

## Security & Configuration

Never commit tokens or account identifiers; use `REDACTED-*` fixtures. Treat external credential files as read-only; never add Keychain-reading code. Preserve old config decoding by adding optional Codable fields. Update matching `plans/` documents when provider contracts change. Follow `SECURITY.md` for private vulnerability reports.
