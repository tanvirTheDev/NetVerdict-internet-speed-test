import { z } from 'zod';

export const BUFFERBLOAT_GRADES = ['A+', 'A', 'B', 'C', 'D', 'F'] as const;
export type BufferbloatGrade = (typeof BUFFERBLOAT_GRADES)[number];

export const bufferbloatGradeSchema = z.enum(BUFFERBLOAT_GRADES);

/**
 * Grading thresholds are versioned so a change to the algorithm can never
 * silently splice two different scoring functions into one historical
 * trend line (§4 of the build brief — that would itself be a fabricated
 * result under §5.7). `v1` is the only profile that exists today.
 */
export const GRADING_PROFILE_IDS = ['v1'] as const;
export type GradingProfileId = (typeof GRADING_PROFILE_IDS)[number];

export const DAY_BUCKETS = ['morning', 'afternoon', 'evening_peak', 'late_night'] as const;
export type DayBucket = (typeof DAY_BUCKETS)[number];

export const dayBucketSchema = z.enum(DAY_BUCKETS);
