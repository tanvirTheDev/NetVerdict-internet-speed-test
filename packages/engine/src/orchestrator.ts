import {
  asBytes,
  asEpochMs,
  ok,
  type BufferbloatGrade,
  type Bytes,
  type ConnectionType,
  type EngineError,
  type EpochMs,
  type GradingProfileId,
  type LatencyResult,
  type LatencySample,
  type MeasurementPhase,
  type PhaseResult,
  type Result,
  type RpmResult,
  type ThroughputResult,
  type ThroughputStatistic,
  type TransferSample,
  type TestConditions,
  type TestResult,
  type WorkerEvent,
} from '@netverdict/contracts';
import {
  DEFAULT_ADAPTIVE_SIZING_OPTIONS,
  fitPlanToAvailableConnections,
  planAdaptiveSizing,
  type AdaptiveSizingOptions,
} from './adaptive-sizing';
import { bucketDay } from './day-bucket';
import { gradeBufferbloat, GRADING_PROFILE_V1 } from './bufferbloat';
import { computeLatencyResult } from './latency';
import { computeRpm } from './rpm';
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
  /** Gap between loaded-latency probes fired while a transfer saturates the link (§5.4: every ~250–500ms). */
  loadedLatencyProbeIntervalMs: number;
  /** Set false to skip loaded-latency probing entirely; bufferbloat and loaded RPM then report `unavailable`. */
  measureBufferbloat: boolean;
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
  loadedLatencyProbeIntervalMs: 250,
  measureBufferbloat: true,
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
  const probeStartMs = clock.now();
  const probeOutcome = await provider.download({
    streamId: probeStreamId,
    byteTarget: config.quickProbeBytes,
    clock,
    testStartMs,
    onSample: (sample) => probeSamples.push(sample),
    signal,
  });
  // Timed from the probe's own start, not the test's: the idle-latency
  // phase before it takes ~1s of wall clock, and charging that to the
  // probe's transfer divides its bytes by a ~20x-too-large duration. That
  // under-estimate cascades — adaptive sizing picks a byte target sized
  // for a dial-up line, a fast link drains it in under 500ms, and the
  // phase ends with fewer than `minWindowedSamples` windows, i.e. a
  // download reported `unavailable` on a perfectly healthy connection.
  const probeElapsedMs = Math.max(1, clock.now() - probeStartMs);
  const probeBytes = totalBytesTransferred(probeSamples);
  const roughMbps =
    probeOutcome.ok && probeBytes > 0 ? (probeBytes * 8) / (probeElapsedMs / 1000) / 1_000_000 : 1;
  // The quick probe holds a connection of its own while it runs, so the
  // budget is only right once it has finished.
  const plan = fitPlanToAvailableConnections(
    planAdaptiveSizing(roughMbps, config.adaptiveSizing),
    config.adaptiveSizing,
    config.measureBufferbloat,
  );

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

  // --- Bufferbloat & responsiveness (§5.4) --------------------------------
  const loadedLatencyDown = summariseLoadedLatency(
    download.loadedLatencySamples,
    'loaded_latency_down',
    download.throughput,
  );
  const loadedLatencyUp = summariseLoadedLatency(
    upload.loadedLatencySamples,
    'loaded_latency_up',
    upload.throughput,
  );

  /**
   * The grade is the *increase* over idle, so it needs both halves. With
   * no idle baseline there is no increase to grade — and a raw loaded
   * figure would grade a merely-distant link as bufferbloated, which is a
   * different fault entirely (§5.4). Report `unavailable` instead of
   * substituting a proxy (§5.7 rule 6).
   */
  const idleMedianMs = idleLatency.status === 'complete' ? idleLatency.data.medianMs : undefined;
  const grade = (loaded: PhaseResult<LatencyResult>): BufferbloatGrade | 'unavailable' =>
    idleMedianMs !== undefined && loaded.status === 'complete'
      ? gradeBufferbloat(idleMedianMs, loaded.data.medianMs, GRADING_PROFILE_V1)
      : 'unavailable';

  const rpmOf = (latency: PhaseResult<LatencyResult>): number | undefined =>
    latency.status === 'complete' && latency.data.medianMs > 0
      ? computeRpm(latency.data.medianMs)
      : undefined;

  const rpm: RpmResult = {
    ...(idleMedianMs !== undefined && idleMedianMs > 0 ? { idle: computeRpm(idleMedianMs) } : {}),
    ...(rpmOf(loadedLatencyDown) !== undefined ? { down: rpmOf(loadedLatencyDown) } : {}),
    ...(rpmOf(loadedLatencyUp) !== undefined ? { up: rpmOf(loadedLatencyUp) } : {}),
  };

  const isPartial =
    idleLatency.status !== 'complete' ||
    download.throughput.status !== 'complete' ||
    upload.throughput.status !== 'complete';

  // Asked for after the transfers, not before: it must not delay the
  // measurement, and a failed lookup must not be able to fail the run.
  const server = await provider.describeServer(signal);

  const conditions: TestConditions = {
    startedAtEpochMs: testStartMs,
    tzOffsetMinutes: config.tzOffsetMinutes,
    dayBucket: bucketDay(asEpochMs(testStartMs), config.tzOffsetMinutes),
    connectionType: config.connectionType,
    endpoint: provider.endpoint,
    ...(server ? { server } : {}),
    userAgentClass: config.userAgentClass,
    engineVersion: config.engineVersion,
    schemaVersion: 1,
    gradingProfile: config.gradingProfile,
    interferenceSuspected: false,
  };

  const result: TestResult = {
    conditions,
    download: download.throughput,
    upload: upload.throughput,
    idleLatency,
    loadedLatencyDown,
    loadedLatencyUp,
    bufferbloatGradeDown: grade(loadedLatencyDown),
    bufferbloatGradeUp: grade(loadedLatencyUp),
    rpm,
    isPartial,
    anomalyFlag: false,
  };

  onEvent({ type: 'completed', result });
  return result;
}

