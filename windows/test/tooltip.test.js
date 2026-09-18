// 0.11 glyph/text parity: EscalationText (↻ countdowns, red ⚠︎), the tray
// tooltip builder, menu clamping/label-width helpers, and the red-band
// center dot (the colorblind shape channel).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escalationText, tooltipText, menuClamp, gaugeLabelWidth,
} from '../src/core/format.js';
import { dualRingRGBA } from '../src/ringicon.js';
import { makeGauge, makeSection } from '../src/core/model.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const inMinutes = (m) => new Date(NOW.getTime() + m * 60_000);
const gauge = (pct, { resetAt, used, total, id = 'fiveHour', label = '5-hour window' } = {}) =>
  makeGauge(id, label, pct, { used, total, resetAt });

// MARK: escalation text (port of EscalationTextTests semantics)

test('escalation: green stays calm — countdown only, else remaining', () => {
  // remaining 76% → green
  assert.equal(escalationText(gauge(24, { resetAt: inMinutes(167) }), NOW), '↻2h47m');
  assert.equal(escalationText(gauge(24), NOW), '76%');
});

test('escalation: yellow shows percent plus ↻ countdown', () => {
  // remaining 41% → yellow
  assert.equal(escalationText(gauge(59, { resetAt: inMinutes(43) }), NOW), '41% · ↻43m');
  assert.equal(escalationText(gauge(59), NOW), '41%', 'no reset → percent only');
});

test('escalation: red always carries ⚠︎, with or without countdown', () => {
  // remaining 8% → red
  assert.equal(escalationText(gauge(92, { resetAt: inMinutes(12) }), NOW), '8% · ↻12m ⚠︎');
  assert.equal(escalationText(gauge(92), NOW), '8% ⚠︎');
});

// MARK: tooltip builder

test('tooltip: title + legend first, escalation, then per-gauge lines', () => {
  const gauges = [
    gauge(59, { resetAt: inMinutes(43), used: 34_800, total: 60_000, id: 'fiveHour', label: '5-hour window' }),
    gauge(42, { used: 5_000, total: 12_000, id: 'week', label: 'Weekly limit', resetAt: inMinutes(3 * 1440) }),
  ];
  const tip = tooltipText({ title: 'Z.AI Coding Plan (max) · api.z.ai', gauges, now: NOW });
  const lines = tip.split('\n');
  assert.equal(lines[0], 'Z.AI Coding Plan (max) · api.z.ai — outer ring = 5-hour window · inner ring = weekly limit');
  assert.equal(lines[1], '41% · ↻43m', 'primary gauge escalation');
  assert.equal(lines[2], '5-hour window: 59% used · 41% left (34.8k/60.0k tokens) · Resets in 43m');
  assert.equal(lines[3], 'Weekly limit: 42% used · 58% left (5.0k/12.0k tokens) · Resets in 72h 0m');
});

test('tooltip works for a single gauge without inventing an inner ring', () => {
  const tip = tooltipText({ title: 'GitHub API · rate limit', gauges: [
    gauge(8, { used: 5, total: 60, id: 'gh-core', label: 'Core requests', resetAt: inMinutes(40) }),
  ], now: NOW });
  const lines = tip.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'GitHub API · rate limit — outer ring = core requests');
  assert.equal(lines[2], 'Core requests: 8% used · 92% left (5/60 tokens) · Resets in 40m');
});

test('weekly-only Codex tooltip labels the outer ring as weekly', () => {
  const tip = tooltipText({ title: 'Codex (pro) · usage', gauges: [
    gauge(10, { id: 'codex-weekly', label: 'Weekly limit', resetAt: inMinutes(600) }),
  ], now: NOW });
  assert.equal(tip.split('\n')[0], 'Codex (pro) · usage — outer ring = weekly limit');
  assert.match(tip, /Weekly limit: 10% used · 90% left/);
  assert.doesNotMatch(tip, /5-hour|inner ring/);
});

// MARK: menu hygiene helpers

test('menuClamp: short text unchanged, long text ellipsized at the cap', () => {
  assert.equal(menuClamp('short title'), 'short title');
  const long = 'e'.repeat(60);
  assert.equal(menuClamp(long), 'e'.repeat(47) + '…');
  assert.equal(menuClamp('x'.repeat(40), 36), 'x'.repeat(35) + '…', 'picker rows clamp at 36');
  assert.equal(menuClamp('pad   '), 'pad   ', 'under the cap the text is untouched (Swift parity)');
  assert.equal(menuClamp('a '.repeat(30) + 'b'), 'a a a a a a a a a a a a a a a a a a a a a a a a…',
    'trailing whitespace is trimmed before the ellipsis');
  assert.equal(menuClamp(undefined), '', 'non-strings fall back to empty (defensive)');
});

test('gaugeLabelWidth: floors at 13, grows with the longest label', () => {
  assert.equal(gaugeLabelWidth([]), 13);
  assert.equal(gaugeLabelWidth([makeSection('zai', 'Z.AI', { gauges: [makeGauge('fiveHour', '5-hour window', 1)] })]), 13);
  const sections = [
    makeSection('custom', 'my-custom-source', { gauges: [makeGauge('c1', 'a very long custom gauge label', 1)] }),
    makeSection('zai', 'Z.AI', { gauges: [makeGauge('fiveHour', '5-hour window', 1)] }),
  ];
  assert.equal(gaugeLabelWidth(sections), 'a very long custom gauge label'.length);
});

// MARK: red-band center dot (shape channel)

function pixelAt(rgba, size, x, y) {
  const o = (y * size + x) * 4;
  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
}

test('red band paints the center dot; other bands leave the center empty', () => {
  const size = 16;
  const center = 8;
  const red = dualRingRGBA({ size, fiveRemaining: 8, fiveBand: 'red', weekRemaining: 50, weekBand: 'yellow' });
  const [r, g, b, a] = pixelAt(red, size, center, center);
  assert.ok(a > 200, `center pixel must be opaque (alpha ${a})`);
  assert.ok(r > 180 && g < 120 && b < 120, `center pixel must be red (got ${r},${g},${b})`);

  const yellow = dualRingRGBA({ size, fiveRemaining: 41, fiveBand: 'yellow', weekRemaining: 50, weekBand: 'yellow' });
  const alpha = pixelAt(yellow, size, center, center)[3];
  assert.equal(alpha, 0, 'no dot outside the red band — center stays transparent');
});
