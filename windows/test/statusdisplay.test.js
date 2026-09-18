// Port of Tests/quotabarTests/StatusDisplayTests.swift — what the tray
// shows, decided by resolve(): selected source → healthy fallback → short
// error → cached warm start → idle. The two regression tests pin the
// critique bugs: an errored selection (or a z.ai auth failure) must fall
// through to a healthy provider instead of replacing the glyph with a
// warning. Plus the RefreshCoordinator port.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, errorText, RefreshCoordinator } from '../src/core/statusdisplay.js';
import { makeGauge, makeSection, makeSnapshot } from '../src/core/model.js';

const gauge = (id, pct = 50) => makeGauge(id, id, pct);
const section = (id, gauges = [], error = undefined) => makeSection(id, id, { gauges, errorMessage: error });
const zaiSnapshot = (gauges = [], error = undefined) => makeSnapshot({
  fetchedAt: new Date(), rawJSON: '', gauges, errorMessage: error, usedScheme: '',
});

// MARK: happy paths

test('main source healthy wins', () => {
  const zai = section('zai', [gauge('fiveHour')]);
  const claude = section('claude', [gauge('claude-5h')]);
  const result = resolve([zai, claude], zaiSnapshot([gauge('fiveHour')]), 'claude');
  assert.deepEqual(result, { kind: 'gauges', gauges: [gauge('claude-5h')], title: 'claude' });
});

test('defaults to zai when no main source', () => {
  const result = resolve(
    [section('github', [gauge('gh-core')]), section('zai', [gauge('fiveHour')])],
    zaiSnapshot(), null);
  assert.deepEqual(result, { kind: 'gauges', gauges: [gauge('fiveHour')], title: 'zai' });
});

// MARK: the regression tests (critique bugs 1 and 2)

test('errored main source falls back to healthy section', () => {
  const erroredClaude = section('claude', [], 'run `claude` once to re-authenticate');
  const healthyGithub = section('github', [gauge('gh-core')]);
  const result = resolve([erroredClaude, healthyGithub], null, 'claude');
  assert.deepEqual(result, { kind: 'gauges', gauges: [gauge('gh-core')], title: 'github' });
});

test('zai auth error yields to healthy section', () => {
  const healthyClaude = section('claude', [gauge('claude-5h')]);
  const result = resolve([healthyClaude], zaiSnapshot([], 'No token — paste it in the menu\'s key fields'), null);
  assert.deepEqual(result, { kind: 'gauges', gauges: [gauge('claude-5h')], title: 'claude' });
});

// MARK: error wording

test('nothing healthy surfaces main source error', () => {
  const result = resolve(
    [section('claude', [], 'Network error: offline'), section('zai', [], 'HTTP 503')],
    zaiSnapshot([], 'HTTP 503'), 'claude');
  assert.deepEqual(result, { kind: 'error', text: '⚠︎ claude' });
});

test('nothing healthy falls back to zai snapshot error', () => {
  const result = resolve([], zaiSnapshot([], 'No token — paste it'), null);
  assert.deepEqual(result, { kind: 'error', text: '⚠︎ z.ai auth' });
});

test('zai error wording preserved for auth and generic', () => {
  assert.equal(errorText('zai', 'No token — paste it in the menu\'s key fields'), '⚠︎ z.ai auth');
  assert.equal(errorText('zai', 'Unauthorized — token rejected'), '⚠︎ z.ai auth');
  assert.equal(errorText('zai', 'HTTP 503 from api.z.ai'), '⚠︎ z.ai');
  assert.equal(errorText('codex', 'HTTP 429'), '⚠︎ codex');
});

// MARK: warm start / idle / no data

test('cached zai snapshot warm starts before first fetch', () => {
  const cached = [gauge('fiveHour'), gauge('week')];
  const result = resolve([], zaiSnapshot(cached), null);
  assert.deepEqual(result, { kind: 'gauges', gauges: cached, title: undefined });
});

test('idle when nothing exists yet', () => {
  assert.deepEqual(resolve([], null, null), { kind: 'idle', text: 'quotabar…' });
});

test('no data when sections exist but all empty', () => {
  const result = resolve([section('copilot'), section('github')], null, null);
  assert.deepEqual(result, { kind: 'error', text: '⚠︎ no data' });
});

// MARK: refresh coalescing

test('single cycle begin end', () => {
  const coordinator = new RefreshCoordinator();
  assert.equal(coordinator.begin(), true, 'first request runs');
  assert.equal(coordinator.end(), false, 'clean cycle end reports no re-run');
  assert.equal(coordinator.begin(), true);
});

test('request during flight re-runs', () => {
  const coordinator = new RefreshCoordinator();
  assert.equal(coordinator.begin(), true);
  assert.equal(coordinator.begin(), false, 'arrives mid-flight → pending');
  assert.equal(coordinator.end(), true, 'cycle end reports the pending re-run');
  assert.equal(coordinator.end(), false, 'end is idempotent outside a cycle');
  assert.equal(coordinator.running, false);
});

test('re-run cycle can also accumulate', () => {
  const coordinator = new RefreshCoordinator();
  coordinator.begin();
  coordinator.begin();
  assert.equal(coordinator.end(), true);
  assert.equal(coordinator.begin(), true, 're-run starts normally');
  assert.equal(coordinator.end(), false);
});