/**
 * Turns a phase's under-load round trips into a `LatencyResult`, or says
 * why it cannot. An empty series is `unavailable` rather than `failed`:
 * with `measureBufferbloat` off, or a phase too short to fit a probe past
 * warm-up, nothing went wrong — the measurement simply was not taken
 * (§5.7 rule 6).
 *
 * The transfer's own outcome gates the whole thing. These probes are only
 * meaningful because something was saturating the link while they ran —
 * if that transfer failed (a rate-limited endpoint, a dropped
 * connection), the probes went out over an *idle* line. Observed live:
 * a download rate-limited to zero bytes still returned 28.4ms against a
 * 28.5ms idle baseline, which grades A+ — a perfect bufferbloat score
 * from a link that was never put under load. Reporting that is exactly
 * the fabrication §5.7 rule 1 forbids.
 */
function summariseLoadedLatency(
  samples: readonly LatencySample[],
  phase: Extract<MeasurementPhase, 'loaded_latency_down' | 'loaded_latency_up'>,
  transfer: PhaseResult<ThroughputResult>,
): PhaseResult<LatencyResult> {
  if (samples.length === 0 || transfer.status !== 'complete') {
    return { status: 'unavailable' };
  }
  const outcome = computeLatencyResult(samples, phase);
  return outcome.ok
    ? { status: 'complete', data: outcome.value }
    : { status: 'failed', error: outcome.error };
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

/**
 * Runs one throughput phase for a fixed stretch of wall clock rather
 * than until a byte target is hit.
 *
 * A byte target is a guess: it comes from a single sub-second probe, and
 * when that probe under-reads (a cold connection, a slow first byte) the
 * target is sized for a far slower link and the phase ends seconds early
 * — while the transfer is still inside TCP slow-start. The median of
 * those windows is then the *ramp*, not the link, and it lands well
 * below what the connection sustains. Guessing high is no better: it
 * pushes streams past their timeout to be killed mid-flight.
 *
 * Ending on a deadline removes the guess from the answer. The probe now
 * only picks how many streams to open and how large each request is;
 * neither can shorten the measurement. Streams that finish their request
 * with time left simply issue another. The phase stops at whichever
 * comes first: the deadline, or `maxTotalBytes` — a data cap must still
 * bind on a link fast enough to reach it (§5.2).
 */
interface ThroughputPhaseOutcome {
  throughput: PhaseResult<ThroughputResult>;
  /** Round trips observed while this phase saturated the link — the raw material for the bufferbloat grade. */
  loadedLatencySamples: readonly LatencySample[];
}

async function runThroughputPhase(
  params: ThroughputPhaseParams,
): Promise<ThroughputPhaseOutcome | 'aborted'> {
  const { phase, plan, provider, clock, testStartMs, config, signal, onEvent, seedSamples } =
    params;
  const samples: TransferSample[] = [...seedSamples];
  const phaseStartMs = clock.now();
  const phaseDurationMs = config.adaptiveSizing.targetDurationSeconds * 1000;

  // Two mechanisms, because they cover different moments: the timer ends
  // requests that are still streaming when time runs out, the clock check
  // below stops a finished stream from opening another. Only the timer can
  // interrupt an in-flight transfer, and only the clock check is visible to
  // a test running on fake time.
  const deadlineController = new AbortController();
  const stopPhase = (): void => {
    deadlineController.abort();
  };
  const deadlineTimer = setTimeout(stopPhase, phaseDurationMs);
  const transferSignal = AbortSignal.any([signal, deadlineController.signal]);

  const onSample = (sample: TransferSample): void => {
    samples.push(sample);
    if (totalBytesTransferred(samples) >= config.adaptiveSizing.maxTotalBytes) {
      stopPhase();
    }
    const instantaneousMbps = computeInstantaneousMbps(
      samples,
      sample.atMs,
      config.liveGaugeTrailingWindowMs,
    );
    onEvent({
      type: 'throughputSample',
      phase,
      instantaneousMbps,
      // Progress is elapsed time now that time is what ends the phase.
      progress: Math.min(1, (clock.now() - phaseStartMs) / phaseDurationMs),
    });
  };

  const transfer = (streamId: string): Promise<Result<void, EngineError>> => {
    const streamParams = {
      streamId,
      byteTarget: plan.perStreamByteTarget,
      clock,
      testStartMs,
      onSample,
      signal: transferSignal,
    };
    return phase === 'download' ? provider.download(streamParams) : provider.upload(streamParams);
  };

  const timeLeft = (): boolean =>
    clock.now() - phaseStartMs < phaseDurationMs &&
    !deadlineController.signal.aborted &&
    !isAborted(signal);

  /**
   * Latency probes fired *while* the transfer streams above saturate the
   * link — this is the whole bufferbloat measurement (§5.4). The probe is
   * a zero-byte request, so it costs nothing measurable against the
   * throughput it runs alongside, and it deliberately shares
   * `transferSignal`: probing must stop the instant the load does, or the
   * tail of the series would record an idle link and grade the connection
   * better than it is.
   *
   * Probes inside the warm-up window are dropped for the same reason the
   * throughput windows drop them — the link is not yet saturated during
   * slow-start, so those round trips describe a half-loaded connection
   * and would understate the queueing delay.
   */
  const loadedLatencySamples: LatencySample[] = [];
  const probeUnderLoad = async (): Promise<void> => {
    if (!config.measureBufferbloat) {
      return;
    }
    while (timeLeft()) {
      const probe = await provider.probeLatency(transferSignal);
      const atMs = clock.now() - testStartMs;
      const pastWarmup = clock.now() - phaseStartMs >= config.throughputWindowing.warmupMs;
      if (!probe.ok) {
        // A probe the load itself killed says nothing about the link; one
        // that timed out under load is exactly the signal we came for.
        if (probe.error.code !== 'ABORTED_BY_USER' && pastWarmup) {
          const sample: LatencySample = { atMs, rttMs: 0, underLoad: phase, timedOut: true };
          loadedLatencySamples.push(sample);
          onEvent({ type: 'latencySample', sample });
        }
      } else if (pastWarmup) {
        const sample: LatencySample = {
          atMs,
          rttMs: probe.value.rttMs,
          underLoad: phase,
          timedOut: probe.value.timedOut,
        };
        loadedLatencySamples.push(sample);
        onEvent({ type: 'latencySample', sample });
      }
      await clock.sleep(config.loadedLatencyProbeIntervalMs, transferSignal);
    }
  };

  const [streamResults] = await Promise.all([
    Promise.all(
      Array.from({ length: plan.streamCount }, async (_unused, index) => {
        const streamId = randomStreamId(index + 1);
        let lastResult: Result<void, EngineError> = ok(undefined);
        do {
          lastResult = await transfer(streamId);
        } while (lastResult.ok && timeLeft());
        return lastResult;
      }),
    ),
    probeUnderLoad(),
  ]);
  clearTimeout(deadlineTimer);

  if (isAborted(signal)) {
    return 'aborted';
  }

  const outcome = computeThroughputResult(samples, phase, {
    ...config.throughputWindowing,
    statistic: config.throughputStatistic,
  });

  if (outcome.ok) {
    return { throughput: { status: 'complete', data: outcome.value }, loadedLatencySamples };
  }

  const hardFailure = streamResults.find(
    (streamResult) =>
      !streamResult.ok &&
      streamResult.error.code !== 'INSUFFICIENT_SAMPLES' &&
      // Cutting off in-flight streams is how the phase *ends* now, so the
      // abort every stream reports at the deadline is the expected exit,
      // not a failure. A real user abort never reaches here — `isAborted`
      // above returns 'aborted' first.
      streamResult.error.code !== 'ABORTED_BY_USER',
  );
  return {
    throughput: {
      status: 'failed',
      error: hardFailure && !hardFailure.ok ? hardFailure.error : outcome.error,
    },
    loadedLatencySamples,
  };
}
