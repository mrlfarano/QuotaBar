import test from 'node:test';
import assert from 'node:assert/strict';
import { loginItemOptions, isLoginEnabled, setLoginEnabled } from '../src/loginitem.js';

test('packaged and development startup entries use separate names and launch arguments', () => {
  assert.deepEqual(loginItemOptions({ isPackaged: true }), { name: 'QuotaBar', path: process.execPath, args: [] });
  assert.deepEqual(loginItemOptions({ isPackaged: false, getAppPath: () => 'C:\\My Projects\\QuotaBar' }), {
    name: 'QuotaBar (development)', path: process.execPath, args: ['C:\\My Projects\\QuotaBar'],
  });
});

test('startup lookup uses the named enabled entry, even when legacy openAtLogin is false', () => {
  const options = { name: 'QuotaBar', path: 'C:\\Program Files\\QuotaBar\\QuotaBar.exe', args: [] };
  const item = { name: 'QuotaBar', scope: 'user', enabled: true, args: [] };
  const app = { getLoginItemSettings(query) {
    assert.deepEqual(query, { path: `"${options.path}"`, args: [] });
    return { openAtLogin: false, launchItems: [item] };
  } };
  assert.equal(isLoginEnabled(app, options), true);
  for (const change of [{ name: 'Different app' }, { scope: 'machine' }, { enabled: false }, { args: ['--demo'] }]) {
    Object.assign(item, { name: 'QuotaBar', scope: 'user', enabled: true, args: [] }, change);
    assert.equal(isLoginEnabled(app, options), false);
  }
});

test('startup registration failures are reported instead of silently claiming success', () => {
  const options = { name: 'QuotaBar', path: process.execPath, args: [] };
  let write;
  const app = {
    setLoginItemSettings: (value) => { write = value; },
    getLoginItemSettings: () => ({ launchItems: [] }),
  };
  assert.throws(() => setLoginEnabled(app, true, options), /Windows could not update/);
  assert.deepEqual(write, { ...options, openAtLogin: true, enabled: true });
});
