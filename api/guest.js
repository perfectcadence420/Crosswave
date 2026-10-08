import { api, db, jsonBody, randomToken, tokenHash, currentGuest, COOKIE_NAME, ApiError } from "./_lib/core.js";
export default api(["POST"], async (req, res) => {
  const body = jsonBody(req);
  if (body.ageConfirmed !== true || body.rulesAccepted !== true)
    throw new ApiError(403, "Confirm you are 18+ and accept the rules");
  const sql = db();
  const existing = await currentGuest(req, sql, true);
  if (existing) return res.status(200).json({ guestId: existing, resumed: true });
  const token = randomToken();
  const rows = await sql`INSERT INTO crosswave.guests(token_hash)
    VALUES (${tokenHash(token)}) RETURNING id`;
  const secure = process.env.VERCEL === "1" || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Max-Age=86400; HttpOnly; SameSite=Strict; Path=/api${secure}`);
  return res.status(201).json({ guestId: rows[0].id, resumed: false });
});
