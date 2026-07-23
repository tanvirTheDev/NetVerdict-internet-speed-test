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

    // Idle RPM comes straight off the idle latency: 60,000 / 10ms.
    expect(result.rpm.idle).toBe(6_000);

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

  /**
   * Requests short enough that a phase fits many of them, so the fake
   * clock reaches the deadline through many small steps rather than one
   * jump — which is what leaves room for the loaded-latency probe loop to
   * interleave, exactly as it does against a real endpoint.
   */
  function shortRequests(): { atMs: number; bytes: number }[] {
    return Array.from({ length: 3 }, (_unused, i) => ({ atMs: i * 20, bytes: 100_000 }));
  }

  /** Idle probes answer fast; every probe after them is slow, modelling a link that queues under load. */
  function idleThenLoadedRtts(idleMs: number, loadedMs: number): number[] {
    return [...(Array(15).fill(idleMs) as number[]), ...(Array(400).fill(loadedMs) as number[])];
  }

  it('grades bufferbloat from the latency increase measured while the link is saturated', async () => {
    const provider = new FakeTransferProvider({
      latencyRttsMs: idleThenLoadedRtts(10, 250),
      downloadSamplesPerStream: shortRequests(),
      uploadSamplesPerStream: shortRequests(),
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

    expect(result.loadedLatencyDown.status).toBe('complete');
    expect(result.loadedLatencyUp.status).toBe('complete');

    // Idle 10ms, loaded 250ms -> a 240ms increase, which lands in the D
    // band (C is up to 200ms, D up to 400ms) of the v1 profile.
    expect(result.bufferbloatGradeDown).toBe('D');
    expect(result.bufferbloatGradeUp).toBe('D');

    // 60,000 / 250ms loaded, against 60,000 / 10ms idle.
    expect(result.rpm).toEqual({ idle: 6_000, down: 240, up: 240 });

    // Every probe is tagged with what was saturating the link when it ran,
    // so a download-phase round trip can never be graded as upload bloat.
    const tags = events
      .filter((event) => event.type === 'latencySample')
      .map((event) => event.sample.underLoad);
    expect(new Set(tags)).toEqual(new Set(['none', 'download', 'upload']));
  });

  it('reports bufferbloat unavailable — not a guess — when loaded-latency probing is switched off', async () => {
    const provider = new FakeTransferProvider({
      latencyRttsMs: idleThenLoadedRtts(10, 250),
      downloadSamplesPerStream: shortRequests(),
      uploadSamplesPerStream: shortRequests(),
    });

    const result = await runMeasurement(
      { ...baseConfig(), measureBufferbloat: false },
      { provider, clock: new FakeClock() },
      () => {
        /* noop */
      },
      new AbortController().signal,
    );

    expect(result?.loadedLatencyDown).toEqual({ status: 'unavailable' });
    expect(result?.loadedLatencyUp).toEqual({ status: 'unavailable' });
    expect(result?.bufferbloatGradeDown).toBe('unavailable');
    expect(result?.bufferbloatGradeUp).toBe('unavailable');
    // Throughput is untouched by the flag — only the grade goes away.
    expect(result?.download.status).toBe('complete');
    expect(result?.rpm.down).toBeUndefined();
    expect(result?.rpm.idle).toBe(6_000);
  });

  it('cannot grade bufferbloat without an idle baseline, even with loaded latency in hand', async () => {
    // The grade is an *increase* over idle. With no idle figure there is
    // nothing to subtract, and the raw loaded latency would grade a merely
    // distant link as bufferbloated.
    const provider = new FakeTransferProvider({
      latencyRttsMs: idleThenLoadedRtts(10, 250),
      downloadSamplesPerStream: shortRequests(),
      uploadSamplesPerStream: shortRequests(),
    });

    const result = await runMeasurement(
      // Below MIN_LATENCY_SAMPLES(5), so idle latency fails.
      { ...baseConfig(), idleLatencyProbeCount: 2 },
      { provider, clock: new FakeClock() },
      () => {
        /* noop */
      },
      new AbortController().signal,
    );

    expect(result?.idleLatency.status).toBe('failed');
    expect(result?.loadedLatencyDown.status).toBe('complete');
    expect(result?.bufferbloatGradeDown).toBe('unavailable');
    expect(result?.bufferbloatGradeUp).toBe('unavailable');
    // Loaded RPM needs no baseline, so it survives an unusable idle phase.
    expect(result?.rpm.down).toBeDefined();
    expect(result?.rpm.idle).toBeUndefined();
  });

  it('will not grade bufferbloat from probes taken while the transfer was failing', async () => {
    // Seen live: a download rate-limited to zero bytes still answered its
    // latency probes in ~28ms against a ~28ms idle baseline, which grades
    // A+ — a perfect score from a link that was never loaded. The probes
    // are only meaningful if something was actually saturating the line.
    const provider = new FakeTransferProvider({
      latencyRttsMs: idleThenLoadedRtts(10, 250),
      downloadSamplesPerStream: [], // transfer moves nothing -> no windows -> phase fails
      uploadSamplesPerStream: shortRequests(),
    });

    const result = await runMeasurement(
      baseConfig(),
      { provider, clock: new FakeClock() },
      () => {
        /* noop */
      },
      new AbortController().signal,
    );

    expect(result?.download.status).toBe('failed');
    expect(result?.loadedLatencyDown).toEqual({ status: 'unavailable' });
    expect(result?.bufferbloatGradeDown).toBe('unavailable');
    expect(result?.rpm.down).toBeUndefined();

    // The upload half ran normally and is still graded.
    expect(result?.upload.status).toBe('complete');
    expect(result?.bufferbloatGradeUp).toBe('D');
  });

  it('keeps a stream that finished its request working until the phase deadline', async () => {
    // A request that completes in 500ms against an 8s phase. Ending the
    // phase when the byte target ran out would stop 7.5s early, with the
    // transfer still inside TCP slow-start — and the median of those
    // windows is the ramp, not the link.
    const quickRequest = Array.from({ length: 3 }, (_unused, i) => ({
      atMs: i * 250,
      bytes: 100_000,
    }));
    const provider = new FakeTransferProvider({
      latencyRttsMs: [10, 12, 11, 9, 10, 11, 12, 10, 9, 11, 10, 12, 9, 10, 11],
      downloadSamplesPerStream: quickRequest,
      uploadSamplesPerStream: quickRequest,
    });

    const result = await runMeasurement(
      baseConfig(),
      { provider, clock: new FakeClock() },
      () => {
        /* noop */
      },
      new AbortController().signal,
    );

    expect(result?.download.status).toBe('complete');
    // 'stream-0' is the quick probe, which is sized and run separately.
    const sizedCalls = provider.downloadStreamIds.filter((id) => id !== 'stream-0');
    expect(sizedCalls.length).toBeGreaterThan(new Set(sizedCalls).size);
  });

  it('sizes the download from the quick probe alone, unaffected by how long idle latency took', async () => {
    // Charging the idle-latency phase to the probe's transfer time makes a
    // fast link look slow, shrinks the byte target, and ends the download
    // with too few windows to report — an `unavailable` download on a
    // healthy connection.
    async function byteTargetWithLatencyPhaseCost(msPerProbe: number): Promise<number> {
      const provider = new FakeTransferProvider({
        latencyRttsMs: [10, 12, 11, 9, 10, 11, 12, 10, 9, 11, 10, 12, 9, 10, 11],
        downloadSamplesPerStream: generousSamples(),
        uploadSamplesPerStream: generousSamples(),
      });
      const clock = new FakeClock();
      await runMeasurement(
        baseConfig(),
        { provider, clock },
        (event) => {
          if (event.type === 'latencySample') clock.advance(msPerProbe);
        },
        new AbortController().signal,
      );
      // Index 0 is the quick probe; index 1 is the first sized download stream.
      return provider.downloadByteTargets[1] ?? 0;
    }

    const instantLatencyPhase = await byteTargetWithLatencyPhaseCost(0);
    const slowLatencyPhase = await byteTargetWithLatencyPhaseCost(40);

    expect(instantLatencyPhase).toBeGreaterThan(0);
    expect(slowLatencyPhase).toBe(instantLatencyPhase);
  });
});
