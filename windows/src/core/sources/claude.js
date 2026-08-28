// Port of ClaudeSource.swift — Claude (Pro/Max) usage via Claude Code's own
// OAuth session, with the refresh-token chain. Wire-format parser exposed
// for --parse-claude.

import { request } from '../http.js';
import { networkMessage } from './zai.js';
import { objectFrom } from '../jsonutil.js';
import { readJSONCandidates } from '../credfiles.js';
import { leafNumber, leafDate } from '../jsonutil.js';
import { gauge } from '../parser.js';

export const id = 'claude';
export const title = 'Claude (Pro/Max) · usage';
export const usageURL = 'https://api.anthropic.com/api/oauth/usage';
export const refreshURL = 'https://api.anthropic.com/v1/oauth/token';
// Claude Code's public PKCE client id.
export const clientID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const CREDENTIAL_FILE = ['~/.claude/.credentials.json'];

export function section(error) {
  return { id, title, gauges: [], errorMessage: error, notice: undefined };
}

/// Fetches usage. Returns { section, tokenUpdate } — tokenUpdate is the
/// OAuthSourceConfig the caller should persist when the refresh flow
/// produced new credentials.
export async function fetch(config, triedRefresh = false) {
  const candidates = candidateTokens(config);
  if (candidates.length === 0) {
    return { section: section('No OAuth token — run `claude` once, then Discover Sources'), tokenUpdate: undefined };
  }

  let sawAuthFailure = false;
  for (const token of candidates) {
    let status;
    let text;
    try {
      ({ status, text } = await request(usageURL, {
        timeoutMs: 15000,
        headers: {
          Authorization: 'Bearer ' + token,
          'anthropic-beta': 'oauth-2025-04-20',
          'anthropic-version': '2023-06-01',
        },
      }));
    } catch (error) {
      return { section: section(`Network error: ${networkMessage(error)}`), tokenUpdate: undefined };
    }
    if (status === 401 || status === 403) { sawAuthFailure = true; continue; }
    if (status !== 200) {
      return { section: section(`HTTP ${status} from api.anthropic.com`), tokenUpdate: undefined };
    }
    const root = objectFrom(text);
    if (!root) return { section: section('Response was not JSON'), tokenUpdate: undefined };
    const gauges = gaugesFromRoot(root);
    if (gauges.length === 0) {
      return { section: section('Connected, but no usage buckets in response'), tokenUpdate: undefined };
    }
    return { section: { id, title, gauges, errorMessage: undefined, notice: undefined }, tokenUpdate: undefined };
  }
  if (!sawAuthFailure) return { section: section('Request failed'), tokenUpdate: undefined };

  const refreshed = await refreshToken(config);
  if (refreshed) {
    const updated = {
      enabled: config?.enabled ?? true,
      token: refreshed.token,
      refreshToken: refreshed.refreshToken ?? config?.refreshToken,
      accountId: config?.accountId,
      discovered: config?.discovered ?? false,
    };
    if (!triedRefresh) {
      const retry = await fetch(updated, true);
      return { section: retry.section, tokenUpdate: retry.tokenUpdate ?? updated };
    }
    return { section: section('Token refreshed but usage still unauthorized'), tokenUpdate: updated };
  }
  return { section: section('Token expired — run `claude` once to re-authenticate, then Discover Sources'), tokenUpdate: undefined };
}

/// Wire-format parser, exposed for `--parse-claude <fixture>`.
export function gaugesFromRoot(root) {
  const gauges = [];
  for (const [key, gaugeID, label] of [['five_hour', 'claude-5h', '5-hour window'], ['seven_day', 'claude-weekly', 'Weekly limit']]) {
    const bucket = root[key];
    const utilization = leafNumber(bucket?.utilization);
    if (utilization === null) continue;
    gauges.push(gauge(gaugeID, label, utilization, { resetAt: leafDate(bucket.resets_at) }));
  }
  return gauges;
}

// MARK: credential plumbing

/// Config token first, then the CLI auth file read live.
function candidateTokens(config) {
  const tokens = [];
  if (config?.token) tokens.push(config.token);
  const file = readCredentialFile();
  if (file && file.accessToken && !tokens.includes(file.accessToken)) tokens.push(file.accessToken);
  return tokens;
}

async function refreshToken(config) {
  const refresh = config?.refreshToken ?? readCredentialFile()?.refreshToken;
  if (!refresh) return null;
  let status;
  let text;
  try {
    ({ status, text } = await request(refreshURL, {
      method: 'POST',
      timeoutMs: 15000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: clientID, refresh_token: refresh }),
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

function readCredentialFile() {
  const root = readJSONCandidates(CREDENTIAL_FILE);
  if (!root) return null;
  const oauth = root.claudeAiOauth;
  const token = oauth?.accessToken;
  if (typeof token !== 'string' || token === '') return null;
  return { accessToken: token, refreshToken: typeof oauth.refreshToken === 'string' ? oauth.refreshToken : undefined };
}
