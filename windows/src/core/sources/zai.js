// Port of ZaiSource + its fetchSnapshot loop (QuotaProvider.swift).
//
// Mirrors the official dashboard (z.ai/manage-apikey/coding-plan/personal/usage):
//   axios baseURL "https://api.z.ai/api", Authorization: "Bearer " + token,
//   headers refer + Accept-Language. The community "no Bearer" variant is
//   kept as a fallback candidate, and the type=2 request falls back to an
//   unparameterized one when it comes back empty.

import { request } from '../http.js';
import { objectFrom, pretty } from '../jsonutil.js';
import { resolvedToken } from '../config.js';
import { gaugesFrom, planLevel } from '../parser.js';

export const quotaPath = '/api/monitor/usage/quota/limit';

function snapshot({ raw = '', gauges = [], error, usedScheme = '', planLevel: level } = {}) {
  return {
    fetchedAt: new Date(),
    rawJSON: raw,
    gauges,
    errorMessage: error,
    usedScheme,
    planLevel: level,
  };
}

export async function fetchSnapshot(config, env = process.env) {
  const token = resolvedToken(config, env);
  if (token === '') {
    return snapshot({ error: 'No token configured — add it in Settings…' });
  }
  const base = env.QUOTABAR_ZAI_BASE || config.baseURL;

  const schemes = [];
  if (config.authScheme) schemes.push(config.authScheme);
  for (const candidate of ['Bearer ', '']) {
    if (!schemes.includes(candidate)) schemes.push(candidate);
  }

  let sawAuthFailure = false;
  // The coding-plan dashboard requests this endpoint with type=2; fall back
  // to an unparameterized request if that ever comes back empty.
  for (const addType of [true, false]) {
    let parts = base + quotaPath;
    if (addType) parts += '?type=2';
    let url;
    try {
      url = new URL(parts);
    } catch {
      return snapshot({ error: `Bad base URL ${base}` });
    }

    for (const scheme of schemes) {
      let status;
      let text;
      try {
        ({ status, text } = await request(url.href, {
          timeoutMs: 20000,
          headers: {
            Authorization: scheme + token,
            'Accept-Language': 'en-US,en',
            'Content-Type': 'application/json;charset=utf-8',
            refer: 'https://z.ai/manage-apikey/coding-plan/personal/usage',
          },
        }));
      } catch (error) {
        return snapshot({ error: `Network error: ${networkMessage(error)}` });
      }

      if (status !== 200) {
        if (status === 401 || status === 403) {
          sawAuthFailure = true;
          continue;
        }
        return snapshot({ error: `HTTP ${status} from ${url.host || base}` });
      }

      const root = objectFrom(text);
      if (!root) return snapshot({ raw: text, error: 'Response was not JSON' });

      const success = typeof root.success === 'boolean' ? root.success : true;
      const code = typeof root.code === 'number' ? root.code : 0;
      const message = typeof root.msg === 'string' ? root.msg : '';

      if (code === 401 || message.toLowerCase().includes('token expired')) {
        sawAuthFailure = true;
        continue;
      }
      if (!success) {
        return snapshot({ raw: pretty(text), error: message === '' ? 'API rejected the request' : message });
      }

      const gauges = gaugesFrom(root);
      if (gauges.length === 0 && addType) continue; // retry without type=2
      const level = planLevel(root);
      if (gauges.length === 0) {
        return snapshot({ raw: pretty(text), error: 'Connected, but no usage limits in response', usedScheme: scheme, planLevel: level });
      }
      return snapshot({ raw: pretty(text), gauges, usedScheme: scheme, planLevel: level });
    }
    if (sawAuthFailure) break; // no point retrying auth with different params
  }

  if (sawAuthFailure) {
    return snapshot({ error: 'Unauthorized — token rejected (tried header styles)' });
  }
  return snapshot({ error: 'Request failed' });
}

export function networkMessage(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'request timed out';
  return error?.message ?? String(error);
}
