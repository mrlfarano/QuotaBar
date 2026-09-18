// Port of Discovery.swift's ZaiTokenDiscovery — finds the z.ai dashboard
// token without any copy-paste: the z.ai site keeps it in browser
// localStorage under a known key, and every Chromium-family browser
// persists localStorage to on-disk LevelDB we can read directly (no
// keychain, no admin prompts). Firefox keeps the same key in a per-profile
// SQLite file whose TEXT values are readable the same way. Edge/IE-store
// and Windows-protected storage are deliberately not read.
//
// Windows adaptation: Chromium browsers live under %LOCALAPPDATA%
// (<vendor>\User Data\<profile>\Local Storage\leveldb) instead of
// ~/Library/Application Support; Firefox under
// %APPDATA%\Mozilla\Firefox\Profiles. The byte-level extractor is
// platform-independent and identical to the Swift original.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandTilde } from './credfiles.js';

export const storageKey = 'z-ai-open-platform-token-production';

/// Chromium-layout browsers under %LOCALAPPDATA%, with per-profile
/// "Local Storage/leveldb" directories below <vendor path>/User Data.
/// Arc/Comet have less standardized Windows roots — absence tolerated.
export const chromiumBrowsers = [
  { name: 'Google Chrome', vendorPath: 'Google/Chrome/User Data' },
  { name: 'Google Chrome Canary', vendorPath: 'Google/Chrome SxS/User Data' },
  { name: 'Chromium', vendorPath: 'Chromium/User Data' },
  { name: 'Brave', vendorPath: 'BraveSoftware/Brave-Browser/User Data' },
  { name: 'Microsoft Edge', vendorPath: 'Microsoft/Edge/User Data' },
  { name: 'Arc', vendorPath: 'Arc/User Data' },
  { name: 'Comet', vendorPath: 'Comet/User Data' },
];

export const firefoxProfiles = 'Mozilla/Firefox/Profiles';

function defaultLocalAppData() {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
}

function defaultAppData() {
  return process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
}

/// Scan every browser profile for the z.ai localStorage key.
/// `localAppData`/`appData` are injectable so tests can point at a fixture
/// tree. Returns { browser, token } or null.
export function findToken({ localAppData = defaultLocalAppData(), appData = defaultAppData() } = {}) {
  for (const browser of chromiumBrowsers) {
    const root = path.join(localAppData, ...browser.vendorPath.split('/'));
    let profiles;
    try {
      profiles = fs.readdirSync(root);
    } catch {
      continue; // browser not installed
    }
    for (const profile of profiles) {
      const leveldb = path.join(root, profile, 'Local Storage', 'leveldb');
      let files;
      try {
        files = fs.readdirSync(leveldb);
      } catch {
        continue;
      }
      for (const file of files) {
        let data;
        try {
          data = fs.readFileSync(path.join(leveldb, file));
        } catch {
          continue; // browser may hold locks on live files — skip non-fatally
        }
        const token = extractToken(data, storageKey);
        if (token) return { browser: browser.name, token };
      }
    }
  }
  // Firefox: webappsstore.sqlite per profile; localStorage TEXT values sit
  // in the file as plain runs, same extraction.
  const profilesRoot = path.join(appData, ...firefoxProfiles.split('/'));
  let profiles;
  try {
    profiles = fs.readdirSync(profilesRoot);
  } catch {
    return null;
  }
  for (const profile of profiles) {
    let data;
    try {
      data = fs.readFileSync(path.join(profilesRoot, profile, 'webappsstore.sqlite'));
    } catch {
      continue;
    }
    const token = extractToken(data, storageKey);
    if (token) return { browser: 'Firefox', token };
  }
  return null;
}

/// GLM coding plan routed through Claude Code: ~/.claude/settings.json
/// with ANTHROPIC_BASE_URL on z.ai carries the plan token in
/// ANTHROPIC_AUTH_TOKEN. Only picks it up when the base URL actually
/// points at z.ai — a real Anthropic token is never touched.
export function claudeBridgeToken(file) {
  const settingsPath = file ?? path.join(os.homedir(), '.claude', 'settings.json');
  let root;
  try {
    root = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return null;
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  const env = root.env;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
  const base = env.ANTHROPIC_BASE_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (typeof base !== 'string' || !base.includes('z.ai')) return null;
  if (typeof token !== 'string' || token.length < 20) return null;
  return token;
}

/// Pull the localStorage value for `key` out of raw LevelDB/SQLite bytes.
/// Chromium writes DOM strings as UTF-16LE, so both encodings of the key
/// are probed; the value is the first plausible token run (≥20 printable
/// chars, UTF-16LE NULs stripped) within a window after the key — record
/// headers are short, the value follows immediately.
export function extractToken(data, key) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  for (const probe of [Buffer.from(key, 'utf8'), utf16LE(key)]) {
    const at = buffer.indexOf(probe);
    if (at === -1) continue;
    const windowEnd = Math.min(at + probe.length + 512, buffer.length);
    const token = firstTokenRun(buffer.subarray(at + probe.length, windowEnd));
    if (token && token !== key) return token;
  }
  return null;
}

/// First run of ≥20 printable bytes, taken whole once it ends; an
/// interleaved NUL continues the run only when the next byte is printable
/// too (the UTF-16LE pattern) — stray NULs or header bytes split it.
function firstTokenRun(bytes) {
  let run = Buffer.alloc(0);
  const finish = (buf) => {
    const cleaned = buf.filter((b) => b !== 0);
    return cleaned.length >= 20 ? cleaned.toString('utf8') : null;
  };
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    const printable = byte >= 0x21 && byte <= 0x7e;
    const utf16Interleave = byte === 0 && run.length > 0
      && index + 1 < bytes.length && bytes[index + 1] >= 0x21 && bytes[index + 1] <= 0x7e;
    if (printable || utf16Interleave) {
      run = Buffer.concat([run, Buffer.from([byte])]);
    } else {
      const token = finish(run);
      if (token) return token;
      run = Buffer.alloc(0);
    }
  }
  return finish(run);
}

function utf16LE(string) {
  const out = [];
  for (const char of string) {
    const code = char.charCodeAt(0);
    if (code < 0x80) {
      out.push(code, 0);
    }
  }
  return Buffer.from(out);
}
