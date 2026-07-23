# Claude Code Build Prompt — "NetVerdict" Internet Quality & ISP Accountability Platform

> Paste this whole file into Claude Code (Opus) as the project brief. Build in the phases defined at the bottom. Do not skip the Measurement Integrity rules — they are the difference between a real tool and a fake gauge.

---

## 0. Your role & the quality bar

You are a senior full-stack engineer building a **production SaaS** that will be used by thousands of real users. Optimize for **measurement accuracy, honesty, scalability, and low server bandwidth cost**. No placeholder logic, no faked numbers, no "TODO" measurement code. Every metric shown to a user must come from a real transfer that actually happened. If you cannot measure something reliably, show "unavailable" — never invent a value.

Write clean, typed, modular, testable code. Assume the maintainer is experienced — skip hand-holding comments, but document the measurement math and any non-obvious concurrency decisions.

---

## 1. The core idea (why this is different)

Every speed test on the market answers one question: _"How fast is my internet right now?"_ — two numbers and a spinning gauge.

**This tool answers a better question: "Is my ISP consistently delivering what I pay for?"**

That reframe is the entire product. It is an **accountability platform**, not a one-shot meter. The differentiators all flow from it:

1. **Plan Guardian** — user enters ISP name, plan name, advertised down/up speed, and monthly price. Every test is scored against the promise, producing a rolling **"Promise Delivered %"** and a plain-language verdict ("You are getting ~62% of your advertised 40 Mbps on average").
2. **Peak-hour intelligence** — results are auto-bucketed by time-of-day (esp. evening peak 7pm–12am, the window where many ISPs throttle). Surface _"Your speed drops 45% during evening peak"_ — this is the insight users actually want and no consumer tool shows it.
3. **Bufferbloat + Responsiveness (RPM)** — measure **loaded vs. unloaded latency**, jitter, and packet loss, and grade bufferbloat A+→F. These predict real experience (video calls, gaming) far better than raw Mbps, and most tools omit them entirely.
4. **Real-world translation** — convert raw numbers into: _"Right now this supports 4K streaming ✓, 3 simultaneous video calls ✓, competitive gaming ✗ (high loaded latency)."_
5. **Evidence Report** — one click generates a timestamped, shareable public report (unique URL) + PDF export the user can send to their ISP as a data-backed complaint.
6. **Scheduled/background testing** — build an honest longitudinal dataset automatically instead of relying on a single lucky/unlucky manual test.

Working name: **NetVerdict** (swap freely). Tagline: _"Don't guess. Get the verdict on your connection."_

---

## 2. Tech stack (non-negotiable unless I say otherwise)

- **Next.js 15** (App Router, Server Components where sensible), **TypeScript** (strict).
- **Tailwind CSS** + a small headless component layer (Radix or shadcn/ui). No heavy UI kits.
- **PostgreSQL + TimescaleDB extension** (the time-series `tests` data _is_ the product; enable the hypertable early so history/peak-hour queries stay fast as data grows) + **Drizzle ORM** (typed schema, migrations checked in).
- **Redis** — rate limiting, cached aggregations (peak-hour %, promise-delivered %), and pub/sub for any live feature. Also the queue backend.
- **BullMQ** (on Redis) or systemd timers for the headless 24/7 monitor jobs.
- **Web Workers** for the measurement engine (mandatory — see §3).
- **Framer Motion** for UI chrome/choreography + **react-three-fiber / raw WebGL shaders** for the hero data-visualizations (see §5.5). These are two different tools for two different jobs — do not use Framer Motion for particle fields.
- **Recharts** or **visx** for time-series/history charts.
- **Auth**: Auth.js (email + Google). Anonymous testing allowed; history requires an account.
- **Deploy target**: single VPS (Hostinger KVM) behind Nginx, Dockerized. Also runnable on Vercel for the app layer.
- **i18n**: English + Bangla (`bn`) from day one — copy in a dictionary, not hardcoded. RTL not required.

### 2.1 Transport decisions — read this before adding sockets

- **Core measurement is HTTP** (fetch/XHR against Cloudflare edge) + `postMessage` between worker and UI. **Do NOT put WebSocket in the measurement path** — it adds complexity with zero accuracy gain. Waveform uses WebSockets only because they host their own servers; we offload transfer to Cloudflare's HTTP infra, so XHR is correct.
- **WebSocket / SSE**: add **only** for optional _live/social_ features (real-time BD network-status map, live ISP leaderboards, dashboards that update as tests stream in). Prefer **SSE** for one-way live updates; reach for WebSocket only if you need bidirectional. Not part of v1.
- **WebRTC data channel (advanced, high-value)**: the one transport that genuinely sharpens _measurement_. See §3.7.

