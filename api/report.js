import { api, db, jsonBody, currentGuest, validUuid, ApiError } from "./_lib/core.js";
const reasons = ["nudity","harassment","hate","spam","underage","other"];
export default api(["POST"], async (req, res) => {
  const { callId, reason, details = "" } = jsonBody(req);
  if (!validUuid(callId) || !reasons.includes(reason) ||
      typeof details !== "string" || details.length > 1000)
    throw new ApiError(400, "Invalid report");
  const sql = db(), guestId = await currentGuest(req, sql);
  const rows = await sql`INSERT INTO crosswave.reports(call_id,reporter_id,reported_id,reason,details)
    SELECT c.id,${guestId}::uuid,
      CASE WHEN c.guest_a=${guestId}::uuid THEN c.guest_b ELSE c.guest_a END,
      ${reason},${details}
    FROM crosswave.calls c
    WHERE c.id=${callId}::uuid AND c.started_at > now()-interval '7 days'
      AND (c.guest_a=${guestId}::uuid OR c.guest_b=${guestId}::uuid)
    ON CONFLICT (call_id,reporter_id) DO NOTHING RETURNING id,reported_id`;
  if (!rows.length) throw new ApiError(409, "Report already submitted or call unavailable");
  await sql`INSERT INTO crosswave.blocks(blocker_id,blocked_id)
    VALUES(${guestId}::uuid,${rows[0].reported_id}::uuid) ON CONFLICT DO NOTHING`;
  return res.status(201).json({ ok: true, reportId: rows[0].id, blocked: true });
});
