import { asBytes, type Bytes } from '@netverdict/contracts';

export interface AdaptiveSizingOptions {
  /** How long we want the real measurement phase to run, in seconds. */
  targetDurationSeconds: number;
  /** Hard ceiling on total bytes transferred across all streams (§5.2) — protects a fast line's data cap. */
  maxTotalBytes: Bytes;
  /** Floor per stream — protects a slow line from too few post-warmup samples. */
  minPerStreamBytes: Bytes;
  minStreamCount: number;
  maxStreamCount: number;
}

export const DEFAULT_ADAPTIVE_SIZING_OPTIONS: AdaptiveSizingOptions = {
  targetDurationSeconds: 8,
  maxTotalBytes: asBytes(300_000_000),
  minPerStreamBytes: asBytes(1_000_000),
  minStreamCount: 4,
  maxStreamCount: 8,
};

export interface AdaptiveSizingPlan {
  streamCount: number;
  perStreamByteTarget: Bytes;
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

  const estimatedTotalBytes = ((roughMbps * 1_000_000) / 8) * options.targetDurationSeconds;
  const cappedTotalBytes = Math.min(options.maxTotalBytes, estimatedTotalBytes);
  const perStreamByteTarget = Math.max(
    options.minPerStreamBytes,
    Math.floor(cappedTotalBytes / streamCount),
  );

  return { streamCount, perStreamByteTarget: asBytes(perStreamByteTarget) };
}
