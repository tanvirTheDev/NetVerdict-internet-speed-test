#!/usr/bin/env node
/**
 * The scripted half of `docs/accuracy.md` (§11): runs NetVerdict n times
 * against the real endpoints and prints the per-run figures plus the
 * median and spread of each metric, ready to paste into the results log.
 *
 * The reference tools (speedtest.net, Cloudflare's own web test) are
 * browser-only and cannot be driven from here — run them interleaved by
 * hand, one between each NetVerdict run, which is what "interleaved" in
 * the procedure means. This script's job is to make our side of the
 * comparison repeatable and free of hand-copied numbers.
 *
 * Cloudflare rate-limits a client that tests repeatedly (HTTP 429), and a
 * throttled run measures nothing. Rather than pace by a guessed sleep,
 * each run waits until the endpoint actually answers again.
 *
 * Usage: npx tsx packages/engine/bin/accuracy-run.ts [--runs=5] [--cooldown=60]
 */
import { SystemClock } from '../src/clock';
import { CloudflareTransferProvider } from '../src/transfer-provider';
import { DEFAULT_ORCHESTRATOR_CONFIG, runMeasurement } from '../src/orchestrator';
import { ENGINE_VERSION } from '../src/version';
import { median } from '../src/percentiles';
import type { TestResult } from '@netverdict/contracts';

function arg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? Number(raw.split('=')[1]) : fallback;
}

const RUNS = arg('runs', 5);
/**
 * Cloudflare's throttling is driven by how much you have recently
 * transferred, not by request count, so it bites a *full* run long
 * before it refuses a small one. Measured: at 90s spacing, runs 2 and 3
 * of a 5-run series both had their download phase rate-limited to zero
 * while the cheap readiness check below sailed through. Five minutes is
 * what actually clears it for a full 8s × N-stream phase.
 */
const COOLDOWN_SECONDS = arg('cooldown', 300);
const ENDPOINT = 'https://speed.cloudflare.com';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until the endpoint stops answering 429. Necessary but not
 * sufficient: this asks for 1 KB, and passing it does not prove a full
 * phase will be served — that is what the cooldown above is for. It is
 * kept because it cheaply catches the case where we are still plainly
 * throttled, rather than burning a whole run to find out.
 */
