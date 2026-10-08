# Straylo — random video and text chat

## Straylo private admin dashboard (October 2026)

Open `https://straylo.com/admin` to sign in with the owner password. The admin interface is independent of guest chat routes and cannot fetch metrics before a secure 12-hour signed, HTTP-only cookie is issued. Admin passwords and the HMAC session key live **only in Vercel production environment variables** `STRAYLO_ADMIN_PASSWORD` and `STRAYLO_ADMIN_SESSION_SECRET`, each with strong random values. Do not commit or expose those values in client bundles. Logout destroys the client cookie. Change the password by rotating the Vercel env values and redeploying; rotate the session secret to invalidate previously issued cookies.

`GET /api/admin/metrics?range=24h|7d|30d` returns read-only aggregate counts from Neon: guest sessions started, matches formed, completed calls, average completed-call duration, completed calls lasting 30+ seconds, report counts and reasons, and UTC hourly/daily trend buckets. **Matches formed are not verified successful WebRTC connections**, and a visitor can participate in several matches. No message contents, IP addresses, tokens, session nicknames, or identifying report details are exposed. Guest session counts measure sessions created on starting chat, not homepage visits or ad click conversions.

Live socket counts are read directly from Cloudflare's Durable Object via `/internal/metrics` (available only with the `REALTIME_SHARED_SECRET` server-to-server header). The endpoint returns connected WebSockets, queued video/text participants, and matched calls; it is not a public API. On errors or if the updated Worker hasn't deployed, the admin dashboard explicitly shows **Worker stats unavailable** instead of fabricating live counts. Historical Neon aggregates still work.

On Vercel Hobby, the /api/admin/* actions and existing /api/health share a single api/admin.js function, keeping the repository within the 12-function deployment limit. Do not add separate api/admin/*.js files without reviewing this limit first.

This dashboard does not contain provider billing usage, which is only available on the Cloudflare, Neon and Vercel usage pages linked in the interface. It refreshes every 30 seconds while open; metric windows use UTC calendar days and 24 UTC hours.

## iPhone Safari keyboard layout fix (October 2026)

Lock the active chat view to the visual viewport rather than placing it in a body with a taller fixed minimum height. When iOS opens the keyboard, the visual viewport's height **and vertical offset** can change. Straylo updates the fixed chat shell from both its resize and scroll events and prevents root-document scrolling; the messages list stays the only scrolling area. During text-chat input with the keyboard open, the nonessential session footer hides, keeping the message composer and Send button directly above the keyboard. Keyboard detection tracks viewport height relative to the unoccluded baseline and resets on rotation. Returning home removes the scroll lock. Text fields retain 16px fonts to avoid Safari focus zoom.

## Five-second rematching after Next (October 2026)

Cloudflare's Durable Object matchmaking now temporarily excludes the previous stranger for **five seconds** after Next or a peer departure. It still prioritizes unfamiliar guests whenever available. If the previous pair are the only compatible waiting guests, a **Durable Object alarm** retries matching at the end of the cooldown, without requiring either device to click anything. Reports/blocks and bans remain enforced by the existing Neon-backed call creation endpoint, so blocked guests cannot reconnect. The legacy HTTP fallback already had no recent-peer exclusion and is unchanged.

## One-tap mode selection (October 2026)

Choosing Text or Video on the homepage immediately begins matchmaking, once nickname, 18+ confirmation, and community rules are complete. There is no second required Start click. During the connection setup we show "Connecting to matchmaking…" and only show "Waiting for someone to connect…" once the waiting queue has confirmed the join. After Stop or an error, the existing Start button remains as a manual retry. This applies to both HTTP fallback and WebSocket matchmaking.

## Session onboarding and typing indicators (October 2026)

- Before opening either chat mode, visitors enter a nickname (2–24 characters, letters/numbers and limited punctuation) and confirm 18+ and community rules on the **home screen**. These controls are not repeated in the live chat view.
- Nicknames are session-only and visible to the current stranger; no registered accounts are implied.
- Text and video-plus-text conversations show a remote nickname in the Messages heading, label received messages with it and show an ephemeral **nickname is typing…** indicator.
- Typing notifications are debounced, expire after 4 seconds, and clear after a message arrives or the call ends.
- WebSocket signaling handles ephemeral `profile`/`typing` events directly. Legacy HTTP signaling wraps these events into the existing `text` kind with an internal subtype, preserving the current Neon database kind constraint and interoperability with older browsers.
- Mobile text chat fills the viewport with compact controls. Inputs use at least 16 px font to avoid iOS Safari focus zoom, and visualViewport resize keeps the composer in view above the virtual keyboard.
- Text-only chat hides the unnecessary close (X) button; the video-chat message drawer retains its close button.
- Direct links to `/chat/video` or `/chat/text` without completed onboarding safely show the home screen rather than opening an unconsented session.

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


This repository contains Straylo's immersive browser client, WebRTC media transport, and Vercel serverless APIs backed by the existing Neon database.

## Architecture
- Browser: camera/microphone via getUserMedia; peer-to-peer video/audio via WebRTC, plus text mode.
- Vercel: anonymous guest session, matchmaking, status polling, WebRTC signaling, leave, abuse report/block APIs.
- Neon: guests, matching queue, calls, signaling messages, reports, blocks and moderation actions.
- STUN servers are public; optional TURN relays require server-side TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL.
- Video and audio streams go peer-to-peer when reachable or through a TURN relay when one is configured. They are **not** stored in Neon.

## How to test with two people
1. Use the same **production domain** or preview deployment hostname on both devices, and choose the same mode from the home screen.
2. Each tester accepts the 18+ and rules checkboxes.
3. Choose Video or Text to open fullscreen chat. Confirm consent and click **Start**; for video, grant camera/microphone permissions.
4. First user sees "Looking for a stranger…"; once the second joins, both show "Match found".
5. During video, each sees the other's camera, hears audio, and can send text messages via the side chat (or mobile Messages drawer). Use headphones to avoid feedback.
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


## Unified video quality (October 2026)

Straylo now uses **one video profile** for everyone. There is no quality selector.

- Capture target: **1920×1080 at 30 fps** on cameras that support it, with browser fallback.
- Outbound encoding: up to **5 Mbps** video bitrate and 30 fps; the browser dynamically adapts to congestion, CPU and hardware.
- WebRTC transport and Cloudflare TURN settings are unchanged; these limits also apply to the HTTP matchmaking flow and optional WebSocket flow.
- Actual received resolution, frame rate, recent jitter-buffer average, connection route and RTT remain available in diagnostics.
- The high-quality profile may increase TURN usage or make weak network issues more apparent. We can adjust it centrally later without having to change a user setting.

These are *targets and ceilings*, not fixed-quality guarantees. The previously observed approximately 1-fps playback and second-long jitter buffer are not automatically resolved by raising camera capture quality. Real-device testing remains necessary.
