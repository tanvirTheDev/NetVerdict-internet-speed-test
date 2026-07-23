import { z } from 'zod';

/**
 * One chunk of bytes observed on one parallel stream at one instant.
 * The engine keeps the full series (never just a running total) so
 * throughput can be recomputed over any sliding window (§5.2 of the
 * build brief) and so a synthetic fixture can assert an exact result.
 */
export const transferSampleSchema = z.object({
  atMs: z.number().nonnegative(),
  bytes: z.number().nonnegative(),
  streamId: z.string().min(1),
});

export type TransferSample = z.infer<typeof transferSampleSchema>;

export const LOAD_CONDITIONS = ['none', 'download', 'upload'] as const;
export type LoadCondition = (typeof LOAD_CONDITIONS)[number];

/** One round-trip-time observation, tagged with what was saturating the link at the time. */
export const latencySampleSchema = z.object({
  atMs: z.number().nonnegative(),
  rttMs: z.number().nonnegative(),
  underLoad: z.enum(LOAD_CONDITIONS),
  /** `true` when the probe timed out — a loss, not a slow reply. */
  timedOut: z.boolean(),
});

export type LatencySample = z.infer<typeof latencySampleSchema>;
