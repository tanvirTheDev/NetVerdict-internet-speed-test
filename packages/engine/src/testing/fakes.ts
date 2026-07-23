import {
  asEpochMs,
  asMilliseconds,
  ok,
  type EngineError,
  type EpochMs,
  type MeasurementServer,
  type Result,
  type TransferSample,
} from '@netverdict/contracts';
import type { Clock } from '../clock';
import type {
  LatencyProbeResult,
  TransferProvider,
  TransferStreamParams,
} from '../transfer-provider';

/**
 * Manually-advanced clock (§2.8) — every orchestrator test runs on fake
 * time, so timing assertions are exact and no test ever calls `sleep`.
 */
export class FakeClock implements Clock {
  private currentMs: EpochMs;

  constructor(startMs = 0) {
    this.currentMs = asEpochMs(startMs);
  }

  now(): EpochMs {
    return this.currentMs;
  }

  advance(byMs: number): void {
    this.currentMs = asEpochMs(this.currentMs + byMs);
  }

  /** Jumps the clock instead of waiting — fake time is the point (§2.8: no test calls `sleep`). */
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal?.aborted) {
      this.advance(ms);
    }
    return Promise.resolve();
  }
}

export interface FakeTransferScript {
  /** Consumed in order, one per `probeLatency()` call; cycles once exhausted. */
  latencyRttsMs: readonly number[];
  /** Replayed (with `streamId` substituted) for every `download()` call. `atMs` is an offset from when that call started. */
  downloadSamplesPerStream: readonly Omit<TransferSample, 'streamId'>[];
  /** Replayed (with `streamId` substituted) for every `upload()` call. `atMs` is an offset from when that call started. */
  uploadSamplesPerStream: readonly Omit<TransferSample, 'streamId'>[];
  /** Omit to model an endpoint that does not report which POP served the run. */
  server?: MeasurementServer;
}

/**
 * A scripted `TransferProvider` — deterministic, no network, no timers
 * (§2.8). Orchestrator tests assert against exactly the samples they
 * scripted, not whatever a real endpoint happened to return.
 */
export class FakeTransferProvider implements TransferProvider {
  readonly endpoint = 'fake://test';
  readonly downloadByteTargets: number[] = [];
  /** One entry per `download()` call — a stream appearing twice means the phase re-issued on it. */
  readonly downloadStreamIds: string[] = [];
  private latencyCallIndex = 0;

  constructor(private readonly script: FakeTransferScript) {}

  describeServer(): Promise<MeasurementServer | undefined> {
    return Promise.resolve(this.script.server);
  }

  probeLatency(): Promise<Result<LatencyProbeResult, EngineError>> {
    const rttMs =
      this.script.latencyRttsMs[this.latencyCallIndex % this.script.latencyRttsMs.length] ?? 0;
    this.latencyCallIndex += 1;
    return Promise.resolve(ok({ rttMs: asMilliseconds(rttMs), timedOut: false }));
  }

  download(params: TransferStreamParams): Promise<Result<void, EngineError>> {
    this.downloadByteTargets.push(params.byteTarget);
    this.downloadStreamIds.push(params.streamId);
    return Promise.resolve(this.replay(this.script.downloadSamplesPerStream, params));
  }

  upload(params: TransferStreamParams): Promise<Result<void, EngineError>> {
    return Promise.resolve(this.replay(this.script.uploadSamplesPerStream, params));
  }

  /**
   * Replays a script and advances the clock past it, because a transfer
   * that consumed no time is not a transfer. The orchestrator ends a
   * throughput phase on a deadline and re-issues requests on streams that
   * finish early — against a provider that never moves the clock, that
   * loop would never reach its deadline and the test would hang. Sample
   * timestamps are offsets from when this call began, so a re-issued
   * request lands *after* the one before it rather than replaying the
   * same instants.
   */
  private replay(
    script: readonly Omit<TransferSample, 'streamId'>[],
    params: TransferStreamParams,
  ): Result<void, EngineError> {
    if (script.length === 0) {
      return ok(undefined);
    }
    const startedAtMs = params.clock.now() - params.testStartMs;
    for (const sample of script) {
      params.onSample({
        atMs: startedAtMs + sample.atMs,
        bytes: sample.bytes,
        streamId: params.streamId,
      });
    }
    const scriptSpanMs = Math.max(...script.map((sample) => sample.atMs));
    if (params.clock instanceof FakeClock) {
      params.clock.advance(scriptSpanMs);
    }
    return ok(undefined);
  }
}
