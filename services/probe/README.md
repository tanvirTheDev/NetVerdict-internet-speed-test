# services/probe (Phase 8 — deferred)

The WebRTC data-channel probe (§5.8 of the build brief): a small signaling +
STUN/TURN-capable service that gives the browser genuine UDP-style packet
loss and jitter measurement, which HTTP/TCP cannot see.

**Not implemented yet, and intentionally empty.** It cannot run on Vercel
serverless — a WebRTC signaling service needs a host that holds persistent
connections. When Phase 8 starts, this service deploys separately (e.g. a
small Fly.io/Railway free-tier instance) and the main app talks to it
behind the same feature-flagged `TransferProvider`-style interface used
for Cloudflare, so the product stays fully functional HTTP-only if this
service is unavailable or blocked by a firewall.
