import fs from 'node:fs';
import path from 'node:path';
import { configFileURL } from './config.js';

export const providerNames = { zai: 'Z.AI', codex: 'Codex', claude: 'Claude', github: 'GitHub', copilot: 'GitHub Copilot', openrouter: 'OpenRouter', antigravity: 'Antigravity' };
export const defaultPreferences = () => ({ watched: {}, lowAlert: false, recoveryAlert: false, threshold: 25, pauseUntil: 0, manual: false });

export function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences');
  const result = defaultPreferences();
  for (const key of ['lowAlert', 'recoveryAlert', 'manual']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('Invalid preference');
    result[key] = value[key] ?? result[key];
  }
  if (value.threshold !== undefined && ![10, 25, 50].includes(value.threshold)) throw new Error('Invalid alert threshold');
  result.threshold = value.threshold ?? 25;
  if (value.pauseUntil !== undefined && (!Number.isSafeInteger(value.pauseUntil) || value.pauseUntil < -1)) throw new Error('Invalid pause time');
  result.pauseUntil = value.pauseUntil ?? 0;
  if (value.watched !== undefined) {
    if (!value.watched || typeof value.watched !== 'object' || Array.isArray(value.watched)) throw new Error('Invalid quota selection');
    const entries = Object.entries(value.watched);
    if (entries.length > 100 || entries.some(([id, gauge]) => id.length > 128 || typeof gauge !== 'string' || gauge.length > 128)) throw new Error('Invalid quota selection');
    result.watched = Object.fromEntries(entries);
  }
  return result;
}

function file(name) { return path.join(path.dirname(configFileURL()), name); }
export function readWindowsFile(name) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return null; }
}
export function writeWindowsFile(name, value) {
  const target = file(name);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch {
    try { fs.unlinkSync(temporary); } catch { /* No temporary file. */ }
    throw new Error('Could not save changes. Your previous settings are intact.');
  }
}
export function loadPreferences() {
  try { return validatePreferences(readWindowsFile('windows-preferences.json')); } catch { return defaultPreferences(); }
}
export function paused(preferences, now = Date.now()) { return preferences.pauseUntil === -1 || preferences.pauseUntil > now; }

export function cleanGauges(gauges) {
  return (Array.isArray(gauges) ? gauges : []).filter(g => typeof g.id === 'string' && typeof g.label === 'string' && Number.isFinite(g.pct)).slice(0, 100).map(g => ({
    id: g.id.slice(0, 128), label: g.label.slice(0, 100), pct: Math.min(100, Math.max(0, g.pct)),
    resetAt: g.resetAt && Number.isFinite(new Date(g.resetAt).getTime()) ? new Date(g.resetAt).toISOString() : null,
  }));
}

export function applyReading(previous, section, now = Date.now()) {
  const gauges = cleanGauges(section.gauges);
  const error = section.errorMessage;
  const status = error ? /token|unauthori[sz]ed|credential|401|403|sign.in/i.test(error) ? 'Sign-in required' : 'Unavailable' : gauges.length ? 'Connected' : 'No quota reported';
  return {
    id: section.id, name: providerNames[section.id] ?? String(section.title ?? section.id).slice(0, 100),
    gauges: error ? previous?.gauges ?? [] : gauges,
    lastSuccess: !error && gauges.length ? now : previous?.lastSuccess ?? null,
    lastAttempt: now, status,
  };
}

export function cachedReadings(value) {
  if (value?.version !== 1 || !Array.isArray(value.providers)) return [];
  return value.providers.slice(0, 100).filter(p => typeof p?.id === 'string' && p.id.length <= 128 && Number.isFinite(p.lastSuccess)).map(p => ({
    id: p.id, name: providerNames[p.id] ?? String(p.name ?? p.id).slice(0, 100), gauges: cleanGauges(p.gauges),
    lastSuccess: p.lastSuccess, lastAttempt: null, status: 'Cached',
  }));
}

export function quotaAlert(previous, current, preferences) {
  // Called only on successful, fresh readings. Never infer recovery from time.
  if (!previous || previous.key !== current.key) return [];
  const events = [];
  if (preferences.lowAlert && previous.left > preferences.threshold && current.left <= preferences.threshold && previous.alertedReset !== current.resetAt) events.push('low');
  if (preferences.recoveryAlert && previous.left === 0 && current.left > 0) events.push('recovery');
  return events;
}
