# Plan 003 — B2 concentric dual-ring status item

- **Planned by:** GLM-5.3 · **Executor:** GLM-5.3 (session precedent)
- **Status:** approved by user ("that looks good for now") after reviewing
  rendered mockups `/tmp/design-b/options-B-{2x,magnified}.png` (copied to
  `docs/design/` for the record).

## Spec

Status bar becomes one compact glyph + escalating text (Option B2 + D):

- **Glyph** (single 20×20 image, `lockFocus`, unflipped):
  - Outer ring = 5-hour remaining: radius 8.25, stroke 3.5, band color,
    track `tertiaryLabelColor`.
  - Inner ring = weekly remaining: radius 4.25, stroke 2, band color.
  - Both arcs start at 12 o'clock, fill clockwise (startAngle 90,
    endAngle 90 − 360·f, clockwise). Fallback: weekly-only → outer ring
    shows weekly, no inner ring.
- **Text** (`escalationTitle`):
  - green → countdown only (`9h26m`), `secondaryLabelColor`
  - yellow → `41%` band-color semibold + ` · 43m` secondary
  - red → `18%` band-color semibold + ` · 12m ⚠︎` secondary
  - demo → ` demo` suffix tertiary
- System band colors (`systemGreen/Yellow/Red`) as everywhere else; menu,
  tooltip, sources, polling all unchanged. `statusText` and the old single
  `ringImage` are removed (dead code).

## Steps

1. `Visualization.swift`: add `dualRingImage(fiveRemaining:fiveBand:weekRemaining:weekBand:)`,
   remove `ringImage`.
2. `main.swift`: replace ring+text logic in `updateStatusItem` with glyph +
   `escalationTitle(for:demo:)`; delete `statusText`.
3. Copy mockup PNGs into `docs/design/`; update README status-bar mock.
4. Gates: `swift build` 0/0; 4 fixtures byte-identical; demo screenshot
   (green outer + yellow inner + `2h47m demo`); live screenshot; agent
   reinstall (`scripts/install-login.sh`) so ~/Applications copy matches.

## Acceptance

All gates above pass; commit + tag `v0.5`; push to origin.
