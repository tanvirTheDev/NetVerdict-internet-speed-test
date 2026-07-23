import { z } from 'zod';
import { engineErrorSchema, type EngineError } from './errors';
import { bufferbloatGradeSchema, dayBucketSchema, GRADING_PROFILE_IDS } from './grading';

/**
 * Every phase of a run reports through this envelope. `partial` and
 * `failed` are not error states to be hidden — they are the honest
 * outcome (§5.7 rule 2). A `complete` phase without `data` is not a
 * valid state and is rejected by the schema.
 */
export const PHASE_RESULT_STATUSES = ['complete', 'partial', 'failed', 'unavailable'] as const;
export type PhaseResultStatus = (typeof PHASE_RESULT_STATUSES)[number];

export function phaseResultSchema<TDataSchema extends z.ZodType>(dataSchema: TDataSchema) {
  return z
    .discriminatedUnion('status', [
      z.object({ status: z.literal('complete'), data: dataSchema }),
      z.object({ status: z.literal('partial'), data: dataSchema, error: engineErrorSchema }),
      z.object({ status: z.literal('failed'), error: engineErrorSchema }),
    ])
    .or(z.object({ status: z.literal('unavailable') }));
}

/**
 * The hand-written TS counterpart of `phaseResultSchema<T>(...)`'s output
 * — engine code (which constructs these values, not just validates them)
 * types against this directly instead of fighting Zod's generic
 * inference. Keep the two in structural sync; a contract test round-trips
 * sample values through both (see `test-result.contract.test.ts`).
 */
export type PhaseResult<T> =
  | { status: 'complete'; data: T }
  | { status: 'partial'; data: T; error: EngineError }
  | { status: 'failed'; error: EngineError }
  | { status: 'unavailable' };

/** The reported statistic is stated explicitly — never assume which one is shown (§5.2). */
export const throughputStatisticSchema = z.enum(['median', 'p90']);
export type ThroughputStatistic = z.infer<typeof throughputStatisticSchema>;

export const throughputResultSchema = z.object({
  mbps: z.number().nonnegative(),
  statistic: throughputStatisticSchema,
  streamCount: z.number().int().positive(),
  sampleCount: z.number().int().nonnegative(),
  warmupDiscardedMs: z.number().nonnegative(),
  windowMs: z.number().positive(),
  totalBytesTransferred: z.number().nonnegative(),
});

export type ThroughputResult = z.infer<typeof throughputResultSchema>;

export const latencyResultSchema = z.object({
  minMs: z.number().nonnegative(),
  medianMs: z.number().nonnegative(),
  jitterMs: z.number().nonnegative(),
  packetLossPct: z.number().min(0).max(100),
  sampleCount: z.number().int().nonnegative(),
});

export type LatencyResult = z.infer<typeof latencyResultSchema>;

export const rpmResultSchema = z.object({
  idle: z.number().nonnegative().optional(),
  down: z.number().nonnegative().optional(),
  up: z.number().nonnegative().optional(),
});

export type RpmResult = z.infer<typeof rpmResultSchema>;

export const CONNECTION_TYPES = [
  'bluetooth',
  'cellular',
  'ethernet',
  'wifi',
  'wimax',
  'other',
  'unknown',
  'none',
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/**
 * What was true about the run itself — needed to judge whether a number
 * should be trusted (§5.7 rule 3). None of this is optional decoration;
 * it is what makes a suspicious result explicable instead of mysterious.
 */
export const testConditionsSchema = z.object({
  startedAtEpochMs: z.number().nonnegative(),
  tzOffsetMinutes: z.number().int(),
  dayBucket: dayBucketSchema,
  connectionType: z.enum(CONNECTION_TYPES),
  endpoint: z.string().min(1),
  userAgentClass: z.string().min(1),
  engineVersion: z.string().min(1),
  schemaVersion: z.literal(1),
  gradingProfile: z.enum(GRADING_PROFILE_IDS),
  /** Set when the page was hidden, a competing tab was active, or CPU throttling was detected mid-run. */
  interferenceSuspected: z.boolean(),
});

export type TestConditions = z.infer<typeof testConditionsSchema>;

/**
 * The single canonical output of one run. This is what gets persisted,
 * scored against a Plan Guardian promise, and rendered on an Evidence
 * Report — every consumer reads the same shape.
 */
export const testResultSchema = z.object({
  conditions: testConditionsSchema,
  download: phaseResultSchema(throughputResultSchema),
  upload: phaseResultSchema(throughputResultSchema),
  idleLatency: phaseResultSchema(latencyResultSchema),
  loadedLatencyDown: phaseResultSchema(latencyResultSchema),
  loadedLatencyUp: phaseResultSchema(latencyResultSchema),
  bufferbloatGradeDown: bufferbloatGradeSchema.or(z.literal('unavailable')),
  bufferbloatGradeUp: bufferbloatGradeSchema.or(z.literal('unavailable')),
  rpm: rpmResultSchema,
  isPartial: z.boolean(),
  /** `true` when this run is ≥10x off the user's rolling baseline (§5.7 rule 4) — flagged, never dropped, never averaged in silently. */
  anomalyFlag: z.boolean(),
});

export type TestResult = z.infer<typeof testResultSchema>;
