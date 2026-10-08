# Straylo — random video and text chat

Straylo is the public-facing brand for this repository. The original Crosswave infrastructure identifiers, Neon schema, guest cookie, Vercel project, and Cloudflare Worker name are intentionally retained for compatibility while the domain transition is pending.

## New mobile-first experience
- Landing screen has two choices: **Video chat** and **Text chat**.
- Choosing a mode opens a full-height app route: `/chat/video` or `/chat/text`.
- Desktop video places the stranger's video prominently next to your own, with persistent messages on the side.
- Mobile video uses a large stranger view and picture-in-picture for your camera. The Messages icon opens the integrated text chat as a drawer.
- **Both video and text chat support sending and receiving text messages**. The mode only decides whether WebRTC camera/audio is included.
- **Back** disconnects the session and returns to the landing page, as does browser back.
- The 18+ and rules checkboxes remain mandatory to connect. Report, block, Next, Stop, quality profiles and Cloudflare TURN are retained.
- The regular site still uses HTTP matchmaking; the test link with `?realtime=1` opts into the Cloudflare Durable Object WebSocket canary.
- Client-side routes need the Vercel rewrite in `vercel.json`.

**Domain:** `straylo.com` was available at the last registry lookup, but is **not purchased or connected**. Do not switch Cloudflare Worker allowed origins or `API_BASE_URL` until the purchased domain is verified and Vercel is configured to serve it.

---


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

## Fixing failed video connections — TURN relay
If matchmaking succeeds but video cannot connect, the peer-to-peer ICE handshake may be blocked by NAT/firewalls. The original version used only STUN. TURN relays allow two clients to communicate through a server when they cannot reach one another directly.

**Recommended: Cloudflare Realtime TURN.** In the Cloudflare Dashboard → Realtime → TURN, create a TURN key, then add the following encrypted **production** environment variables to the Crosswave Vercel project:

- `CLOUDFLARE_TURN_KEY_ID` — the TURN key ID.
- `CLOUDFLARE_TURN_API_TOKEN` — the TURN key API token.

Redeploy Crosswave after adding the variables (environment changes do not change already-built deployments). The authenticated `GET /api/ice` route then generates two-hour TURN credentials server-side and returns the ICE servers to the browser. It should respond with `turnAvailable: true` once configured. Never put the long-lived token into client.js, GitHub, a screenshot or browser HTML.

The original generic provider environment variables `TURN_URLS`, `TURN_USERNAME`, and `TURN_CREDENTIAL` also remain supported for an alternative TURN provider. Cloudflare TURN docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/

For the first test, use two different devices or a normal and incognito browser window on the same exact domain, with cameras allowed. Confirm the status shows "TURN relay available" after matching. If there are still failures, inspect browser chrome://webrtc-internals while the call is active to see the ICE candidate pair and connection state. Avoid sharing the full diagnostics dump because it can reveal network identifiers.

## Connection quality and latency (v1 beta)
The **Start** button now displays Searching → Connecting → Connected as the actual browser connection changes. Text chat becomes Connected on a successful match.

To keep low-spec devices and cellular networks responsive, the default video capture target is **640×360 at 24 fps** with a 900 kbps maximum video encoding bitrate (where supported); the browser is allowed to adapt quality. Compatible receivers request a modest 60–80 ms jitter buffer target. This may trade sharpness or smoothness for lower delay; it cannot overcome network latency.

Once video connects, an on-screen diagnostic shows **Route (direct/TURN), round-trip time (RTT), approximate average received video jitter buffer, and FPS** if the browser supports these WebRTC statistics. RTT and jitter buffer are **not** the total mouth-to-screen audio/video delay; recording an actual test is still the best way to estimate it. This display uses only counters and candidate types, and never shows network IPs or TURN secrets.


## Video quality profiles (October 2026)

The beta previously forced every user to 640×360 at 24 fps and a 900 Kbps video bitrate ceiling. This visibly degraded quality in normal calls. Camera quality is now selectable **before** joining a call:

- **Balanced** (default): target 1280×720, 30 fps, up to 1.8 Mbps video.
- **Sharper**: target 1280×720, 30 fps, up to 2.7 Mbps video.
- **Low data**: target 640×360, 24 fps, up to 800 Kbps video.

These are browser hints and encoding *ceilings*, not fixed bitrates or a promise of transmitted resolution. Higher settings can increase TURN traffic and may worsen lag on congested networks; use Low data on unstable mobile or slow connections. Reload or Stop and Start to change quality.

Connection diagnostics now show actual *received* frame resolution and a recent (roughly last 3 seconds) jitter-buffer average, computed from deltas of WebRTC stats rather than a running lifetime average. This is still **not** end-to-end camera-to-display latency. TURN transport and geographic latency are unchanged by the quality selector.
