import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeSnapshot, deserializeSnapshot, makeGauge, makeSnapshot } from '../src/core/model.js';

const wire = { fetchedAt: 0, rawJSON: '{}', gauges: [{ id: 'fiveHour', label: '5-hour window', pct: 25, resetAt: 3600 }], usedScheme: 'Bearer ' };

test('cache reads Swift reference dates and omits absent optionals when writing', () => {
  const snap = deserializeSnapshot(JSON.stringify(wire));
  assert.equal(snap.fetchedAt.toISOString(), '2001-01-01T00:00:00.000Z');
  assert.equal(snap.gauges[0].resetAt.toISOString(), '2001-01-01T01:00:00.000Z');
  assert.deepEqual(JSON.parse(serializeSnapshot(snap)), wire);
});

test('cache round-trips fractional dates, counts, model details, plan and errors', () => {
  const snap = makeSnapshot({ fetchedAt: new Date('2026-09-01T00:00:00.123Z'), rawJSON: '{"usage":25}',
    gauges: [makeGauge('week', 'Weekly', 25, { used: 25, total: 100, resetAt: new Date('2026-09-02T00:00:00Z'), details: [{ modelCode: 'example', usage: 25 }] })],
    errorMessage: 'offline', usedScheme: '', planLevel: 'pro' });
  assert.deepEqual(deserializeSnapshot(serializeSnapshot(snap)), snap);
});

for (const bad of ['{', 'null', '[]', '{}', JSON.stringify({ ...wire, fetchedAt: '0' }),
  JSON.stringify({ ...wire, usedScheme: null }), JSON.stringify({ ...wire, gauges: [null] }),
  JSON.stringify({ ...wire, gauges: [{ id: 'x', label: 'x', pct: '20' }] }),
  JSON.stringify({ ...wire, gauges: [{ id: 'x', label: 'x', pct: 20, resetAt: 'tomorrow' }] })]) {
  test(`cache rejects malformed snapshot: ${bad}`, () => assert.equal(deserializeSnapshot(bad), null));
}
