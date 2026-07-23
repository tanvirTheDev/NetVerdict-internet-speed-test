import {
  asBytes,
  asEpochMs,
  type Bytes,
  type ConnectionType,
  type EpochMs,
  type GradingProfileId,
  type LatencyResult,
  type LatencySample,
  type PhaseResult,
  type ThroughputResult,
  type ThroughputStatistic,
  type TransferSample,
  type TestConditions,
  type TestResult,
  type WorkerEvent,
} from '@netverdict/contracts';
import {
  DEFAULT_ADAPTIVE_SIZING_OPTIONS,
  planAdaptiveSizing,
  type AdaptiveSizingOptions,
} from './adaptive-sizing';
import { bucketDay } from './day-bucket';
import { computeLatencyResult } from './latency';
import {
  computeThroughputResult,
  DEFAULT_THROUGHPUT_OPTIONS,
  type ThroughputComputationOptions,
} from './throughput';
import { computeInstantaneousMbps, totalBytesTransferred } from './windowing';
import type { Clock } from './clock';
import { randomStreamId, type TransferProvider } from './transfer-provider';

export interface OrchestratorConfig {
  endpoint: string;
  connectionType: ConnectionType;
  userAgentClass: string;
  tzOffsetMinutes: number;
  engineVersion: string;
  gradingProfile: GradingProfileId;
  idleLatencyProbeCount: number;
  throughputStatistic: ThroughputStatistic;
  adaptiveSizing: AdaptiveSizingOptions;
  throughputWindowing: Omit<ThroughputComputationOptions, 'statistic'>;
  quickProbeBytes: Bytes;
  liveGaugeTrailingWindowMs: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: Omit<
  OrchestratorConfig,
  'endpoint' | 'connectionType' | 'userAgentClass' | 'tzOffsetMinutes' | 'engineVersion'
> = {
  gradingProfile: 'v1',
  idleLatencyProbeCount: 15,
  throughputStatistic: 'median',
  adaptiveSizing: DEFAULT_ADAPTIVE_SIZING_OPTIONS,
  throughputWindowing: DEFAULT_THROUGHPUT_OPTIONS,
  quickProbeBytes: asBytes(500_000),
  liveGaugeTrailingWindowMs: 500,
};

export interface OrchestratorDeps {
  provider: TransferProvider;
  clock: Clock;
}

/**
 * Wrapping this in a function (rather than reading `signal.aborted`
 * inline everywhere) is deliberate, not stylistic: `signal` is mutated
 * from *outside* this module (whoever holds the matching
 * `AbortController` calls `.abort()` during one of the `await`s below).
 * A repeated raw property read narrows in the type-checker's eyes to
 * "still false, nothing here changed it" — a real false positive, since
 * the whole point of cooperative cancellation is that something else
 * changes it concurrently. Routing through an opaque function call
 * sidesteps that instead of scattering `eslint-disable` comments over
 * every check.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Runs idle latency → download → upload and assembles a `TestResult`
 * (§5 of the build brief). Bufferbloat/loaded-latency/RPM are Phase 3
 * work — this Phase 1 orchestrator reports them `unavailable`, honestly,
 * rather than fabricating a placeholder (§5.7 rule 6).
 *
 * Returns `undefined` only when aborted before any phase produced a
 * usable result — otherwise every phase that ran, succeeded or not, is
 * reflected in the returned `TestResult` (partial results are first-class,
 * §2.5).
 */
export async function runMeasurement(
  config: OrchestratorConfig,
  deps: OrchestratorDeps,
  onEvent: (event: WorkerEvent) => void,
  signal: AbortSignal,
): Promise<TestResult | undefined> {
  const { provider, clock } = deps;
  const testStartMs = clock.now();

  if (isAborted(signal)) {
    onEvent({ type: 'aborted' });
    return undefined;
  }

  // --- Idle latency ---------------------------------------------------
  onEvent({ type: 'phase', phase: 'idle_latency' });
  const idleLatencySamples: LatencySample[] = [];
  for (let i = 0; i < config.idleLatencyProbeCount; i += 1) {
    if (isAborted(signal)) {
      onEvent({ type: 'aborted' });
      return undefined;
    }
    const probe = await provider.probeLatency(signal);
    if (!probe.ok) {
      if (probe.error.code === 'ABORTED_BY_USER') {
        onEvent({ type: 'aborted' });
        return undefined;
      }
      // A single rejected/unreachable probe counts as loss, not a fatal error (§5.7 rule 4 — flag, don't hide).
      const sample: LatencySample = {
        atMs: clock.now() - testStartMs,
        rttMs: 0,
        underLoad: 'none',
        timedOut: true,
      };
      idleLatencySamples.push(sample);
      onEvent({ type: 'latencySample', sample });
      continue;
    }
    const sample: LatencySample = {
      atMs: clock.now() - testStartMs,
      rttMs: probe.value.rttMs,
      underLoad: 'none',
      timedOut: probe.value.timedOut,
    };
    idleLatencySamples.push(sample);
    onEvent({ type: 'latencySample', sample });
  }
  const idleLatencyOutcome = computeLatencyResult(idleLatencySamples, 'idle_latency');
  const idleLatency: PhaseResult<LatencyResult> = idleLatencyOutcome.ok
    ? { status: 'complete', data: idleLatencyOutcome.value }
    : { status: 'failed', error: idleLatencyOutcome.error };

  // --- Quick probe → adaptive sizing -----------------------------------
  if (isAborted(signal)) {
    onEvent({ type: 'aborted' });
    return undefined;
  }
  const probeSamples: TransferSample[] = [];
  const probeStreamId = randomStreamId(0);
  const probeOutcome = await provider.download({
    streamId: probeStreamId,
    byteTarget: config.quickProbeBytes,
    clock,
    testStartMs,
    onSample: (sample) => probeSamples.push(sample),
    signal,
  });
  const probeElapsedMs = Math.max(1, clock.now() - testStartMs);
  const probeBytes = totalBytesTransferred(probeSamples);
  const roughMbps =
    probeOutcome.ok && probeBytes > 0 ? (probeBytes * 8) / (probeElapsedMs / 1000) / 1_000_000 : 1;
  const plan = planAdaptiveSizing(roughMbps, config.adaptiveSizing);

  // --- Download ---------------------------------------------------------
  onEvent({ type: 'phase', phase: 'download' });
  const download = await runThroughputPhase({
    phase: 'download',
    plan,
    provider,
    clock,
    testStartMs,
    config,
    signal,
    onEvent,
    // The quick probe's bytes are real transfer that already happened — fold them in rather than discarding real data.
    seedSamples: probeOutcome.ok ? probeSamples : [],
  });
  if (download === 'aborted') {
    onEvent({ type: 'aborted' });
    return undefined;
  }

  // --- Upload -------------------------------------------------------------
  onEvent({ type: 'phase', phase: 'upload' });
  const upload = await runThroughputPhase({
    phase: 'upload',
    plan,
    provider,
    clock,
    testStartMs,
    config,
    signal,
    onEvent,
    seedSamples: [],
  });
  if (upload === 'aborted') {
    onEvent({ type: 'aborted' });
    return undefined;
  }

  const isPartial =
    idleLatency.status !== 'complete' ||
    download.status !== 'complete' ||
    upload.status !== 'complete';

  const conditions: TestConditions = {
    startedAtEpochMs: testStartMs,
    tzOffsetMinutes: config.tzOffsetMinutes,
    dayBucket: bucketDay(asEpochMs(testStartMs), config.tzOffsetMinutes),
    connectionType: config.connectionType,
    endpoint: provider.endpoint,
    userAgentClass: config.userAgentClass,
    engineVersion: config.engineVersion,
    schemaVersion: 1,
    gradingProfile: config.gradingProfile,
    interferenceSuspected: false,
  };

  const result: TestResult = {
    conditions,
    download,
    upload,
    idleLatency,
    loadedLatencyDown: { status: 'unavailable' },
    loadedLatencyUp: { status: 'unavailable' },
    bufferbloatGradeDown: 'unavailable',
    bufferbloatGradeUp: 'unavailable',
    rpm: {},
    isPartial,
    anomalyFlag: false,
  };

  onEvent({ type: 'completed', result });
  return result;
}

interface ThroughputPhaseParams {
  phase: 'download' | 'upload';
  plan: { streamCount: number; perStreamByteTarget: Bytes };
  provider: TransferProvider;
  clock: Clock;
  testStartMs: EpochMs;
  config: OrchestratorConfig;
  signal: AbortSignal;
  onEvent: (event: WorkerEvent) => void;
  seedSamples: readonly TransferSample[];
}

async function runThroughputPhase(
  params: ThroughputPhaseParams,
): Promise<PhaseResult<ThroughputResult> | 'aborted'> {
  const { phase, plan, provider, clock, testStartMs, config, signal, onEvent, seedSamples } =
    params;
  const samples: TransferSample[] = [...seedSamples];

  const onSample = (sample: TransferSample): void => {
    samples.push(sample);
    const instantaneousMbps = computeInstantaneousMbps(
      samples,
      sample.atMs,
      config.liveGaugeTrailingWindowMs,
    );
    onEvent({
      type: 'throughputSample',
      phase,
      instantaneousMbps,
      progress: Math.min(1, samples.length > 0 ? sample.bytes / plan.perStreamByteTarget : 0),
    });
  };

  const streamResults = await Promise.all(
    Array.from({ length: plan.streamCount }, (_unused, index) =>
      phase === 'download'
        ? provider.download({
            streamId: randomStreamId(index + 1),
            byteTarget: plan.perStreamByteTarget,
            clock,
            testStartMs,
            onSample,
            signal,
          })
        : provider.upload({
            streamId: randomStreamId(index + 1),
            byteTarget: plan.perStreamByteTarget,
            clock,
            testStartMs,
            onSample,
            signal,
          }),
    ),
  );

  if (isAborted(signal)) {
    return 'aborted';
  }

  const outcome = computeThroughputResult(samples, phase, {
    ...config.throughputWindowing,
    statistic: config.throughputStatistic,
  });

  if (outcome.ok) {
    return { status: 'complete', data: outcome.value };
  }

  const hardFailure = streamResults.find(
    (streamResult) => !streamResult.ok && streamResult.error.code !== 'INSUFFICIENT_SAMPLES',
  );
  return {
    status: 'failed',
    error: hardFailure && !hardFailure.ok ? hardFailure.error : outcome.error,
  };
}
