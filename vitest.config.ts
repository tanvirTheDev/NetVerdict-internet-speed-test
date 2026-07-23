import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The 90% gate (§2.8) targets the pure measurement math specifically —
      // the reason the brief lists "throughput math, windowing, percentiles,
      // grading, unit conversion, day-bucketing, verdict scoring" as the
      // scope, not the whole package. Excluded here, deliberately:
      //  - clock.ts: a one-line wrapper over Date.now(), nothing to assert
      //  - transfer-provider.ts: real network I/O — CI never touches the
      //    live network (§2.8); it's proven by the CLI harness instead
      //  - orchestrator.ts: the imperative shell — tested with fakes
      //    (see orchestrator.test.ts), but its abort/error plumbing isn't
      //    coverage-gated the way the math it calls is
      //  - testing/**, index.ts: test infra and a re-export barrel
      include: ['packages/engine/src/**/*.ts'],
      exclude: [
        'packages/engine/src/index.ts',
        'packages/engine/src/clock.ts',
        'packages/engine/src/transfer-provider.ts',
        'packages/engine/src/orchestrator.ts',
        'packages/engine/src/testing/**',
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
