import { asBytes, type Bytes } from '@netverdict/contracts';

export interface AdaptiveSizingOptions {
  /** How long the measurement phase runs, in seconds. This is a deadline, not an estimate — see `runThroughputPhase`. */
  targetDurationSeconds: number;
  /** Hard ceiling on total bytes transferred across all streams (§5.2) — protects a fast line's data cap. */
  maxTotalBytes: Bytes;
  /** Floor per stream — protects a slow line from too few post-warmup samples. */
  minPerStreamBytes: Bytes;
  /**
   * Multiplier on the per-request byte target, so a request outlasts the
   * deadline unless the probe badly over-read.
   *
   * The two ways of being wrong stopped being symmetric once the phase
   * ends on a clock. Asking for more than the link delivers costs
   * nothing — the deadline cuts the request off mid-stream and those
   * bytes were never transferred. Asking for too little ends the request
   * early and forces another round trip, which restarts the request on a
   * throttled endpoint and risks an HTTP 429 that takes the whole phase
   * down. So the target deliberately leans high.
   */
  requestHeadroomFactor: number;
  /** Largest single request the endpoint will serve — Cloudflare rejects a `bytes=` far above this. */
  maxRequestBytes: Bytes;
  minStreamCount: number;
  maxStreamCount: number;
  /**
   * How many requests to one origin can genuinely be in flight at once.
   *
   * Browsers cap this at 6 per origin over HTTP/1.1 — and
   * `speed.cloudflare.com` negotiates HTTP/1.1, not h2, so the cap
   * applies. Asking for more does not open more connections; the extras
   * queue in the browser. A plan of 8 streams therefore reports
   * `streamCount: 8` while only 6 ever transfer concurrently, which is a
   * measurement that overstates what it did.
   *
   * Worse, the loaded-latency probe is just another request to the same
   * origin: fill all 6 slots with transfers and the probe never gets one.
   * Measured in Chrome against this endpoint — 7 streams: the probe took
   * **45,441 ms** and returned only when the phase deadline killed it. 5
   * streams: **258 ms**, with the link still moving ~29 Mbps during the
   * probe. That is the difference between having a bufferbloat grade and
   * reporting `unavailable`.
   */
  maxConcurrentStreams: number;
}

export const DEFAULT_ADAPTIVE_SIZING_OPTIONS: AdaptiveSizingOptions = {
  targetDurationSeconds: 8,
  maxTotalBytes: asBytes(300_000_000),
  minPerStreamBytes: asBytes(1_000_000),
  requestHeadroomFactor: 4,
  maxRequestBytes: asBytes(50_000_000),
  minStreamCount: 4,
  maxStreamCount: 8,
  maxConcurrentStreams: 6,
};

export interface AdaptiveSizingPlan {
  streamCount: number;
  perStreamByteTarget: Bytes;
}

/**
 * Trims a plan to the connections actually available, reserving one for
 * the loaded-latency probe when bufferbloat is being measured.
 *
 * Kept separate from `planAdaptiveSizing` because it answers a different
 * question: that function asks how many streams this *link* wants, this
 * one asks how many the *client* can really open. Bytes per stream are
 * left alone — the phase ends on a deadline, so a stream carrying a
 * larger share of the work simply runs for the same 8 seconds.
 */
export function fitPlanToAvailableConnections(
  plan: AdaptiveSizingPlan,
  options: AdaptiveSizingOptions,
  reserveProbeSlot: boolean,
): AdaptiveSizingPlan {
  const budget = Math.max(1, options.maxConcurrentStreams - (reserveProbeSlot ? 1 : 0));
  return { ...plan, streamCount: Math.min(plan.streamCount, budget) };
}

/**
 * Picks stream count and per-stream byte target from a rough speed
 * estimate (§5.2) — so a 2 Mbps line isn't asked to pull 1 GB, and a
 * gigabit line isn't starved by a target sized for dial-up. Pure
 * function: the orchestrator supplies `roughMbps` from a small real
 * probe transfer; this only does the arithmetic.
 */
export function planAdaptiveSizing(
  roughMbps: number,
  options: AdaptiveSizingOptions = DEFAULT_ADAPTIVE_SIZING_OPTIONS,
): AdaptiveSizingPlan {
  if (roughMbps <= 0) {
    throw new RangeError(
      `planAdaptiveSizing: roughMbps must be positive, got ${String(roughMbps)}`,
    );
  }

  // Three explicit tiers rather than a formula: fast links get the full
  // stream count (parallelism is what exposes their real ceiling), slow
  // links get the floor (more streams just adds overhead), and everything
  // in between sits at the midpoint.
  const midStreamCount = Math.round((options.minStreamCount + options.maxStreamCount) / 2);
  const tieredStreamCount =
    roughMbps > 50
      ? options.maxStreamCount
      : roughMbps > 10
        ? midStreamCount
        : options.minStreamCount;
  const streamCount = Math.min(
    options.maxStreamCount,
    Math.max(options.minStreamCount, tieredStreamCount),
  );

  const estimatedTotalBytes =
    ((roughMbps * 1_000_000) / 8) * options.targetDurationSeconds * options.requestHeadroomFactor;
  const cappedTotalBytes = Math.min(options.maxTotalBytes, estimatedTotalBytes);
  const perStreamByteTarget = Math.min(
    options.maxRequestBytes,
    Math.max(options.minPerStreamBytes, Math.floor(cappedTotalBytes / streamCount)),
  );

  return { streamCount, perStreamByteTarget: asBytes(perStreamByteTarget) };
}
