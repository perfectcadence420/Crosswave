import { api } from "./_lib/core.js";

// STUN-only is sufficient for basic trials but TURN is required for restrictive NATs.
// Configure short-lived TURN credentials from a trusted provider before public launch.
export default api(["GET"], async (_req, res) => {
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
  const urls = (process.env.TURN_URLS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  return res.status(200).json({ iceServers, turnAvailable: iceServers.length > 2 });
});
