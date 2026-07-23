import { describe, expect, it } from 'vitest';
import type { WorkerEvent } from '@netverdict/contracts';
import {
  DEFAULT_ORCHESTRATOR_CONFIG,
  runMeasurement,
  type OrchestratorConfig,
} from './orchestrator';
import { FakeClock, FakeTransferProvider } from './testing/fakes';

// A generous, evenly spaced sample script — enough post-warmup windows for
// computeThroughputResult to succeed regardless of exactly how many
// streams planAdaptiveSizing picks (streamCount only scales how many
// times this same script gets replayed and summed, never how much any
// one call reports). Exact Mbps values are covered by throughput.test.ts
// and windowing.test.ts; this suite verifies orchestration — event
// ordering, abort handling, and how the final TestResult is assembled.
function generousSamples(): { atMs: number; bytes: number }[] {
  return Array.from({ length: 12 }, (_unused, i) => ({ atMs: 1_750 + i * 250, bytes: 100_000 }));
}

function baseConfig(): OrchestratorConfig {
  return {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    endpoint: 'fake://test',
    connectionType: 'wifi',
    userAgentClass: 'test-harness',
    tzOffsetMinutes: 0,
    engineVersion: '0.1.0-test',
  };
}

describe('runMeasurement', () => {
  it('runs idle latency, then download, then upload, and assembles a complete, non-partial result', async () => {
    const provider = new FakeTransferProvider({
      latencyRttsMs: [10, 12, 11, 9, 10, 11, 12, 10, 9, 11, 10, 12, 9, 10, 11],
      downloadSamplesPerStream: generousSamples(),
      uploadSamplesPerStream: generousSamples(),
    });
    const events: WorkerEvent[] = [];
    const result = await runMeasurement(
      baseConfig(),
      { provider, clock: new FakeClock() },
      (event) => {
        events.push(event);
      },
      new AbortController().signal,
    );

    expect(result).toBeDefined();
    if (!result) return;

    expect(result.isPartial).toBe(false);
    expect(result.download.status).toBe('complete');
    expect(result.upload.status).toBe('complete');
    expect(result.idleLatency.status).toBe('complete');

    // Phase 1 does not run loaded-latency/bufferbloat/RPM — reported unavailable, honestly (§5.7 rule 6).
    expect(result.loadedLatencyDown).toEqual({ status: 'unavailable' });
    expect(result.loadedLatencyUp).toEqual({ status: 'unavailable' });
    expect(result.bufferbloatGradeDown).toBe('unavailable');
    expect(result.bufferbloatGradeUp).toBe('unavailable');
    expect(result.rpm).toEqual({});

    expect(result.conditions.schemaVersion).toBe(1);
    expect(result.conditions.gradingProfile).toBe('v1');
    expect(result.conditions.engineVersion).toBe('0.1.0-test');
    expect(result.conditions.connectionType).toBe('wifi');

    const phaseOrder = events.filter((e) => e.type === 'phase').map((e) => e.phase);
    expect(phaseOrder).toEqual(['idle_latency', 'download', 'upload']);

    expect(events.some((e) => e.type === 'completed')).toBe(true);
    expect(events.some((e) => e.type === 'latencySample')).toBe(true);
    expect(events.some((e) => e.type === 'throughputSample')).toBe(true);
  });

  it('stops immediately and emits only "aborted" when the signal is already aborted', async () => {
    const provider = new FakeTransferProvider({
      latencyRttsMs: [10],
      downloadSamplesPerStream: generousSamples(),
      uploadSamplesPerStream: generousSamples(),
    });
    const controller = new AbortController();
    controller.abort();
    const events: WorkerEvent[] = [];

    const result = await runMeasurement(
      baseConfig(),
      { provider, clock: new FakeClock() },
      (event) => {
        events.push(event);
      },
      controller.signal,
    );

    expect(result).toBeUndefined();
    expect(events).toEqual([{ type: 'aborted' }]);
  });

  it('marks the result partial when a phase fails, without discarding the phases that succeeded', async () => {
    const provider = new FakeTransferProvider({
      latencyRttsMs: [10],
      downloadSamplesPerStream: generousSamples(),
      uploadSamplesPerStream: generousSamples(),
    });
    // Below MIN_LATENCY_SAMPLES(5) -> idle latency fails honestly, independent of download/upload.
    const config: OrchestratorConfig = { ...baseConfig(), idleLatencyProbeCount: 2 };

    const result = await runMeasurement(
      config,
      { provider, clock: new FakeClock() },
      () => {
        /* noop */
      },
      new AbortController().signal,
    );

    expect(result).toBeDefined();
    if (!result) return;
    expect(result.idleLatency.status).toBe('failed');
    expect(result.isPartial).toBe(true);
    // Download/upload are independent phases and still complete.
    expect(result.download.status).toBe('complete');
    expect(result.upload.status).toBe('complete');
  });
});
