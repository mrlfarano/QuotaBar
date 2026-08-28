// Tolerant JSON leaf conversions shared by every parser (port of
// QuotaResponseParser.number / .date and ZaiSource.pretty), plus the sorted
// pretty-printer used for raw responses and saved config.

// Swift Double(String) accepts "42", "42.", ".5", "1e3" — but not whitespace.
const STRICT_DOUBLE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export function strictDouble(text) {
  if (!STRICT_DOUBLE.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/// Numbers, numeric strings, and "NN%" strings become Doubles; real JSON
/// booleans are rejected (they must not become 1/0), while JSON 1 stays a
/// legitimate percentage value.
export function number(any) {
  if (any === null || any === undefined) return null;
  if (typeof any === 'boolean') return null;
  if (typeof any === 'number') return Number.isFinite(any) ? any : null;
  if (typeof any === 'string') {
    if (any.endsWith('%')) return strictDouble(any.slice(0, -1));
    return strictDouble(any);
  }
  return null;
}

// Aliases used by the source parsers (leaf conversions).
export const leafNumber = number;
export const leafDate = date;

/// ISO 8601 with internet date-time (T separator, Z or ±hh:mm offset),
/// fractional seconds allowed — the ISO8601DateFormatter contract.
const ISO8601 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:[Zz]|([+-])(\d{2}):?(\d{2}))$/;

/// Epoch seconds, epoch milliseconds (>1e12), or ISO 8601 strings → Date.
/// Numeric strings go through the epoch path first, exactly like Swift.
export function date(any) {
  const asNumber = number(any);
  if (asNumber !== null) {
    if (asNumber > 1_000_000_000_000) return new Date(asNumber);            // epoch ms
    if (asNumber > 1_000_000_000) return new Date(asNumber * 1000);         // epoch s
    return null; // below epoch-s range is a nonsensical timestamp
  }
  if (typeof any === 'string' && any !== '') {
    const match = ISO8601.exec(any);
    if (match) {
      const [, y, mo, d, h, mi, s, frac, sign, oh, om] = match;
      let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, frac ? Math.round(parseFloat(frac) * 1000) : 0);
      if (sign) {
        const offsetMin = +oh * 60 + +om;
        ms += (sign === '+' ? -1 : 1) * offsetMin * 60_000;
      }
      return new Date(ms);
    }
  }
  return null;
}

/// Sorted-key, 2-space pretty printer (the .prettyPrinted + .sortedKeys look).
export function sortedPretty(value) {
  return JSON.stringify(sortDeep(value), sortedKeysReplacer, 2);
}

function sortedKeysReplacer(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]));
  }
  return value;
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

/// Reformat JSON text sorted + pretty; unparseable text comes back as-is
/// (port of ZaiSource.pretty).
export function pretty(text) {
  try {
    return sortedPretty(JSON.parse(text));
  } catch {
    return text;
  }
}

/// Parse a JSON string that must be an object, else null.
export function objectFrom(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
