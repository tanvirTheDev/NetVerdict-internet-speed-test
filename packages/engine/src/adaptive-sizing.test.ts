import { describe, expect, it } from 'vitest';
import { asBytes } from '@netverdict/contracts';
import {
  DEFAULT_ADAPTIVE_SIZING_OPTIONS,
  fitPlanToAvailableConnections,
  planAdaptiveSizing,
} from './adaptive-sizing';

describe('planAdaptiveSizing', () => {
  it('throws on a non-positive speed estimate', () => {
    expect(() => planAdaptiveSizing(0)).toThrow(RangeError);
    expect(() => planAdaptiveSizing(-5)).toThrow(RangeError);
  });

  it('picks the floor stream count for a slow line (≤10 Mbps)', () => {
    const plan = planAdaptiveSizing(5);
    expect(plan.streamCount).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.minStreamCount);
    expect(plan.perStreamByteTarget).toBe(5_000_000); // (5e6/8)*8s*4 headroom / 4 streams
  });

  it('picks the midpoint stream count for a moderate line (>10, ≤50 Mbps)', () => {
    const plan = planAdaptiveSizing(30);
    expect(plan.streamCount).toBe(6);
  });

  it('picks the full stream count for a fast line (>50 Mbps)', () => {
    const plan = planAdaptiveSizing(100);
    expect(plan.streamCount).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.maxStreamCount);
    expect(plan.perStreamByteTarget).toBe(37_500_000); // (100e6/8)*8s*4 headroom / 8 streams, under the 300MB ceiling
  });

  it('caps total bytes at the hard ceiling for a very fast estimate', () => {
    const plan = planAdaptiveSizing(10_000);
    expect(plan.streamCount).toBe(8);
    expect(plan.perStreamByteTarget).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.maxTotalBytes / 8);
  });

  it('reserves a connection for the latency probe when bufferbloat is being measured', () => {
    // Browsers allow 6 concurrent connections per origin over HTTP/1.1,
    // and the loaded-latency probe needs one of them. Measured in Chrome:
    // with all 6 taken by transfers the probe took 45,441ms and only
    // returned when the phase deadline killed it; leaving one free, 258ms.
    const wanted = planAdaptiveSizing(1_000);
    expect(wanted.streamCount).toBe(8);

    const probing = fitPlanToAvailableConnections(wanted, DEFAULT_ADAPTIVE_SIZING_OPTIONS, true);
    expect(probing.streamCount).toBe(5);

    const notProbing = fitPlanToAvailableConnections(
      wanted,
      DEFAULT_ADAPTIVE_SIZING_OPTIONS,
      false,
    );
    expect(notProbing.streamCount).toBe(6);
  });

  it('leaves a plan that already fits within the connection budget alone', () => {
    const modest = planAdaptiveSizing(5); // 4 streams, below the budget
    const fitted = fitPlanToAvailableConnections(modest, DEFAULT_ADAPTIVE_SIZING_OPTIONS, true);
    expect(fitted).toEqual(modest);
  });

  it('never asks for a single request larger than the endpoint will serve', () => {
    // Cloudflare rejects a `bytes=` far above this outright, and a rejected
    // request yields no samples at all — worse than a smaller one.
    const plan = planAdaptiveSizing(10_000, {
      ...DEFAULT_ADAPTIVE_SIZING_OPTIONS,
      maxTotalBytes: asBytes(1_000_000_000),
      minStreamCount: 4,
      maxStreamCount: 4,
    });
    expect(plan.perStreamByteTarget).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.maxRequestBytes);
  });

  it('floors the per-stream target for a very slow estimate, so there is still enough data for post-warmup windows', () => {
    const plan = planAdaptiveSizing(0.05);
    expect(plan.perStreamByteTarget).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.minPerStreamBytes);
  });
});
