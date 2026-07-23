import { describe, expect, it } from 'vitest';
import { isErr, isOk, type LatencySample } from '@netverdict/contracts';
import { computeLatencyResult, MIN_LATENCY_SAMPLES } from './latency';

function valid(rttMs: number): LatencySample {
  return { atMs: 0, rttMs, underLoad: 'none', timedOut: false };
}

function lost(): LatencySample {
  return { atMs: 0, rttMs: 0, underLoad: 'none', timedOut: true };
}

describe('computeLatencyResult', () => {
  it('reports INSUFFICIENT_SAMPLES below the minimum probe count', () => {
    const result = computeLatencyResult([valid(10), valid(20)], 'idle_latency', 5);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INSUFFICIENT_SAMPLES');
    }
  });

  it('defaults the minimum to MIN_LATENCY_SAMPLES (5)', () => {
    expect(MIN_LATENCY_SAMPLES).toBe(5);
    const result = computeLatencyResult(
      [valid(10), valid(10), valid(10), valid(10)],
      'idle_latency',
    );
    expect(isErr(result)).toBe(true);
  });

  it('computes min/median/jitter exactly for a clean, all-valid sample set', () => {
    // rtts in time order: 10, 20, 15, 25, 10
    const samples = [valid(10), valid(20), valid(15), valid(25), valid(10)];
    const result = computeLatencyResult(samples, 'idle_latency');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.minMs).toBe(10);
      // sorted: 10,10,15,20,25 -> n=5, rank=2 -> sorted[2]=15
      expect(result.value.medianMs).toBe(15);
      // |20-10|+|15-20|+|25-15|+|10-25| = 10+5+10+15 = 40, /4 = 10
      expect(result.value.jitterMs).toBe(10);
      expect(result.value.packetLossPct).toBe(0);
      expect(result.value.sampleCount).toBe(5);
    }
  });

  it('excludes timed-out probes from RTT stats but counts them toward packet loss', () => {
    // 2 lost out of 8 -> 25% loss; valid rtts in order: 10, 20, 10, 20, 10, 20
    const samples = [
      valid(10),
      lost(),
      valid(20),
      valid(10),
      lost(),
      valid(20),
      valid(10),
      valid(20),
    ];
    const result = computeLatencyResult(samples, 'idle_latency');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.packetLossPct).toBe(25);
      expect(result.value.minMs).toBe(10);
      expect(result.value.medianMs).toBe(15); // sorted valid rtts: 10,10,10,20,20,20 -> rank=2.5 -> (10+20)/2
      expect(result.value.sampleCount).toBe(8);
    }
  });

  it('reports INSUFFICIENT_SAMPLES on 100% packet loss rather than inventing a 0ms result', () => {
    const samples = Array.from({ length: 6 }, () => lost());
    const result = computeLatencyResult(samples, 'idle_latency');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INSUFFICIENT_SAMPLES');
      expect(result.error.message).toContain('100% packet loss');
    }
  });

  it('carries the phase through into the error', () => {
    const result = computeLatencyResult([], 'loaded_latency_down');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.phase).toBe('loaded_latency_down');
    }
  });
});
