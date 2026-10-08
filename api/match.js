import { api, db, jsonBody, currentGuest, ApiError } from "./_lib/core.js";
export default api(["POST"], async (req, res) => {
  const { mode } = jsonBody(req);
  if (!["video","text"].includes(mode)) throw new ApiError(400, "Invalid chat mode");
  const sql = db();
  const guestId = await currentGuest(req, sql);
  const rows = await sql`SELECT * FROM crosswave.find_match(${guestId}::uuid,${mode}::text)`;
  const r = rows[0];
  return res.status(200).json({ state: r.state, callId: r.call_id, peerId: r.peer_id, initiator: r.initiator });
});
