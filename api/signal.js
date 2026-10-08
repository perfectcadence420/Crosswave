import { api, db, jsonBody, currentGuest, validUuid, ApiError } from "./_lib/core.js";
export default api(["GET","POST"], async (req, res) => {
  const sql = db(), guestId = await currentGuest(req, sql);
  const body = req.method === "POST" ? jsonBody(req) : req.query;
  const callId = body.callId;
  if (!validUuid(callId)) throw new ApiError(400, "Invalid call ID");
  if (req.method === "GET") {
    const after = String(body.after ?? "0");
    if (!/^(0|[1-9][0-9]{0,17})$/.test(after)) throw new ApiError(400, "Invalid cursor");
    const rows = await sql`SELECT s.id::text AS id,s.kind,s.payload,s.created_at
      FROM crosswave.signals s JOIN crosswave.calls c ON c.id=s.call_id
      WHERE s.call_id=${callId}::uuid AND s.receiver_id=${guestId}::uuid
        AND c.ended_at IS NULL AND (c.guest_a=${guestId}::uuid OR c.guest_b=${guestId}::uuid)
        AND s.id > ${after}::bigint
      ORDER BY s.id LIMIT 100`;
    return res.status(200).json({ signals: rows, nextCursor: rows.at(-1)?.id || after });
  }
  const { kind, payload } = body;
  if (!["offer","answer","ice","text"].includes(kind) ||
      !payload || typeof payload !== "object" || Array.isArray(payload))
    throw new ApiError(400, "Invalid signal");
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > 65536) throw new ApiError(413, "Signal too large");
  if (kind === "text" &&
      (typeof payload.text !== "string" || payload.text.length < 1 || payload.text.length > 1000))
    throw new ApiError(400, "Text message must be 1-1000 characters");
  const rows = await sql`INSERT INTO crosswave.signals(call_id,sender_id,receiver_id,kind,payload)
    SELECT c.id,${guestId}::uuid,
      CASE WHEN c.guest_a=${guestId}::uuid THEN c.guest_b ELSE c.guest_a END,
      ${kind},${JSON.stringify(payload)}::jsonb
    FROM crosswave.calls c
    WHERE c.id=${callId}::uuid AND c.ended_at IS NULL
      AND (c.guest_a=${guestId}::uuid OR c.guest_b=${guestId}::uuid)
    RETURNING id::text AS id`;
  if (!rows.length) throw new ApiError(404, "Call not found");
  return res.status(201).json({ id: rows[0].id });
});
