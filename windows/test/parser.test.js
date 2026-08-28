// Port of Tests/quotabarTests/QuotaResponseParserTests.swift — pinned Z.AI
// contract parsing plus the tolerant leaf conversions and the adaptive
// fallback.

import test from 'node:test';
import assert from 'node:assert/strict';
import { number, date } from '../src/core/jsonutil.js';
import { gaugesFrom, planLevel } from '../src/core/parser.js';

// MARK: number()

test('number conversions', () => {
  assert.equal(number(41.5), 41.5);
  assert.equal(number(3), 3);
  assert.equal(number('42'), 42);
  assert.equal(number('37.5%'), 37.5);  // dashboard-style strings
  assert.equal(number('abc'), null);
  assert.equal(number(null), null);
  assert.equal(number(undefined), null);
});

test('number rejects real booleans but keeps numeric one', () => {
  // JSON true/false must not become 1/0, while JSON 1 stays a legitimate
  // percentage value.
  assert.equal(number(true), null);
  assert.equal(number(false), null);
  assert.equal(number(1), 1);
});

// MARK: date()

test('date epoch seconds and milliseconds', () => {
  assert.equal(date(1_787_862_451).getTime(), 1_787_862_451_000);
  assert.ok(Math.abs(date(1_788_719_742_998).getTime() / 1000 - 1_788_719_742.998) < 0.001);
  // Below epoch-s range is a nonsensical timestamp, not a date.
  assert.equal(date(123), null);
});

test('date ISO8601 with and without fractional seconds', () => {
  const utc = (iso) => Date.parse(iso);

  assert.equal(date('2026-08-27T12:00:00Z').getTime(), utc('2026-08-27T12:00:00Z'));

  const fractional = date('2026-08-27T12:00:00.500Z');
  assert.ok(Math.abs(fractional.getTime() - utc('2026-08-27T12:00:00Z') - 500) < 1);

  assert.equal(date('not a date'), null);
  assert.equal(date(''), null);
});

// MARK: pinned contract

function pinnedFixture(percentage = 41) {
  return {
    code: 200, success: true,
    data: {
      level: 'max',
      limits: [
        { type: 'TIME_LIMIT', unit: 3, percentage, currentValue: 49_200, usage: 120_000, nextResetTime: 1_787_862_451_000 },
        { type: 'TIME_LIMIT', unit: 6, percentage: 14, currentValue: 8_400, usage: 60_000, nextResetTime: '2026-09-01T00:00:00Z' },
        { type: 'TIME_LIMIT', unit: 5, percentage: 3, currentValue: 139, usage: 4_000,
          usageDetails: [{ modelCode: 'GLM-4.7', usage: 139 }], nextResetTime: 1_788_719_742_998 },
      ],
    },
  };
}

test('pinned gauges parse in display order', () => {
  const gauges = gaugesFrom(pinnedFixture());
  assert.deepEqual(gauges.map((g) => g.id), ['fiveHour', 'week', 'mcp']);
  assert.equal(gauges[0].pct, 41);
  assert.equal(gauges[0].used, 49_200);
  assert.equal(gauges[0].total, 120_000);
  assert.equal(gauges[0].resetAt.getTime(), 1_787_862_451_000);
  assert.equal(gauges[1].label, 'Weekly limit');
  // ISO8601 reset strings parse through the same date() path.
  assert.equal(gauges[1].resetAt.getTime(), Date.parse('2026-09-01T00:00:00Z'));
});

test('pinned gauges clamp and carry details', () => {
  const gauges = gaugesFrom(pinnedFixture(120));
  assert.equal(gauges[0].pct, 100, 'percentage > 100 must clamp, not invert the ring');
  assert.equal(gauges[2].details[0].modelCode, 'GLM-4.7');
  assert.equal(gauges[2].details[0].usage, 139);
});

test('plan level', () => {
  assert.equal(planLevel(pinnedFixture()), 'max');
  assert.equal(planLevel({}), null);
});

// MARK: adaptive fallback

test('adaptive fallback parses keyword payloads', () => {
  // payload_b shape: fractional ratios normalize to percents, keyword
  // scoring picks one gauge per window.
  const payloadB = {
    success: true,
    data: {
      quota: {
        fiveHourWindow: { used_ratio: 0.37 },
        week: { usedRatio: 0.52 },
      },
    },
  };
  const gauges = gaugesFrom(payloadB);
  assert.deepEqual(gauges.map((g) => g.id), ['fiveHour', 'week']);
  assert.ok(Math.abs(gauges[0].pct - 37) < 0.001);
  assert.ok(Math.abs(gauges[1].pct - 52) < 0.001);
});
