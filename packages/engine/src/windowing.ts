import {
  asBytes,
  asMilliseconds,
  type Mbps,
  type Milliseconds,
  type TransferSample,
} from '@netverdict/contracts';
import { mbpsFromBytesOverWindow } from './units';

export interface WindowingOptions {
  /** TCP slow-start ramp: discard samples timestamped before this, relative to stream start (§5.2). */
  warmupMs: Milliseconds;
  /** Bucket width for the sliding window (§5.2) — throughput is bytes/sec over this window, never total-bytes/total-time. */
  windowMs: Milliseconds;
}

/**
 * Discards the warm-up ramp, then buckets the remaining samples into
 * consecutive `windowMs`-wide windows (aligned to the first post-warmup
 * sample), summing bytes **across every parallel stream** in each
 * bucket. This is what "aggregate throughput across N concurrent
 * connections" means concretely: one shared timeline, bytes from every
 * `streamId` landing in the same time slice count together.
 *
 * Returns one Mbps reading per window. An empty result means every
 * sample fell inside the warm-up period — the caller treats that as
 * insufficient data, not zero throughput.
 */
export function computeWindowedThroughput(
  samples: readonly TransferSample[],
  options: WindowingOptions,
): readonly Mbps[] {
  const steadyState = samples.filter((sample) => sample.atMs >= options.warmupMs);
  if (steadyState.length === 0) {
    return [];
  }

  const rangeStartMs = Math.min(...steadyState.map((s) => s.atMs));
  const rangeEndMs = Math.max(...steadyState.map((s) => s.atMs));
  const windowMs = options.windowMs;
  // Every bucket is a fixed `windowMs` wide, anchored to the first
  // post-warmup sample — deliberately NOT derived from where samples
  // happen to fall. A duration computed from `min(rangeEnd, bucketStart
  // + windowMs) - bucketStart` collapses to ~0 whenever a sample lands
  // exactly on a bucket boundary (the last bucket becomes near-instant,
  // producing a spurious multi-thousand-Mbps spike from a few normal
  // bytes). Fixed-width buckets can only *under*-report a genuinely
  // partial trailing window — a far safer failure mode, and one the
  // median/p90 aggregation absorbs.
  const windowCount = Math.floor((rangeEndMs - rangeStartMs) / windowMs) + 1;

  const bucketBytes = new Array<number>(windowCount).fill(0);
  for (const sample of steadyState) {
    const bucketIndex = Math.min(
      windowCount - 1,
      Math.floor((sample.atMs - rangeStartMs) / windowMs),
    );
    bucketBytes[bucketIndex] = (bucketBytes[bucketIndex] ?? 0) + sample.bytes;
  }

  const readings: Mbps[] = [];
  for (let i = 0; i < windowCount; i += 1) {
    readings.push(mbpsFromBytesOverWindow(asBytes(bucketBytes[i] ?? 0), windowMs));
  }
  return readings;
}

/**
 * The rate shown on a *live* gauge while a test is running — bytes in
 * the trailing `trailingWindowMs` across every stream, as of `nowMs`
 * (test-relative). Distinct from `computeWindowedThroughput`'s
 * steady-state windows: this is a live instantaneous reading, recomputed
 * on every new sample, and is never the number that gets persisted as
 * the final result.
 */
export function computeInstantaneousMbps(
  samples: readonly TransferSample[],
  nowMs: number,
  trailingWindowMs: number,
): Mbps {
  const windowStartMs = nowMs - trailingWindowMs;
  const bytesInWindow = samples
    .filter((sample) => sample.atMs >= windowStartMs && sample.atMs <= nowMs)
    .reduce((sum, sample) => sum + sample.bytes, 0);
  const effectiveWindowMs = Math.max(1, Math.min(trailingWindowMs, nowMs));
  return mbpsFromBytesOverWindow(asBytes(bytesInWindow), asMilliseconds(effectiveWindowMs));
}

export function uniqueStreamCount(samples: readonly TransferSample[]): number {
  return new Set(samples.map((sample) => sample.streamId)).size;
}

export function totalBytesTransferred(samples: readonly TransferSample[]): number {
  return samples.reduce((sum, sample) => sum + sample.bytes, 0);
}