async function waitUntilNotRateLimited(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${ENDPOINT}/__down?bytes=1000`, { cache: 'no-store' });
      await response.body?.cancel();
      if (response.ok) return;
      process.stdout.write(`    endpoint returned ${String(response.status)}, waiting…\n`);
    } catch {
      process.stdout.write('    endpoint unreachable, waiting…\n');
    }
    await sleep(30_000);
  }
  throw new Error('Endpoint stayed rate-limited for 30 minutes; aborting.');
}

interface RunRow {
  // Explicitly `| undefined` rather than `?`: under
  // `exactOptionalPropertyTypes`, a phase that reported no figure must be
  // recorded as an absent measurement, not an absent key.
  downMbps: number | undefined;
  upMbps: number | undefined;
  idleMs: number | undefined;
  loadedDownMs: number | undefined;
  loadedUpMs: number | undefined;
  gradeDown: string;
  gradeUp: string;
  partial: boolean;
  note: string;
}

function toRow(result: TestResult): RunRow {
  const thr = (p: TestResult['download']) => (p.status === 'complete' ? p.data.mbps : undefined);
  const lat = (p: TestResult['idleLatency']) =>
    p.status === 'complete' ? p.data.medianMs : undefined;
  const why = (p: TestResult['download'] | TestResult['idleLatency']) =>
    p.status === 'failed' ? p.error.code : p.status === 'unavailable' ? 'unavailable' : '';
  return {
    downMbps: thr(result.download),
    upMbps: thr(result.upload),
    idleMs: lat(result.idleLatency),
    loadedDownMs: lat(result.loadedLatencyDown),
    loadedUpMs: lat(result.loadedLatencyUp),
    gradeDown: result.bufferbloatGradeDown,
    gradeUp: result.bufferbloatGradeUp,
    partial: result.isPartial,
    note: [why(result.download), why(result.upload)].filter(Boolean).join(' '),
  };
}

function summarise(label: string, values: (number | undefined)[], unit: string): string {
  const present = values.filter((v): v is number => v !== undefined);
  if (present.length === 0) return `  ${label.padEnd(16)} no successful runs`;
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  return (
    `  ${label.padEnd(16)} median ${median(present).toFixed(1)}${unit}` +
    `   spread ${lo.toFixed(1)}–${hi.toFixed(1)}${unit}   n=${String(present.length)}/${String(values.length)}`
  );
}

async function main(): Promise<void> {
  const clock = new SystemClock();
  const provider = new CloudflareTransferProvider(ENDPOINT);
  const rows: RunRow[] = [];
  let server: TestResult['conditions']['server'];

  process.stdout.write(
    `NetVerdict accuracy run — engine ${ENGINE_VERSION}, ${String(RUNS)} runs, ` +
      `${String(COOLDOWN_SECONDS)}s cooldown between them.\n` +
      `Run your reference tool (speedtest.net) once between each run.\n\n`,
  );

  for (let run = 1; run <= RUNS; run += 1) {
    process.stdout.write(`[run ${String(run)}/${String(RUNS)}] waiting for a clear endpoint…\n`);
    await waitUntilNotRateLimited();
    process.stdout.write(`[run ${String(run)}/${String(RUNS)}] measuring…\n`);

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
      () => {
        /* per-sample events are noise here; only the final result matters */
      },
      new AbortController().signal,
    );

    if (!result) {
      process.stdout.write('    aborted before producing a result\n');
      continue;
    }
    server ??= result.conditions.server;
    const row = toRow(result);
    rows.push(row);
    process.stdout.write(
      `    ${row.downMbps?.toFixed(1) ?? '—'}↓ / ${row.upMbps?.toFixed(1) ?? '—'}↑ Mbps  ` +
        `idle ${row.idleMs?.toFixed(1) ?? '—'}ms  ` +
        `loaded ${row.loadedDownMs?.toFixed(1) ?? '—'}↓/${row.loadedUpMs?.toFixed(1) ?? '—'}↑ms  ` +
        `bloat ${row.gradeDown}/${row.gradeUp}` +
        `${row.partial ? `  PARTIAL ${row.note}` : ''}\n`,
    );

    if (run < RUNS) await sleep(COOLDOWN_SECONDS * 1_000);
  }

  process.stdout.write(
    `\n=== Summary (engine ${ENGINE_VERSION}, POP ${server?.colo ?? '?'}) ===\n`,
  );
  process.stdout.write(
    summarise(
      'download',
      rows.map((r) => r.downMbps),
      ' Mbps',
    ) + '\n',
  );
  process.stdout.write(
    summarise(
      'upload',
      rows.map((r) => r.upMbps),
      ' Mbps',
    ) + '\n',
  );
  process.stdout.write(
    summarise(
      'idle latency',
      rows.map((r) => r.idleMs),
      'ms',
    ) + '\n',
  );
  process.stdout.write(
    summarise(
      'loaded down',
      rows.map((r) => r.loadedDownMs),
      'ms',
    ) + '\n',
  );
  process.stdout.write(
    summarise(
      'loaded up',
      rows.map((r) => r.loadedUpMs),
      'ms',
    ) + '\n',
  );
  process.stdout.write(
    `  grades           down ${rows.map((r) => r.gradeDown).join(',')} | up ${rows.map((r) => r.gradeUp).join(',')}\n`,
  );
  process.stdout.write(
    `  partial runs     ${String(rows.filter((r) => r.partial).length)}/${String(rows.length)}\n`,
  );
}

main().catch((error: unknown) => {
  console.error('Accuracy harness crashed:', error);
  process.exit(1);
});
