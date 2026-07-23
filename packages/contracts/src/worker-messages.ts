import { z } from 'zod';
import { MEASUREMENT_PHASES, engineErrorSchema } from './errors';
import { latencySampleSchema } from './samples';
import { testResultSchema } from './test-result';

/**
 * The worker↔UI protocol (§5.5). Every message is validated at the
 * boundary — a malformed message is logged and dropped, never crashes
 * the run (§5.5). The UI only ever sends `start`/`stop`; the worker
 * streams everything else back.
 */
export const startCommandSchema = z.object({
  type: z.literal('start'),
  endpoint: z.string().min(1),
  runBufferbloat: z.boolean(),
});

export const stopCommandSchema = z.object({
  type: z.literal('stop'),
});

export const workerCommandSchema = z.discriminatedUnion('type', [
  startCommandSchema,
  stopCommandSchema,
]);

export type WorkerCommand = z.infer<typeof workerCommandSchema>;

const phaseChangedEventSchema = z.object({
  type: z.literal('phase'),
  phase: z.enum(MEASUREMENT_PHASES),
});

const throughputSampleEventSchema = z.object({
  type: z.literal('throughputSample'),
  phase: z.enum(['download', 'upload']),
  instantaneousMbps: z.number().nonnegative(),
  /** 0–1, or -1 if the total transfer size is not predetermined (adaptive sizing, §5.2). */
  progress: z.number(),
});

const latencySampleEventSchema = z.object({
  type: z.literal('latencySample'),
  sample: latencySampleSchema,
});

const phaseFailedEventSchema = z.object({
  type: z.literal('phaseFailed'),
  error: engineErrorSchema,
});

const completedEventSchema = z.object({
  type: z.literal('completed'),
  result: testResultSchema,
});

const abortedEventSchema = z.object({
  type: z.literal('aborted'),
});

export const workerEventSchema = z.discriminatedUnion('type', [
  phaseChangedEventSchema,
  throughputSampleEventSchema,
  latencySampleEventSchema,
  phaseFailedEventSchema,
  completedEventSchema,
  abortedEventSchema,
]);

export type WorkerEvent = z.infer<typeof workerEventSchema>;
