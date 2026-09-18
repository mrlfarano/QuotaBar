// Port of Tests/quotabarTests/SettingsTests.swift — poll-cadence clamping,
// per-source enable toggles (with credential preservation), masked key
// entry, version label.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedPollMinutes, versionLabel } from '../src/core/format.js';
import { defaultConfig, validateConfig } from '../src/core/config.js';
import { makeGauge, makeSection } from '../src/core/model.js';
import {
  TOGGLEABLE_SOURCES, KEY_FIELDS, isSourceEnabled, setSourceEnabled,
  maskedKey, keyValue, setKey, sourceStatus, shortStatus,
} from '../src/core/settings.js';

// MARK: poll cadence

test('normalized poll minutes', () => {
  assert.equal(normalizedPollMinutes(5), 5);
  assert.equal(normalizedPollMinutes(0), 1);
  assert.equal(normalizedPollMinutes(-7), 1);
  assert.equal(normalizedPollMinutes(999), 60);
});

// MARK: masked keys

test('masked key keeps only last five characters', () => {
  assert.equal(maskedKey('sk-or-v1-0123456789abcdefghij'), '********fghij');
  assert.equal(maskedKey('1234567890'), '********67890');
});

test('masked key short keys stay all stars', () => {
  assert.equal(maskedKey(''), '');
  assert.equal(maskedKey('abc'), '***');
  assert.equal(maskedKey('abcde'), '*****', 'exactly five characters: nothing readable');
  assert.equal(maskedKey('  ab  '), '**', 'whitespace is trimmed before masking');
});

test('masked key fixed length does not leak key length', () => {
  assert.equal(maskedKey('abcdefghijklmn'), '********jklmn');
  assert.equal(maskedKey('abcdefghijklmnopqrstuvwxyz012345'), '********12345',
    'a 32-char key and a 14-char key both show exactly 8 stars + last 5');
});

// MARK: key fields

test('set key round trip', () => {
  const config = defaultConfig();
  config.authScheme = 'Bearer ';
  let updated = setKey(config, 'zai', 'z1');
  assert.equal(keyValue(updated, 'zai'), 'z1');
  assert.equal(updated.zaiToken, 'z1');
  assert.equal(updated.authScheme, undefined, 'changing the Z.AI key must re-probe header styles');
  // Copy-on-write: the input config is untouched (Swift value semantics).
  assert.equal(config.zaiToken, '');
  assert.equal(config.authScheme, 'Bearer ');

  updated = setKey(updated, 'github', 'gh1');
  updated = setKey(updated, 'openrouter', 'or1');
  assert.equal(keyValue(updated, 'github'), 'gh1');
  assert.equal(keyValue(updated, 'openrouter'), 'or1');
  assert.equal(updated.zaiToken, 'z1', 'one field must not disturb the others');
  assert.equal(keyValue(updated, 'unknown'), '');
});

test('set key creates source object on demand', () => {
  const config = defaultConfig(); // sources undefined
  const updated = setKey(config, 'github', 'gh1');
  assert.equal(updated.sources.github.token, 'gh1');
  assert.equal(isSourceEnabled(updated, 'github'), true,
    'pasting a key into a fresh object keeps its enabled-by-default state');

  const openrouter = setKey(config, 'openrouter', 'or1');
  assert.equal(openrouter.sources.openrouter.token, 'or1');
  assert.equal(isSourceEnabled(openrouter, 'openrouter'), true,
    'a fresh object enables the source — pasting a key reads as intent to use it');
});

test('set key preserves existing source state', () => {
  const config = defaultConfig();
  config.sources = {};
  config.sources.github = { enabled: false, token: '', discovered: true };
  config.sources.openrouter = {
    enabled: false, token: '', refreshToken: 'r0', accountId: 'a0', discovered: false,
  };
  let updated = setKey(config, 'github', 'gh1');
  updated = setKey(updated, 'openrouter', 'or1');

  assert.equal(isSourceEnabled(updated, 'github'), false, 'an explicit opt-out survives key entry');
  assert.equal(updated.sources.github.discovered, true);
  assert.equal(isSourceEnabled(updated, 'openrouter'), false);
  assert.equal(updated.sources.openrouter.refreshToken, 'r0');
  assert.equal(updated.sources.openrouter.accountId, 'a0');
  assert.equal(updated.sources.openrouter.token, 'or1');
});

// MARK: source enable state

test('default enabled states mirror fetch gates', () => {
  const config = defaultConfig();
  assert.equal(isSourceEnabled(config, 'github'), true, 'GitHub polls by default');
  for (const id of ['claude', 'codex', 'openrouter', 'copilot', 'antigravity']) {
    assert.equal(isSourceEnabled(config, id), false, `${id} stays off until discovered or enabled`);
  }
  assert.equal(isSourceEnabled(config, 'unknown'), false);
});

