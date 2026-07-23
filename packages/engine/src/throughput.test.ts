import { describe, expect, it } from 'vitest';
import { asMilliseconds, isErr, isOk, type TransferSample } from '@netverdict/contracts';
import { computeThroughputResult, type ThroughputComputationOptions } from './throughput';

const OPTIONS: ThroughputComputationOptions = {
  warmupMs: asMilliseconds(1_500),
  windowMs: asMilliseconds(250),
  statistic: 'median',
  minWindowedSamples: 3,
};

function sample(atMs: number, bytes: number, streamId = 'stream-1'): TransferSample {
  return { atMs, bytes, streamId };
}

function evenSamples(
  count: number,
  bytesPerWindow: number,
  streamId = 'stream-1',
): TransferSample[] {
  return Array.from({ length: count }, (_unused, i) =>
    sample(1_500 + i * 250, bytesPerWindow, streamId),
  );
}

describe('computeThroughputResult', () => {
  it('reports INSUFFICIENT_SAMPLES honestly instead of a number computed from noise', () => {
    // Only 2 post-warmup windows, below the configured minimum of 3.
    const samples = evenSamples(2, 250_000);
    const result = computeThroughputResult(samples, 'download', OPTIONS);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INSUFFICIENT_SAMPLES');
      expect(result.error.phase).toBe('download');
      expect(result.error.retriable).toBe(true);
    }
  });

  it('reports the median of steady-state windows for a clean, constant-rate line (2 Mbps)', () => {
    // 62,500 bytes / 250ms == 2 Mbps per window (units.test.ts arithmetic)
    const samples = evenSamples(10, 62_500);
    const result = computeThroughputResult(samples, 'download', OPTIONS);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.mbps).toBeCloseTo(2, 10);
      expect(result.value.statistic).toBe('median');
      expect(result.value.streamCount).toBe(1);
      expect(result.value.sampleCount).toBe(10);
      expect(result.value.warmupDiscardedMs).toBe(1_500);
      expect(result.value.windowMs).toBe(250);
      expect(result.value.totalBytesTransferred).toBe(10 * 62_500);
    }
  });

  it('reports near gigabit throughput correctly across parallel streams', () => {
    // Target ~940 Mbps: 940e6 bits/s * 0.25s / 8 = 29,375,000 bytes per 250ms window,
    // spread evenly across 8 parallel streams.
    const perStreamBytes = 29_375_000 / 8;
    const samples: TransferSample[] = [];
    for (let stream = 0; stream < 8; stream += 1) {
      samples.push(...evenSamples(6, perStreamBytes, `stream-${String(stream)}`));
    }
    const result = computeThroughputResult(samples, 'download', OPTIONS);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.mbps).toBeCloseTo(940, 0);
      expect(result.value.streamCount).toBe(8);
    }
  });

  it('reports the p90 statistic when configured, distinct from the median', () => {
    // 9 windows at 2 Mbps, 1 window at 20 Mbps. Sorted: [2×9, 20]; n=10, p90 rank = 0.9*9 = 8.1
    // -> interpolate between sorted[8]=2 and sorted[9]=20, fraction 0.1 -> 2 + 0.1*18 = 3.8
    const samples = evenSamples(9, 62_500);
    samples.push(sample(1_500 + 9 * 250, 625_000)); // 625,000 bytes / 250ms == 20 Mbps
    const result = computeThroughputResult(samples, 'download', { ...OPTIONS, statistic: 'p90' });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.mbps).toBeCloseTo(3.8, 10);
    }
  });

  it('keeps the median stable against a single mid-test stall, unlike a plain average would', () => {
    const samples = evenSamples(9, 62_500);
    samples[4] = sample(1_500 + 4 * 250, 0); // one stalled window among nine — a plain mean would drop noticeably, the median should not
    const result = computeThroughputResult(samples, 'download', OPTIONS);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.mbps).toBeCloseTo(2, 10); // median unaffected by the single zero
    }
  });

  it('carries the phase through to the error for the upload phase too', () => {
    const result = computeThroughputResult([], 'upload', OPTIONS);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.phase).toBe('upload');
    }
  });
});
