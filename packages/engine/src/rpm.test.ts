import { describe, expect, it } from 'vitest';
import { computeRpm } from './rpm';

describe('computeRpm', () => {
  it('computes 60,000ms / latency exactly on round numbers', () => {
    expect(computeRpm(60)).toBe(1_000);
    expect(computeRpm(1_000)).toBe(60);
  });

  it('rounds to the nearest integer, as RPM is conventionally reported', () => {
    expect(computeRpm(17)).toBe(Math.round(60_000 / 17));
  });

  it('throws on non-positive latency — an invariant violation, not a valid measurement', () => {
    expect(() => computeRpm(0)).toThrow(RangeError);
    expect(() => computeRpm(-5)).toThrow(RangeError);
  });
});
