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

// MARK: - 0.11 parity (EscalationText, tooltip, menu hygiene)

/// The escalating status text as a plain string (port of EscalationText):
/// calm when green — countdown only; numbers when it matters; `↻` marks
/// the countdown as time-until-reset, not quota-left; red always carries
/// ⚠︎, with or without a countdown.
export function escalationText(gauge, now = new Date()) {
  const remaining = Math.round(remainingPct(gauge.pct));
  const short = shortReset(gauge.resetAt, now);
  const band = bandOfGauge(gauge);
  if (band === Band.GREEN) return short ? `↻${short}` : `${remaining}%`;
  let text = `${remaining}%`;
  if (short) text += ` · ↻${short}`;
  if (band === Band.RED) text += ' ⚠︎';
  return text;
}

/// The tray tooltip — Windows' only text channel next to the glyph.
/// First line names the driving source and the ring legend, then the
/// primary gauge's escalation, then one line per gauge with "% left"
/// (parity with the macOS tooltip). Callers truncate to the OS's
/// 128-character budget.
export function tooltipText({ title, gauges, now = new Date() }) {
  const legend = gauges.slice(0, 2).map((gauge, index) => `${index === 0 ? 'outer' : 'inner'} ring = ${gauge.label.toLowerCase()}`).join(' · ');
  const lines = [legend ? `${title} — ${legend}` : title];
  if (gauges.length > 0) lines.push(escalationText(gauges[0], now));
  for (const gauge of gauges) {
    let line = `${gauge.label}: ${Math.round(gauge.pct)}% used · ${Math.round(remainingPct(gauge.pct))}% left`;
    if (gauge.used != null && gauge.total != null) {
      line += ` (${compactCount(gauge.used)}/${compactCount(gauge.total)} tokens)`;
    }
    const reset = resetText(gauge.resetAt, now);
    if (reset) line += ` · ${reset}`;
    lines.push(line);
  }
  return lines.join('\n');
}

/// Ellipsis-truncate past the cap (the Swift menu's `truncated`): section
/// titles, error rows, and notices at 48; Status-Bar-Source picker rows at
/// 36 — one verbose custom source must not stretch the whole menu.
export function menuClamp(text, max = 48) {
  const s = String(text ?? '');
  if ([...s].length <= max) return s;
  return [...s].slice(0, max - 1).join('').trimEnd() + '…';
}

/// Longest gauge label across all sections, floored at the original 13 —
/// every bar row pads to it so the block bars align even with verbose
/// custom-source labels.
export function gaugeLabelWidth(sections) {
  const longest = Math.max(0, ...(sections ?? []).flatMap((s) => (s.gauges ?? []).map((g) => [...String(g.label)].length)));
  return Math.max(13, longest);
}
