# 0001 — Tech stack

## Context

NetVerdict is a measurement-accuracy-critical SaaS (§0 of the build brief)
that needs to ship as a free-tier MVP deployable with a single `git push`
to Vercel (see the v2.1 note at the top of the brief).

## Decision

- **Next.js 16** (App Router) + **TypeScript 5.9 strict** for the app layer.
- **npm workspaces monorepo**: `apps/web`, `packages/{contracts,engine,db,config}`,
  `services/probe` (deferred). One-way dependency direction enforced by
  ESLint + dependency-cruiser (§2.1/§2.2).
- **Zod** for schema validation at every boundary (`packages/contracts`).
- **Drizzle ORM** over **Neon** serverless Postgres (§0004).
- **Upstash Redis** (REST client) for rate limiting and cached aggregations.
- **Tailwind CSS v4** + Radix/shadcn primitives for UI (Phase 2+).
- **Vitest** for unit/contract/integration tests, **Playwright** for E2E.
- **Auth.js** for email + Google auth (Phase 4).

## Consequences

- No Docker/Nginx/VPS to operate; deploys are `git push` → Vercel build.
- No TimescaleDB hypertable in v1 — see 0004.
- No BullMQ — background jobs run on Vercel Cron hitting an API route.
- `packages/engine` has no dependency on any of the above; it is pure
  TypeScript that also runs headlessly under Node (§5.6).

## Alternatives rejected

- **Self-hosted VPS (original brief v1)**: more control (Timescale,
  BullMQ, WebRTC probe host all in one place) but costs money and ops
  effort the MVP goal explicitly rules out. Revisit if/when the product
  outgrows Vercel's free tier.
- **Turborepo/Nx**: build-graph caching is nice but is itself a dependency
  needing justification (§2.14); plain npm workspaces scripts are enough
  at this repo's current size.
