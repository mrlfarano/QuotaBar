// Port of GitHubSource.swift — GitHub API core rate limit.
// GET https://api.github.com/rate_limit → resources.core {limit, remaining,
// reset, used}. Unauthenticated calls get a 60/hr core budget; an optional
// token raises it to 5000/hr.

import { request } from '../http.js';
import { networkMessage } from './zai.js';
import { objectFrom } from '../jsonutil.js';
import { gauge } from '../parser.js';

const endpoint = 'https://api.github.com/rate_limit';

export function section(error) {
  return { id: 'github', title: 'GitHub API · rate limit', gauges: [], errorMessage: error, notice: undefined };
}

export async function fetch(token) {
  let status;
  let text;
  try {
    ({ status, text } = await request(endpoint, {
      timeoutMs: 15000,
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }));
  } catch (error) {
    return section(`Network error: ${networkMessage(error)}`);
  }
  if (status !== 200) return section(`HTTP ${status} from api.github.com`);
  const root = objectFrom(text);
  const core = root?.resources?.core;
  if (!core || typeof core.limit !== 'number' || typeof core.used !== 'number' || typeof core.reset !== 'number') {
    return section('Could not read resources.core from response');
  }

  const coreGauge = gauge('gh-core', 'Core requests', core.limit > 0 ? (core.used / core.limit) * 100 : 0, {
    used: core.used,
    total: core.limit,
    resetAt: new Date(core.reset * 1000),
  });
  return { id: 'github', title: 'GitHub API · rate limit', gauges: [coreGauge], errorMessage: undefined, notice: undefined };
}
