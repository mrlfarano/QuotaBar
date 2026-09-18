import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReading, cachedReadings, defaultPreferences, paused, quotaAlert, validatePreferences } from '../src/core/windowsstate.js';

test('Windows preferences validate trust boundaries without changing shared config', () => {
  assert.deepEqual(validatePreferences({}), defaultPreferences());
  for (const value of [{ threshold: 0 }, { lowAlert: 'yes' }, { watched: [] }, { pauseUntil: Infinity }, { watched: { a: {} } }]) assert.throws(() => validatePreferences(value));
  assert.equal(paused({ pauseUntil: 200 }, 100), true);
  assert.equal(paused({ pauseUntil: 200 }, 201), false);
  assert.equal(paused({ pauseUntil: -1 }), true);
});

test('failed fetch preserves last good data and age, without exposing response or credentials', () => {
  const good = applyReading(null, { id: 'codex', gauges: [{ id: 'week', label: 'Weekly', pct: 42 }], rawJSON: 'SECRET' }, 100);
  const bad = applyReading(good, { id: 'codex', gauges: [], errorMessage: 'token SECRET rejected' }, 200);
  assert.equal(bad.status, 'Sign-in required');
  assert.equal(bad.lastSuccess, 100);
  assert.equal(bad.lastAttempt, 200);
  assert.equal(bad.gauges[0].pct, 42);
  assert.equal(JSON.stringify(bad).includes('SECRET'), false);
  const cached = cachedReadings({ version: 1, providers: [bad] });
  assert.equal(cached[0].status, 'Cached');
  assert.equal(cached[0].lastSuccess, 100);
  assert.equal(applyReading(bad, { id: 'codex', gauges: [] }, 300).status, 'No quota reported');
});

test('alerts require an observed crossing; recovery requires fresh positive quota', () => {
  const preferences = { lowAlert: true, recoveryAlert: true, threshold: 25 };
  const previous = { key: 'codex:week', left: 26, resetAt: 'next' };
  const current = { ...previous, left: 25 };
  assert.deepEqual(quotaAlert(null, current, preferences), []);
  assert.deepEqual(quotaAlert(previous, current, preferences), ['low']);
  assert.deepEqual(quotaAlert({ ...previous, alertedReset: 'next' }, current, preferences), []);
  assert.deepEqual(quotaAlert({ ...previous, left: 0 }, { ...current, left: 1 }, preferences), ['recovery']);
  assert.deepEqual(quotaAlert(previous, { ...current, key: 'claude:week' }, preferences), []);
  assert.deepEqual(quotaAlert(previous, current, defaultPreferences()), []);
});
