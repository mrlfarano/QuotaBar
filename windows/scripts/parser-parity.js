// Compare the Windows Node CLI with output captured from the macOS Swift build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const cases = [
  ...['payload_real', 'payload_a', 'payload_b', 'payload_c'].map((name) => ['--parse', [`${name}.json`]]),
  ...['claude', 'codex', 'openrouter', 'copilot', 'antigravity'].map((name, index) => [
    `--parse-${name}`, [['claude-usage.json', 'codex-usage.json', 'openrouter-credits.json', 'copilot-user.json', 'antigravity-userstatus.json'][index]],
  ]),
  ['--parse-custom', ['custom-config.json', 'custom-payload.json']],
  ['--parse-codex', ['codex-pro-weekly.json']],
];

export function capture(command, prefix = []) {
  return cases.map(([flag, files]) => {
    const result = spawnSync(command, [...prefix, flag, ...files.map((file) => path.join(root, 'testdata', file))], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${flag} ${files.join(' ')}: ${result.stderr}`);
    return { name: `${flag} ${files.join(' ')}`, status: result.status, stdout: result.stdout, stderr: result.stderr };
  });
}

export function compare(reference, actual) {
  assert.equal(reference.length, cases.length, 'Swift baseline must contain every fixture');
  assert.equal(actual.length, cases.length, 'Windows result must contain every fixture');
  for (let i = 0; i < cases.length; i++) {
    assert.deepEqual(actual[i], reference[i], `Parser parity failed: ${actual[i].name}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, input, output] = process.argv.slice(2);
  if (mode === '--record' && input && output) {
    fs.writeFileSync(output, JSON.stringify(capture(path.resolve(input)), null, 2) + '\n');
    console.log(`Recorded ${cases.length} Swift parser fixtures`);
  } else if (mode === '--compare' && input) {
    compare(JSON.parse(fs.readFileSync(input, 'utf8')), capture(process.execPath, [path.join(root, 'windows/src/cli.js')]));
    console.log(`All ${cases.length} parser fixtures match Swift byte-for-byte (stdout, stderr, exit status)`);
  } else {
    console.error('usage: parser-parity.js --record <swift-binary> <output.json> | --compare <swift-output.json>');
    process.exitCode = 2;
  }
}
