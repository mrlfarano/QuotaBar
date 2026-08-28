# Contributing to QuotaBar

Thanks for wanting to help! QuotaBar is a small, dependency-free SwiftPM
project — a good first issue usually fits in one file. By participating you
agree to uphold the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

```sh
git clone https://github.com/mrlfarano/QuotaBar.git
cd QuotaBar
scripts/make-app.sh && open build/QuotaBar.app   # release build, menu-bar app
swift build                                      # debug build only
.build/debug/quotabar --demo                     # synthetic gauges, no tokens
```

`--demo` needs no credentials. For live-source work, see the credential
sections in the README.

## Ground rules

- **No dependencies.** QuotaBar is AppKit + Foundation only; keep it that way.
- **Every source is an `enum` with `static func fetch(...) async -> SourceSection`.**
  Failures return a section with `errorMessage` — sources never throw and
  never crash the app.
- **Offline checks required.** New or changed parsers need a fixture in
  `testdata/` plus a `--parse-*` code path that prints gauges deterministically,
  and unit-test coverage in `Tests/quotabarTests/` for the pure parsing logic.
- **Secrets stay out.** Never commit real tokens, captured responses with
  account identifiers, or keychain-reading code. Sanitize fixtures
  (`REDACTED-*` placeholders are the convention).
- **Reverse-engineered endpoints** (z.ai, Claude, Codex) are documented in
  `plans/` with the pinned request/response shapes; update the matching plan
  when a contract changes.
- Config schema changes must keep old configs decoding: extend existing
  `Codable` structs only with optional fields (synthesized decoders require
  non-optional keys to be present).

## Pull requests

1. Fork + branch from `master`.
2. Keep the change small; one source/feature per PR.
3. Verify: `swift build -c release` clean, `swift test` green, offline
   `--parse-*` checks pass, and (if touching a live source) the matching
   `--probe <source>` works.
4. Describe what you tested and paste the probe output.

## Reporting bugs

Include: macOS version, whether the menu shows an error row for the affected
source (copy the exact text), and output of
`.build/release/quotabar --probe <source>` with any tokens redacted.
