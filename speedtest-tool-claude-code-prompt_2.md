# Claude Code Build Brief — "NetVerdict" Internet Quality & ISP Accountability Platform

> Paste this whole file into Claude Code (Opus) as the project brief.
> Build strictly in the phases in §12. Two sections are non-negotiable and override any convenience shortcut: **§2 Engineering Standards** and **§5.7 Measurement Integrity**. They are the difference between a real instrument and a decorative gauge.

**Document version:** 2.1 · **Supersedes:** `speedtest-tool-claude-code-prompt_1.md`

> **v2.1 note:** target deployment is the **free tier of Vercel**, not a self-hosted VPS. This changes the infra choices in §3/§6/§9/§12 from the original VPS-oriented plan (TimescaleDB, self-hosted Redis, BullMQ, Docker/Nginx) to serverless-native equivalents (Neon, Upstash, Vercel Cron). The measurement engine, contracts, and all code-quality standards in §2 are unaffected — this is a hosting swap, not a rewrite.

---

## 0. Your role & the quality bar

You are a senior full-stack engineer building a **production SaaS** used by thousands of real people. Optimize, in this order:

1. **Measurement accuracy & honesty** — a wrong number is worse than no number.
2. **Maintainability** — the maintainer is experienced; code must be readable, typed, and safe to change in six months.
3. **Scalability & low bandwidth cost** — the transfer payload must not run through our VPS.
4. **Polish** — only after the three above hold.

No placeholder logic, no faked numbers, no `TODO` in measurement code paths. Every metric shown to a user must come from a transfer that actually happened. If something cannot be measured reliably, render `unavailable` — never interpolate, never invent.

Skip hand-holding comments. **Do** document: measurement math, unit conventions, concurrency decisions, and anything where the obvious reading of the code is wrong.

---

## 1. Product thesis (why this exists)

Every speed test answers _"How fast is my internet right now?"_ — two numbers and a spinning dial.

**This tool answers: "Is my ISP consistently delivering what I pay for?"**

That reframe is the entire product. It is an **accountability platform**, not a one-shot meter. Every differentiator flows from it:

| #   | Feature                    | The insight it delivers                                                                                                                                                                                                       |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Plan Guardian**          | User records ISP, plan, advertised down/up, monthly price. Every test is scored against the promise → rolling **Promise Delivered %** + plain-language verdict ("You're getting ~62% of your advertised 40 Mbps on average"). |
| 2   | **Peak-hour intelligence** | Results auto-bucketed by time-of-day (esp. evening peak 19:00–24:00, when throttling bites). Surfaces _"Your speed drops 45% during evening peak."_ No consumer tool shows this.                                              |
| 3   | **Bufferbloat + RPM**      | Loaded vs. unloaded latency, jitter, packet loss, bufferbloat graded A+→F. Predicts real experience (calls, gaming) far better than raw Mbps. Most tools omit it entirely.                                                    |
| 4   | **Real-world translation** | _"Supports 4K streaming ✓, 3 simultaneous video calls ✓, competitive gaming ✗ (high loaded latency)."_                                                                                                                        |
| 5   | **Evidence Report**        | One click → timestamped, shareable public report + PDF, defensible enough to send an ISP as a complaint.                                                                                                                      |
| 6   | **Scheduled testing**      | An honest longitudinal dataset, not one lucky manual sample.                                                                                                                                                                  |

Working name: **NetVerdict** (swap freely). Tagline: _"Don't guess. Get the verdict on your connection."_

---

## 2. Engineering standards (non-negotiable)

This section exists so that quality is enforced by tooling, not by memory or willpower. **Phase 0 (§12) sets all of this up before any feature code is written.**

### 2.1 Repository layout

Single repo, workspace-based, so the engine is physically incapable of importing UI code.

```
netverdict/
├─ apps/
│  └─ web/                     # Next.js 15 app — UI, API routes, server actions
│     ├─ app/                  # App Router (route groups: (marketing), (app), api)
│     ├─ components/           # ui/ = primitives, features/ = domain-aware
│     ├─ server/               # db access, services, auth — server-only
│     └─ workers/              # worker entrypoints (measurement, render)
├─ packages/
│  ├─ engine/                  # @netverdict/engine — measurement core, ZERO framework deps
│  ├─ contracts/               # @netverdict/contracts — Zod schemas + inferred types (the wire format)
│  ├─ db/                      # @netverdict/db — Drizzle schema, migrations, seed
│  └─ config/                  # shared eslint / tsconfig / tailwind presets
├─ services/
│  └─ probe/                   # (Phase 8) WebRTC probe + signaling — needs a host that
│                               #   holds persistent connections (e.g. Fly.io free tier);
│                               #   cannot run on Vercel serverless. Deferred, feature-flagged.
├─ docs/
│  ├─ adr/                     # architecture decision records, numbered
│  ├─ accuracy.md              # validation methodology + results
│  └─ methodology.md           # public-facing: how each metric is computed
├─ vercel.json · .env.example
└─ .github/workflows/ci.yml
```

