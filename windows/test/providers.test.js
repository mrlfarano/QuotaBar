import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Claude from '../src/core/sources/claude.js';
import * as Codex from '../src/core/sources/codex.js';
import * as Copilot from '../src/core/sources/copilot.js';
import * as OpenRouter from '../src/core/sources/openrouter.js';
import * as GitHub from '../src/core/sources/github.js';
import * as Antigravity from '../src/core/sources/antigravity.js';
import { fetchCustom } from '../src/core/sources/custom.js';
import { fetchSnapshot, networkMessage } from '../src/core/sources/zai.js';
import { defaultConfig } from '../src/core/config.js';
import { fixture, isolatedHome, writeJSON, mockFetch } from './helpers.js';

const config = { enabled: true, token: 'REDACTED-token', discovered: false, accountId: 'REDACTED-account' };

for (const [name, source, payload, ids, percentages] of [
  ['Claude', Claude, 'claude-usage', ['claude-5h', 'claude-weekly'], [41.2, 17.8]],
  ['Codex', Codex, 'codex-usage', ['codex-5h', 'codex-weekly'], [0, 36]],
]) {
  test(`${name} parses shared fixture in display order with reset dates`, () => {
    const gauges = source.gaugesFromRoot(fixture(payload));
    assert.deepEqual(gauges.map((g) => g.id), ids);
    assert.deepEqual(gauges.map((g) => g.pct), percentages);
    assert.ok(gauges.every((g) => g.resetAt instanceof Date));
    assert.deepEqual(source.gaugesFromRoot({}), []);
  });

  test(`${name} reports missing credentials without a request`, async (t) => {
    isolatedHome(t);
    mockFetch(t, []);
    assert.match((await source.fetch()).section.errorMessage, /No OAuth token/);
  });

  test(`${name} sends credentials only to its usage endpoint`, async (t) => {
    isolatedHome(t);
    const calls = mockFetch(t, [{ body: fixture(payload) }]);
    const result = await source.fetch(config);
    assert.equal(result.section.errorMessage, undefined);
    assert.equal(result.tokenUpdate, undefined);
    assert.equal(calls[0].url, source.usageURL);
    assert.equal(calls[0].headers.Authorization, 'Bearer REDACTED-token');
    assert.ok(calls[0].signal instanceof AbortSignal);
    if (name === 'Codex') assert.equal(calls[0].headers['ChatGPT-Account-Id'], config.accountId);
    else assert.equal(calls[0].headers['anthropic-beta'], 'oauth-2025-04-20');
  });

  for (const [response, expected] of [
    [{ status: 503, body: {} }, /HTTP 503/], [{ body: '<html>error</html>' }, /not JSON/],
    [{ body: {} }, /no .* (buckets|windows)/], [new Error('synthetic offline'), /Network error: synthetic offline/],
    [{ status: 401, body: {} }, /Token expired/],
  ]) {
    test(`${name} handles ${expected}`, async (t) => {
      isolatedHome(t);
      mockFetch(t, [response]);
      const result = await source.fetch(config);
      assert.deepEqual(result.section.gauges, []);
      assert.match(result.section.errorMessage, expected);
    });
  }

  test(`${name} refreshes rejected token and returns rotated credentials for persistence`, async (t) => {
    isolatedHome(t);
    const calls = mockFetch(t, [{ status: 401, body: {} },
      { body: { access_token: 'REDACTED-new', refresh_token: 'REDACTED-new-refresh' } }, { body: fixture(payload) }]);
    const original = { ...config, refreshToken: 'REDACTED-refresh' };
    const result = await source.fetch(original);
    assert.equal(result.section.errorMessage, undefined);
    assert.deepEqual(result.tokenUpdate, { ...original, token: 'REDACTED-new', refreshToken: 'REDACTED-new-refresh' });
    assert.equal(original.token, config.token);
    assert.equal(calls[1].url, source.refreshURL);
    assert.equal(calls[1].method, 'POST');
    const body = name === 'Claude' ? JSON.parse(calls[1].body) : Object.fromEntries(new URLSearchParams(calls[1].body));
    assert.equal(body.refresh_token, 'REDACTED-refresh');
    assert.equal(body.grant_type, 'refresh_token');
    assert.equal(calls[2].headers.Authorization, 'Bearer REDACTED-new');
  });

  test(`${name} stops when refresh endpoint rejects the credential`, async (t) => {
    isolatedHome(t);
    const calls = mockFetch(t, [{ status: 403, body: {} }, { status: 400, body: {} }]);
    const result = await source.fetch({ ...config, refreshToken: 'REDACTED-refresh' });
    assert.match(result.section.errorMessage, /Token expired/);
    assert.equal(result.tokenUpdate, undefined);
    assert.equal(calls.length, 2);
  });

  test(`${name} reads CLI credentials live without rewriting its file`, async (t) => {
    const home = isolatedHome(t);
    const relative = name === 'Claude' ? '.claude/.credentials.json' : '.codex/auth.json';
    const value = name === 'Claude' ? { claudeAiOauth: { accessToken: 'REDACTED-file' } }
      : { tokens: { access_token: 'REDACTED-file', account_id: 'REDACTED-account' } };
    const file = writeJSON(home, relative, value);
    const before = fs.readFileSync(file, 'utf8');
    const calls = mockFetch(t, [{ body: fixture(payload) }]);
    assert.equal((await source.fetch()).section.errorMessage, undefined);
    assert.equal(calls[0].headers.Authorization, 'Bearer REDACTED-file');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
}

test('Claude tries live file token after stored token expires', async (t) => {
  const home = isolatedHome(t);
  writeJSON(home, '.claude/.credentials.json', { claudeAiOauth: { accessToken: 'REDACTED-file' } });
  const calls = mockFetch(t, [{ status: 401, body: {} }, { body: fixture('claude-usage') }]);
  assert.equal((await Claude.fetch(config)).section.errorMessage, undefined);
  assert.deepEqual(calls.map((c) => c.headers.Authorization), ['Bearer REDACTED-token', 'Bearer REDACTED-file']);
});

test('OpenRouter distinguishes capped, uncapped and free-tier accounts', () => {
  assert.equal(OpenRouter.sectionFrom(fixture('openrouter-credits')).gauges[0].pct, 32.7);
  const uncapped = OpenRouter.sectionFrom({ data: { limit: null, usage: 3.27, is_free_tier: true } });
  assert.deepEqual(uncapped.gauges, []);
  assert.match(uncapped.notice, /No spending cap.*3\.27/);
  assert.match(uncapped.title, /free tier/);
  assert.equal(OpenRouter.sectionFrom({ data: { limit: 10 } }).gauges[0].pct, 0);
  assert.match(OpenRouter.sectionFrom({}).errorMessage, /No data/);
});

test('OpenRouter environment key takes precedence; empty key does not request', async (t) => {
  const calls = mockFetch(t, [{ body: fixture('openrouter-credits') }]);
  assert.equal((await OpenRouter.fetch(config, { OPENROUTER_API_KEY: 'REDACTED-env' })).errorMessage, undefined);
  assert.equal(calls[0].headers.Authorization, 'Bearer REDACTED-env');
  assert.match((await OpenRouter.fetch(undefined, {})).errorMessage, /No API key/);
});

test('Copilot handles unlimited plans and clamps excess remaining quota', () => {
  const data = fixture('copilot-user');
  const gauge = Copilot.sectionFrom(data).gauges[0];
  assert.equal(gauge.pct, 20);
  assert.equal(gauge.resetAt.toISOString(), '2026-09-01T00:00:00.000Z');
  data.quota_snapshots.premium_interactions.remaining = 400;
  assert.equal(Copilot.sectionFrom(data).gauges[0].pct, 0);
  data.quota_snapshots.premium_interactions.unlimited = true;
  assert.match(Copilot.sectionFrom(data).notice, /Unlimited/);
  assert.match(Copilot.sectionFrom({}).errorMessage, /No premium_interactions/);
});

test('Copilot falls back to raw OAuth when session token is rejected', async (t) => {
  const calls = mockFetch(t, [{ body: { token: 'REDACTED-session' } }, { status: 401, body: {} }, { body: fixture('copilot-user') }]);
  assert.equal((await Copilot.fetch(config)).errorMessage, undefined);
  assert.deepEqual(calls.map((c) => c.headers.Authorization), ['Bearer REDACTED-token', 'Bearer REDACTED-session', 'token REDACTED-token']);
  assert.ok(calls.every((c) => c.headers['Editor-Version']));
});

test('Copilot uses Windows APPDATA credential location', async (t) => {
  const home = isolatedHome(t);
  writeJSON(home, 'github-copilot/hosts.json', { 'github.com': { oauth_token: 'REDACTED-windows' } });
  const calls = mockFetch(t, [{ status: 403, body: {} }, { body: fixture('copilot-user') }]);
  assert.equal((await Copilot.fetch()).errorMessage, undefined);
  assert.equal(calls[1].headers.Authorization, 'token REDACTED-windows');
});

test('GitHub supports unauthenticated quota and authenticated quota', async (t) => {
  const body = { resources: { core: { used: 15, limit: 60, reset: 1788278400 } } };
  const calls = mockFetch(t, [{ body }, { body }]);
  const section = await GitHub.fetch();
  assert.equal(section.gauges[0].pct, 25);
  assert.equal(section.gauges[0].resetAt.getTime(), 1788278400000);
  await GitHub.fetch('REDACTED-token');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Authorization, 'Bearer REDACTED-token');
});

const custom = { id: 'Example', title: 'Example quota', url: 'https://example.invalid/quota', token: 'REDACTED-token', usedPath: 'data.used', limitPath: 'data.limit' };
test('custom source resolves nested usage, defaults missing usage, and sends configured headers', async (t) => {
  const calls = mockFetch(t, [{ body: { data: { used: 25, limit: 100 }, reset: '2026-09-01T00:00:00Z' } }, { body: { data: { limit: 100 } } }]);
  const result = await fetchCustom({ ...custom, resetPath: 'reset', headers: { 'X-Test': '1' } });
  assert.equal(result.id, 'example');
  assert.equal(result.gauges[0].pct, 25);
  assert.equal(result.gauges[0].resetAt.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(calls[0].headers.Authorization, 'Bearer REDACTED-token');
  assert.equal(calls[0].headers['X-Test'], '1');
  assert.equal((await fetchCustom(custom)).gauges[0].pct, 0);
});

test('custom source rejects bad URL and missing or zero limit', async (t) => {
  mockFetch(t, [{ body: { data: { limit: 0 } } }, { body: {} }]);
  assert.match((await fetchCustom({ ...custom, url: 'bad url' })).errorMessage, /Invalid/);
  assert.match((await fetchCustom(custom)).errorMessage, /limitPath/);
  assert.match((await fetchCustom(custom)).errorMessage, /limitPath/);
});

for (const [name, fetcher] of [['GitHub', () => GitHub.fetch()], ['OpenRouter', () => OpenRouter.fetch(config, {})], ['custom', () => fetchCustom(custom)]]) {
  for (const [response, message] of [[{ status: 500, body: {} }, /HTTP 500/], [{ body: 'not json' }, /JSON|Could not read/], [new Error('offline'), /Network error: offline/]]) {
    test(`${name} degrades to error section: ${message}`, async (t) => {
      mockFetch(t, [response]);
      const result = await fetcher();
      assert.match(result.errorMessage, message);
      assert.deepEqual(result.gauges, []);
    });
  }
}

test('Antigravity picks most constrained pool member and excludes image-only quota', () => {
  const data = fixture('antigravity-userstatus');
  const result = Antigravity.sectionFrom(data);
  assert.match(result.title, /Google AI Pro/);
  assert.deepEqual(result.gauges.map((g) => g.id), ['antigravity-gemini', 'antigravity-claude-gpt']);
  assert.ok(Math.abs(result.gauges[0].pct - 69) < 1e-8);
  assert.ok(Math.abs(result.gauges[1].pct - 55) < 1e-8);
  assert.match(Antigravity.sectionFrom({ code: 7 }).errorMessage, /code 7/);
  assert.match(Antigravity.sectionFrom({ userStatus: {} }).notice, /no usage fractions/);
});

test('Z.AI tries raw auth after Bearer rejection and remembers working scheme', async (t) => {
  const calls = mockFetch(t, [{ status: 401, body: {} }, { body: fixture('payload_real') }]);
  const result = await fetchSnapshot({ ...defaultConfig(), zaiToken: 'REDACTED-token' }, {});
  assert.ok(result.gauges.length);
  assert.equal(result.usedScheme, '');
  assert.deepEqual(calls.map((c) => c.headers.Authorization), ['Bearer REDACTED-token', 'REDACTED-token']);
  assert.ok(calls.every((c) => c.url.endsWith('?type=2')));
});

test('Z.AI retries without type=2 after empty responses', async (t) => {
  const calls = mockFetch(t, [{ body: {} }, { body: {} }, { body: fixture('payload_real') }]);
  const result = await fetchSnapshot({ ...defaultConfig(), zaiToken: 'REDACTED-token' }, {});
  assert.ok(result.gauges.length);
  assert.equal(new URL(calls[2].url).search, '');
});

test('Z.AI auth rejection is bounded and does not leak credentials', async (t) => {
  const calls = mockFetch(t, [{ status: 401, body: {} }, { body: { code: 401, msg: 'token expired' } }]);
  const result = await fetchSnapshot({ ...defaultConfig(), zaiToken: 'REDACTED-secret' }, {});
  assert.match(result.errorMessage, /Unauthorized/);
  assert.ok(!JSON.stringify(result).includes('REDACTED-secret'));
  assert.equal(calls.length, 2);
});

test('Z.AI handles missing token, bad base, invalid JSON, API rejection and timeout', async (t) => {
  const cfg = { ...defaultConfig(), zaiToken: 'REDACTED-token' };
  mockFetch(t, [{ body: '<html>bad</html>' }, { body: { success: false, msg: 'quota denied' } }, new DOMException('timeout', 'TimeoutError')]);
  assert.match((await fetchSnapshot(defaultConfig(), {})).errorMessage, /No token/);
  assert.match((await fetchSnapshot({ ...cfg, baseURL: 'bad url' }, {})).errorMessage, /Bad base/);
  assert.match((await fetchSnapshot(cfg, {})).errorMessage, /not JSON/);
  assert.equal((await fetchSnapshot(cfg, {})).errorMessage, 'quota denied');
  assert.match((await fetchSnapshot(cfg, {})).errorMessage, /request timed out/);
  assert.equal(networkMessage(new DOMException('aborted', 'AbortError')), 'request timed out');
});
