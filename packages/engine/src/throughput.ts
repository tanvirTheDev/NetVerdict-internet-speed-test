import {
  err,
  ok,
  type EngineError,
  type MeasurementPhase,
  type Milliseconds,
  type Result,
  type ThroughputResult,
  type ThroughputStatistic,
  type TransferSample,
} from '@netverdict/contracts';
import { median, percentile } from './percentiles';
import { computeWindowedThroughput, totalBytesTransferred, uniqueStreamCount } from './windowing';

export interface ThroughputComputationOptions {
  warmupMs: Milliseconds;
  windowMs: Milliseconds;
  statistic: ThroughputStatistic;
  /** Need at least this many post-warmup windows before the result is trustworthy — one window is a fluke, not a measurement. */
  minWindowedSamples: number;
}

export const DEFAULT_THROUGHPUT_OPTIONS: Omit<ThroughputComputationOptions, 'statistic'> = {
  warmupMs: 1_500 as Milliseconds,
  windowMs: 250 as Milliseconds,
  minWindowedSamples: 3,
};

/**
 * Turns a raw `TransferSample[]` into the headline `ThroughputResult` —
 * warm-up discard, sliding-window aggregation, then the median/p90 of
 * the steady-state windows (§5.2). Reports honestly via `Result`: too
 * few post-warmup windows is `INSUFFICIENT_SAMPLES`, never a silently
 * optimistic number computed from noise.
 */
export function computeThroughputResult(
  samples: readonly TransferSample[],
  phase: Extract<MeasurementPhase, 'download' | 'upload'>,
  options: ThroughputComputationOptions,
): Result<ThroughputResult, EngineError> {
  const windowedMbps = computeWindowedThroughput(samples, options);

  if (windowedMbps.length < options.minWindowedSamples) {
    return err({
      code: 'INSUFFICIENT_SAMPLES',
      phase,
      retriable: true,
      message: `${phase}: only ${String(windowedMbps.length)} post-warmup window(s), need ${String(options.minWindowedSamples)}`,
    });
  }

  const mbps = options.statistic === 'median' ? median(windowedMbps) : percentile(windowedMbps, 90);
  const steadyStateCount = samples.filter((sample) => sample.atMs >= options.warmupMs).length;

  return ok({
    mbps,
    statistic: options.statistic,
    streamCount: uniqueStreamCount(samples),
    sampleCount: steadyStateCount,
    warmupDiscardedMs: options.warmupMs,
    windowMs: options.windowMs,
    totalBytesTransferred: totalBytesTransferred(samples),
  });
}