**Rules**

- `packages/engine` may import **nothing** from `apps/web`, React, Next, or Node built-ins. It targets the browser Worker environment and must run headless under Node via an adapter. Enforce with `eslint-plugin-import` `no-restricted-imports` + a dependency-cruiser rule in CI.
- Dependency direction is one-way: `apps/web` → `packages/*`. Never the reverse, never sideways between feature folders.
- `packages/contracts` is the only place a client/server payload shape is defined. Both sides import it. No duplicated interfaces.

### 2.2 Architectural rules

- **Layers:** `route/component` → `service` → `repository` → `db`. A React component never touches Drizzle; an API route never writes SQL inline.
- **Pure core, imperative shell.** All measurement math (throughput windowing, grading, percentiles) lives in **pure functions over arrays of samples** — no `fetch`, no timers, no globals inside them. I/O lives in thin adapters around that core. This is what makes the math unit-testable without a network.
- **Ports & adapters at every external edge:** `TransferProvider` (Cloudflare / self-hosted / WebRTC), `Clock`, `Storage`, `Logger`. Inject them; never reach for a global. Tests substitute fakes.
- **No god modules.** A file over ~300 lines or a function over ~50 is a design smell — split it before it grows.
- **Feature flags** for anything experimental (WebRTC probe, WebGL hero visuals) via a single typed flag module, default-off, so `main` is always shippable.

### 2.3 TypeScript standards

`strict: true` plus: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`.

- **`any` is banned** (`@typescript-eslint/no-explicit-any: error`). Use `unknown` + a Zod parse at boundaries. A justified exception needs an inline `// eslint-disable-next-line` **with a reason**.
- **Brand every physical unit.** Unit confusion is the #1 silent bug class in a measurement tool — make it a compile error:
  ```ts
  type Brand<T, B extends string> = T & { readonly __brand: B };
  export type Bytes = Brand<number, 'Bytes'>;
  export type Bits = Brand<number, 'Bits'>;
  export type Milliseconds = Brand<number, 'Milliseconds'>;
  export type Mbps = Brand<number, 'Mbps'>;
  ```
  Conversions live in exactly one module (`units.ts`) and are unit-tested. Nothing else multiplies by 8 or divides by 1e6.
- **Discriminated unions over booleans** for state: `type Phase = { kind: 'idle' } | { kind: 'download'; progress: number } | ...`. Exhaustive `switch` with a `never` guard.
- **`readonly` by default** on sample arrays and result objects. Measurement results are immutable facts.
- No enums (use `as const` objects + union types). No `namespace`. No default exports except where a framework demands it (Next pages/route handlers).

### 2.4 Naming & file conventions

- Files: `kebab-case.ts`. React components: `PascalCase.tsx`. Hooks: `use-thing.ts` exporting `useThing`.
- Types/interfaces `PascalCase`; no `I` prefix. Constants `SCREAMING_SNAKE_CASE`.
- **Names carry units:** `latencyMs`, `downMbps`, `payloadBytes`, `windowMs`. A bare `speed`, `size`, `time`, or `duration` is rejected in review.
- Booleans read as assertions: `isPartial`, `hasWarmupCompleted`, `shouldDiscardSample`.
- One exported concept per file; barrel `index.ts` only at package roots.

### 2.5 Error handling & failure taxonomy

- **The engine never throws for expected failures.** It returns a `Result<T, EngineError>`:
  ```ts
  type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
  ```
  Throwing is reserved for programmer error (invariant violations). Wrap all third-party/network calls at the adapter boundary and convert to typed errors.
- **A closed error taxonomy** (`EngineErrorCode`): `NETWORK_UNAVAILABLE`, `ENDPOINT_REJECTED`, `CORS_BLOCKED`, `TIMEOUT`, `ABORTED_BY_USER`, `INSUFFICIENT_SAMPLES`, `UNSUPPORTED_ENVIRONMENT`. Every error carries `{ code, phase, retriable, cause }`. The UI maps code → localized message; it never string-matches an error message.
- **Partial results are first-class**, not a failure. If upload succeeds and download fails, persist the run with `isPartial: true` and the failed phase recorded. Never backfill a missing phase with an estimate.
- **Every async op is cancellable** via `AbortSignal` threaded from the worker's `stop` message. Aborting a test must leave no orphaned streams, timers, or in-flight fetches.
- **User-facing errors are actionable**; internal detail (stack, endpoint URL, cause chain) goes to the log, never to the DOM.

