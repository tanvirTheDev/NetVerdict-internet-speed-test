#!/usr/bin/env node
/**
 * Node CLI harness (Phase 1 deliverable, §5.6 headless parity): runs the
 * exact same engine that will run in a browser Worker, against the real
 * Cloudflare endpoints, and prints the result. This is what
 * `docs/accuracy.md`'s comparison procedure runs alongside speedtest.net
 * to check our numbers land within a reasonable margin of a reference
 * tool — a manual/scripted procedure, not something CI does (§2.8: no
 * live network in CI).
 *
 * Usage: npm run measure --workspace=packages/engine
 */
import { SystemClock } from '../src/clock';
import { CloudflareTransferProvider } from '../src/transfer-provider';
import { DEFAULT_ORCHESTRATOR_CONFIG, runMeasurement } from '../src/orchestrator';
import { ENGINE_VERSION } from '../src/version';
import type { WorkerEvent } from '@netverdict/contracts';

function formatEvent(event: WorkerEvent): string {
  switch (event.type) {
    case 'phase':
      return `[phase] ${event.phase}`;
    case 'throughputSample':
      return `[${event.phase}] ${event.instantaneousMbps.toFixed(1)} Mbps (progress ${(event.progress * 100).toFixed(0)}%)`;
    case 'latencySample':
      return `[latency] ${event.sample.timedOut ? 'timeout' : `${event.sample.rttMs.toFixed(1)}ms`}`;
    case 'phaseFailed':
      return `[failed] ${event.error.code}: ${event.error.message}`;
    case 'aborted':
      return '[aborted]';
    case 'completed':
      return '[completed]';
  }
}

async function main(): Promise<void> {
  const clock = new SystemClock();
  const provider = new CloudflareTransferProvider();
  const controller = new AbortController();

  let lastThroughputLogMs = 0;
  const onEvent = (event: WorkerEvent): void => {
    if (event.type === 'throughputSample') {
      const now = Date.now();
      if (now - lastThroughputLogMs < 500) return;
      lastThroughputLogMs = now;
    }
    console.log(formatEvent(event));
  };

  const result = await runMeasurement(
    {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      endpoint: provider.endpoint,
      connectionType: 'unknown',
      userAgentClass: `node/${process.version}`,
      tzOffsetMinutes: new Date().getTimezoneOffset(),
      engineVersion: ENGINE_VERSION,
    },
    { provider, clock },
    onEvent,
    controller.signal,
  );

  if (!result) {
    console.error('Measurement aborted before completion.');
    process.exit(1);
  }

  console.log('\n--- Result -----------------------------------');
  console.log(JSON.stringify(result, null, 2));

  if (result.isPartial) {
    console.warn('\nResult is PARTIAL — at least one phase did not complete cleanly.');
  }
}

main().catch((error: unknown) => {
  console.error('Harness crashed:', error);
  process.exit(1);
});
