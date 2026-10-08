import { api, db, currentGuest } from "./_lib/core.js";

// Server-side TURN credential generation; the provider's long-term secret
// never leaves Vercel. Requires a valid Crosswave guest session.
export default api(["GET"], async (req, res) => {
  await currentGuest(req, db());
  const stun = [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" }
  ];

  // Recommended provider: Cloudflare Realtime TURN.
  // API reference: https://developers.cloudflare.com/realtime/turn/generate-credentials/
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (keyId && apiToken) {
    try {
      const response = await fetch(
        "https://rtc.live.cloudflare.com/v1/turn/keys/" +
          encodeURIComponent(keyId) + "/credentials/generate-ice-servers",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ ttl: 7200 }),
          signal: AbortSignal.timeout(7000)
        }
      );
      if (response.ok) {
        const result = await response.json();
        const servers = Array.isArray(result.iceServers) ? result.iceServers : [];
        const usableRelay = servers.some(entry => {
          if (!entry?.username || !entry?.credential) return false;
          const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
          return urls.some(url => typeof url === "string" && /^turns?:/i.test(url));
        });
        if (usableRelay) {
          return res.status(200).json({
            iceServers: [...stun, ...servers],
            turnAvailable: true,
            provider: "cloudflare"
          });
        }
        console.warn("Cloudflare TURN response contained no relay credentials");
      } else {
        console.warn("Cloudflare TURN HTTP response:", response.status);
      }
    } catch (error) {
      console.warn("Cloudflare TURN unavailable:", error?.name || "unknown");
    }
  }

  // Existing manual provider configuration continues to work.
  const urls = (process.env.TURN_URLS || "").split(",")
    .map(s => s.trim()).filter(url => /^turns?:/i.test(url));
  if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    return res.status(200).json({
      iceServers: [
        ...stun,
        {
          urls,
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL
        }
      ],
      turnAvailable: true,
      provider: "manual"
    });
  }
  return res.status(200).json({
    iceServers: stun,
    turnAvailable: false,
    provider: null
  });
});