### 2.6 Configuration & secrets

- **One typed config module per app**, validated with Zod at boot; the process refuses to start on invalid env. `process.env` is referenced **exactly once** in the codebase — inside that module.
- `.env.example` is committed and exhaustive; real `.env` is git-ignored. No secret, token, or connection string in the repo, in a comment, in a test fixture, or in a log line — ever.
- Separate `server` and `client` config objects; anything on the client is `NEXT_PUBLIC_*` and assumed public.

### 2.7 Logging & observability

- **Structured JSON logging** (`pino`), never bare `console.log` outside dev scripts. Fields: `requestId`, `route`, `durationMs`, `outcome`. Levels used correctly: `error` = someone must act.
- **No PII in logs.** IP addresses are used for rate limiting and geo-coarse attribution only, and are **hashed with a rotating salt** before storage. Emails, precise coordinates, and raw IPs never hit a log sink.
- Error tracking (Sentry or equivalent) on server + client, with the measurement worker's failures reported as typed error codes rather than raw exceptions.
- `/api/health` (liveness) and `/api/ready` (DB + Redis reachable) endpoints for the container orchestrator.

### 2.8 Testing strategy

Deterministic tests only — **CI never touches the live network.**

| Layer       | Tool                    | Scope                                                                                                                                      | Gate                                       |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Unit        | Vitest                  | Throughput math, windowing, percentiles, grading, unit conversion, day-bucketing, verdict scoring                                          | **≥ 90% line/branch on `packages/engine`** |
| Contract    | Vitest + Zod            | Every wire payload parses; schema round-trips                                                                                              | must pass                                  |
| Integration | Vitest + Testcontainers | Repositories against real Postgres (plain, CI-local container — separate from the Neon instance used at runtime), migrations apply cleanly | must pass                                  |
| E2E         | Playwright              | Run-a-test flow, result card, share report, reduced-motion path, keyboard-only run                                                         | must pass on Chromium + WebKit             |
| A11y        | axe-core in Playwright  | Zero critical violations on landing, test, dashboard                                                                                       | must pass                                  |

- **Synthetic sample streams as fixtures**: hand-built `TransferSample[]` sequences representing slow-start ramps, mid-test stalls, a gigabit line, a 2 Mbps line, and a bufferbloated line. Assert exact expected Mbps/grades. These fixtures are the engine's regression suite — they must not change casually.
- **A fake `TransferProvider` and a fake `Clock`** make every timing test instant and deterministic. No `sleep` in tests.
- Test names state behaviour: `discards samples inside the warm-up window`. No `it('works')`.
- A bug fix lands with the failing test that proves it.

### 2.9 Tooling & automation

- **ESLint flat config** (typescript-eslint strict-type-checked) + **Prettier** (formatting is never discussed in review). Shared presets in `packages/config`.
- **Husky + lint-staged** pre-commit: format, lint, typecheck staged files. Pre-push: unit tests.
- **commitlint** enforcing **Conventional Commits**: `feat|fix|perf|refactor|test|docs|chore|build|ci(scope): subject`. Scope = package or feature (`engine`, `ui`, `db`, `reports`).
- **Knip** or `depcheck` in CI to catch dead exports/unused deps.
- Node version pinned via `.nvmrc`; package manager pinned via `packageManager` in `package.json`. Lockfile committed and CI-verified with a frozen install.

### 2.10 Git workflow

- Trunk-based: short-lived branches off `main`, named `feat/plan-guardian`, `fix/upload-window-drift`.
- **`main` is always deployable** and always green. No direct pushes; PRs only.
- PRs are small and single-purpose (< ~400 lines of diff where possible), with a description covering _what changed, why, and how it was verified_.
- **Commit or push only when I ask.** Never commit secrets, generated artifacts, or `node_modules`.
- Migrations are forward-only, reviewed, and never edited after merge.

### 2.11 CI pipeline (GitHub Actions)

Stages, fail-fast, all required to merge:

`install (frozen lockfile)` → `format:check` → `lint` → `typecheck` → `test:unit + coverage gate` → `test:integration (Testcontainers)` → `build` → `test:e2e (Playwright)` → `audit (npm audit --omit=dev + license check)` → `bundle-size + Lighthouse CI budgets`.

Cache dependencies and Next's build cache. Upload Playwright traces and coverage as artifacts on failure.

