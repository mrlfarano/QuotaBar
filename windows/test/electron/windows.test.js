import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

test('Windows Electron integration', { timeout: 60000 }, async (t) => {
  assert.equal(process.platform, 'win32', 'Run test:electron on Windows');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quotabar-electron-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, QUOTABAR_TEST_HOME: home };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'GH_TOKEN', 'GITHUB_TOKEN', 'OPENROUTER_API_KEY', 'QUOTABAR_ZAI_TOKEN', 'QUOTABAR_ZAI_BASE']) delete env[key];
  const { stdout } = await promisify(execFile)(electron, [fileURLToPath(new URL('./runner.mjs', import.meta.url))], {
    env, timeout: 50000, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  const line = stdout.split(/\r?\n/).find((line) => line.startsWith('QUOTABAR_RESULTS='));
  assert.ok(line, `Electron did not report results: ${stdout}`);
  for (const result of JSON.parse(line.slice('QUOTABAR_RESULTS='.length))) {
    await t.test(result.name, () => assert.equal(result.error, undefined, result.error));
  }
});
