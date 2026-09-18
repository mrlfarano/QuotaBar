import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig, validateConfig, loadConfig, saveConfig, configFileURL, cacheFileURL, resolvedToken } from '../src/core/config.js';
import { expandTilde, readJSONCandidates, fileExists } from '../src/core/credfiles.js';
import { isolatedHome, writeJSON } from './helpers.js';

test('config persists in isolated profile and round-trips optional provider fields', (t) => {
  const home = isolatedHome(t);
  const config = { ...defaultConfig(), zaiToken: 'REDACTED-zai', mainSource: 'codex', sources: {
    codex: { enabled: false, token: 'REDACTED-token', refreshToken: 'REDACTED-refresh', accountId: 'REDACTED-account', discovered: false },
  } };
  assert.equal(configFileURL(), path.join(home, '.quotabar', 'config.json'));
  assert.equal(cacheFileURL(), path.join(home, '.quotabar', 'last-snapshot.json'));
  saveConfig(config);
  assert.deepEqual(loadConfig(), config);
});

for (const content of ['', '  ', '{broken', 'null', '[]', '{}', '{"pollMinutes":"5"}']) {
  test(`unreadable config falls back safely: ${JSON.stringify(content)}`, (t) => {
    isolatedHome(t);
    assert.deepEqual(loadConfig(), defaultConfig());
    fs.mkdirSync(path.dirname(configFileURL()), { recursive: true });
    fs.writeFileSync(configFileURL(), content);
    assert.deepEqual(loadConfig(), defaultConfig());
    assert.equal(fs.readFileSync(configFileURL(), 'utf8'), content, 'Loading must not overwrite a damaged config');
  });
}

test('config rejects invalid required fields and nested source shapes', () => {
  for (const patch of [{ zaiToken: 1 }, { baseURL: null }, { pollMinutes: 1.5 }, { sources: [] },
    { sources: { github: { enabled: true } } }, { sources: { codex: { enabled: true, token: '' } } },
    { sources: { custom: [{}] } }]) {
    assert.equal(validateConfig({ ...defaultConfig(), ...patch }), null);
  }
  assert.deepEqual(validateConfig({ ...defaultConfig(), futureField: true }), defaultConfig());
});

test('failed config save reports error without throwing', (t) => {
  const home = isolatedHome(t);
  fs.writeFileSync(path.join(home, '.quotabar'), 'blocked');
  const log = t.mock.method(console, 'error', () => {});
  assert.doesNotThrow(() => saveConfig(defaultConfig()));
  assert.match(log.mock.calls[0].arguments[0], /failed saving config/);
  assert.equal(fs.readFileSync(path.join(home, '.quotabar'), 'utf8'), 'blocked');
});

test('failed config replacement preserves previous file and removes temporary output', (t) => {
  isolatedHome(t);
  const original = { ...defaultConfig(), zaiToken: 'REDACTED-original' };
  assert.equal(saveConfig(original), true);
  t.mock.method(fs, 'renameSync', () => { throw new Error('Simulated file lock'); });
  t.mock.method(console, 'error', () => {});
  assert.equal(saveConfig({ ...original, zaiToken: 'REDACTED-new' }), false);
  assert.deepEqual(loadConfig(), original);
  assert.deepEqual(fs.readdirSync(path.dirname(configFileURL())), ['config.json']);
});

test('environment token overrides config only when nonempty', () => {
  const config = { zaiToken: 'REDACTED-stored' };
  assert.equal(resolvedToken(config, { QUOTABAR_ZAI_TOKEN: 'REDACTED-env' }), 'REDACTED-env');
  assert.equal(resolvedToken(config, { QUOTABAR_ZAI_TOKEN: '' }), config.zaiToken);
  assert.equal(resolvedToken(config, {}), config.zaiToken);
});

test('Windows credential paths expand and candidate reads skip missing or malformed files', (t) => {
  const home = isolatedHome(t);
  assert.equal(expandTilde('~/.codex/auth.json'), path.join(home, '.codex/auth.json'));
  assert.equal(expandTilde('~'), home);
  assert.equal(expandTilde('%APPDATA%/auth.json'), `${home}/auth.json`);
  assert.equal(expandTilde('%QUOTABAR_TEST_UNSET%/auth.json'), '%QUOTABAR_TEST_UNSET%/auth.json');
  const valid = writeJSON(home, 'valid.json', { token: 'REDACTED' });
  const array = writeJSON(home, 'array.json', []);
  const invalid = path.join(home, 'invalid.json');
  fs.writeFileSync(invalid, '{');
  assert.deepEqual(readJSONCandidates([path.join(home, 'missing'), invalid, array, valid]), { token: 'REDACTED' });
  assert.equal(readJSONCandidates([invalid, array]), null);
  assert.equal(fileExists([path.join(home, 'missing'), valid]), true);
  assert.equal(fileExists([path.join(home, 'missing')]), false);
});