### 2.12 Documentation

- `README.md`: what it is, run it in 3 commands, architecture diagram, how to run tests.
- **ADRs in `docs/adr/NNNN-title.md`** for every consequential choice — and at minimum for: Cloudflare-as-transport, HTTP-over-WebSocket for measurement, Neon/Vercel serverless data layer (and the deferred Timescale hypertable), worker/OffscreenCanvas split, WebRTC probe. Format: Context → Decision → Consequences → Alternatives rejected.
- `docs/methodology.md` is **public-facing and linked from every Evidence Report** — the exact algorithm for each metric. This is what makes a report defensible to an ISP.
- **TSDoc on every exported engine symbol**, stating units and the formula. Inline comments explain _why_, never _what_.
- `CHANGELOG.md` generated from Conventional Commits.

### 2.13 Definition of Done

A task is done only when **all** hold: typechecks · lints clean · unit tests cover the new logic · integration/E2E updated if a flow changed · a11y checked (keyboard + contrast + reduced-motion) · i18n keys added for both `en` and `bn` (no hardcoded strings) · errors handled with typed codes · docs/ADR updated · no new dependency without justification · **measurement accuracy re-verified if anything in `packages/engine` or the render path changed.**

### 2.14 Dependency policy

Every new dependency needs a one-line justification in the PR **and** answers to: is it maintained, what does it cost in bundle bytes, and can 30 lines of our own code replace it? Prefer platform APIs. No dependency in `packages/engine` beyond what is strictly required for the math (target: **zero runtime deps**).

### 2.15 Security baseline

- **Validate every input at the boundary with Zod** — API routes, worker messages, URL params, PDF/report inputs. Never trust a client-submitted metric without range-sanity checks (see §5.7).
- Rate limit all write endpoints (per IP **and** per user) in Redis; return `429` with `Retry-After`.
- Security headers via Next middleware: strict CSP (allowlist the Cloudflare speed endpoints explicitly), `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- Parameterized queries only (Drizzle handles this — no raw string interpolation into SQL).
- Public report slugs are **unguessable** (≥ 128 bits of entropy), optionally expiring; a public report exposes no account identity beyond what the user opted into.
- Auth: httpOnly + `SameSite=Lax` session cookies, CSRF protection on mutations, no JWT in `localStorage`.
- Dependabot/Renovate on; `npm audit` gate in CI.

### 2.16 Performance & accessibility budgets (enforced in CI)

- Landing page: **Lighthouse ≥ 90** across the board; LCP < 2.0s on simulated 4G; initial JS ≤ 200 KB gzipped (measurement worker and WebGL bundles are **lazy-loaded**, never in the landing bundle).
- Test screen: **60fps sustained** during measurement; zero long tasks > 50ms on the main thread while a test runs.
- **WCAG 2.1 AA**: keyboard-operable end to end, visible focus, ARIA live region announcing phase + final results, `prefers-reduced-motion` honoured with a genuine non-animated path, AA contrast in both themes.

---

## 3. Tech stack (fixed unless I say otherwise)

- **Next.js 15** (App Router, Server Components where sensible) · **TypeScript strict**.
- **Tailwind CSS** + headless primitives (Radix / shadcn/ui). No heavy UI kits.
- **PostgreSQL via Neon** (serverless driver, `@neondatabase/serverless` + Drizzle's neon adapter) — free tier, native Vercel integration. **Drizzle ORM**, migrations checked in. Plain, well-indexed tables for v1 (see §6) — no TimescaleDB hypertable, since no free/serverless Postgres host supports the extension. Revisit Timescale only if the project later moves to a self-hosted Postgres instance.
- **Upstash Redis** (HTTP/REST client, serverless-friendly, free tier, native Vercel integration) — rate limiting (via `@upstash/ratelimit`) and cached aggregations. No persistent-connection Redis client, no self-hosted Redis.
- **Vercel Cron Jobs** (a `vercel.json` cron hitting an API route) for headless scheduled testing, instead of BullMQ/systemd — BullMQ needs a long-running worker holding a Redis connection, which doesn't fit stateless serverless functions. Flag to me if the free Hobby tier's cron frequency ends up too coarse for the desired monitoring cadence; the fallback is a paid Vercel plan or moving just the monitor job to a small always-on host.
- **Web Workers** for the measurement engine — mandatory (§5).
- **Framer Motion** for UI chrome/choreography; **react-three-fiber / raw WebGL** for hero data-visuals (§8). Two tools, two jobs — never animate a particle field with Framer Motion.
- **Recharts** or **visx** for time-series charts.
- **Auth.js** (email + Google). Anonymous testing allowed; history requires an account.
- **Deploy**: Vercel free (Hobby) tier — `git push` deploys, no Docker/Nginx/VPS. Local dev points at free Neon + Upstash cloud branches by default, so no local infra container is required either.
- **i18n**: English + Bangla (`bn`) from day one, dictionary-driven. RTL not required.

### 3.1 Transport decisions — read before adding sockets

- **Core measurement is HTTP** (fetch/XHR against Cloudflare edge) + `postMessage` between worker and UI. **No WebSocket in the measurement path** — it adds complexity with zero accuracy gain. Waveform uses WebSockets because they host their own servers; we offload transfer to Cloudflare's HTTP infra, so XHR/fetch is correct. (Record as ADR-0002.)
- **WebSocket / SSE**: only for optional _live/social_ features (network-status map, ISP leaderboards). Prefer **SSE** for one-way updates. Not in v1, and always decoupled from measurement.
- **WebRTC data channel**: the one transport that genuinely sharpens _measurement_ — see §5.8. Feature-flagged, later phase.

---

## 4. Domain model & result contract

Before the engine, define the vocabulary in `packages/contracts` — every layer speaks it.

- `TransferSample { atMs: Milliseconds; bytes: Bytes; streamId: string }`
- `LatencySample { atMs: Milliseconds; rttMs: Milliseconds; underLoad: 'none' | 'download' | 'upload' }`
- `PhaseResult<T> = { status: 'complete' | 'partial' | 'failed'; data?: T; error?: EngineError }`
- `TestResult` — the single canonical output of a run, versioned, containing throughput, latency, bufferbloat, RPM, conditions, and integrity flags.

**Version the result contract.** Every persisted run stores `schemaVersion` and `engineVersion`, and grading thresholds live in a named, versioned profile (`gradingProfile: 'v1'`). When the algorithm changes, historical rows stay interpretable and comparisons across versions can be flagged rather than silently mixed. This is mandatory for a longitudinal dataset — a chart that unknowingly splices two algorithms is a fabricated trend.

---

## 5. The measurement engine (the hard part)

Standalone, framework-agnostic TypeScript in `packages/engine`, running **inside a Web Worker** so the UI thread never blocks and timing is never corrupted by render jank. The React layer only sends `start`/`stop` and consumes streamed progress events.

### 5.1 Data transfer strategy (cost & accuracy)

**Byte transfer runs against Cloudflare's public speed endpoints, not our VPS.** This removes the #1 cost that kills self-hosted speed tests at scale and is globally edge-distributed.

- Download: `GET https://speed.cloudflare.com/__down?bytes=N`
- Upload: `POST https://speed.cloudflare.com/__up` (N bytes of random payload)
- Latency probe: small `__down?bytes=0|1` round trips, or `cdn-cgi/trace`

