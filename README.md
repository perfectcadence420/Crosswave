# Crosswave backend v1

A small, private-by-default anonymous matchmaking API for the existing static landing page.
The landing page is intentionally unchanged until the next UI/WebRTC milestone.

## Setup
1. Install dependencies with `npm install`.
2. Apply `migrations/001_crosswave.sql` to the target Neon Postgres database.
3. Set `DATABASE_URL` in **server-side** Vercel environment variables (pooled Neon URL).
4. Deploy and test `GET /api/health` (must return `"database":"ok"`).

Never publish `DATABASE_URL`, check it into git, or prefix it with `NEXT_PUBLIC_`.

## API
- `POST /api/guest` body `{"ageConfirmed":true,"rulesAccepted":true}` starts an anonymous 24-hour guest session using a HttpOnly SameSite cookie scoped to `/api`.
- `POST /api/match` body `{"mode":"video"}` (or `"text"`) joins the queue or connects two guests.
- `GET /api/status` checks the waiting state, heartbeats, and active call.
- `POST /api/signal` body `{"callId":"uuid","kind":"offer|answer|ice|text","payload":{...}}` sends a WebRTC signaling message or text message to the peer.
- `GET /api/signal?callId=uuid&after=0` polls incoming peer messages.
- `POST /api/leave` exits the queue or current call.
- `POST /api/report` body `{"callId":"uuid","reason":"nudity|harassment|hate|spam|underage|other","details":"..."}` records a report and blocks rematching.

All APIs except `health` and `guest` require the guest session cookie. Cross-origin browser writes are rejected.
The browser never sees any database credential. Only participants can exchange/read their call signals.

## Not ready for a public launch
- Matchmaking uses one short global advisory lock; redesign under real load.
- Polling is a v1 signaling transport; use managed WebSocket or real-time signaling for scale.
- Provision TURN/STUN credentials and implement WebRTC client for actual audio/video.
- Add IP/device abuse defenses, bot controls, automated/manual moderation, admin workflows, and proper age assurance.
- Run a scheduled retention job for short-lived signaling records, waiting queue entries and expired sessions.
- Add end-to-end integration tests before public release.
- Guests are not verified accounts; guest bans can be evaded via new sessions. Do not describe guest-only banning as robust enforcement.
