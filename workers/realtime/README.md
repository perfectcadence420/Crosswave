# Crosswave Realtime — Cloudflare Durable Objects

This is an optional, authenticated WebSocket matchmaker for Crosswave.
The existing HTTP/Neon matchmaking remains the default until the new Worker
is deployed, tested, and explicitly activated. Video itself remains WebRTC
(peer-to-peer when possible, with Cloudflare TURN fallback).

## What changes when enabled

- Vercel serves the site, verifies age/rules guest sessions, issues WebSocket tickets,
  and stores abuse reports and one Neon call record for each match.
- A Cloudflare Worker validates 60-second HMAC tickets and browser origins.
- A single beta Durable Object keeps the queue and ongoing signaling in memory,
  with WebSocket hibernation attachments to restore session state.
- Neon is no longer polled every ~0.7–1.4 seconds by connected browsers.
- Matches, bans/blocks, call ends, and reports still use Neon.
- A recently skipped partner is excluded from rematching for 120 seconds.

## Provision a Worker (one manual Cloudflare setup)

1. Open Cloudflare Dashboard → Workers & Pages → Create Application →
   Import a repository, and link GitHub `perfectcadence420/Crosswave`.
2. Choose Worker name **crosswave-realtime** (must match `wrangler.jsonc`).
   Set root directory to **workers/realtime** and deploy with
   `npx wrangler deploy` (or the Cloudflare UI's equivalent deploy command).
3. Check `https://<assigned-subdomain>.workers.dev/health` responds with
   `{"ok":true,"service":"crosswave-realtime"}`.
4. In Cloudflare's Worker Settings → Variables and Secrets add the secret
   `REALTIME_SHARED_SECRET`, with a randomly generated 32+ character value.
   This same value will also go in Vercel as an encrypted/sensitive secret.
   Keep it out of GitHub and browser code.
5. Confirm Worker plain variables `ALLOWED_ORIGINS` and `API_BASE_URL`
   match the actual Crosswave deployment origin. The committed defaults point
   to `https://crosswave-eta.vercel.app`.
6. In Vercel Crosswave production environment add:
   - `REALTIME_SHARED_SECRET`: same Worker secret, server-side only.
   - `REALTIME_WEBSOCKET_URL`: `wss://<assigned-subdomain>.workers.dev/connect`.
   - `REALTIME_ENABLED`: `false` initially.
7. Redeploy Vercel, verify `GET /api/realtime-config` says `enabled:false`.
   After a successful canary, switch `REALTIME_ENABLED=true` and redeploy.

**Important:** Cloudflare TURN keys **cannot** deploy Workers or sign WebSocket
session tickets. The realtime shared secret is entirely different from the TURN
API token. A Cloudflare account can use Git integration without sharing any
Cloudflare API token here.

## Protocol

The browser calls POST /api/guest as before, then POST /api/socket-ticket.
Vercel returns a short-lived signed ticket. The browser opens the Worker URL
with WebSocket subprotocols `crosswave.v1` and `auth.<ticket>`.
The ticket is never placed in a query parameter or logged.

Server events:
- `ready`
- `waiting`
- `matched`: {callId,initiator,mode}
- `signal`: {callId,kind,payload}
- `peer-left`
- `error`

Client messages:
- `join`: {mode:"video"|"text"}
- `next`: {mode}
- `leave`
- `signal`: {callId,kind:"offer"|"answer"|"ice"|"text",payload}

The Worker calls `POST /api/internal/realtime-call` on the Vercel origin using
the shared secret (server-to-server) when matches open and close. The endpoint
checks guest eligibility, stored blocks, current calls and bans.
The resulting real Neon call ID keeps existing POST /api/report working.

## Security and capacity limits

Beta controls: origin allowlist, short-lived tickets, one socket per guest,
240 incoming messages/minute per guest, 70-kilobyte message limit, 2,500-socket
limit on the beta lobby, stored blocks and bans verified by Neon on each match.

Before public scale: add Turnstile or rate limiting for guest creation and
ticket issuance, distributed abuse protection, stronger age assurance, 
operational alerting, regional queues/sharding, and backpressure/load testing.
This single global Durable Object is an **initial architecture**, not evidence
of 1,000-user production capacity. Failed "close" writes may temporarily leave
a stale Neon call; add reconciliation before full rollout.

## Neon ephemeral data retention

`migrations/002_ephemeral_retention.sql` adds indexes and a bounded
`crosswave.cleanup_ephemeral()` routine. The migration is installed in both
development and production but does **not** run deletions or schedule a job.
Default retention proposal: 24 hours for WebRTC signaling/text; two minutes
for abandoned queue entries. Calls and reports are not deleted. Establish and
approve the retention/moderation policy before running or scheduling cleanup.