The transfer backend is **pluggable behind a `TransferProvider` interface** so a self-hosted LibreSpeed-style backend can be added later as alternate/fallback. Our VPS orchestrates, stores, and analyzes — it does **not** move the payload.

### 5.2 Download / upload measurement

Naive single-fetch measurement massively **underreports** fast links (TCP slow-start + single-stream ceiling). Implement properly:

- **Parallel streams**: 4–8 concurrent connections; aggregate throughput across all.
- **Warm-up discard**: ignore the first ~1.5–2s of each stream. Steady state only.
- **Sliding-window throughput**: bytes/sec over a moving window — never total-bytes ÷ total-time.
- **Adaptive sizing**: probe with a small chunk, then choose chunk size and stream count from the detected speed. Hard ceiling on total bytes transferred per test.
- **Reporting**: report the **median / 90th percentile** of the steady-state window, not a ramp-skewed mean. State which statistic is shown, in the UI and in `methodology.md`.
- **Upload**: same windowing and discard logic; generate payload with `crypto.getRandomValues` **in chunks, streamed** — never one giant in-memory buffer.

### 5.3 Latency, jitter, packet loss

- **Unloaded latency**: 10–20 sequential small round trips → report **min, median, jitter**. Jitter = mean absolute deviation (or stdev) of successive RTTs; document which.
- **Packet loss**: batch of probes with timeout; loss % = timed-out ÷ total.
- Keep the **full RTT series** (for the consistency chart), not just the aggregate.

### 5.4 Bufferbloat & Responsiveness (flagship differentiators)

