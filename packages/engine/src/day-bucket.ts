import type { DayBucket, EpochMs } from '@netverdict/contracts';

const MS_PER_MINUTE = 60_000;

/**
 * Buckets an hour-of-day (0–23, local time) into the four windows the
 * product cares about — especially `evening_peak` (19:00–23:59), the
 * window where ISP throttling is most visible (§1).
 */
export function bucketDayFromHour(localHour: number): DayBucket {
  if (localHour < 0 || localHour > 23 || !Number.isInteger(localHour)) {
    throw new RangeError(
      `bucketDayFromHour: hour must be an integer in [0, 23], got ${String(localHour)}`,
    );
  }
  if (localHour >= 5 && localHour < 12) return 'morning';
  if (localHour >= 12 && localHour < 19) return 'afternoon';
  if (localHour >= 19) return 'evening_peak';
  return 'late_night';
}

/**
 * `tzOffsetMinutes` follows `Date.prototype.getTimezoneOffset()`'s sign
 * convention: positive when local time is *behind* UTC (e.g. US Eastern
 * standard time reports +300). Local wall-clock time is therefore
 * `epochMs - tzOffsetMinutes * 60_000`.
 */
export function bucketDay(epochMs: EpochMs, tzOffsetMinutes: number): DayBucket {
  const localMs = epochMs - tzOffsetMinutes * MS_PER_MINUTE;
  const localHour = new Date(localMs).getUTCHours();
  return bucketDayFromHour(localHour);
}
