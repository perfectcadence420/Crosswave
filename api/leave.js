import { api, db, currentGuest } from "./_lib/core.js";
export default api(["POST"], async (req, res) => {
  const sql = db(), guestId = await currentGuest(req, sql);
  const rows = await sql`SELECT crosswave.leave(${guestId}::uuid) AS ended`;
  return res.status(200).json({ ok: true, endedCall: rows[0].ended });
});
