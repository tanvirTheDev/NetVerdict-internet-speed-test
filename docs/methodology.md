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

**Which server, and why the number differs from other tools.** The
endpoint is anycast: the network routes you to Cloudflare's nearest POP,
and there is no POP to choose between. Every result records the one that
served it (an IATA-style code such as `DAC`, plus its country).

This is the single largest reason a NetVerdict figure can sit below a
reference tool's. Tools that pick a server _inside your ISP's own
network_ measure traffic that never crosses your provider's transit or
peering links — a shorter and cheaper path, and one your ISP fully
controls. Measured from one Dhaka connection: 30 ms and ~29 Mbps to
Cloudflare's Dhaka POP, against 6 ms and ~57 Mbps to an in-ISP server.
Neither number is wrong; they answer different questions. NetVerdict
deliberately measures the path your traffic actually takes to reach the
wider internet, because that is the path a streaming service, a game
server, or a video call sits at the far end of — and because a figure
taken inside the ISP's own network is the one an ISP will quote back to
you when you complain.

**Parallel streams.** A single connection under-reports a fast link (TCP
slow-start plus a single-stream ceiling), so the test opens several at
once and sums their throughput on one shared timeline. The count is
chosen from a short probe transfer: 4 streams up to ~10 Mbps, 6 up to
~50 Mbps, 8 above that.

That figure is then capped by what the browser will actually run
concurrently. Browsers allow **6 connections per origin** over HTTP/1.1,
and `speed.cloudflare.com` negotiates HTTP/1.1 — asking for 8 does not
open 8, it opens 6 and queues the rest, which would report a stream count
the test never achieved. When bufferbloat is being measured the cap drops
to **5**, because the loaded-latency probe needs a connection of its own;
see the bufferbloat section for what happens when it does not get one.

**Phase duration.** Each phase runs for a fixed **8 seconds** of wall
clock, or until the 300 MB cap, whichever comes first — it does not stop
when some byte target is met. A byte target has to be guessed from that
same short probe, and a probe that reads low ends the phase seconds early
with the transfer still inside slow-start, so the reported figure becomes
the ramp rather than the link. The probe therefore only chooses how many
streams to open and how large each request is; neither can shorten the
measurement. A stream that finishes its request with time still on the
clock opens another.

**Warm-up discard.** The first **1,500 ms** of each transfer is
discarded, measured from that transfer's own first byte — not from the
start of the test. That window is dominated by TCP slow-start, and
counting it would drag the reported figure below what the link actually
sustains. Because upload begins several seconds into a run, timing the
discard from the start of the test would exempt upload from it entirely.

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

**Rate limiting.** Cloudflare throttles a client that tests repeatedly,
answering HTTP 429. That is reported as its own condition rather than as
a phase that produced no speed, because a throttled run says nothing
about your connection.

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

Bufferbloat is what makes a call stutter the moment someone else starts a
download, on a connection whose speed test looks fine. It is oversized
buffers in the network filling up under load and delaying every packet
behind them — so it is invisible to any measurement taken on an idle
link.

**Loaded-latency probes.** While the download phase is saturating the
link, a round-trip probe is fired every **250 ms**. The upload phase is
probed the same way, separately. Probes stop the instant the transfer
does — a probe answered after the load ended would describe an idle
connection and flatter the grade.

**The probe needs its own connection.** It is an ordinary request to the
same origin, so it competes for the browser's 6-connection budget with
the transfer streams. Fill all six and the probe never gets a slot:
measured in Chrome against this endpoint, a probe issued behind 7 streams
took **45,441 ms** and returned only when the phase deadline killed it,
against **258 ms** with one connection kept free — while the link was
moving ~29 Mbps in both cases. This is why the stream count is capped at
5 whenever bufferbloat is measured. Left unhandled it does not produce a
wrong grade so much as no grade at all: every probe outlives the phase,
and the run reports _unavailable_.

**Warm-up.** Probes inside the transfer's first 1,500 ms are discarded,
matching the throughput warm-up. During slow-start the link is not yet
saturated, so those round trips describe a half-loaded connection and
would understate the queueing delay.

**No load, no grade.** If the transfer those probes rode along with did
not complete — a rate-limited endpoint, a dropped connection — the
loaded latency and its grade report _unavailable_ for that direction.
The probes are only meaningful because something was saturating the link
while they ran; without that they describe an idle line and would score a
suspiciously perfect grade. Each direction is gated independently, so a
failed download does not discard a good upload grade.

**The grade is the _increase_, not the raw figure.** A connection to a
distant server has high latency without being bufferbloated; grading the
raw loaded figure would confuse distance with queueing. The graded
quantity is `loaded median − idle median`. With no idle baseline there is
no increase to compute, and the grade reports _unavailable_ rather than
falling back to the raw number.

Thresholds for profile `v1`, in milliseconds of increase over idle:

| Grade | Increase over idle |
| ----- | ------------------ |
| A+    | ≤ 5 ms             |
| A     | ≤ 30 ms            |
| B     | ≤ 60 ms            |
| C     | ≤ 200 ms           |
| D     | ≤ 400 ms           |
| F     | above 400 ms       |

**Download and upload are graded separately** (§5.4). They routinely
differ by several grades: on an asymmetric consumer connection the upload
buffer is usually the worse of the two, and upload bufferbloat is the
common cause of video-call lag — a call uploads your camera continuously.

Thresholds are versioned (`gradingProfile`), so recalibrating them can
never silently reinterpret a stored result (§4). `v1` is calibrated
against publicly documented grading conventions, not yet against our own
production data.

## RPM (Round-trips Per Minute)

**Higher = your connection stays responsive when busy.** RPM is the IETF
Responsiveness-under-load metric: how many round trips fit into a minute
at the latency measured _while the link is saturated_, i.e.
`60,000 / loaded latency in ms`.

It is reported for the idle link and for each loaded phase, so the drop
between them is visible. A connection at 10 ms idle scores 6,000 RPM; if
it climbs to 250 ms under load, that collapses to 240 — the same fact the
bufferbloat grade states as a letter.

Unlike the grade, RPM needs no idle baseline, so a run whose idle-latency
phase failed still reports loaded RPM.

## What "supports competitive gaming" is judged on

Gaming suitability is decided by the **bufferbloat grade, never by idle
latency** — a link can have excellent idle latency and be unplayable the
moment anything else in the house starts transferring. Grades A+ through
B pass; C and worse do not. The **worse of the download and upload
grades** decides, because a connection is only as playable as its weakest
direction.

## What "partial" and "flagged" mean

A result marked partial means one phase of the test failed honestly —
never that a missing number was filled in with an estimate. A result
flagged as an anomaly is kept and shown, not deleted, because you have a
right to see everything you asked to be measured (§5.7).
