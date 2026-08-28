// Port of the config model and ConfigStore in QuotaProvider.swift.
//
// Faithful detail: Swift's synthesized Decodable requires every non-optional
// key, so a hand-edited config.json missing e.g. "zaiToken" decodes to
// *nothing* and the app falls back to defaults. validateX() below mirrors
// that strictness — any missing/mistyped required key rejects the whole
// file. Optionals stay optional, exactly as on macOS.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sortedPretty } from './jsonutil.js';

export function configFileURL() {
  return path.join(os.homedir(), '.quotabar', 'config.json');
}

export function cacheFileURL() {
  return path.join(os.homedir(), '.quotabar', 'last-snapshot.json');
}

export function defaultConfig() {
  return {
    zaiToken: '',
    authScheme: undefined,
    baseURL: 'https://api.z.ai',
    pollMinutes: 5,
    sources: undefined,
    mainSource: undefined,
  };
}

// MARK: - Strict decoding (Swift Codable semantics)

const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

function obj(v) {
  return v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

export function validateGitHubSource(json) {
  const o = obj(json);
  if (!o || !isBool(o.enabled) || !isStr(o.token)) return null;
  return { enabled: o.enabled, token: o.token, discovered: isBool(o.discovered) ? o.discovered : undefined };
}

export function validateOAuthSource(json) {
  const o = obj(json);
  if (!o || !isBool(o.enabled) || !isStr(o.token) || !isBool(o.discovered)) return null;
  return {
    enabled: o.enabled,
    token: o.token,
    refreshToken: isStr(o.refreshToken) ? o.refreshToken : undefined,
    accountId: isStr(o.accountId) ? o.accountId : undefined,
    discovered: o.discovered,
  };
}

export function validateCustomSource(json) {
  const o = obj(json);
  if (!o || !isStr(o.id) || !isStr(o.url) || !isStr(o.token) || !isStr(o.usedPath) || !isStr(o.limitPath)) return null;
  if (o.headers !== undefined && obj(o.headers) === null) return null;
  const headers = o.headers === undefined
    ? undefined
    : Object.fromEntries(Object.entries(o.headers).filter(([, v]) => isStr(v)));
  return {
    id: o.id,
    title: isStr(o.title) ? o.title : undefined,
    url: o.url,
    token: o.token,
    headers,
    usedPath: o.usedPath,
    limitPath: o.limitPath,
    resetPath: isStr(o.resetPath) ? o.resetPath : undefined,
  };
}

function validateSources(json) {
  if (json === undefined || json === null) return undefined;
  const o = obj(json);
  if (!o) return null;
  const out = {};
  if (o.github !== undefined) {
    const github = validateGitHubSource(o.github);
    if (!github) return null;
    out.github = github;
  }
  if (o.custom !== undefined) {
    if (!Array.isArray(o.custom)) return null;
    const custom = o.custom.map(validateCustomSource);
    if (custom.some((c) => c === null)) return null;
    out.custom = custom;
  }
  for (const key of ['claude', 'codex', 'openrouter', 'copilot', 'antigravity']) {
    if (o[key] !== undefined) {
      const source = validateOAuthSource(o[key]);
      if (!source) return null;
      out[key] = source;
    }
  }
  return out;
}

export function validateConfig(json) {
  const o = obj(json);
  if (!o || !isStr(o.zaiToken) || !isStr(o.baseURL) || !isInt(o.pollMinutes)) return null;
  const sources = validateSources(o.sources);
  if (sources === null) return null;
  return {
    zaiToken: o.zaiToken,
    authScheme: isStr(o.authScheme) ? o.authScheme : undefined,
    baseURL: o.baseURL,
    pollMinutes: o.pollMinutes,
    sources,
    mainSource: isStr(o.mainSource) ? o.mainSource : undefined,
  };
}

// MARK: - Store

export function loadConfig() {
  let text;
  try {
    text = fs.readFileSync(configFileURL(), 'utf8');
  } catch {
    return defaultConfig();
  }
  if (text.trim() === '') return defaultConfig();
  try {
    return validateConfig(JSON.parse(text)) ?? defaultConfig();
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config) {
  const file = configFileURL();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, sortedPretty(config), 'utf8');
    fs.chmodSync(file, 0o600); // best-effort on Windows; full owner-only ACLs are POSIX-only
  } catch (error) {
    console.error(`quotabar: failed saving config: ${error.message}`);
  }
}

export function resolvedToken(config, env = process.env) {
  const envToken = env.QUOTABAR_ZAI_TOKEN;
  if (envToken) return envToken;
  return config.zaiToken;
}
