import { describe, expect, it } from 'vitest';
import type { BufferbloatGrade, TestResult } from '@netverdict/contracts';
import { translateToRealWorldCapabilities } from './real-world-translation';

function baseResult(overrides: {
  downMbps?: number;
  upMbps?: number;
  idleLatencyMs?: number;
  downStatus?: 'complete' | 'unavailable';
  gradeDown?: BufferbloatGrade | 'unavailable';
  gradeUp?: BufferbloatGrade | 'unavailable';
}): TestResult {
  const {
    downMbps = 50,
    upMbps = 20,
    idleLatencyMs = 20,
    downStatus = 'complete',
    gradeDown = 'unavailable',
    gradeUp = 'unavailable',
  } = overrides;
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
    bufferbloatGradeDown: gradeDown,
    bufferbloatGradeUp: gradeUp,
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

  it('reports gaming unavailable without a bufferbloat grade — idle latency must never stand in for it', () => {
    const fast = translateToRealWorldCapabilities(
      baseResult({ downMbps: 500, upMbps: 500, idleLatencyMs: 5 }),
    );
    expect(fast.gaming.status).toBe('unavailable');
  });

  it('marks gaming supported when the link holds its latency under load', () => {
    const translation = translateToRealWorldCapabilities(
      baseResult({ gradeDown: 'A', gradeUp: 'A+' }),
    );
    expect(translation.gaming.status).toBe('supported');
  });

  it('marks gaming unsupported on a bloated link, however fast it is', () => {
    const translation = translateToRealWorldCapabilities(
      baseResult({ downMbps: 900, upMbps: 900, idleLatencyMs: 3, gradeDown: 'A+', gradeUp: 'F' }),
    );
    expect(translation.gaming.status).toBe('not-supported');
  });

  it('judges gaming by the worse direction — upload bloat ruins a game just as thoroughly', () => {
    const translation = translateToRealWorldCapabilities(
      baseResult({ gradeDown: 'A+', gradeUp: 'D' }),
    );
    expect(translation.gaming.status).toBe('not-supported');
  });
});
