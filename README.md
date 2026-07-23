# NetVerdict

> Don't guess. Get the verdict on your connection.

An accountability platform, not a one-shot speed test: NetVerdict scores
your ISP against what it advertised (Plan Guardian), surfaces peak-hour
throttling, grades bufferbloat/RPM, and generates evidence reports you
can send to your ISP. See `speedtest-tool-claude-code-prompt_2.md` for
the full product/engineering brief this repo is built from.

## Stack

Next.js 16 (App Router) · TypeScript strict · Neon (serverless Postgres)

- Drizzle · Upstash Redis · Tailwind v4 · Vitest + Playwright. Deploys
  free on Vercel — no Docker/Nginx/VPS. See `docs/adr/` for why.

## Repo layout

```
apps/web/          Next.js app — UI, API routes, server config
packages/contracts/  Zod schemas + inferred types — the wire format every layer imports
packages/engine/     Measurement core — framework-agnostic, runs in a Worker or headless Node
packages/db/         Drizzle schema + Neon connection factory
packages/config/     Shared tsconfig/ESLint/Tailwind presets
services/probe/      (Phase 8, deferred) WebRTC probe — needs its own host, not Vercel
docs/adr/            Architecture decision records
docs/accuracy.md      Repeatable accuracy-validation procedure + results log
docs/methodology.md   Public methodology, linked from every Evidence Report
```

## Getting started

```bash
nvm use            # Node version pinned in .nvmrc
npm install
cp .env.example .env   # fill in a free Neon + Upstash project's credentials
npm run dev         # apps/web on http://localhost:3000
```

## Common commands

```bash
npm run lint          # ESLint across the whole workspace
npm run format:check  # Prettier check
npm run typecheck     # tsc across every package (project references) + apps/web
npm run test          # Vitest, unit + contract tests
npm run test:coverage # same, with the coverage gate (packages/engine ≥ 90%)
npm run verify        # everything above + build — what CI runs
```

No live network calls in the test suite — the engine's throughput/latency
math is tested against synthetic sample-stream fixtures (§2.8 of the
build brief), so `npm test` is deterministic and fast.

## Deploying

1. Push this repo to GitHub.
2. Import it in Vercel; set **Root Directory** to `apps/web` (Vercel
   auto-detects the npm workspace and installs from the repo root).
3. Add the environment variables from `.env.example` in the Vercel
   project's Environment Variables settings.
4. Push to `main` → Vercel builds and deploys.

## Status

Phase 0 (foundation/tooling) and Phase 1 (measurement engine core) are
in progress. See §12 of the build brief for the full phase plan and the
Definition of Done (§2.13) each phase is held to.