test('toggle preserves stored credentials', () => {
  const config = defaultConfig();
  config.sources = {};
  config.sources.codex = { enabled: true, token: 't0', refreshToken: undefined, accountId: 'a1', discovered: true };

  const disabled = setSourceEnabled(config, 'codex', false);
  assert.equal(isSourceEnabled(disabled, 'codex'), false);
  assert.equal(disabled.sources.codex.token, 't0');
  assert.equal(disabled.sources.codex.accountId, 'a1');
  assert.equal(disabled.sources.codex.discovered, true);
  // Copy-on-write: the input config is untouched (Swift value semantics).
  assert.equal(isSourceEnabled(config, 'codex'), true);

  const reEnabled = setSourceEnabled(disabled, 'codex', true);
  assert.equal(isSourceEnabled(reEnabled, 'codex'), true);
  assert.equal(reEnabled.sources.codex.token, 't0', 're-enabling must not wipe the token');
});

test('toggle creates missing source object', () => {
  const config = defaultConfig(); // sources undefined
  const toggled = setSourceEnabled(config, 'copilot', true);
  assert.equal(isSourceEnabled(toggled, 'copilot'), true);
  assert.equal(isSourceEnabled(toggled, 'github'), true, "toggling one source must not flip GitHub's default");
  assert.equal(isSourceEnabled(toggled, 'claude'), false);
});

// MARK: Z.AI as a toggleable source (0.11 parity)

test('zai is enabled by default and listed as toggleable', () => {
  const config = defaultConfig();
  assert.equal(isSourceEnabled(config, 'zai'), true, 'absent sources.zai ⇒ enabled');
  assert.equal(TOGGLEABLE_SOURCES[0].id, 'zai', 'Z.AI sits first in the picker');
});

test('zai toggle preserves top-level token', () => {
  const config = defaultConfig();
  config.zaiToken = 'z-secret';
  let updated = setSourceEnabled(config, 'zai', false);
  assert.equal(isSourceEnabled(updated, 'zai'), false);
  assert.equal(updated.zaiToken, 'z-secret', 'toggling must not touch the token');
  // Copy-on-write: the input config is untouched (Swift value semantics).
  assert.equal(isSourceEnabled(config, 'zai'), true);

  updated = setSourceEnabled(updated, 'zai', true);
  assert.equal(isSourceEnabled(updated, 'zai'), true);
  assert.equal(updated.zaiToken, 'z-secret');
});

test('legacy config without zai entry decodes enabled', () => {
  const legacy = '{"zaiToken":"z1","baseURL":"https://api.z.ai","pollMinutes":5,"sources":{"github":{"enabled":true,"token":""}}}';
  const config = validateConfig(JSON.parse(legacy));
  assert.ok(config);
  assert.equal(config.sources.zai, undefined, 'no zai key in old configs');
  assert.equal(isSourceEnabled(config, 'zai'), true, 'old configs keep polling Z.AI');
});

test('macOS-style config round-trips with sources.zai intact', () => {
  // Exactly what the macOS app writes when Z.AI is toggled off: the full
  // OAuth shape under sources.zai. The loader must not strip it (the old
  // validator silently dropped unknown keys, corrupting the shared config).
  const fromMac = '{"zaiToken":"z1","baseURL":"https://api.z.ai","pollMinutes":5,'
    + '"sources":{"zai":{"enabled":false,"token":"","discovered":false},"github":{"enabled":true,"token":""}}}';
  const config = validateConfig(JSON.parse(fromMac));
  assert.ok(config);
  // Compare through JSON (what saveConfig writes): undefined optionals drop out.
  assert.deepEqual(JSON.parse(JSON.stringify(config.sources.zai)), { enabled: false, token: '', discovered: false });
  assert.equal(isSourceEnabled(config, 'zai'), false);

  const reSaved = validateConfig(JSON.parse(JSON.stringify(config)));
  assert.deepEqual(JSON.parse(JSON.stringify(reSaved.sources.zai)), { enabled: false, token: '', discovered: false });
});

test('mistyped sources.zai rejects the whole config (Swift strictness)', () => {
  const broken = '{"zaiToken":"","baseURL":"https://api.z.ai","pollMinutes":5,'
    + '"sources":{"zai":{"enabled":"yes"}}}';
  assert.equal(validateConfig(JSON.parse(broken)), null);
});