- **Loaded latency**: probe every ~250–500ms while download saturates the link; repeat separately during upload saturation (upload bufferbloat is usually worse on asymmetric BD connections and is the real cause of video-call lag).
- **Bufferbloat grade**: derived from the _increase_ of loaded over unloaded latency, A+→F, **download and upload graded separately**. Thresholds live in the versioned grading profile (§4) and are documented publicly.
- **RPM**: implement the IETF Responsiveness-under-load metric (≈ `60000 / loaded_latency_ms`, aggregated). Report `unloadedLatency`, `loadedLatencyDown`, `loadedLatencyUp`, `jitter`, `rpm`. Explain RPM in one plain sentence in the UI ("higher = your connection stays responsive when busy").

### 5.5 Streamed progress

The worker emits live typed events — `phase`, `instantaneousMbps`, `progress`, `latencySample` — so the UI can animate a live gauge and real-time graph _as it happens_. Worker↔UI messages are a **discriminated union validated at the boundary**; a malformed message is logged and dropped, never crashes the run.

### 5.6 Headless parity

The same engine must run under Node (via a `TransferProvider` + `Clock` adapter) for the CLI harness and the 24/7 monitor. **One implementation, two environments** — no forked logic, no copy-pasted math.

### 5.7 Measurement integrity rules (hard requirements)

1. Never display a number the transfer didn't produce. No cosmetic inflation, no "smoothing up."
2. If a phase fails (network drop, CORS, endpoint down), report it honestly and mark the run **partial**. Never silently fabricate or interpolate.
3. Record conditions with every result: timestamp + tz offset, `navigator.connection` type if available, endpoint used, browser/UA class, `engineVersion`, `schemaVersion`, and a flag when local interference is suspected (page hidden, high CPU, competing tabs).
4. **Flag anomalies, don't launder them**: a result ≥ 10× off the user's rolling baseline is stored with `anomalyFlag`, excluded from headline averages, and visible to the user — never dropped, never smoothed into the trend.
5. **The server independently sanity-checks submitted metrics** (range validation, internal consistency, per-user rate limits). A client-submitted number is untrusted input, always.
6. Anything unmeasurable renders as `unavailable`, with a reason.

### 5.8 WebRTC data-channel probe (advanced, feature-flagged, later phase)

HTTP latency/loss measurement is blind to _real_ packet loss because TCP silently retransmits. Gaming and VoIP run on UDP, where loss and jitter actually bite.

- Open a **WebRTC data channel in unreliable + unordered mode** (`maxRetransmits: 0`, `ordered: false`) to a tiny self-hosted probe service — UDP-style semantics in the browser.
- Send timestamped probes while idle **and** under download/upload saturation → true latency, jitter, and **genuine packet loss** (never retransmitted → actually lost).
- **Tradeoff to flag to me before building:** requires a small signaling + STUN/TURN-capable service on the VPS (bandwidth is negligible — probes, not payload). Build it behind the same port/adapter pattern, **feature-flagged**, and the product must remain fully functional HTTP-only when WebRTC is blocked by a firewall.

---

## 6. Data model (Drizzle)

- `users` — auth, locale, home ISP reference.
- `isp_plans` — `id, user_id, isp_name, plan_name, advertised_down_mbps, advertised_up_mbps, monthly_price, currency, active`.
- `tests` — one row per run: `id, user_id (nullable), plan_id (nullable), started_at, tz_offset, day_bucket (morning|afternoon|evening_peak|late_night), down_mbps, up_mbps, idle_latency_ms, loaded_latency_down_ms, loaded_latency_up_ms, jitter_ms, packet_loss_pct, bufferbloat_grade_down, bufferbloat_grade_up, rpm, endpoint, connection_type, client_meta jsonb, is_partial, anomaly_flag, schema_version, engine_version, grading_profile`.
- `reports` — `id, public_slug, user_id, date_range, summary jsonb, created_at, expires_at`.

**Conventions**

- `tests` is a plain, well-indexed Postgres table on Neon — **not** a Timescale hypertable (§3: no free/serverless host supports the extension). If the project ever moves to a self-hosted Postgres instance, converting to a hypertable at that point is a documented, deliberate migration, not a default.
- Indexes: `(user_id, started_at DESC)`, `(plan_id, day_bucket)` — peak-hour and history queries depend on them.
- `snake_case` columns, `timestamptz` always (never naive timestamps), monetary values as integer minor units, no floats for money.
- Migrations are generated, reviewed, forward-only, and applied in CI against a scratch DB before merge.
- Retention/aggregation policy considered at design time: raw rows retained; dashboard rollups computed via SQL views cached in Upstash Redis with an explicit TTL (Timescale continuous aggregates are unavailable on Neon — this is the serverless-compatible substitute).

---

## 7. Features & screens

