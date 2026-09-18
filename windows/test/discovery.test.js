import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runDiscovery } from '../src/core/discovery.js';
import { defaultConfig } from '../src/core/config.js';
import { isolatedHome, writeJSON } from './helpers.js';

const scanners = { findZaiToken: () => null, bridgeToken: () => null };

test('Windows discovery enables installed sources without copying OAuth secrets', (t) => {
  const home = isolatedHome(t);
  writeJSON(home, '.claude/.credentials.json', { claudeAiOauth: { accessToken: 'REDACTED-claude' } });
  writeJSON(home, '.codex/auth.json', { tokens: { access_token: 'REDACTED-codex' } });
  writeJSON(home, 'opencode/auth.json', { 'github-copilot': { refresh: 'REDACTED-copilot' } });
  fs.mkdirSync(path.join(home, 'Antigravity'));
  const input = defaultConfig();
  const result = runDiscovery(input, { GH_TOKEN: 'REDACTED-gh', OPENROUTER_API_KEY: 'REDACTED-router' }, scanners);
  assert.equal(result.outcome.changed, true);
  for (const key of ['claude', 'codex', 'copilot', 'antigravity']) {
    assert.equal(result.config.sources[key].enabled, true);
    assert.equal(result.config.sources[key].discovered, true);
    assert.equal(result.config.sources[key].token, '');
  }
  assert.equal(result.config.sources.github.token, 'REDACTED-gh');
  assert.equal(result.config.sources.openrouter.token, 'REDACTED-router');
  assert.deepEqual(input, defaultConfig(), 'Discovery must not mutate input');
  assert.equal(runDiscovery(result.config, {}, scanners).outcome.changed, false);
  assert.ok(!result.outcome.lines.join('\n').includes('REDACTED'));
});

for (const key of ['github', 'openrouter']) {
  test(`discovery preserves explicit ${key} opt-out despite environment token`, (t) => {
    isolatedHome(t);
    const input = { ...defaultConfig(), sources: { [key]: { enabled: false, token: '', discovered: false } } };
    const result = runDiscovery(input, { GH_TOKEN: 'REDACTED-gh', OPENROUTER_API_KEY: 'REDACTED-router' }, scanners);
    assert.deepEqual(result.config.sources[key], input.sources[key]);
  });
}

test('discovery preserves manual credentials and ignores unrelated auth stores', (t) => {
  const home = isolatedHome(t);
  writeJSON(home, 'opencode/auth.json', { otherProvider: { access: 'REDACTED-other' } });
  writeJSON(home, '.claude/.credentials.json', { claudeAiOauth: { accessToken: '' } });
  const input = { ...defaultConfig(), sources: { github: { enabled: true, token: 'REDACTED-manual' } } };
  const result = runDiscovery(input, { GH_TOKEN: 'REDACTED-env' }, scanners);
  assert.equal(result.config.sources.github.token, 'REDACTED-manual');
  assert.equal(result.config.sources.claude, undefined);
  assert.equal(result.config.sources.copilot, undefined);
  assert.equal(result.outcome.changed, false);
});
