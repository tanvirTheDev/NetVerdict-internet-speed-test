# Accuracy verification

NetVerdict's entire value proposition depends on its numbers being real
(§0, §5.7 of the build brief). This document is a repeatable procedure,
not a one-off claim — re-run it whenever `packages/engine` or the render
path (§8.1) changes, and commit the refreshed results table below. **An
engine change without a refreshed table here does not ship** (§11).

## Procedure

1. Fixed known link, wired where possible, no competing traffic.
2. n ≥ 5 interleaved runs: NetVerdict vs. speedtest.net vs. Cloudflare's
   own speed test (and `iperf3` where a reference server is available).
3. Record the median and spread per tool; NetVerdict's result must land
   within a documented margin of the reference median.
4. Repeat on: a gigabit line, a ~40 Mbps line, and a throttled/mobile
   link.
5. Repeat with the hero visuals (§8) **on** and **off** — a delta between
   the two indicates main-thread contamination of the measurement
   timing (§8.1) and blocks the merge until fixed.

### Running our side

```bash
npm run accuracy --workspace=packages/engine          # 5 runs, 300s cooldown
npm run accuracy --workspace=packages/engine -- --runs=8 --cooldown=600
```

`packages/engine/bin/accuracy-run.ts` performs step 2's NetVerdict half
and step 3's arithmetic, printing each run plus the median and spread of
every metric. Two things it deliberately handles rather than leaving to
whoever runs it:

- **Rate limiting.** Cloudflare answers 429 to a client testing
  repeatedly, and a throttled run measures nothing. Each run blocks until
  the endpoint actually answers again instead of pacing by a guessed
  sleep, so a comparison is never quietly built on throttled numbers.
  Note that throttling tracks recent _bytes_, not request count, so the
  readiness check is necessary but not sufficient — at 90s spacing, runs
  2 and 3 of a 5-run series both had their download phase refused while
  the cheap check passed. Hence the 300s default.
- **Honest gaps.** A phase that failed is recorded as a gap with its
  error code, never dropped from the series — a median taken only over
  the runs that happened to succeed is a flattering median.

The reference tools are browser-only and cannot be driven from here. Run
speedtest.net by hand, once between each NetVerdict run — that is what
"interleaved" means in step 2, and it matters because link conditions
drift over the minutes a full comparison takes.

### Interpreting the comparison

NetVerdict measures to Cloudflare's nearest edge; speedtest.net usually
picks a server **inside your ISP's network**. That is a genuinely shorter
path, so a gap in the reference's favour is expected and is not by itself
an accuracy defect — see the server section of `methodology.md`. What the
comparison is really checking is that our figure tracks the reference
_proportionally_ across runs and does not drift, collapse, or exceed it.

## Results log

| Date       | Engine version | Link                               | NetVerdict (median)                              | Reference (median) | Delta   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | -------------- | ---------------------------------- | ------------------------------------------------ | ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-22 | 0.1.0          | Dev sandbox (unmeasured host link) | 19.6↓ / 12.0↑ Mbps, 31.5ms idle latency, 0% loss | _(not yet run)_    | _(n/a)_ | **Smoke test, not a real comparison.** First live run of `npm run measure --workspace=packages/engine` against production Cloudflare endpoints. Confirms the full pipeline — real transfer, warm-up discard, windowing, adaptive sizing (5 down-streams / 4 up-streams chosen from the quick probe), idle-latency probing — produces plausible, non-fabricated numbers end to end. **Does not** satisfy the procedure above: no speedtest.net/Cloudflare-web reference run alongside it, no known link speed, no repeated trials. Superseded by a real comparison run before Phase 1 is considered done. |