1. **Test screen** — animated gauge, live speed graph, phase indicator (idle latency → download → upload → bufferbloat), server selector, advanced-metrics panel (jitter, loss, loaded latency, RPM, bufferbloat grades). Responsive; usable one-handed on mobile.
2. **Result card** — down/up, latency trio, bufferbloat A–F badges, RPM, **real-world translation** block, "Share as evidence" + "Save to history".
3. **Dashboard (auth)** — Promise Delivered % gauge, trend chart, **peak-hour breakdown**, best/worst times of day, anomaly log.
4. **Plan Guardian setup** — add/edit ISP plan; the verdict engine scores every test against it.
5. **Evidence Report** — public read-only `/r/[slug]` + PDF export; branded, timestamped, links `methodology.md` so it's defensible to an ISP.
6. **Scheduled testing** — in-tab recurring test (v1) + documented headless runner (a Vercel Cron job hitting an API route that drives the same engine, v2), writing to the same DB.
7. **Public landing** — explains bufferbloat/RPM in plain language, SEO'd, accountability positioning front and centre.

---

## 8. Visual & motion system

The goal is a UI people screenshot and share. Framer Motion handles **chrome** (layout transitions, spring number roll-ups, gestures, phase choreography). The hero moments need **Canvas/WebGL** — Framer Motion animates DOM and will choke on thousands of particles.

**Signature concepts (build these, not a generic dial):**

1. **Gauge as a living data-flow.** WebGL particle/fluid field where particle **velocity and density map to live throughput**; particles stream toward the device on download, away on upload; turbulence encodes jitter. Shader for the field, Framer Motion for the frame.
2. **Bufferbloat as a visible clog (the money shot).** The connection renders as a pipe that visibly swells and backs up when loaded latency spikes — turns an abstract metric into "oh, _that's_ what's wrong."
3. **One continuous journey, not four screens.** Idle → download → upload → verdict as a single camera-like flow with shared-element transitions.
4. **A verdict that springs into place** with spring physics, rather than a number popping in.
5. **Ambient background reacts to real connection health** — calm when good, turbulent when bad, driven by live metrics, never random.

Every hero visual is driven by **real measured values** (§5.7). No decorative fake motion masquerading as data.

### 8.1 Render architecture (how the fancy UI must not sabotage the engine)

Heavy main-thread animation during a live test corrupts **both** the visuals and the numbers (dropped frames + skewed timing). Enforce:

- **Measurement in a Web Worker** (§5). All timing off the main thread.
- **Heavy visuals in OffscreenCanvas** on their own render worker, or a decoupled rAF loop — never tangled into React's render cycle.
- **Coalesce worker events to ~30–60fps before touching React state.** Never `setState` per sample. Drive the gauge by **interpolating toward the latest sample inside rAF**.
- **Animate only `transform` and `opacity`** (GPU-composited). No layout-thrashing properties.
- **Real `prefers-reduced-motion` + low-end-device path**: detect weak devices and throttle **visuals only, never measurement**. On a low-end phone the numbers stay accurate even if the particle field degrades to a bar. **Accuracy outranks spectacle, always.**
- **Prove it:** before merging any visual work, run the accuracy comparison (§11) with visuals on vs. off. A measurable delta blocks the merge.

---

## 9. Architecture & scale

- Measurement is client-side against Cloudflare edge → our server load stays tiny at high traffic.
- API routes only persist/aggregate and generate reports — thin, validated, rate-limited (per IP + per user).
- Aggregations (peak-hour %, Promise Delivered %) computed in SQL over Neon Postgres and **cached in Upstash Redis** with explicit TTLs and documented invalidation. Never recompute per page load.
- Deploys via Vercel (`git push` → build → deploy); no Docker/Nginx/VPS to operate. `.env.example` documents every required Neon/Upstash/Auth.js variable; `/api/health` and `/api/ready` still exist as plain route handlers for uptime monitoring.
- Future live features run on **SSE + Upstash Redis pub/sub**, fully decoupled — a live-feature outage can never affect a test.

---

## 10. Non-functional requirements

- **Accuracy** validated against speedtest.net / Cloudflare within a documented margin on a known link; method and results in `docs/accuracy.md`, re-run each time the engine changes.
- **Performance**: 60fps during measurement; Lighthouse ≥ 90 on landing (§2.16).
- **Accessibility**: WCAG AA, keyboard-operable, ARIA-annotated gauge, reduced-motion respected (§2.16).
- **Mobile-first**, PWA-installable (offline shell; "run test" works on flaky links).
- **Privacy**: anonymous testing with zero account; explicit disclosure of what's stored; no data selling; GDPR-friendly export + delete; hashed IPs (§2.7).
- **Tests**: throughput math and bufferbloat grading unit-tested against synthetic streams — deterministic, no live network in CI (§2.8).

