import { api, db, currentGuest } from "./_lib/core.js";
export default api(["GET"], async (req, res) => {
  const sql = db();
  const guestId = await currentGuest(req, sql);
  // End a disconnected call only after the other participant has missed heartbeats.
  await sql`UPDATE crosswave.calls c SET ended_at=now()
    WHERE c.ended_at IS NULL AND (c.guest_a=${guestId}::uuid OR c.guest_b=${guestId}::uuid)
      AND EXISTS (SELECT 1 FROM crosswave.guests g
        WHERE g.id=CASE WHEN c.guest_a=${guestId}::uuid THEN c.guest_b ELSE c.guest_a END
        AND g.last_seen_at < now()-interval '90 seconds')`;
  const calls = await sql`SELECT id,mode,
      CASE WHEN guest_a=${guestId}::uuid THEN guest_b ELSE guest_a END AS peer_id,
      (guest_a=${guestId}::uuid) AS initiator
    FROM crosswave.calls WHERE ended_at IS NULL
      AND (guest_a=${guestId}::uuid OR guest_b=${guestId}::uuid)
    ORDER BY started_at DESC LIMIT 1`;
  if (calls.length) return res.status(200).json({
    state: "matched", callId: calls[0].id, mode: calls[0].mode,
    peerId: calls[0].peer_id, initiator: calls[0].initiator
  });
  const queue = await sql`UPDATE crosswave.waiting_queue
    SET last_seen_at=now() WHERE guest_id=${guestId}::uuid RETURNING mode`;
  return res.status(200).json({ state: queue.length ? "waiting" : "idle",
    mode: queue[0]?.mode || null });
});
