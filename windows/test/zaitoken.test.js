// Port of Tests/quotabarTests/ZaiDiscoveryTests.swift — Z.AI token
// discovery: the z.ai dashboard stores its API token in browser localStorage
// under a known key. Chromium-family browsers keep localStorage in LevelDB
// (values often UTF-16LE); Firefox keeps it in SQLite with plain TEXT runs.
// The extractor must survive both encodings and record-header noise without
// ever returning garbage.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  storageKey, findToken, claudeBridgeToken, extractToken,
} from '../src/core/zaitoken.js';
import { runDiscovery } from '../src/core/discovery.js';

function utf16LE(string) {
  const out = [];
  for (const char of string) {
    const code = char.charCodeAt(0);
    if (code < 0x80) out.push(code, 0);
  }
  return Buffer.from(out);
}

// MARK: extractor

test('extracts ascii value after ascii key', () => {
  const blob = Buffer.concat([
    Buffer.from([0x01, 0x02]),
    Buffer.from(storageKey, 'utf8'),
    Buffer.from([0x00, 0x08]),
    Buffer.from('eyJhb-token-ascii-98765', 'utf8'),
    Buffer.from([0x00]),
  ]);
  assert.equal(extractToken(blob, storageKey), 'eyJhb-token-ascii-98765');
});

test('extracts utf16 value after utf16 key', () => {
  // Chrome writes DOM strings as UTF-16LE: key and value interleaved.
  const blob = Buffer.concat([utf16LE(storageKey), utf16LE('eyJhb-token-utf16-43210')]);
  assert.equal(extractToken(blob, storageKey), 'eyJhb-token-utf16-43210');
});

test('missing key yields nothing', () => {
  const blob = Buffer.from('https://z.ai totally unrelated bytes', 'utf8');
  assert.equal(extractToken(blob, storageKey), null);
});

test('short run is not a token', () => {
  const blob = Buffer.concat([Buffer.from(storageKey, 'utf8'), Buffer.from('\u01abc', 'utf8')]);
  assert.equal(extractToken(blob, storageKey), null, 'a 3-char run is header noise, not a token');
});

test('nul gaps split runs so header noise glues nothing', () => {
  // token, then a NUL run (gap) followed by unrelated printable junk:
  // the extractor must not glue them into one value.
  const blob = Buffer.concat([
    Buffer.from(storageKey, 'utf8'),
    Buffer.from('eyJhb-real-token-value-1', 'utf8'),
    Buffer.from([0x00, 0x00, 0x00]),
    Buffer.from('https://example.com/path', 'utf8'),
  ]);
  assert.equal(extractToken(blob, storageKey), 'eyJhb-real-token-value-1');
});

// MARK: filesystem walker (fixture tree)

function makeChromiumFixture(root, browserDir = 'Comet') {
  const leveldb = path.join(root, browserDir, 'User Data', 'Default', 'Local Storage', 'leveldb');
  fs.mkdirSync(leveldb, { recursive: true });
  const blob = Buffer.concat([
    Buffer.from([0x00, 0x03]),
    utf16LE(storageKey),
    utf16LE('eyJhb-fixture-token-abc123'),
  ]);
  fs.writeFileSync(path.join(leveldb, '000003.log'), blob);
}

test('findToken scans chromium profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quotabar-zai-fixture-'));
  try {
    makeChromiumFixture(root);
    const found = findToken({ localAppData: root, appData: root });
    assert.equal(found.browser, 'Comet');
    assert.equal(found.token, 'eyJhb-fixture-token-abc123');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findToken falls through to firefox', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quotabar-zai-firefox-'));
  try {
    const profiles = path.join(root, 'Mozilla', 'Firefox', 'Profiles', 'abc123.default');
    fs.mkdirSync(profiles, { recursive: true });
    fs.writeFileSync(path.join(profiles, 'webappsstore.sqlite'), Buffer.concat([
      Buffer.from([0x0d, 0x00]),
      Buffer.from(storageKey, 'utf8'),
      Buffer.from([0x00]),
      Buffer.from('eyJhb-firefox-token-77777', 'utf8'),
    ]));
    const found = findToken({ localAppData: root, appData: root });
    assert.equal(found.browser, 'Firefox');
    assert.equal(found.token, 'eyJhb-firefox-token-77777');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findToken returns null on empty tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quotabar-zai-empty-'));
  try {
    assert.equal(findToken({ localAppData: root, appData: root }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// MARK: Claude Code bridge

function writeBridge(base, token) {
  const file = path.join(os.tmpdir(), `quotabar-bridge-${process.hrtime.bigint()}.json`);
  fs.writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: token } }));
  return file;
}

test('bridge picks up token only for zai base url', () => {
  const zai = writeBridge('https://api.z.ai/api/anthropic', 'eyJhb-bridge-token-xyz987');
  try {
    assert.equal(claudeBridgeToken(zai), 'eyJhb-bridge-token-xyz987');
  } finally {
    fs.rmSync(zai, { force: true });
  }

  const anthropic = writeBridge('https://api.anthropic.com', 'sk-ant-real-anthropic-key-12345');
  try {
    assert.equal(claudeBridgeToken(anthropic), null, 'a real Anthropic token must never be grabbed');
  } finally {
    fs.rmSync(anthropic, { force: true });
  }
});

test('bridge ignores short tokens', () => {
  const short = writeBridge('https://api.z.ai', 'id');
  try {
    assert.equal(claudeBridgeToken(short), null);
  } finally {
    fs.rmSync(short, { force: true });
  }
});

// MARK: run() integration (deterministic branches)

test('runDiscovery never touches a stored zai token', async (t) => {
  const { isolatedHome } = await import('./helpers.js');
  isolatedHome(t);
  const config = { ...{ zaiToken: '' }, zaiToken: 'user-set-token-abcde' };
  const { config: updated, outcome } = runDiscovery(config, {});
  assert.equal(updated.zaiToken, 'user-set-token-abcde', 'the never-overwrite rule covers zai too');
  assert.ok(outcome.lines.includes('zai: token already set'));
});

test('runDiscovery discovers from browser, then bridge, else reports missing', async (t) => {
  const { isolatedHome } = await import('./helpers.js');
  isolatedHome(t);
  const empty = runDiscovery({ zaiToken: '' }, {}, {
    findZaiToken: () => null,
    bridgeToken: () => null,
  });
  assert.equal(empty.config.zaiToken, '');
  assert.ok(empty.outcome.lines[0].startsWith('zai: no token found'));

  const bridged = runDiscovery({ zaiToken: '' }, {}, {
    findZaiToken: () => null,
    bridgeToken: () => 'eyJhb-bridge-token-xyz987',
  });
  assert.equal(bridged.config.zaiToken, 'eyJhb-bridge-token-xyz987');
  assert.ok(bridged.outcome.lines.includes("zai: token picked up from Claude Code's z.ai base URL"));
  assert.equal(bridged.outcome.changed, true);

  const found = runDiscovery({ zaiToken: '' }, {}, {
    findZaiToken: () => ({ browser: 'Google Chrome', token: 'eyJhb-browser-token-00001' }),
    bridgeToken: () => 'eyJhb-bridge-should-lose',
  });
  assert.equal(found.config.zaiToken, 'eyJhb-browser-token-00001',
    'browser localStorage wins over the Claude bridge');
  assert.ok(found.outcome.lines.includes('zai: token discovered in Google Chrome localStorage'));
});