test('set key zai creates enabled entry on demand', () => {
  const config = defaultConfig(); // sources undefined
  const updated = setKey(config, 'zai', 'z1');
  assert.equal(updated.zaiToken, 'z1');
  assert.equal(isSourceEnabled(updated, 'zai'), true,
    'pasting a key reads as intent to use the source');
});

test('set key zai keeps explicit opt-out', () => {
  const config = defaultConfig();
  config.sources = { zai: { enabled: false, token: '', discovered: false } };
  const updated = setKey(config, 'zai', 'z1');
  assert.equal(isSourceEnabled(updated, 'zai'), false,
    'pasting a key must not override the toggle');
  assert.equal(updated.zaiToken, 'z1');
});

// MARK: per-source status lines (0.11 parity)

test('source status: disabled and healthy stay silent', () => {
  const config = defaultConfig();
  config.sources = { claude: { enabled: false, token: '', discovered: false } };
  const healthy = [makeSection('claude', 'Claude Pro/Max', { gauges: [makeGauge('claude-5h', '5-hour window', 41)] })];
  assert.equal(sourceStatus('claude', config, healthy), undefined, 'disabled is silent');
  assert.equal(sourceStatus('github', config, healthy), 'waiting for first fetch',
    'enabled with no section yet speaks up');

  const enabled = defaultConfig();
  enabled.sources = { claude: { enabled: true, token: '', discovered: true } };
  assert.equal(sourceStatus('claude', enabled, healthy), undefined, 'healthy is silent');
});

test('source status: error, notice, and pending data', () => {
  const config = defaultConfig();
  config.sources = {
    claude: { enabled: true, token: '', discovered: true },
    copilot: { enabled: true, token: '', discovered: true },
  };
  const sections = [
    makeSection('claude', 'Claude Pro/Max', { errorMessage: 'HTTP 401 from claude\nsecond line ignored' }),
    makeSection('github', 'GitHub API', { notice: 'token from environment' }),
    makeSection('copilot', 'GitHub Copilot', {}),
  ];
  assert.equal(sourceStatus('claude', config, sections), '⚠︎ HTTP 401 from claude');
  assert.equal(sourceStatus('github', config, sections), 'token from environment',
    'a notice is shown as-is (short)');
  assert.equal(sourceStatus('copilot', config, sections), 'waiting for data');
});

test('short status takes the first line and caps at 40 characters', () => {
  assert.equal(shortStatus('single line'), 'single line');
  assert.equal(shortStatus('first\nsecond\nthird'), 'first', 'multiline keeps the first line');
  assert.equal(shortStatus('  padded  '), 'padded', 'whitespace is trimmed');
  const long = 'x'.repeat(50);
  assert.equal(shortStatus(long), 'x'.repeat(39) + '…');
  assert.equal([...shortStatus(long)].length, 40);
  assert.equal(shortStatus('exactly-40-characters-exactly-40-char'), 'exactly-40-characters-exactly-40-char');
  assert.equal(shortStatus(undefined), '');
});

// MARK: Copilot key field (Windows extends macOS here: its settings window
// can host the extra field without crowding a menu)

test('copilot key round trip and precedence', () => {
  const config = defaultConfig();
  assert.equal(KEY_FIELDS.some((f) => f.id === 'copilot'), true, 'Copilot has a key field');
  assert.equal(keyValue(config, 'copilot'), '');

  const updated = setKey(config, 'copilot', 'ghu_1234567890');
  assert.equal(keyValue(updated, 'copilot'), 'ghu_1234567890');
  assert.equal(updated.sources.copilot.token, 'ghu_1234567890');
  assert.equal(isSourceEnabled(updated, 'copilot'), true,
    'pasting a key enables the source (the source prefers a pasted token over discovered files)');
  assert.equal(maskedKey(keyValue(updated, 'copilot')), '********67890');

  // An explicit opt-out survives key entry, like every other field.
  const opted = defaultConfig();
  opted.sources = { copilot: { enabled: false, token: '', refreshToken: 'r0', accountId: 'a0', discovered: true } };
  const rekeyed = setKey(opted, 'copilot', 'ghu_x');
  assert.equal(isSourceEnabled(rekeyed, 'copilot'), false);
  assert.equal(rekeyed.sources.copilot.refreshToken, 'r0');
  assert.equal(rekeyed.sources.copilot.accountId, 'a0');
  assert.equal(rekeyed.sources.copilot.discovered, true);
});

// MARK: version label

test('version label', () => {
  assert.equal(versionLabel('0.10.0'), 'QuotaBar v0.10.0');
  assert.equal(versionLabel(null), 'QuotaBar (dev build)');
  assert.equal(versionLabel(''), 'QuotaBar (dev build)');
  assert.equal(versionLabel(12), 'QuotaBar (dev build)', 'non-string version values fall back');
});
