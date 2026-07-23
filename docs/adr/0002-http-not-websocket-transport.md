# 0002 — HTTP transport for measurement, not WebSocket

## Context

The measurement engine needs to move bytes for download/upload throughput
and probe round-trip time for latency. Some competing tools (e.g.
Waveform) use WebSockets against their own self-hosted servers.

## Decision

Core measurement uses **HTTP (fetch/XHR)** against Cloudflare's public
speed endpoints (`speed.cloudflare.com/__down`, `/__up`), not WebSocket.
Worker↔UI communication uses `postMessage`, not a network socket at all.

## Consequences

- We offload the actual byte transfer to Cloudflare's globally distributed
  edge — our server's bandwidth bill stays near zero even at scale (§5.1).
- No socket lifecycle (reconnect, heartbeat, backpressure) to manage in
  the measurement path — one less class of bug in the code everything
  else trusts (§13 guardrail 4).
- Parallel streams are just concurrent `fetch` calls; the sliding-window
  math (§5.2) operates identically whether the transport were HTTP or a
  socket, so nothing is sacrificed in accuracy.

## Alternatives rejected

- **WebSocket to our own server**: only makes sense if we host the
  transfer endpoint ourselves — which reintroduces the bandwidth cost
  this whole architecture exists to avoid (§5.1). Waveform's approach is
  correct _for their infra model_, not for ours.
- **WebRTC data channel for all measurement**: genuinely more accurate
  for packet loss (real UDP semantics, §5.8) but requires hosting a
  signaling/STUN service — deferred to Phase 8, feature-flagged, HTTP
  remains the required fallback.
