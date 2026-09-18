import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = path.resolve(root, '../testdata');
const exe = path.join(process.env.QUOTABAR_PACKAGE_OUT || path.join(root, 'out'), 'QuotaBar-win32-x64/QuotaBar.exe');

test('packaged Windows executable', { timeout: 60000 }, async (t) => {
  assert.equal(process.platform, 'win32', 'Run test:package on Windows');
  assert.ok(fs.existsSync(exe), 'Run npm run package:win before test:package');
  const binary = fs.readFileSync(exe);
  assert.equal(binary.toString('ascii', 0, 2), 'MZ');
  const pe = binary.readUInt32LE(0x3c);
  assert.equal(binary.toString('ascii', pe, pe + 4), 'PE\0\0');
  assert.equal(binary.readUInt16LE(pe + 4), 0x8664, 'Expected x64 Windows executable');
  assert.ok(fs.statSync(path.join(path.dirname(exe), 'resources/app.asar')).size > 0);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quotabar-package-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'QUOTABAR_ZAI_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'OPENROUTER_API_KEY']) delete env[key];
  for (const [flag, files, expected] of [
    ['--parse', ['payload_real.json'], /fiveHour=\d+%/],
    ['--parse-claude', ['claude-usage.json'], /claude-5h=41%/],
    ['--parse-codex', ['codex-usage.json'], /codex-weekly=36%/],
    ['--parse-codex', ['codex-pro-weekly.json'], /^codex-weekly=10% resets@1788272109\r?\n$/],
    ['--parse-openrouter', ['openrouter-credits.json'], /openrouter-credits=33%/],
    ['--parse-copilot', ['copilot-user.json'], /copilot-premium=20%/],
    ['--parse-antigravity', ['antigravity-userstatus.json'], /antigravity-gemini=69%/],
    ['--parse-custom', ['custom-config.json', 'custom-payload.json'], /openrouter=40%/],
  ]) {
    await t.test(flag, async () => {
      const { stdout } = await promisify(execFile)(exe, [flag, ...files.map((file) => path.join(fixtures, file))], { env, timeout: 20000, windowsHide: true });
      assert.match(stdout, expected);
    });
  }
  await t.test('invalid fixture exits with input-error code', async () => {
    await assert.rejects(promisify(execFile)(exe, ['--parse', path.join(home, 'missing.json')], { env, timeout: 10000, windowsHide: true }),
      (error) => error.code === 2 && /could not read/.test(error.stderr));
  });
  assert.equal(fs.existsSync(path.join(home, '.quotabar')), false, 'Offline CLI must not initialize GUI/config');
});
