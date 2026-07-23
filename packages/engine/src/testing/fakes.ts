import {
  asEpochMs,
  asMilliseconds,
  ok,
  type EngineError,
  type EpochMs,
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
}

export interface FakeTransferScript {
  /** Consumed in order, one per `probeLatency()` call; cycles once exhausted. */
  latencyRttsMs: readonly number[];
  /** Replayed verbatim (with `streamId` substituted) for every `download()` call. */
  downloadSamplesPerStream: readonly Omit<TransferSample, 'streamId'>[];
  /** Replayed verbatim (with `streamId` substituted) for every `upload()` call. */
  uploadSamplesPerStream: readonly Omit<TransferSample, 'streamId'>[];
}

/**
 * A scripted `TransferProvider` — deterministic, no network, no timers
 * (§2.8). Orchestrator tests assert against exactly the samples they
 * scripted, not whatever a real endpoint happened to return.
 */
export class FakeTransferProvider implements TransferProvider {
  readonly endpoint = 'fake://test';
  private latencyCallIndex = 0;

  constructor(private readonly script: FakeTransferScript) {}

  probeLatency(): Promise<Result<LatencyProbeResult, EngineError>> {
    const rttMs =
      this.script.latencyRttsMs[this.latencyCallIndex % this.script.latencyRttsMs.length] ?? 0;
    this.latencyCallIndex += 1;
    return Promise.resolve(ok({ rttMs: asMilliseconds(rttMs), timedOut: false }));
  }

  download(params: TransferStreamParams): Promise<Result<void, EngineError>> {
    for (const sample of this.script.downloadSamplesPerStream) {
      params.onSample({ ...sample, streamId: params.streamId });
    }
    return Promise.resolve(ok(undefined));
  }

  upload(params: TransferStreamParams): Promise<Result<void, EngineError>> {
    for (const sample of this.script.uploadSamplesPerStream) {
      params.onSample({ ...sample, streamId: params.streamId });
    }
    return Promise.resolve(ok(undefined));
  }
}
