import { describe, expect, it } from 'vitest';
import { asMilliseconds, type TransferSample } from '@netverdict/contracts';
import {
  computeInstantaneousMbps,
  computeWindowedThroughput,
  totalBytesTransferred,
  uniqueStreamCount,
} from './windowing';

const WARMUP_MS = asMilliseconds(1_500);
const WINDOW_MS = asMilliseconds(250);

function sample(atMs: number, bytes: number, streamId = 'stream-1'): TransferSample {
  return { atMs, bytes, streamId };
}

describe('computeWindowedThroughput', () => {
  it('returns an empty array when every sample falls inside the warm-up period', () => {
    const samples = [sample(0, 100_000), sample(500, 100_000), sample(1_499, 100_000)];
    expect(
      computeWindowedThroughput(samples, { warmupMs: WARMUP_MS, windowMs: WINDOW_MS }),
    ).toEqual([]);
  });

  it('produces one clean window per bucket for evenly spaced, aligned samples (10 buckets, 250,000 bytes each)', () => {
    // Every sample lands exactly windowMs apart and exactly at a bucket boundary —
    // the case that used to collapse the last bucket's duration to ~0 (fixed by
    // anchoring bucket width to a fixed windowMs instead of the sample span).
    const samples: TransferSample[] = [];
    for (let i = 0; i < 10; i += 1) {
      samples.push(sample(1_500 + i * 250, 250_000));
    }
    const readings = computeWindowedThroughput(samples, {
      warmupMs: WARMUP_MS,
      windowMs: WINDOW_MS,
    });
    expect(readings).toHaveLength(10);
    // 250,000 bytes / 250ms == 8 Mbps (same arithmetic as the units.test.ts case)
    for (const reading of readings) {
      expect(reading).toBeCloseTo(8, 10);
    }
  });

  it('aggregates bytes across parallel streams landing in the same window', () => {
    const samples: TransferSample[] = [
      sample(1_500, 150_000, 'stream-a'),
      sample(1_500, 100_000, 'stream-b'),
    ];
    const readings = computeWindowedThroughput(samples, {
      warmupMs: WARMUP_MS,
      windowMs: WINDOW_MS,
    });
    expect(readings).toHaveLength(1);
    // 250,000 combined bytes / 250ms == 8 Mbps, same as the single-stream case
    expect(readings[0]).toBeCloseTo(8, 10);
  });

  it('discards only the warm-up ramp, not the steady state that follows it', () => {
    const samples: TransferSample[] = [
      sample(0, 999_999_999), // huge slow-start burst inside warm-up — must not count
      sample(1_499, 999_999_999), // still inside warm-up (< warmupMs)
      sample(1_500, 250_000), // first steady-state sample
    ];
    const readings = computeWindowedThroughput(samples, {
      warmupMs: WARMUP_MS,
      windowMs: WINDOW_MS,
    });
    expect(readings).toHaveLength(1);
    expect(readings[0]).toBeCloseTo(8, 10);
  });

  it('models a mid-test stall as one low window without corrupting the others', () => {
    const samples: TransferSample[] = [];
    for (let i = 0; i < 10; i += 1) {
      // window index 4 stalls: zero bytes that round
      samples.push(sample(1_500 + i * 250, i === 4 ? 0 : 250_000));
    }
    const readings = computeWindowedThroughput(samples, {
      warmupMs: WARMUP_MS,
      windowMs: WINDOW_MS,
    });
    expect(readings).toHaveLength(10);
    expect(readings[4]).toBe(0);
    const others = readings.filter((_, index) => index !== 4);
    for (const reading of others) {
      expect(reading).toBeCloseTo(8, 10);
    }
  });
});

describe('computeInstantaneousMbps', () => {
  it('sums bytes only within the trailing window across all streams', () => {
    const samples: TransferSample[] = [
      sample(0, 999_999_999, 'stream-a'), // long before the trailing window — must not count
      sample(4_800, 125_000, 'stream-a'),
      sample(4_900, 125_000, 'stream-b'),
    ];
    // trailing 500ms window ending at nowMs=5000 covers [4500, 5000] — both recent samples qualify
    expect(computeInstantaneousMbps(samples, 5_000, 500)).toBeCloseTo(4, 10); // 250,000 bytes / 500ms = 4 Mbps
  });

  it('clamps the effective window so early-test readings are not divided by a window wider than elapsed time', () => {
    const samples: TransferSample[] = [sample(50, 62_500, 'stream-a')];
    // nowMs=50 is less than the nominal 500ms trailing window; effective window is min(500, 50)=50ms
    expect(computeInstantaneousMbps(samples, 50, 500)).toBeCloseTo(10, 10); // 62,500 bytes / 50ms = 10 Mbps
  });
});

describe('uniqueStreamCount', () => {
  it('counts distinct streamIds, not samples', () => {
    const samples = [sample(0, 1, 'a'), sample(1, 1, 'a'), sample(2, 1, 'b')];
    expect(uniqueStreamCount(samples)).toBe(2);
  });
});

describe('totalBytesTransferred', () => {
  it('sums every sample, including warm-up bytes — real data actually sent, not just steady-state', () => {
    const samples = [sample(0, 100), sample(1, 200), sample(2, 300)];
    expect(totalBytesTransferred(samples)).toBe(600);
  });

  it('is zero for an empty array', () => {
    expect(totalBytesTransferred([])).toBe(0);
  });
});
