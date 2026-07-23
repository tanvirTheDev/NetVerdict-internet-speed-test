import { describe, expect, it } from 'vitest';
import { asEpochMs } from '@netverdict/contracts';
import { bucketDay, bucketDayFromHour } from './day-bucket';

describe('bucketDayFromHour', () => {
  it.each([
    [0, 'late_night'],
    [4, 'late_night'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [18, 'afternoon'],
    [19, 'evening_peak'],
    [23, 'evening_peak'],
  ] as const)('buckets hour %i as %s', (hour, expected) => {
    expect(bucketDayFromHour(hour)).toBe(expected);
  });

  it('throws on an out-of-range or non-integer hour', () => {
    expect(() => bucketDayFromHour(-1)).toThrow(RangeError);
    expect(() => bucketDayFromHour(24)).toThrow(RangeError);
    expect(() => bucketDayFromHour(5.5)).toThrow(RangeError);
  });
});

describe('bucketDay', () => {
  it('applies a positive tzOffsetMinutes (local behind UTC) per getTimezoneOffset()’s convention', () => {
    // 10:00 UTC, tzOffsetMinutes=300 (e.g. US Eastern behind UTC) -> 05:00 local -> morning
    const epochMs = asEpochMs(Date.UTC(2026, 0, 1, 10, 0, 0));
    expect(bucketDay(epochMs, 300)).toBe('morning');
  });

  it('applies a negative tzOffsetMinutes (local ahead of UTC)', () => {
    // 19:00 UTC, tzOffsetMinutes=0 -> 19:00 local -> evening_peak
    const epochMs = asEpochMs(Date.UTC(2026, 0, 1, 19, 0, 0));
    expect(bucketDay(epochMs, 0)).toBe('evening_peak');
  });

  it('shifts across a day boundary correctly', () => {
    // 01:00 UTC, tzOffsetMinutes=-180 (local ahead by 3h, e.g. Moscow) -> 04:00 local -> late_night
    const epochMs = asEpochMs(Date.UTC(2026, 0, 1, 1, 0, 0));
    expect(bucketDay(epochMs, -180)).toBe('late_night');
  });
});
