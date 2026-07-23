import { z } from 'zod';

/**
 * Closed taxonomy of everything that can go wrong in a measurement run.
 * The UI maps `code` to a localized message; it must never string-match
 * an error message, because messages are for logs and codes are the
 * contract (see §2.5 of the build brief).
 */
export const ENGINE_ERROR_CODES = [
  'NETWORK_UNAVAILABLE',
  'ENDPOINT_REJECTED',
  /**
   * The endpoint is throttling us (HTTP 429), not failing. Distinct from
   * ENDPOINT_REJECTED because the user-facing advice is completely
   * different — "wait a minute, or pick another server" versus "this
   * endpoint is broken" — and because a run rate-limited into silence
   * would otherwise read as a connection with no download speed.
   */
  'ENDPOINT_RATE_LIMITED',
  'CORS_BLOCKED',
  'TIMEOUT',
  'ABORTED_BY_USER',
  'INSUFFICIENT_SAMPLES',
  'UNSUPPORTED_ENVIRONMENT',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export const MEASUREMENT_PHASES = [
  'idle_latency',
  'download',
  'upload',
  'loaded_latency_down',
  'loaded_latency_up',
] as const;

export type MeasurementPhase = (typeof MEASUREMENT_PHASES)[number];

export const engineErrorSchema = z.object({
  code: z.enum(ENGINE_ERROR_CODES),
  phase: z.enum(MEASUREMENT_PHASES),
  retriable: z.boolean(),
  /** Human-readable detail for logs only — never rendered verbatim to a user. */
  message: z.string(),
});

export type EngineError = z.infer<typeof engineErrorSchema>;

export function isRetriableCode(code: EngineErrorCode): boolean {
  return code === 'TIMEOUT' || code === 'NETWORK_UNAVAILABLE' || code === 'ENDPOINT_RATE_LIMITED';
}
