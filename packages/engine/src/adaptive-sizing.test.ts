import { describe, expect, it } from 'vitest';
import { DEFAULT_ADAPTIVE_SIZING_OPTIONS, planAdaptiveSizing } from './adaptive-sizing';

describe('planAdaptiveSizing', () => {
  it('throws on a non-positive speed estimate', () => {
    expect(() => planAdaptiveSizing(0)).toThrow(RangeError);
    expect(() => planAdaptiveSizing(-5)).toThrow(RangeError);
  });

  it('picks the floor stream count for a slow line (≤10 Mbps)', () => {
    const plan = planAdaptiveSizing(5);
    expect(plan.streamCount).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.minStreamCount);
    expect(plan.perStreamByteTarget).toBe(1_250_000); // (5e6/8)*8s / 4 streams
  });

  it('picks the midpoint stream count for a moderate line (>10, ≤50 Mbps)', () => {
    const plan = planAdaptiveSizing(30);
    expect(plan.streamCount).toBe(6);
  });

  it('picks the full stream count for a fast line (>50 Mbps)', () => {
    const plan = planAdaptiveSizing(100);
    expect(plan.streamCount).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.maxStreamCount);
    expect(plan.perStreamByteTarget).toBe(12_500_000); // (100e6/8)*8s / 8 streams
  });

  it('caps total bytes at the hard ceiling for a very fast estimate', () => {
    const plan = planAdaptiveSizing(10_000);
    expect(plan.streamCount).toBe(8);
    expect(plan.perStreamByteTarget).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.maxTotalBytes / 8);
  });

  it('floors the per-stream target for a very slow estimate, so there is still enough data for post-warmup windows', () => {
    const plan = planAdaptiveSizing(0.05);
    expect(plan.perStreamByteTarget).toBe(DEFAULT_ADAPTIVE_SIZING_OPTIONS.minPerStreamBytes);
  });
});
