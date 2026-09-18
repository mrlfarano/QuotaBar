import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolatedHome, writeJSON } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fixtures = fileURLToPath(new URL('../../testdata/', import.meta.url));
function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

for (const [flag, file, expected] of [
  ['--parse-claude', 'claude-usage', /claude-5h=41% resets@\d+ claude-weekly=18% resets@\d+\n$/],
  ['--parse-codex', 'codex-usage', /^codex-5h=0% resets@1787862451 codex-weekly=36% resets@1788272109\n$/],
  ['--parse-openrouter', 'openrouter-credits', /^openrouter-credits=33%\n$/],
  ['--parse-copilot', 'copilot-user', /^copilot-premium=20% resets@1788220800\n$/],
  ['--parse-antigravity', 'antigravity-userstatus', /^antigravity-gemini=69% resets@\d+ antigravity-claude-gpt=55% resets@\d+\n$/],
  ...['payload_real', 'payload_a', 'payload_b', 'payload_c'].map((file) => ['--parse', file, /\S+=\d+%/]),
]) {
  test(`CLI ${flag} ${file} prints deterministic gauges and succeeds`, () => {
    const result = run(flag, path.join(fixtures, `${file}.json`));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, expected);
    assert.equal(result.stderr, '');
    assert.equal(run(flag, path.join(fixtures, `${file}.json`)).stdout, result.stdout);
  });
}

test('CLI custom source prints exact counts', () => {
  const result = run('--parse-custom', path.join(fixtures, 'custom-config.json'), path.join(fixtures, 'custom-payload.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'openrouter=40% [400.0/1000.0]\n');
});

test('CLI distinguishes invalid input, empty data, and invalid flags', (t) => {
  const home = isolatedHome(t);
  const empty = writeJSON(home, 'empty.json', {});
  const invalid = path.join(home, 'invalid.json');
  fs.writeFileSync(invalid, '{broken');
  for (const flag of ['--parse', '--parse-claude', '--parse-codex', '--parse-openrouter', '--parse-copilot', '--parse-antigravity']) {
    assert.equal(run(flag, empty).status, 1, flag);
    assert.equal(run(flag, invalid).status, 2, flag);
    assert.equal(run(flag, path.join(home, 'missing')).status, 2, flag);
  }
  assert.equal(run('--parse-custom', empty, empty).status, 2);
  assert.match(run('--unknown').stdout, /^usage:/);
  assert.equal(run('--unknown').status, 2);
});
