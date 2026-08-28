// Gauge / SourceSection / Snapshot model plus cache serialization that is
// byte-compatible with the macOS app's JSONEncoder output: Date encodes as
// seconds since 2001-01-01 (deferredToDate), optionals are omitted, and keys
// follow Swift property declaration order. last-snapshot.json is therefore
// interchangeable between the two apps.

// 2001-01-01T00:00:00Z in epoch milliseconds.
const REF_EPOCH_MS = 978_307_200_000;

export function makeGauge(id, label, pct, { used, total, resetAt, details } = {}) {
  return { id, label, pct, used, total, resetAt, details };
}

export function makeSection(id, title, { gauges = [], errorMessage, notice } = {}) {
  return { id, title, gauges, errorMessage, notice };
}

export function makeSnapshot({ fetchedAt, rawJSON, gauges, errorMessage, usedScheme, planLevel }) {
  return { fetchedAt, rawJSON, gauges, errorMessage, usedScheme, planLevel };
}

// MARK: - Cache serialization (Swift Codable wire format)

function refSeconds(date) {
  return (date.getTime() - REF_EPOCH_MS) / 1000;
}

function fromRefSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(REF_EPOCH_MS + value * 1000);
}

function encodeGauge(gauge) {
  const out = { id: gauge.id, label: gauge.label, pct: gauge.pct };
  if (gauge.used !== undefined && gauge.used !== null) out.used = gauge.used;
  if (gauge.total !== undefined && gauge.total !== null) out.total = gauge.total;
  if (gauge.resetAt) out.resetAt = refSeconds(gauge.resetAt);
  if (gauge.details) out.details = gauge.details.map((d) => ({ modelCode: d.modelCode, usage: d.usage }));
  return out;
}

export function serializeSnapshot(snap) {
  const out = { fetchedAt: refSeconds(snap.fetchedAt), rawJSON: snap.rawJSON, gauges: snap.gauges.map(encodeGauge) };
  if (snap.errorMessage !== undefined && snap.errorMessage !== null) out.errorMessage = snap.errorMessage;
  out.usedScheme = snap.usedScheme;
  if (snap.planLevel !== undefined && snap.planLevel !== null) out.planLevel = snap.planLevel;
  return JSON.stringify(out);
}

function decodeGauge(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (typeof json.id !== 'string' || typeof json.label !== 'string') return null;
  if (typeof json.pct !== 'number') return null;
  const resetAt = json.resetAt === undefined ? undefined : fromRefSeconds(json.resetAt);
  if (json.resetAt !== undefined && !resetAt) return null;
  return {
    id: json.id,
    label: json.label,
    pct: json.pct,
    used: typeof json.used === 'number' ? json.used : undefined,
    total: typeof json.total === 'number' ? json.total : undefined,
    resetAt,
    details: Array.isArray(json.details)
      ? json.details.map((d) => ({ modelCode: String(d?.modelCode ?? ''), usage: Number(d?.usage ?? 0) }))
      : undefined,
  };
}

export function deserializeSnapshot(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const fetchedAt = fromRefSeconds(json.fetchedAt);
  if (!fetchedAt || typeof json.rawJSON !== 'string' || !Array.isArray(json.gauges)) return null;
  const gauges = json.gauges.map(decodeGauge);
  if (gauges.some((g) => g === null)) return null;
  if (typeof json.usedScheme !== 'string') return null;
  return {
    fetchedAt,
    rawJSON: json.rawJSON,
    gauges,
    errorMessage: typeof json.errorMessage === 'string' ? json.errorMessage : undefined,
    usedScheme: json.usedScheme,
    planLevel: typeof json.planLevel === 'string' ? json.planLevel : undefined,
  };
}
