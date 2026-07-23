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

## Results log

| Date       | Engine version | Link                               | NetVerdict (median)                              | Reference (median) | Delta   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | -------------- | ---------------------------------- | ------------------------------------------------ | ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-22 | 0.1.0          | Dev sandbox (unmeasured host link) | 19.6↓ / 12.0↑ Mbps, 31.5ms idle latency, 0% loss | _(not yet run)_    | _(n/a)_ | **Smoke test, not a real comparison.** First live run of `npm run measure --workspace=packages/engine` against production Cloudflare endpoints. Confirms the full pipeline — real transfer, warm-up discard, windowing, adaptive sizing (5 down-streams / 4 up-streams chosen from the quick probe), idle-latency probing — produces plausible, non-fabricated numbers end to end. **Does not** satisfy the procedure above: no speedtest.net/Cloudflare-web reference run alongside it, no known link speed, no repeated trials. Superseded by a real comparison run before Phase 1 is considered done. |
