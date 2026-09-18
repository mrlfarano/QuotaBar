// Port of StatusDisplay.swift — status-display resolution and refresh
// coalescing, both pure and unit-tested. Decides what the tray shows: the
// selected source's gauges, a healthy fallback's gauges — an errored or
// empty selection falls through to the next healthy provider instead of
// hijacking the glyph with its error — a short error line when nothing is
// healthy, or idle text at startup.

/// resolve() → { kind: 'gauges', gauges, title }
///            | { kind: 'error', text }
///            | { kind: 'idle', text }
/// `title` (the driving section's title) feeds the tray tooltip's first
/// line; undefined on the warm-start path where only the cached snapshot
/// exists (callers fall back to the Z.AI title).
export function resolve(sections, zaiSnapshot, mainSource) {
  const wanted = (mainSource ?? 'zai').toLowerCase();
  const match = sections.find((s) => s.id === wanted && s.gauges.length > 0);
  if (match) return { kind: 'gauges', gauges: match.gauges, title: match.title };
  const fallback = sections.find((s) => s.gauges.length > 0);
  if (fallback) return { kind: 'gauges', gauges: fallback.gauges, title: fallback.title };
  // Nothing healthy: surface the most relevant error — the selected
  // source's, else the z.ai snapshot's, else any section's.
  const erroredWanted = sections.find((s) => s.id === wanted);
  if (erroredWanted && erroredWanted.errorMessage) {
    return { kind: 'error', text: errorText(erroredWanted.id, erroredWanted.errorMessage) };
  }
  if (zaiSnapshot?.errorMessage) {
    return { kind: 'error', text: errorText('zai', zaiSnapshot.errorMessage) };
  }
  const errored = sections.find((s) => s.errorMessage);
  if (errored) {
    return { kind: 'error', text: errorText(errored.id, errored.errorMessage) };
  }
  // Warm start: sections not built yet (right after launch), but the
  // cached z.ai snapshot still has numbers worth showing.
  if (zaiSnapshot && zaiSnapshot.gauges.length > 0 && !zaiSnapshot.errorMessage) {
    return { kind: 'gauges', gauges: zaiSnapshot.gauges, title: undefined };
  }
  if (sections.length === 0 && (zaiSnapshot?.gauges?.length ?? 0) === 0) {
    return { kind: 'idle', text: 'quotabar…' };
  }
  return { kind: 'error', text: '⚠︎ no data' };
}

/// One-line transient warning, e.g. "⚠︎ z.ai auth". Auth-shaped messages
/// (rejected/missing token) say so; everything else names the source.
export function errorText(id, message) {
  const auth = message.includes('token') || message.includes('Unauthorized');
  const name = id === 'zai' ? 'z.ai' : id;
  return `⚠︎ ${name}${auth ? ' auth' : ''}`;
}

/// Coalesces refresh requests that arrive while a refresh is in flight, so
/// the last config change is never silently dropped — the in-flight cycle
/// finishes, then one more runs. Single-threaded (Electron main process),
/// like the macOS main-thread-only original.
export class RefreshCoordinator {
  constructor() {
    this.running = false;
    this.requestedDuringFlight = false;
  }

  /// true when the caller should run the refresh; false means one is
  /// already running and this request was noted to re-run after it.
  begin() {
    if (this.running) {
      this.requestedDuringFlight = true;
      return false;
    }
    this.running = true;
    return true;
  }

  /// Ends the flight. true when a request arrived meanwhile and the
  /// caller should immediately start another cycle.
  end() {
    this.running = false;
    const rerun = this.requestedDuringFlight;
    this.requestedDuringFlight = false;
    return rerun;
  }
}