---

## 11. Accuracy verification protocol

Not a one-off — a repeatable procedure, scripted where possible, in `docs/accuracy.md`:

1. Fixed known link, wired where possible, no competing traffic.
2. n ≥ 5 interleaved runs: NetVerdict / speedtest.net / Cloudflare / (optionally) `iperf3`.
3. Record median and spread per tool; our result must land within a documented margin of the reference median.
4. Repeat on: gigabit, ~40 Mbps, and a mobile/throttled link.
5. Repeat with hero visuals **on** and **off** — deltas indicate main-thread contamination (§8.1).
6. Commit the results table with date, engine version, and conditions. **A change to `packages/engine` that lacks a refreshed table does not ship.**

---

## 12. Build phases (ship and verify each before moving on)

**Phase 0 — Foundation.** Workspace scaffold (§2.1), TS strict config, ESLint/Prettier, Husky + commitlint, Vitest + Playwright wiring, CI pipeline green on a trivial test, `.env.example`, typed config module, `README`, ADR-0001 (stack) and ADR-0002 (HTTP-not-WebSocket transport). No feature code. This phase is short and non-negotiable — it is what makes every later phase cheap.

**Phase 1 — Engine core.** `packages/engine`: parallel-stream download/upload with warm-up discard + sliding window, idle latency + jitter, against Cloudflare endpoints. Pure math fully unit-tested against synthetic fixtures. Node CLI harness proving numbers match a reference tool (§11).

**Phase 2 — Test UI.** Live gauge + real-time graph + streamed worker events + result card with real-world translation. Anonymous, no DB.

**Phase 3 — Bufferbloat & RPM.** Loaded-latency probing during down/up saturation, grading (versioned profile), RPM, advanced-metrics panel.

**Phase 3B — Visual & motion system (§8 + §8.1).** Build the **render architecture first** (OffscreenCanvas worker, rAF interpolation, event coalescing, reduced-motion path), then the WebGL data-flow gauge, bufferbloat-clog visual, and continuous phase journey. Gate: accuracy unchanged with visuals on vs. off. May run parallel to Phases 4–5 once the render architecture is locked.

**Phase 4 — Persistence & accounts.** Auth, Drizzle schema (hypertable from migration 1), save history, dashboard trend chart, integration tests against a real DB.

**Phase 5 — Plan Guardian & peak-hour intelligence.** ISP plan model, Promise Delivered %, day-bucket analytics, anomaly flags.

**Phase 6 — Evidence Reports.** Public share page + PDF export + methodology footnote.

**Phase 7 — Ops & reach.** Scheduled/background testing (in-tab + headless runner on Vercel Cron), i18n (en/bn), PWA, Vercel deploy config (`vercel.json`, env vars documented), `docs/accuracy.md` finalized.

**Phase 8 — Advanced accuracy & live features (post-launch, optional).** WebRTC data-channel probe (§5.8, feature-flagged, HTTP-only must still work). Then, if wanted, live network-status map / ISP leaderboard on SSE + Redis pub/sub, fully decoupled from measurement.

**At the end of every phase:** run `typecheck + lint + tests + build`, verify the Definition of Done (§2.13), summarize what shipped, and list what's deferred and why. **Ask before any irreversible schema change or any new external dependency in the measurement path.**

---

## 13. Guardrails

1. **No fabricated metrics, ever** (§5.7).
2. No secrets in the repo — `.env` only, `.env.example` committed (§2.6).
3. No new dependency without a one-line justification (§2.14).
4. **Clarity over cleverness in measurement code** — it is the thing everything else trusts.
5. No `any`, no untyped boundary, no unvalidated external input (§2.3, §2.15).
6. Don't skip Phase 0 to "get to the fun part."
7. If a requirement here conflicts with something you'd rather do, **ask** — don't silently substitute.

---

## 14. Start here

Do **not** write feature code yet. First, propose and get my sign-off on:

1. **Module boundaries** for `packages/engine` — file-by-file, with the pure-core / imperative-shell split marked.
2. **The `TransferProvider` interface**, plus `Clock` and the worker↔UI message union.
3. **The throughput math**, stated explicitly: window size, warm-up discard duration, aggregation statistic (median vs. p90), stream count selection, and how parallel streams are summed. Include a worked example on a sample stream so I can check the arithmetic.
4. **The `TestResult` contract v1** and the initial `gradingProfile: 'v1'` thresholds.

Once I confirm those, execute Phase 0, then Phase 1.
