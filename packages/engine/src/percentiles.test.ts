import { describe, expect, it } from 'vitest';
import { meanAbsoluteSuccessiveDifference, median, percentile } from './percentiles';

describe('percentile', () => {
  it('returns the sole value for a single-element array', () => {
    expect(percentile([42], 90)).toBe(42);
  });

  it('interpolates linearly between ranks (numpy default method)', () => {
    // n=5, p=90 -> rank = 0.9 * 4 = 3.6 -> interpolate between sorted[3]=40 and sorted[4]=50
    expect(percentile([10, 20, 30, 40, 50], 90)).toBeCloseTo(46, 10);
  });

  it('does not require pre-sorted input', () => {
    expect(percentile([50, 10, 40, 20, 30], 90)).toBeCloseTo(46, 10);
  });

  it('throws on an empty array — insufficient-sample handling belongs to the caller', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
  });

  it('throws when p is outside [0, 100]', () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], 101)).toThrow(RangeError);
  });
});

describe('median', () => {
  it('returns the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('interpolates between the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('throws on an empty array', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('meanAbsoluteSuccessiveDifference', () => {
  it('is zero for a constant series', () => {
    expect(meanAbsoluteSuccessiveDifference([10, 10, 10])).toBe(0);
  });

  it('averages the absolute consecutive differences, in time order', () => {
    // |20-10| + |10-20| + |25-10| = 10 + 10 + 15 = 35, over 3 differences = 35/3
    expect(meanAbsoluteSuccessiveDifference([10, 20, 10, 25])).toBeCloseTo(35 / 3, 10);
  });

  it('is zero for a single-element series (no successive pair exists)', () => {
    expect(meanAbsoluteSuccessiveDifference([10])).toBe(0);
  });

  it('throws on an empty array', () => {
    expect(() => meanAbsoluteSuccessiveDifference([])).toThrow(RangeError);
  });
});
