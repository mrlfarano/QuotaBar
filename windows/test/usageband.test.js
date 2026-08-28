// Port of Tests/quotabarTests/UsageBandTests.swift

import test from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, remainingPct } from '../src/core/format.js';
import { gauge } from '../src/core/parser.js';

// Color banding on quota REMAINING (battery metaphor) — the thresholds live
// in bandOf() and feed both the tray glyph and the menu.

test('band boundaries', () => {
  assert.equal(bandOf(100), 'green');
  assert.equal(bandOf(76), 'green');   // ≥76 green
  assert.equal(bandOf(75.4), 'yellow');
  assert.equal(bandOf(50), 'yellow');
  assert.equal(bandOf(26), 'yellow');  // ≥26 yellow
  assert.equal(bandOf(25.4), 'red');
  assert.equal(bandOf(25), 'red');     // ≤25 red
  assert.equal(bandOf(0), 'red');
});

test('band clamps out-of-range input', () => {
  assert.equal(bandOf(-10), 'red');
  assert.equal(bandOf(150), 'green');
});

test('gauge remainingPct and band', () => {
  const g = gauge('fiveHour', '5-hour window', 41);
  assert.ok(Math.abs(remainingPct(g.pct) - 59) < 0.001);
  assert.equal(bandOf(remainingPct(g.pct)), 'yellow');

  g.pct = 0;
  assert.equal(remainingPct(g.pct), 100);
  assert.equal(bandOf(remainingPct(g.pct)), 'green');

  // Over-100 usage pins remaining at 0 (red), never negative.
  g.pct = 120;
  assert.equal(remainingPct(g.pct), 0);
  assert.equal(bandOf(remainingPct(g.pct)), 'red');
});
