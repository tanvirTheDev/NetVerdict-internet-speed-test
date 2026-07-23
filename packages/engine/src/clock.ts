import { asEpochMs, type EpochMs } from '@netverdict/contracts';

/**
 * Injected time source (§2.2 ports & adapters) — every phase in the
 * orchestrator reads time through this, never `Date.now()` or
 * `performance.now()` directly, so tests can run with a fake clock and
 * assert exact timing with zero `sleep` calls (§2.8).
 */
export interface Clock {
  now(): EpochMs;
}

export class SystemClock implements Clock {
  now(): EpochMs {
    return asEpochMs(Date.now());
  }
}
