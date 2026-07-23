import { asEpochMs, type EpochMs } from '@netverdict/contracts';

/**
 * Injected time source (§2.2 ports & adapters) — every phase in the
 * orchestrator reads time through this, never `Date.now()` or
 * `performance.now()` directly, so tests can run with a fake clock and
 * assert exact timing with zero `sleep` calls (§2.8).
 */
export interface Clock {
  now(): EpochMs;
  /**
   * Resolves after `ms`, or as soon as `signal` aborts.
   *
   * Waiting goes through the port for the same reason reading the time
   * does: loaded-latency probing paces itself between round trips, and a
   * raw `setTimeout` there would make every test of it wait in real
   * seconds — or, under a fake clock that jumps ahead, never run at all.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export class SystemClock implements Clock {
  now(): EpochMs {
    return asEpochMs(Date.now());
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort(): void {
        clearTimeout(timer);
        resolve();
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
