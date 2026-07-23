# 0004 — Neon Postgres, not TimescaleDB, for v1

## Context

The original brief specced PostgreSQL + the TimescaleDB extension, since
`tests` is a time-series table and hypertables keep history/peak-hour
queries fast as data grows. The MVP deploy target is the **free tier of
Vercel** (v2.1 note), which means the database also needs to be a free,
zero-ops, serverless-friendly host.

## Decision

Use **Neon** (serverless Postgres, native Vercel integration, generous
free tier) with **plain, well-indexed tables** — no TimescaleDB
extension, no hypertable.

## Consequences

- `tests` is indexed on `(user_id, started_at DESC)` and
  `(plan_id, day_bucket)` (§6), which is sufficient for the query
  patterns (a single user's history, peak-hour aggregation for one plan)
  at MVP scale — thousands to low millions of rows, not the billions
  Timescale hypertables are built for.
- Dashboard rollups (Promise Delivered %, peak-hour %) are computed with
  plain SQL and cached in Upstash Redis with an explicit TTL, standing in
  for Timescale's continuous aggregates.
- If the project later moves to a self-hosted Postgres instance (its own
  VM, Timescale Cloud, etc.), converting `tests` to a hypertable at that
  point is a deliberate, documented migration — not silently assumed.

## Alternatives rejected

- **Timescale Cloud**: has its own free trial but not a permanent free
  tier suited to an indefinitely-running free MVP; revisit if the
  product needs Timescale-specific features (compression, continuous
  aggregates) at real scale.
- **Supabase**: also Postgres-as-a-service with a free tier, but doesn't
  support the Timescale extension either, and Neon's Vercel-native
  integration is a smoother fit for this stack specifically.