---

## 3. The measurement engine (this is the hard part — get it right)

Build this as a standalone, framework-agnostic TypeScript module (`/lib/engine/`) that runs **inside a Web Worker**, so the UI thread never blocks and the measurement isn't corrupted by render jank. The React layer only sends `start/stop` messages and receives streamed progress events.

### 3.1 Data transfer strategy (critical for cost & accuracy)

**Do the actual byte transfer against Cloudflare's public speed endpoints, not our VPS.** This offloads the bandwidth (which is the #1 cost that kills self-hosted speed tests at scale), is globally edge-distributed for accuracy, and is the same infra millions of clients use.

- Download: `GET https://speed.cloudflare.com/__down?bytes=N`
- Upload: `POST https://speed.cloudflare.com/__up` (send N bytes of random payload)
- Latency probe: small `__down?bytes=0` (or `1`) round trips, or `cdn-cgi/trace`.

Make the transfer backend **pluggable** via an interface (`TransferProvider`) so we can later add our own self-hosted LibreSpeed-style backend as an alternate/fallback server. Our VPS orchestrates, stores, and analyzes — it does **not** move the test payload by default.

### 3.2 Download / upload measurement — do it correctly

Naive single-fetch measurement massively _underreports_ fast links (TCP slow-start + single-stream ceiling). Implement it properly:

- **Parallel streams**: open 4–8 concurrent connections; aggregate throughput across all of them.
- **Warm-up discard**: ignore the first ~1.5–2s of each stream (TCP slow-start ramp). Only count the steady-state window.
- **Sliding-window throughput**: compute bytes/sec over a moving window, not total-bytes/total-time.
- **Adaptive sizing**: probe with a small chunk first; pick chunk size and stream count from the detected speed so you don't try to push 1 GB down a 2 Mbps line (or starve a gigabit line). Cap total test data with a hard ceiling.
- **Reporting**: report the stable **median/90th-percentile** of the steady-state window, not a raw average skewed by ramp-up.
- **Upload**: same windowing/discard logic; generate the payload with `crypto.getRandomValues` in chunks (never a giant in-memory buffer — stream it).

### 3.3 Latency, jitter, packet loss

- **Unloaded (idle) latency**: 10–20 sequential small round trips; report **min, median, jitter**. Jitter = mean absolute deviation (or stdev) of successive RTTs.
- **Packet loss**: fire a batch of probes with a timeout; loss % = timed-out / total.
- Keep the full RTT series (for the "consistency" chart), not just the average.

### 3.4 Bufferbloat & Responsiveness (the flagship differentiators)

This is what makes the tool credible to power users.

- **Loaded latency**: while the download saturates the link, keep probing latency every ~250–500ms. Repeat separately during upload saturation (upload bufferbloat is usually worse on asymmetric BD connections and is the real cause of video-call lag).
- **Bufferbloat grade**: derive from the _increase_ of loaded over unloaded latency. Grade A+→F. Show download and upload bufferbloat separately.
- **RPM (Round-trips Per Minute)**: implement the IETF Responsiveness-under-load metric (≈ `60000 / loaded_latency_ms` aggregated). Report `unloaded_latency`, `loaded_latency (down)`, `loaded_latency (up)`, `jitter`, and `rpm`. Explain RPM in one plain sentence in the UI ("higher = your connection stays responsive when busy").

### 3.5 Streamed progress

The worker must emit live events (`phase`, `instantaneousMbps`, `progress`, `latencySample`) so the UI can animate a live gauge + a real-time speed graph _as it happens_, not just a final number.

### 3.6 Measurement integrity rules (hard requirements)

