// Port of the Z.AI response parsing in QuotaProvider.swift:
// QuotaResponseParser (pinned dashboard contract) and QuotaParser (the
// keyword-based adaptive fallback). Gauges are plain objects:
//   { id, label, pct, used?, total?, resetAt?, details? }
// absent optionals stay undefined (matching Swift nil).

import { number as leafNumber, date as leafDate, strictDouble } from './jsonutil.js';
import { remainingPct } from './format.js';

export function clampToHundred(gauge) {
  gauge.pct = Math.min(Math.max(gauge.pct, 0), 100);
  return gauge;
}

export function gauge(id, label, pct, { used, total, resetAt, details } = {}) {
  return clampToHundred({ id, label, pct, used, total, resetAt, details });
}

// MARK: - Pinned contract
//
//   { code, success, data: { limits: [ { type, unit, percentage, currentValue,
//       usage, usageDetails, nextResetTime } ] } }
// unit 3 = 5-hour token window, unit 6 = weekly token window.
// Falls back to keyword-based adaptive parsing if the shape ever changes.

const DISPLAY_ORDER = ['fiveHour', 'week', 'mcp'];
const UNIT_MAP = { 3: ['fiveHour', '5-hour window'], 6: ['week', 'Weekly limit'], 5: ['mcp', 'MCP monthly'] };

export function planLevel(root) {
  const data = root?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return typeof data.level === 'string' ? data.level : null;
  }
  return null;
}

function pinnedGauges(root) {
  const data = root?.data;
  const limits = data && typeof data === 'object' ? data.limits : null;
  if (!Array.isArray(limits)) return null;

  const result = [];
  for (const limit of limits) {
    if (!limit || typeof limit !== 'object' || Array.isArray(limit)) continue;
    const unit = leafNumber(limit.unit);
    if (unit === null) continue;
    const mapped = UNIT_MAP[Math.trunc(unit)];
    if (!mapped) continue;
    const [gaugeID, label] = mapped;
    let used = leafNumber(limit.currentValue);
    if (used === null) {
      const total = leafNumber(limit.usage);
      const remaining = leafNumber(limit.remaining);
      if (total !== null && remaining !== null) used = total - remaining;
    }
    const details = detailEntries(limit.usageDetails);
    result.push(gauge(gaugeID, label, leafNumber(limit.percentage) ?? 0, {
      used,
      total: leafNumber(limit.usage),
      resetAt: leafDate(limit.nextResetTime),
      details,
    }));
  }
  result.sort((lhs, rhs) => {
    const l = DISPLAY_ORDER.indexOf(lhs.id);
    const r = DISPLAY_ORDER.indexOf(rhs.id);
    return (l === -1 ? Number.MAX_SAFE_INTEGER : l) - (r === -1 ? Number.MAX_SAFE_INTEGER : r);
  });
  return result;
}

function detailEntries(array) {
  if (!Array.isArray(array) || array.length === 0) return undefined;
  const entries = array
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
      && typeof entry.modelCode === 'string' && leafNumber(entry.usage) !== null)
    .map((entry) => ({ modelCode: entry.modelCode, usage: leafNumber(entry.usage) }));
  return entries.length > 0 ? entries : undefined;
}

/// Pinned first, adaptive fallback.
export function gaugesFrom(root) {
  const pinned = pinnedGauges(root);
  if (pinned && pinned.length > 0) return pinned;
  return adaptiveGauges(root);
}

// MARK: - Adaptive fallback
//
// Keyword-based leaf walk, used only when the pinned contract is absent.

function adaptiveGauges(root) {
  const leaves = [];
  walk(root, '', (path, value) => leaves.push({ path, value }));

  const pick = (keywords, excluded) => {
    const matches = leaves.filter((leaf) => {
      if (excluded.some((bad) => leaf.path.includes(bad))) return false;
      return keywords.some((keyword) => leaf.path.includes(keyword));
    });
    return preferred(matches);
  };

  const result = [];
  const five = pick(['5h', 'five', 'four', 'hour', 'cycle'], ['week', 'wk']);
  if (five) {
    result.push(gauge('fiveHour', '5-hour window', normalize(five.value)));
  }
  const week = pick(['week', 'wk'], []);
  if (week) {
    result.push(gauge('week', 'Weekly limit', normalize(week.value)));
  }
  return result;
}

function preferred(matches) {
  if (matches.length === 0) return null;
  return matches.toSorted((a, b) => score(a.path) - score(b.path))[0];
}

function score(path) {
  let s = path.length;
  for (const good of ['percent', 'pct', 'rate', 'ratio', 'limit', 'used', 'remain']) {
    if (path.includes(good)) s -= 500;
  }
  for (const bad of ['total', 'count', 'amount']) {
    if (path.includes(bad)) s += 300;
  }
  return s;
}

function normalize(value) {
  if (value > 0 && value <= 1) return value * 100;
  return value;
}

function walk(node, path, sink) {
  if (typeof node === 'boolean') return; // real booleans never become 1/0
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node)) {
      const childPath = path === '' ? key.toLowerCase() : `${path}/${key.toLowerCase()}`;
      walk(child, childPath, sink);
    }
  } else if (Array.isArray(node)) {
    for (const child of node) walk(child, `${path}[]`, sink);
  } else if (typeof node === 'number') {
    if (Number.isFinite(node)) sink(path, node);
  } else if (typeof node === 'string') {
    const direct = node.endsWith('%') ? strictDouble(node.slice(0, -1)) : strictDouble(node);
    if (direct !== null) sink(path, direct);
  }
}

export { remainingPct };
