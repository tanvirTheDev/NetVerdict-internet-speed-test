# 0003 — Branded unit types

## Context

Unit confusion — bytes vs. bits, milliseconds vs. seconds, Mbps computed
from the wrong denominator — is the single most common silent bug class
in measurement code, and the kind that produces a plausible-looking wrong
number rather than a crash (the worst outcome for a tool whose entire
value proposition is trustworthy numbers, §5.7).

## Decision

Every physical unit that flows through `packages/contracts` and
`packages/engine` is a **branded type** (`Bytes`, `Bits`, `Milliseconds`,
`Mbps`, `EpochMs` in `packages/contracts/src/units.ts`) — a `number` with
a nominal tag that TypeScript enforces at compile time. A raw number
cannot be passed where a `Mbps` is expected without an explicit
`asMbps(...)` cast at the point the value is first produced.

Conversions between units are pure functions living in exactly one
module (`packages/engine/src/units.ts`) — nowhere else multiplies by 8 or
divides by 1e6.

## Consequences

- A function signature like `computeThroughput(bytes: Bytes, windowMs: Milliseconds): Mbps`
  is self-documenting and misuse is a compile error, not a runtime bug
  discovered when a user reports "my gigabit line shows 125 Mbps."
- Slightly more ceremony at the boundary where raw numbers first enter
  the system (a `fetch` response's byte count, a `performance.now()`
  reading) — acceptable given what it prevents.

## Alternatives rejected

- **Plain `number` everywhere with disciplined naming** (`downloadBytes`,
  `windowMs`): the naming convention (§2.4) still applies as a second
  layer of defense, but it's advisory only — nothing stops a caller from
  passing bytes where bits were expected. Branding makes the mistake
  impossible to compile, not just easy to spot in review.