- Never display a number the transfer didn't actually produce. No cosmetic inflation, no "smoothing up."
- If a phase fails (network drop, CORS, endpoint down), report it honestly and mark the test partial — do **not** silently fabricate.
- Record test conditions with each result: timestamp, client-reported connection type (`navigator.connection` if available), server/endpoint used, browser, and a flag if other tabs/high load may have interfered.
- Detect and flag suspicious results (e.g. a result 10× off from the user's rolling baseline) rather than storing them as clean truth.

### 3.7 WebRTC data-channel probe (optional, advanced — the accuracy edge almost no web tool ships)

HTTP-based latency/loss measurement is blind to _real_ packet loss, because TCP silently retransmits. Gaming and VoIP run on UDP, where loss and jitter actually bite. To measure what those apps experience:

- Open a **WebRTC data channel in unreliable + unordered mode** (`maxRetransmits: 0`, `ordered: false`) to a tiny self-hosted probe endpoint on our VPS. This gives UDP-style semantics in the browser.
- Send timestamped probe packets during idle **and** during download/upload saturation; measure true one-way-ish latency, jitter, and **actual packet loss** (never retransmitted → genuinely lost).
- This produces a far more honest bufferbloat/RPM story for real-time-app suitability than HTTP pings can.
- **Cost/tradeoff to flag to me:** requires hosting a small signaling + STUN/TURN-capable probe service on the VPS (bandwidth here is tiny — probe packets, not payload). Build it behind the same `TransferProvider`-style interface and make it **feature-flagged**: the tool must fully work on HTTP-only if WebRTC is unavailable or blocked by a firewall. Ship this as a later phase, not v1.

---

## 4. Data model (Drizzle)

Design at least:

- `users` — auth, locale, home ISP reference.
- `isp_plans` — `id, user_id, isp_name, plan_name, advertised_down_mbps, advertised_up_mbps, monthly_price, currency, active`.
- `tests` — one row per completed run: `id, user_id (nullable for anon), plan_id (nullable), started_at, tz_offset, day_bucket (enum: morning/afternoon/evening_peak/late_night), down_mbps, up_mbps, idle_latency_ms, loaded_latency_down_ms, loaded_latency_up_ms, jitter_ms, packet_loss_pct, bufferbloat_grade_down, bufferbloat_grade_up, rpm, endpoint, connection_type, client_meta jsonb, is_partial, anomaly_flag`.
- `reports` — shareable evidence reports: `id, public_slug, user_id, date_range, summary jsonb, created_at, expires_at`.

Index `tests` on `(user_id, started_at)` and `(plan_id, day_bucket)` — the peak-hour and history queries depend on it.

---

## 5. Features & screens

1. **Test screen** — big animated gauge, live speed graph, phase indicator (idle latency → download → upload → bufferbloat). Server selector. "Advanced metrics" panel (jitter, loss, loaded latency, RPM, bufferbloat grades). Fully responsive; usable one-handed on mobile.
2. **Result card** — down/up, latency trio, bufferbloat A–F badges, RPM, and the **real-world translation** block. "Share as evidence" + "Save to history" CTAs.
3. **Dashboard (logged in)** — Promise Delivered % gauge, trend chart over time, **peak-hour breakdown chart**, best/worst times of day, anomaly log.
4. **Plan Guardian setup** — add/edit ISP plan; the verdict engine scores every test against it.
5. **Evidence Report** — public read-only page at `/r/[slug]` + PDF export; branded, timestamped, shows methodology footnote so it's defensible to an ISP.
6. **Scheduled testing** — in-browser recurring test while the tab is open (v1), plus an optional documented headless runner (Node script + cron / systemd timer) that hits the same engine for 24/7 monitoring (v2). Store results to the same DB.
7. **Public landing** — explains bufferbloat/RPM in plain language; SEO'd; the "accountability" positioning front and center.

---

## 5.5 Visual & motion system — the "extraordinary UI" layer

The goal is a UI people screenshot and share — something that has never been done on a speed test. Framer Motion handles the _chrome_ (layout transitions, spring number roll-ups, gesture handling, phase choreography). The _hero moments_ below need **Canvas/WebGL** — Framer Motion animates DOM elements and will choke on thousands of particles. Use each tool for its job.

**Signature concepts (build these, not a generic dial):**

1. **Gauge as a living data-flow, not a needle.** Render a WebGL particle/fluid field where particle **velocity and density map to live throughput**. During download, particles stream _toward_ the device; during upload, _away_ from it; turbulence encodes jitter. Data you can literally watch move. Shader for the field, Framer Motion for the frame around it.
2. **Bufferbloat as a visible clog (the money shot).** Render the connection as a pipe/flow that visibly swells and backs up when loaded latency spikes. Turns an abstract metric into an "oh — _that's_ what's wrong" moment. No consumer tool does this.
3. **One continuous journey, not four screens.** Idle-latency → download → upload → verdict as a single camera-like flow using shared-element/layout transitions, so phases dissolve into each other.
4. **A verdict that springs into place.** The scene reorganizes and settles with spring physics onto the final A+→F grade, rather than a number popping in.
5. **Ambient background reacts to real connection health** — calm/slow when good, turbulent when bad. Driven by live metrics, never random.

Constraints: every hero visual must be driven by **real measured values** (§3.6) — no decorative fake motion masquerading as data. Ship a genuine low-motion fallback (see §5.6).

## 5.6 Render architecture (how the fancy UI must NOT sabotage the engine)

This is the senior-level catch: heavy main-thread animation during a live test corrupts **both** the visuals and the numbers (dropped frames + skewed timing). Enforce:

- **Measurement in a Web Worker** (already required, §3). Keep all timing off the main thread.
- **Heavy visuals in OffscreenCanvas** on their own render worker, or a decoupled `requestAnimationFrame` loop — not tangled into React's render cycle.
- **Coalesce the worker's event stream to ~30–60fps before touching React state.** Never `setState` per byte/sample. Drive the smooth gauge by **interpolating toward the latest sample inside rAF**, not by re-rendering on every event.
- **Animate only `transform` and `opacity`** (GPU-composited). No layout-thrashing animated properties.
- **Real `prefers-reduced-motion` + low-end-device path**: detect weak devices and throttle the _visuals_, never the measurement. On a low-end phone the numbers must stay accurate even if the particle field drops to a simple bar. **Accuracy outranks spectacle, always.**

---

## 6. Architecture & scale

- Measurement runs client-side (Web Worker) against Cloudflare edge → our server load stays tiny even at high traffic.
- API routes only persist/aggregate results and generate reports — keep them thin and rate-limited (per IP + per user).
- Add lightweight abuse protection on write endpoints (rate limit, payload validation with Zod, no PII in logs).
- Aggregations (peak-hour %, promise-delivered %) computed in SQL over the Timescale hypertable, **cached in Redis**; don't recompute per page load.
- Everything Dockerized; provide `docker-compose.yml` (app + postgres/timescale + redis), Nginx config, and `.env.example`.
- If/when live features land, put them on **SSE first**, Redis pub/sub as the fan-out — keep them fully decoupled from the measurement path so a live-feature failure can never affect a test.

---

## 7. Non-functional requirements

- **Accuracy** validated against speedtest.net / Cloudflare within a reasonable margin on a known link — document your comparison method in `/docs/accuracy.md`.
- **Performance**: test UI at 60fps during measurement (worker keeps main thread free); Lighthouse ≥ 90 on the landing page.
- **Accessibility**: keyboard-operable, ARIA on the gauge, respects `prefers-reduced-motion`, WCAG AA contrast.
- **Mobile-first**, PWA-installable (offline shell + "run test" works on flaky links).
- **Privacy**: anonymous testing works with zero account; be explicit about what's stored; no selling data; GDPR-friendly delete.
- **Tests**: unit-test the throughput math and bufferbloat grading with synthetic sample streams (deterministic, no live network in CI).

---

## 8. Build in these phases (ship each before moving on)

**Phase 1 — Engine core.** Web Worker measurement module: parallel-stream download/upload with warm-up discard + sliding window, idle latency + jitter, against Cloudflare endpoints. Unit tests for the math. CLI/Node harness to prove numbers match a reference tool.

**Phase 2 — Test UI.** Live gauge + real-time graph + streamed worker events + result card with real-world translation. Anonymous, no DB yet.

**Phase 3 — Bufferbloat & RPM.** Loaded-latency probing during down/up saturation, bufferbloat grading, RPM, advanced-metrics panel.

**Phase 3B — Visual & motion system (§5.5 + §5.6).** Once all metrics exist to visualize: build the render architecture (OffscreenCanvas worker, rAF interpolation, event coalescing, reduced-motion path) FIRST, then the WebGL data-flow gauge, the bufferbloat-clog visual, and the continuous phase journey. Verify measurement accuracy is unchanged with visuals on vs. off before proceeding. Can run in parallel with Phases 4–5 once the render architecture is locked.

**Phase 4 — Persistence & accounts.** Auth, Drizzle schema (Timescale hypertable), save history, dashboard with trend chart.

**Phase 5 — Plan Guardian & peak-hour intelligence.** ISP plan model, Promise Delivered %, day-bucket analytics, anomaly flags.

**Phase 6 — Evidence Reports.** Public share page + PDF export + methodology footnote.

**Phase 7 — Scheduled/background testing** (in-tab recurring + documented headless runner on BullMQ/systemd), i18n (en/bn), PWA, Docker/Nginx deploy config, accuracy doc.

**Phase 8 — Advanced accuracy & live features (optional, post-launch).** WebRTC data-channel probe for true packet loss / real-time-app suitability (§3.7, feature-flagged, HTTP-only must still work). Then, if wanted, live BD network-status map / ISP leaderboard on SSE + Redis pub/sub — fully decoupled from the measurement path.

At the end of each phase: run typecheck + tests, summarize what shipped, and list what's deferred. Ask before making irreversible schema changes.

---

## 9. Guardrails

- No fabricated metrics, ever (§3.6).
- No secrets in the repo; use `.env`.
- Don't add a dependency without a one-line justification.
- Prefer clarity over cleverness in the measurement code — it's the thing everything else trusts.

Start with Phase 1. Before you write code, propose the engine's module boundaries and the `TransferProvider` interface, and confirm the throughput math with me.
