// Port of Visualization.swift (color banding, countdowns) and the main.swift
// formatting helpers. Pure functions — no Electron, no network.

// MARK: - Color banding
//
// Traffic-light semantics on the quota REMAINING (battery metaphor):
//   remaining ≥ 76%  → green   (plenty left, i.e. ≤24% used)
//   remaining 26–75% → yellow
//   remaining ≤ 25%  → red     (nearly exhausted)

export const Band = Object.freeze({ GREEN: 'green', YELLOW: 'yellow', RED: 'red' });

// macOS system colors (dark variants) so the glyph reads on a dark taskbar.
export const BandColor = Object.freeze({
  green: '#32D74B',
  yellow: '#FFD60A',
  red: '#FF453A',
});

export function bandOf(remainingPct) {
  const rounded = Math.round(Math.min(Math.max(remainingPct, 0), 100));
  if (rounded >= 76) return Band.GREEN;
  if (rounded >= 26) return Band.YELLOW;
  return Band.RED;
}

export function remainingPct(pct) {
  return Math.min(Math.max(100 - pct, 0), 100);
}

export function bandOfGauge(gauge) {
  return bandOf(remainingPct(gauge.pct));
}

// MARK: - Text helpers

/// "QuotaBar v0.10.0"; "(dev build)" when there is no version string.
export function versionLabel(version) {
  if (typeof version !== 'string' || version === '') return 'QuotaBar (dev build)';
  return `QuotaBar v${version}`;
}

/// Compact token/request count: 42.0k, 1.5M, "5", "37.5".
export function compactCount(value) {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k';
  if (value === Math.round(value)) return String(Math.round(value));
  return value.toFixed(1);
}

/// Swift's String(Double) — "400.0", not "400". Only the --parse-custom
/// output needs this for byte-parity with the Swift binary.
export function swiftDouble(value) {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/// Compact countdown for the tray tooltip: "2h47m" / "47m". `now` is
/// injectable so tests can assert exact text deterministically.
export function shortReset(date, now = new Date()) {
  if (!date) return null;
  const interval = (date.getTime() - now.getTime()) / 1000;
  if (!(interval > 0)) return null;
  const minutes = Math.trunc(interval / 60);
  if (minutes >= 60) {
    return `${Math.trunc(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
  }
  return `${minutes}m`;
}

/// Long countdown for menu rows: "Resets in 2h 47m".
export function resetText(date, now = new Date()) {
  if (!date) return null;
  const interval = (date.getTime() - now.getTime()) / 1000;
  if (interval <= 0) return 'Reset time reached';
  const hours = Math.trunc(interval / 3600);
  const minutes = Math.trunc((Math.trunc(interval) % 3600) / 60);
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

/// Spaces-only left alignment to `width` (longer labels are kept as-is).
export function padToWidth(text, width) {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

/// Block bar for menu rows: filled runs in the band color, rest muted.
/// (Colors carry through the per-row icon on Windows; the blocks keep the
/// proportion readable in monochrome.)
export function blockBar(pct, width = 12) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(width - filled, 0));
}

/// pollMinutes comes from hand-editable JSON, so clamp it to a sane window.
export function normalizedPollMinutes(value) {
  return Math.min(Math.max(Math.trunc(value), 1), 60);
}
