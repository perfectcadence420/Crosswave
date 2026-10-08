# Crosswave — first live two-person video chat

This repository includes the Crosswave static landing page, its browser WebRTC client, and Vercel serverless APIs backed by Neon Postgres.

## Architecture
- Browser: camera/microphone via getUserMedia; peer-to-peer video/audio via WebRTC, plus text mode.
- Vercel: anonymous guest session, matchmaking, status polling, WebRTC signaling, leave, abuse report/block APIs.
- Neon: guests, matching queue, calls, signaling messages, reports, blocks and moderation actions.
- STUN servers are public; optional TURN relays require server-side TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL.
- Video and audio streams go peer-to-peer when reachable or through a TURN relay when one is configured. They are **not** stored in Neon.

## How to test with two people
1. Use the same **production domain** or same preview deployment URL on both devices. Different hosts do not share guest cookies or signaling contexts.
2. Each tester accepts the 18+ and rules checkboxes.
3. Select Video chat, allow camera and microphone and click **Start**.
4. First user sees "Looking for a stranger…"; once the second joins, both show "Match found".
5. When ICE connects, each sees the other's camera and hears audio. Use headphones to avoid feedback.
6. Test **Next** (disconnect and rematch), **Stop** (leave queue), and **Report** (block and file report).

To test in two windows on the same device, use **normal and incognito** windows: two ordinary tabs share the same guest cookie and are treated as one user. Webcam sharing can be limited by browsers; use separate devices for a real AV test.

### Setup
1. Install deps: npm install
2. Apply migrations/001_crosswave.sql once in Neon for each target branch.
3. Configure a server-side **DATABASE_URL** using the matching Neon branch connection string. Never publish or commit it or add NEXT_PUBLIC_.
4. Deploy to Vercel. The health endpoint is GET /api/health. Video clients retrieve optional TURN configuration from GET /api/ice.

### APIs
- POST /api/guest: \`{"ageConfirmed":true,"rulesAccepted":true}\`
- POST /api/match: \`{"mode":"video"}\` or \`{"mode":"text"}\`
- GET /api/status
- POST /api/signal: \`{"callId":"uuid","kind":"offer|answer|ice|text","payload":{...}}\`
- GET /api/signal?callId=<uuid>&after=0
- POST /api/leave
- POST /api/report: \`{"callId":"uuid","reason":"nudity|harassment|hate|spam|underage|other","details":"..."}\`

Session cookie is HttpOnly, SameSite=Strict. Only call participants can fetch/send that call's signals.

## Known limits before a public launch
- STUN-only mode can fail on CGNAT, symmetric NAT, or restrictive corporate/mobile networks. Add short-lived TURN credentials from a provider and test different networks.
- Browser polling instead of a persistent signaling WebSocket increases database reads/writes and connection setup latency.
- Implement automated moderation, real age assurance, bot controls, IP/device-based rate limits, admin review, appeals, and a content-retention policy.
- Add scheduled deletion of expired sessions and old signaling payloads (signals currently persist). Do not market this as privacy-safe until retention/abuse protections are in place.
- Anonymous bans are easily evaded by clearing cookies.
- This is a limited two-person prototype; verify on real devices before wider release.
