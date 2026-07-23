# 0005 — Cloudflare anycast as the sole measurement endpoint

## Context

§8.1 of the build brief lists a **server selector** on the test screen,
and §5.1 names `TransferProvider` as a port with "Cloudflare /
self-hosted / WebRTC" adapters behind it. That framing assumes there is
a set of servers worth choosing between. Before building the selector,
we checked whether one exists.

Two facts emerged, both measured rather than assumed.

**`speed.cloudflare.com` is anycast.** There is no POP parameter and no
server list; the network routes each client to its nearest edge. From
the Dhaka connection used for this investigation, that edge is already
`DAC` — Cloudflare's Dhaka POP. A selector over this endpoint would be a
dropdown with exactly one entry.

**LibreSpeed's public server list does not survive contact.** It is the
only open, protocol-documented pool of third-party speed-test servers.
Health-checking all 43 entries on 2026-07-23:

|                                       | count |
| ------------------------------------- | ----- |
| listed                                | 43    |
| reachable at all                      | 22    |
| sending `Access-Control-Allow-Origin` | **6** |

CORS is not negotiable for a browser-based test — without that header
the request never completes, however healthy the server. Verified on
London (Clouvider), which answers `curl` fine and sends no ACAO on
either a plain `GET` or an `OPTIONS` preflight. Both Asia-Pacific
entries are dead outright: Bangalore (DigitalOcean) serves a TLS
certificate that does not match its hostname, and Singapore's hostname
does not resolve. All six browser-usable servers are in Europe or the
United States, the nearest ~549 ms away.

## Decision

**Cloudflare's anycast endpoint is the only measurement endpoint. No
server selector ships.** Instead, every result records the POP that
served it — read from `/cdn-cgi/trace`, which unlike `CF-RAY` is exposed
to CORS — and the UI and `docs/methodology.md` explain what that path
means.

`TransferProvider` stays a port. This decision is about which adapters
are worth writing today, not about collapsing the seam.

## Consequences

- The reported figure is the speed to Cloudflare's nearest edge, and is
  labelled as such. It will read lower than a tool pointed at a server
  inside the user's own ISP: 30 ms / ~29 Mbps to the Dhaka POP against
  6 ms / ~57 Mbps to an in-ISP Ookla server, on the same line minutes
  apart.
- That gap is now explicable instead of looking like a defect. It is
  also the more defensible number for an Evidence Report (§7): a
  measurement taken inside an ISP's own network is precisely the one an
  ISP quotes back to a complaining customer.
- Nothing to health-check, no third-party uptime in our critical path,
  and no server-list fetch before a test can start.
- We inherit Cloudflare's rate limiting. It returns HTTP 429 to a client
  testing repeatedly, which is reported as `ENDPOINT_RATE_LIMITED` — a
  distinct condition, because a throttled run says nothing about the
  user's connection and must not read as "no download speed".

## Alternatives rejected

- **LibreSpeed public servers.** Six usable servers, none within
  ~549 ms of the reference connection, against 30 ms for the status quo.
  Shipping this as the default would lower reported speeds for users
  outside Europe and the US while adding a second protocol, a server
  list fetch, and health-checking. Worth revisiting only if the usable
  pool grows a well-maintained presence in South Asia.
- **Self-hosting an endpoint in-country.** The only option that would
  actually reach the ~57 Mbps an in-ISP server reports, because it is
  the same trick. Rejected for now: it reverses §5.1's core economic
  decision that our servers never carry the payload, and at 300 MB per
  test it needs a host with real bandwidth — Vercel's free tier is not
  a candidate. This is the option to reopen if in-ISP-comparable
  numbers become a product requirement; it needs its own ADR.
- **A selector over Cloudflare POPs.** Not offered by the endpoint.
  Anycast routing is the mechanism by which it is fast.
