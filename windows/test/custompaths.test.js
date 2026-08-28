// Port of Tests/quotabarTests/CustomSourcePathTests.swift — dot-path
// resolution and the small formatting helpers the menu and tray render
// through.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compactCount, shortReset, resetText, padToWidth } from '../src/core/format.js';
import { valueAt } from '../src/core/sources/custom.js';

const payload = {
  data: {
    label: 'default',
    limit: 1_000,
    usage: 400,
    usages: [
      { provider: 'p1', used: 250 },
      { provider: 'p2', used: '37.5%' },
    ],
  },
};

test('dot path resolves dict keys and array indices', () => {
  assert.equal(valueAt('data.usage', payload), 400);
  assert.equal(valueAt('data.limit', payload), 1_000);
  assert.equal(valueAt('data.usages.0.used', payload), 250);
  assert.equal(valueAt('data.usages.1.used', payload), 37.5,
    'numeric-string leaves resolve through the same %/number rules');
});

test('dot path misses return null', () => {
  assert.equal(valueAt('data.missing', payload), null);
  assert.equal(valueAt('data.usages.5.used', payload), null);   // out of bounds
  assert.equal(valueAt('data.label.sub', payload), null);       // walking into a string
  assert.equal(valueAt('', payload), null);
  assert.equal(valueAt('data.usages.p1', payload), null);       // string index into array
});

// MARK: formatting helpers

test('compact count', () => {
  assert.equal(compactCount(5), '5');
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(42_000), '42.0k');
  assert.equal(compactCount(1_500_000), '1.5M');
});

test('short reset and reset text', () => {
  const now = new Date(1_787_862_451_000);
  const at = (seconds) => new Date(now.getTime() + seconds * 1000);

  assert.equal(shortReset(null), null);
  assert.equal(shortReset(at(-60), now), null, 'past resets hide from the status bar');
  assert.equal(shortReset(at(47 * 60), now), '47m');
  assert.equal(shortReset(at(2 * 3600 + 47 * 60), now), '2h47m');

  assert.equal(resetText(at(-1), now), 'Reset time reached');
  assert.equal(resetText(at(2 * 3600 + 47 * 60), now), 'Resets in 2h 47m');
  assert.equal(resetText(at(5 * 60), now), 'Resets in 5m');
  assert.equal(resetText(null), null);
});

test('pad to width', () => {
  assert.equal(padToWidth('zai', 13), 'zai          ');
  assert.equal(padToWidth('five-hour-window', 13), 'five-hour-window');
});
