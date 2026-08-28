// Port of CustomSource.swift — generic user-configured provider. Any JSON
// endpoint reporting a used/limit pair (+ optional reset time), located via
// dot paths like "data.usage" or "items.0.remaining".

import { request } from '../http.js';
import { networkMessage } from './zai.js';
import { objectFrom, leafNumber, leafDate } from '../jsonutil.js';
import { gauge } from '../parser.js';

/// Resolve "a.b.0.c" against nested objects/arrays. Returns a number when
/// the leaf is numeric (or a numeric string); null otherwise.
export function valueAt(path, root) {
  let node = root;
  for (const component of String(path).split('.')) {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      if (!(component in node)) return null;
      node = node[component];
    } else if (Array.isArray(node)) {
      const index = Number(component);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return null;
      node = node[index];
    } else {
      return null;
    }
  }
  return leafNumber(node);
}

export async function fetchCustom(source) {
  if (source.url === '') {
    return sectionFor(source, 'Invalid or missing url');
  }
  let url;
  try {
    url = new URL(source.url);
  } catch {
    return sectionFor(source, 'Invalid or missing url');
  }

  const headers = { Accept: 'application/json' };
  if (source.token !== '') headers.Authorization = `Bearer ${source.token}`;
  for (const [key, headerValue] of Object.entries(source.headers ?? {})) {
    headers[key] = headerValue;
  }

  let status;
  let text;
  try {
    ({ status, text } = await request(url.href, { timeoutMs: 15000, headers }));
  } catch (error) {
    return sectionFor(source, `Network error: ${networkMessage(error)}`);
  }
  if (status !== 200) return sectionFor(source, `HTTP ${status}`);

  const root = objectFrom(text);
  if (!root) return sectionFor(source, 'Response was not JSON');

  // Limit is required; used defaults to 0 when its path does not resolve.
  const total = valueAt(source.limitPath, root);
  if (total === null || total <= 0) {
    return sectionFor(source, `limitPath '${source.limitPath}' not found or zero`);
  }
  const used = valueAt(source.usedPath, root) ?? 0;
  const customGauge = gauge(source.id.toLowerCase(), source.title ?? source.id, (used / total) * 100, {
    used,
    total,
    resetAt: source.resetPath ? leafDate(root[source.resetPath]) : undefined,
  });
  return {
    id: source.id.toLowerCase(),
    title: source.title ?? source.id,
    gauges: [customGauge],
    errorMessage: undefined,
    notice: undefined,
  };
}

function sectionFor(source, error) {
  return {
    id: source.id.toLowerCase(),
    title: source.title ?? source.id,
    gauges: [],
    errorMessage: error,
    notice: undefined,
  };
}
