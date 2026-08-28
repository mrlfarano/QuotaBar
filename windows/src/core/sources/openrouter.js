// Port of OpenRouterSource.swift — official credits endpoint. `limit: null`
// means no spending cap, reported honestly as a notice instead of a ring.

import { request } from '../http.js';
import { networkMessage } from './zai.js';
import { objectFrom, leafNumber } from '../jsonutil.js';
import { gauge } from '../parser.js';

export const id = 'openrouter';
export const title = 'OpenRouter · credits';
const creditsURL = 'https://openrouter.ai/api/v1/credits';

export function section(error) {
  return { id, title, gauges: [], errorMessage: error, notice: undefined };
}

export async function fetch(config, env = process.env) {
  const envKey = env.OPENROUTER_API_KEY || undefined;
  const token = envKey ?? config?.token ?? '';
  if (token === '') {
    return section('No API key — set OPENROUTER_API_KEY or add sources.openrouter.token');
  }

  let status;
  let text;
  try {
    ({ status, text } = await request(creditsURL, {
      timeoutMs: 15000,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    }));
  } catch (error) {
    return section(`Network error: ${networkMessage(error)}`);
  }
  if (status !== 200) {
    return section(status === 401 || status === 403 ? `Key rejected (HTTP ${status})` : `HTTP ${status} from openrouter.ai`);
  }
  const root = objectFrom(text);
  if (!root) return section('Response was not JSON');
  return sectionFrom(root);
}

/// Wire-format parser, exposed for `--parse-openrouter <fixture>`.
export function sectionFrom(root) {
  const payload = root.data;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return section('No data object in response');
  }
  let sectionTitle = title;
  if (payload.is_free_tier === true) sectionTitle += ' · free tier';

  const usage = leafNumber(payload.usage);
  const limit = leafNumber(payload.limit);
  if (limit === null || limit <= 0) {
    let notice = 'No spending cap configured';
    if (usage !== null) notice += ` · $${usage.toFixed(2)} used`;
    return { id, title: sectionTitle, gauges: [], errorMessage: undefined, notice };
  }
  const used = usage ?? 0;
  const creditsGauge = gauge('openrouter-credits', 'Credits', (used / limit) * 100, { used, total: limit });
  return { id, title: sectionTitle, gauges: [creditsGauge], errorMessage: undefined, notice: undefined };
}
