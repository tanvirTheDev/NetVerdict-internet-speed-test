import {
  err,
  ok,
  type EngineError,
  type LatencyResult,
  type LatencySample,
  type MeasurementPhase,
  type Result,
} from '@netverdict/contracts';
import { meanAbsoluteSuccessiveDifference, median } from './percentiles';

export const MIN_LATENCY_SAMPLES = 5;

/**
 * Turns raw round-trip probes into `min`/`median`/`jitter`/loss-%
 * (§5.3). Timed-out probes count toward packet loss but are excluded
 * from the RTT statistics — a probe that never returned has no RTT to
 * average in.
 *
 * 100% loss is reported as `INSUFFICIENT_SAMPLES`, not as `0ms` latency:
 * zero valid samples means there is no RTT to report, and inventing one
 * would violate §5.7 rule 1.
 */
export function computeLatencyResult(
  samples: readonly LatencySample[],
  phase: MeasurementPhase,
  minSamples: number = MIN_LATENCY_SAMPLES,
): Result<LatencyResult, EngineError> {
  if (samples.length < minSamples) {
    return err({
      code: 'INSUFFICIENT_SAMPLES',
      phase,
      retriable: true,
      message: `${phase}: only ${String(samples.length)} latency probe(s), need ${String(minSamples)}`,
    });
  }

  const validRtts = samples.filter((sample) => !sample.timedOut).map((sample) => sample.rttMs);
  const packetLossPct = ((samples.length - validRtts.length) / samples.length) * 100;

  if (validRtts.length === 0) {
    return err({
      code: 'INSUFFICIENT_SAMPLES',
      phase,
      retriable: true,
      message: `${phase}: 100% packet loss across ${String(samples.length)} probes — no RTT to report`,
    });
  }

  return ok({
    minMs: Math.min(...validRtts),
    medianMs: median(validRtts),
    jitterMs: meanAbsoluteSuccessiveDifference(validRtts),
    packetLossPct,
    sampleCount: samples.length,
  });
}
