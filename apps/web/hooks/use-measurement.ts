'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  workerEventSchema,
  type EngineError,
  type LatencySample,
  type MeasurementPhase,
  type TestResult,
  type WorkerCommand,
  type WorkerEvent,
} from '@netverdict/contracts';

export interface ThroughputHistoryPoint {
  readonly atMs: number;
  readonly mbps: number;
  readonly phase: 'download' | 'upload';
}

export type MeasurementStatus = 'idle' | 'running' | 'completed' | 'aborted' | 'error';

export interface MeasurementViewState {
  readonly status: MeasurementStatus;
  readonly phase: MeasurementPhase | null;
  readonly instantaneousMbps: number | null;
  readonly throughputPhase: 'download' | 'upload' | null;
  readonly throughputHistory: readonly ThroughputHistoryPoint[];
  readonly latencySamples: readonly LatencySample[];
  readonly result: TestResult | null;
  readonly error: EngineError | null;
}

const INITIAL_STATE: MeasurementViewState = {
  status: 'idle',
  phase: null,
  instantaneousMbps: null,
  throughputPhase: null,
  throughputHistory: [],
  latencySamples: [],
  result: null,
  error: null,
};

/** Bounds the in-memory history so an unusually long run can't grow the array forever. */
const MAX_HISTORY_POINTS = 600;

/**
 * Wraps the measurement Worker for React. The important property this
 * hook enforces (§8.1): the worker can emit many events per second, but
 * `setState` is called **at most once per animation frame** — rapid
 * events accumulate into refs and are flushed together on the next
 * `requestAnimationFrame`, never per-sample. Terminal events (completed/
 * aborted/failed) flush immediately since they're rare and the run is
 * over regardless.
 */
export function useMeasurement(endpoint = 'https://speed.cloudflare.com') {
  const [state, setState] = useState<MeasurementViewState>(INITIAL_STATE);

  const workerRef = useRef<Worker | null>(null);
  const historyRef = useRef<ThroughputHistoryPoint[]>([]);
  const latencySamplesRef = useRef<LatencySample[]>([]);
  const pendingPatchRef = useRef<Partial<MeasurementViewState> | null>(null);
  const rafHandleRef = useRef<number | null>(null);

  const flushNow = useCallback((patch: Partial<MeasurementViewState>) => {
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    pendingPatchRef.current = null;
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const scheduleFlush = useCallback((patch: Partial<MeasurementViewState>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    rafHandleRef.current ??= requestAnimationFrame(() => {
      rafHandleRef.current = null;
      const toApply = pendingPatchRef.current;
      pendingPatchRef.current = null;
      if (toApply) {
        setState((prev) => ({ ...prev, ...toApply }));
      }
    });
  }, []);

  const handleEvent = useCallback(
    (event: WorkerEvent) => {
      switch (event.type) {
        case 'phase':
          scheduleFlush({ phase: event.phase, status: 'running' });
          return;
        case 'throughputSample':
          historyRef.current = [
            ...historyRef.current,
            { atMs: Date.now(), mbps: event.instantaneousMbps, phase: event.phase },
          ].slice(-MAX_HISTORY_POINTS);
          scheduleFlush({
            instantaneousMbps: event.instantaneousMbps,
            throughputPhase: event.phase,
            throughputHistory: historyRef.current,
          });
          return;
        case 'latencySample':
          latencySamplesRef.current = [...latencySamplesRef.current, event.sample];
          scheduleFlush({ latencySamples: latencySamplesRef.current });
          return;
        case 'phaseFailed':
          flushNow({ status: 'error', error: event.error });
          return;
        case 'aborted':
          flushNow({ status: 'aborted' });
          return;
        case 'completed':
          flushNow({ status: 'completed', result: event.result });
          return;
      }
    },
    [scheduleFlush, flushNow],
  );

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) {
      return workerRef.current;
    }
    const worker = new Worker(new URL('../workers/measurement.worker.ts', import.meta.url));
    worker.onmessage = (messageEvent: MessageEvent<unknown>) => {
      const parsed = workerEventSchema.safeParse(messageEvent.data);
      if (!parsed.success) {
        return; // malformed message: dropped, not a crash (§5.5)
      }
      handleEvent(parsed.data);
    };
    workerRef.current = worker;
    return worker;
  }, [handleEvent]);

  const start = useCallback(() => {
    historyRef.current = [];
    latencySamplesRef.current = [];
    flushNow({ ...INITIAL_STATE, status: 'running' });
    const worker = ensureWorker();
    const command: WorkerCommand = { type: 'start', endpoint, runBufferbloat: true };
    worker.postMessage(command);
  }, [ensureWorker, endpoint, flushNow]);

  const stop = useCallback(() => {
    const command: WorkerCommand = { type: 'stop' };
    workerRef.current?.postMessage(command);
  }, []);

  useEffect(
    () => () => {
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
      }
      workerRef.current?.terminate();
    },
    [],
  );

  return { state, start, stop };
}
