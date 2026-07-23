/**
 * IETF Responsiveness-under-load, simplified to its core relation:
 * round-trips per minute = 60,000ms / round-trip time in ms (§5.4). The
 * full spec aggregates many concurrent probe flows under saturating
 * load; this function takes the already-aggregated loaded-latency figure
 * (the output of `computeLatencyResult`) and converts it to RPM.
 */
export function computeRpm(loadedLatencyMs: number): number {
  if (loadedLatencyMs <= 0) {
    throw new RangeError(`computeRpm: latency must be positive, got ${String(loadedLatencyMs)}ms`);
  }
  return Math.round(60_000 / loadedLatencyMs);
}
