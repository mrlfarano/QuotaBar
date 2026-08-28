// Port of Tests/quotabarTests/SettingsTests.swift — poll-cadence clamping,
// per-source enable toggles (with credential preservation), masked key
// entry, version label.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedPollMinutes, versionLabel } from '../src/core/format.js';
import { defaultConfig } from '../src/core/config.js';
import {
  isSourceEnabled, setSourceEnabled, maskedKey, keyValue, setKey,
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

// MARK: version label

test('version label', () => {
  assert.equal(versionLabel('0.10.0'), 'QuotaBar v0.10.0');
  assert.equal(versionLabel(null), 'QuotaBar (dev build)');
  assert.equal(versionLabel(''), 'QuotaBar (dev build)');
  assert.equal(versionLabel(12), 'QuotaBar (dev build)', 'non-string version values fall back');
});
