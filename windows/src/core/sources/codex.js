// Port of CodexSource.swift — OpenAI Codex (ChatGPT plan) usage via the
// Codex CLI's stored OAuth tokens, with refresh. Rotated tokens persist in
// OUR config; the CLI's auth.json is never written.

import { request } from '../http.js';
import { networkMessage } from './zai.js';
import { objectFrom } from '../jsonutil.js';
import { leafNumber, leafDate } from '../jsonutil.js';
import { readJSONCandidates } from '../credfiles.js';
import { gauge } from '../parser.js';

export const id = 'codex';
export const title = 'Codex · usage';
export const usageURL = 'https://chatgpt.com/backend-api/wham/usage';
export const refreshURL = 'https://auth.openai.com/oauth/token';
// Codex CLI's public OAuth client id.
export const clientID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const AUTH_FILE = ['~/.codex/auth.json'];

export function section(error) {
  return { id, title, gauges: [], errorMessage: error, notice: undefined };
}

export async function fetch(config, tokenOverride, triedRefresh = false) {
  const credential = resolveCredential(config, tokenOverride);
  if (!credential) {
    return { section: section('No OAuth token — run `codex login`, then Discover Sources'), tokenUpdate: undefined };
  }

  let status;
  let text;
  try {
    ({ status, text } = await request(usageURL, {
      timeoutMs: 15000,
      headers: {
        Authorization: 'Bearer ' + credential.token,
        'ChatGPT-Account-Id': credential.accountId,
      },
    }));
  } catch (error) {
    return { section: section(`Network error: ${networkMessage(error)}`), tokenUpdate: undefined };
  }

  if (status === 401 || status === 403) {
    const refreshed = await refreshToken(config, credential.refreshToken);
    if (refreshed) {
      const updated = {
        enabled: config?.enabled ?? true,
        token: refreshed.token,
        refreshToken: refreshed.refreshToken ?? config?.refreshToken,
        accountId: config?.accountId ?? credential.accountId,
        discovered: config?.discovered ?? false,
      };
      if (!triedRefresh) {
        const retry = await fetch(updated, refreshed.token, true);
        return { section: retry.section, tokenUpdate: retry.tokenUpdate ?? updated };
      }
      return { section: section('Token refreshed but usage still unauthorized'), tokenUpdate: updated };
    }
    return { section: section('Token expired — run `codex login`, then Discover Sources'), tokenUpdate: undefined };
  }
  if (status !== 200) {
    return { section: section(`HTTP ${status} from chatgpt.com`), tokenUpdate: undefined };
  }
  const root = objectFrom(text);
  if (!root) return { section: section('Response was not JSON'), tokenUpdate: undefined };
  const gauges = gaugesFromRoot(root);
  if (gauges.length === 0) {
    return { section: section('Connected, but no rate-limit windows in response'), tokenUpdate: undefined };
  }
  const plan = typeof root.plan_type === 'string' ? root.plan_type : undefined;
  const sectionTitle = plan !== undefined ? `Codex (${plan}) · usage` : title;
  return { section: { id, title: sectionTitle, gauges, errorMessage: undefined, notice: undefined }, tokenUpdate: undefined };
}

/// Wire-format parser, exposed for `--parse-codex <fixture>`.
export function gaugesFromRoot(root) {
  const rateLimit = root.rate_limit;
  if (!rateLimit || typeof rateLimit !== 'object' || Array.isArray(rateLimit)) return [];
  const gauges = [];
  for (const [key, gaugeID, label] of [['primary_window', 'codex-5h', '5-hour window'], ['secondary_window', 'codex-weekly', 'Weekly limit']]) {
    const window_ = rateLimit[key];
    const used = leafNumber(window_?.used_percent);
    if (used === null) continue;
    gauges.push(gauge(gaugeID, label, used, { resetAt: leafDate(window_.reset_at) }));
  }
  return gauges;
}

// MARK: credential plumbing

function resolveCredential(config, tokenOverride) {
  if (tokenOverride) {
    const file = readAuthFile();
    return {
      token: tokenOverride,
      accountId: config?.accountId ?? file?.accountId,
      refreshToken: config?.refreshToken ?? file?.refreshToken,
    };
  }
  if (config?.token) {
    const file = readAuthFile();
    return {
      token: config.token,
      accountId: config?.accountId ?? file?.accountId,
      refreshToken: config?.refreshToken ?? file?.refreshToken,
    };
  }
  const file = readAuthFile();
  if (file && file.token) return { token: file.token, accountId: file.accountId, refreshToken: file.refreshToken };
  return null;
}

async function refreshToken(config, fileRefreshToken) {
  const refresh = config?.refreshToken ?? fileRefreshToken;
  if (!refresh) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientID,
    refresh_token: refresh,
  }).toString();
  let status;
  let text;
  try {
    ({ status, text } = await request(refreshURL, {
      method: 'POST',
      timeoutMs: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }));
  } catch {
    return null;
  }
  if (status !== 200) return null;
  const object = objectFrom(text);
  const token = object?.access_token;
  if (!token) return null;
  return { token, refreshToken: typeof object.refresh_token === 'string' ? object.refresh_token : undefined };
}

function readAuthFile() {
  const root = readJSONCandidates(AUTH_FILE);
  if (!root) return null;
  const tokens = root.tokens;
  const token = tokens?.access_token;
  if (typeof token !== 'string' || token === '') return null;
  return {
    token,
    accountId: typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
    refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
  };
}
