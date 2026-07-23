import { describe, expect, it } from 'vitest';
import type { TestResult } from '@netverdict/contracts';
import { translateToRealWorldCapabilities } from './real-world-translation';

function baseResult(overrides: {
  downMbps?: number;
  upMbps?: number;
  idleLatencyMs?: number;
  downStatus?: 'complete' | 'unavailable';
}): TestResult {
  const { downMbps = 50, upMbps = 20, idleLatencyMs = 20, downStatus = 'complete' } = overrides;
  return {
    conditions: {
      startedAtEpochMs: 0,
      tzOffsetMinutes: 0,
      dayBucket: 'afternoon',
      connectionType: 'wifi',
      endpoint: 'x',
      userAgentClass: 'x',
      engineVersion: '0.1.0',
      schemaVersion: 1,
      gradingProfile: 'v1',
      interferenceSuspected: false,
    },
    download:
      downStatus === 'complete'
        ? {
            status: 'complete',
            data: {
              mbps: downMbps,
              statistic: 'median',
              streamCount: 4,
              sampleCount: 20,
              warmupDiscardedMs: 1_500,
              windowMs: 250,
              totalBytesTransferred: 1_000_000,
            },
          }
        : { status: 'unavailable' },
    upload: {
      status: 'complete',
      data: {
        mbps: upMbps,
        statistic: 'median',
        streamCount: 4,
        sampleCount: 20,
        warmupDiscardedMs: 1_500,
        windowMs: 250,
        totalBytesTransferred: 1_000_000,
      },
    },
    idleLatency: {
      status: 'complete',
      data: {
        minMs: idleLatencyMs,
        medianMs: idleLatencyMs,
        jitterMs: 1,
        packetLossPct: 0,
        sampleCount: 15,
      },
    },
    loadedLatencyDown: { status: 'unavailable' },
    loadedLatencyUp: { status: 'unavailable' },
    bufferbloatGradeDown: 'unavailable',
    bufferbloatGradeUp: 'unavailable',
    rpm: {},
    isPartial: false,
    anomalyFlag: false,
  };
}

describe('translateToRealWorldCapabilities', () => {
  it('marks 4K and HD streaming supported on a fast line', () => {
    const translation = translateToRealWorldCapabilities(baseResult({ downMbps: 100 }));
    expect(translation.streaming4k.status).toBe('supported');
    expect(translation.streamingHd.status).toBe('supported');
  });

  it('marks 4K unsupported but HD supported in between the two thresholds', () => {
    const translation = translateToRealWorldCapabilities(baseResult({ downMbps: 10 }));
    expect(translation.streaming4k.status).toBe('not-supported');
    expect(translation.streamingHd.status).toBe('supported');
  });

  it('marks both unsupported on a slow line', () => {
    const translation = translateToRealWorldCapabilities(baseResult({ downMbps: 2 }));
    expect(translation.streaming4k.status).toBe('not-supported');
    expect(translation.streamingHd.status).toBe('not-supported');
  });

  it('marks video calls supported when down/up/latency all clear their thresholds', () => {
    const translation = translateToRealWorldCapabilities(
      baseResult({ downMbps: 10, upMbps: 5, idleLatencyMs: 30 }),
    );
    expect(translation.videoCalls.status).toBe('supported');
  });

  it('marks video calls unsupported when latency alone fails, even with plenty of bandwidth', () => {
    const translation = translateToRealWorldCapabilities(
      baseResult({ downMbps: 100, upMbps: 50, idleLatencyMs: 300 }),
    );
    expect(translation.videoCalls.status).toBe('not-supported');
  });

  it('reports streaming as unavailable, not a guess, when download did not complete', () => {
    const translation = translateToRealWorldCapabilities(baseResult({ downStatus: 'unavailable' }));
    expect(translation.streaming4k.status).toBe('unavailable');
    expect(translation.streamingHd.status).toBe('unavailable');
    expect(translation.videoCalls.status).toBe('unavailable');
  });

  it('always reports gaming as unavailable — idle latency must never stand in for bufferbloat', () => {
    const fast = translateToRealWorldCapabilities(
      baseResult({ downMbps: 500, upMbps: 500, idleLatencyMs: 5 }),
    );
    expect(fast.gaming.status).toBe('unavailable');
  });
});
