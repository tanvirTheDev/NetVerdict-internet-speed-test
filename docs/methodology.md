# Methodology

This page is linked from every Evidence Report (§7) — it's what makes a
report defensible if you send it to an ISP. It states, precisely, how
each number is computed. No metric ships here until its algorithm is
implemented and unit-tested in `packages/engine`; this document is
updated in the same change that lands the math, not after.

## Download / upload throughput

Bytes are transferred against Cloudflare's public speed endpoints
(`speed.cloudflare.com/__down`, `/__up`). NetVerdict's own servers never
carry the payload, so the figure reflects your connection rather than our
capacity.

**Parallel streams.** A single connection under-reports a fast link (TCP
slow-start plus a single-stream ceiling), so the test opens several at
once and sums their throughput on one shared timeline. The count is
chosen from a short probe transfer: 4 streams up to ~10 Mbps, 6 up to
~50 Mbps, 8 above that.

**Warm-up discard.** The first **1,500 ms** of the transfer is discarded.
That window is dominated by TCP slow-start, and counting it would drag
the reported figure below what the link actually sustains.

**Sliding window.** Throughput is computed over consecutive **250 ms**
buckets of fixed width — bytes from every stream landing in the same
bucket are summed — never as total-bytes ÷ total-time. Bucket width is
fixed rather than derived from where samples happen to fall, because a
sample landing exactly on a boundary would otherwise produce a
near-zero-duration bucket and a spurious speed spike.

**Reported figure.** The **median** of those steady-state buckets. The
median is used so one stalled or one bursty moment does not move the
headline number. At least **3** post-warm-up buckets are required; below
that the phase reports _unavailable_ rather than a figure computed from
noise. Total transfer is capped at 300 MB.

**Transports.** Download reads the streaming response body. Upload uses
`XMLHttpRequest` in the browser — its `upload.onprogress` reports bytes
actually handed to the network stack — and a streaming request body under
Node. Both feed the identical windowing math above.

## Latency, jitter, packet loss

**Probes.** 15 sequential round trips to a zero-byte endpoint, measured
before any load is applied (idle latency). Each probe times out after 10
seconds.

- **Latency** — reported as the **median** round-trip time, alongside the
  minimum. Timed-out probes are excluded from these statistics; a probe
  that never came back has no round-trip time to average in.
- **Jitter** — the **mean absolute difference between consecutive**
  round-trip times, in time order. This measures how much the connection
  varies moment to moment, which is what disrupts calls and games; it is
  not the standard deviation about a mean.
- **Packet loss** — timed-out probes ÷ total probes.

If every probe times out, latency is reported as _unavailable_ with 100%
loss, never as `0 ms`.

## Bufferbloat grade

_Documented once Phase 3 lands grading: how loaded vs. unloaded latency
increase maps to A+–F, and why download and upload are graded separately
(§5.4). Thresholds are versioned (`gradingProfile`) so a change to this
section never silently reinterprets historical results (§4)._

## RPM (Round-trips Per Minute)

_Documented once Phase 3 lands the IETF Responsiveness-under-load
implementation (§5.4)._

## What "partial" and "flagged" mean

A result marked partial means one phase of the test failed honestly —
never that a missing number was filled in with an estimate. A result
flagged as an anomaly is kept and shown, not deleted, because you have a
right to see everything you asked to be measured (§5.7).
