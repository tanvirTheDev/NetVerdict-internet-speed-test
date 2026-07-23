import { describe, expect, it } from 'vitest';
import { engineErrorSchema } from './errors';
import { err, isErr, isOk, mapErr, mapOk, ok, unwrap } from './result';
import { latencySampleSchema, transferSampleSchema } from './samples';
import { testResultSchema } from './test-result';
import { workerCommandSchema, workerEventSchema } from './worker-messages';

describe('Result helpers', () => {
  it('ok()/err() round-trip through isOk/isErr', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isOk(err('boom'))).toBe(false);
    expect(isErr(err('boom'))).toBe(true);
  });

  it('mapOk transforms only the Ok branch', () => {
    expect(mapOk(ok(2), (n) => n * 10)).toEqual(ok(20));
    expect(mapOk(err('boom'), (n: number) => n * 10)).toEqual(err('boom'));
  });

  it('mapErr transforms only the Err branch', () => {
    expect(mapErr(err('boom'), (e) => `${e}!`)).toEqual(err('boom!'));
    expect(mapErr(ok(2), (e: string) => `${e}!`)).toEqual(ok(2));
  });

  it('unwrap returns the value on Ok and throws on Err', () => {
    expect(unwrap(ok(5))).toBe(5);
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom');
    expect(() => unwrap(err('not an Error instance'))).toThrow('not an Error instance');
  });
});

describe('engineErrorSchema', () => {
  it('accepts a well-formed error', () => {
    const parsed = engineErrorSchema.safeParse({
      code: 'TIMEOUT',
      phase: 'download',
      retriable: true,
      message: 'took too long',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown error code', () => {
    const parsed = engineErrorSchema.safeParse({
      code: 'MADE_UP_CODE',
      phase: 'download',
      retriable: true,
      message: 'x',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('transferSampleSchema / latencySampleSchema', () => {
  it('accepts the shapes the engine actually produces', () => {
    expect(
      transferSampleSchema.safeParse({ atMs: 100, bytes: 5_000, streamId: 'stream-1' }).success,
    ).toBe(true);
    expect(
      latencySampleSchema.safeParse({
        atMs: 100,
        rttMs: 12.5,
        underLoad: 'download',
        timedOut: false,
      }).success,
    ).toBe(true);
  });

  it('rejects a negative byte count — the engine must never produce one', () => {
    expect(
      transferSampleSchema.safeParse({ atMs: 100, bytes: -1, streamId: 'stream-1' }).success,
    ).toBe(false);
  });
});

describe('testResultSchema', () => {
  it('round-trips a fully complete result', () => {
    const candidate = {
      conditions: {
        startedAtEpochMs: 1_700_000_000_000,
        tzOffsetMinutes: 0,
        dayBucket: 'evening_peak',
        connectionType: 'wifi',
        endpoint: 'https://speed.cloudflare.com',
        userAgentClass: 'node/24',
        engineVersion: '0.1.0',
        schemaVersion: 1,
        gradingProfile: 'v1',
        interferenceSuspected: false,
      },
      download: {
        status: 'complete',
        data: {
          mbps: 93.4,
          statistic: 'median',
          streamCount: 6,
          sampleCount: 20,
          warmupDiscardedMs: 1_500,
          windowMs: 250,
          totalBytesTransferred: 12_000_000,
        },
      },
      upload: { status: 'unavailable' },
      idleLatency: {
        status: 'complete',
        data: { minMs: 10, medianMs: 12, jitterMs: 2, packetLossPct: 0, sampleCount: 15 },
      },
      loadedLatencyDown: { status: 'unavailable' },
      loadedLatencyUp: { status: 'unavailable' },
      bufferbloatGradeDown: 'unavailable',
      bufferbloatGradeUp: 'unavailable',
      rpm: {},
      isPartial: true,
      anomalyFlag: false,
    };

    const parsed = testResultSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
  });

  it('rejects a "complete" phase with no data — that combination should be unreachable', () => {
    const parsed = testResultSchema.safeParse({
      conditions: {
        startedAtEpochMs: 0,
        tzOffsetMinutes: 0,
        dayBucket: 'morning',
        connectionType: 'unknown',
        endpoint: 'x',
        userAgentClass: 'x',
        engineVersion: '0.1.0',
        schemaVersion: 1,
        gradingProfile: 'v1',
        interferenceSuspected: false,
      },
      download: { status: 'complete' }, // missing `data`
      upload: { status: 'unavailable' },
      idleLatency: { status: 'unavailable' },
      loadedLatencyDown: { status: 'unavailable' },
      loadedLatencyUp: { status: 'unavailable' },
      bufferbloatGradeDown: 'unavailable',
      bufferbloatGradeUp: 'unavailable',
      rpm: {},
      isPartial: false,
      anomalyFlag: false,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('worker message schemas', () => {
  it('accepts a valid start command and rejects an unknown command type', () => {
    expect(
      workerCommandSchema.safeParse({ type: 'start', endpoint: 'x', runBufferbloat: false })
        .success,
    ).toBe(true);
    expect(workerCommandSchema.safeParse({ type: 'pause' }).success).toBe(false);
  });

  it('accepts every documented worker event shape', () => {
    expect(workerEventSchema.safeParse({ type: 'phase', phase: 'download' }).success).toBe(true);
    expect(
      workerEventSchema.safeParse({
        type: 'throughputSample',
        phase: 'download',
        instantaneousMbps: 12,
        progress: 0.5,
      }).success,
    ).toBe(true);
    expect(workerEventSchema.safeParse({ type: 'aborted' }).success).toBe(true);
  });
});
