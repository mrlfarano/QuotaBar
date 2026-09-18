import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function isolatedHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quotabar-test-'));
  const names = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = home;
  t.mock.method(os, 'homedir', () => home);
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

export function writeJSON(home, relative, value) {
  const file = path.join(home, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

export function fixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../../testdata/${name}.json`, import.meta.url), 'utf8'));
}

// Unexpected requests fail locally; these tests never contact real providers.
export function mockFetch(t, responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), ...options });
    assert.ok(responses.length, `Unexpected request: ${url}`);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return new Response(typeof response.body === 'string' ? response.body : JSON.stringify(response.body), {
      status: response.status ?? 200,
    });
  });
  t.after(() => assert.equal(responses.length, 0, 'All expected requests must run'));
  return calls;
}
