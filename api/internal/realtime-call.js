import { createHash, timingSafeEqual } from "node:crypto";
import { api, db, jsonBody, validUuid, ApiError } from "../_lib/core.js";

function authorized(req) {
  const expected=process.env.REALTIME_SHARED_SECRET;
  const received=req.headers["x-crosswave-realtime-key"];
  if (!expected || expected.length<32 || typeof received!=="string") return false;
  return timingSafeEqual(
    createHash("sha256").update(received).digest(),
    createHash("sha256").update(expected).digest()
  );
}

// Persist only match/close events. No status polling or ICE writes in Neon.
// A persisted call ID preserves the existing reporting and blocking workflow.
export default api(["POST"],async(req,res) => {
  if (!authorized(req)) throw new ApiError(401,"Unauthorized");
  const input=jsonBody(req),sql=db();
  if(input.action==="open") {
    const {callId,guestA,guestB,mode}=input;
    if(!validUuid(callId)||!validUuid(guestA)||!validUuid(guestB)||
       guestA===guestB||!["video","text"].includes(mode))
      throw new ApiError(400,"Invalid match");
    const rows=await sql`INSERT INTO crosswave.calls(id,guest_a,guest_b,mode)
      SELECT ${callId}::uuid,a.id,b.id,${mode}
      FROM crosswave.guests a CROSS JOIN crosswave.guests b
      WHERE a.id=${guestA}::uuid AND b.id=${guestB}::uuid
        AND a.expires_at>now() AND b.expires_at>now()
        AND (a.banned_until IS NULL OR a.banned_until<=now())
        AND (b.banned_until IS NULL OR b.banned_until<=now())
        AND NOT EXISTS (SELECT 1 FROM crosswave.blocks bl
          WHERE (bl.blocker_id=a.id AND bl.blocked_id=b.id)
             OR (bl.blocker_id=b.id AND bl.blocked_id=a.id))
        AND NOT EXISTS (SELECT 1 FROM crosswave.calls c
          WHERE c.ended_at IS NULL
            AND (c.guest_a IN (a.id,b.id) OR c.guest_b IN (a.id,b.id)))
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if(!rows.length) throw new ApiError(409,"Pair unavailable");
    return res.status(201).json({callId:rows[0].id});
  }
  if(input.action==="close") {
    const {callId,endedBy}=input;
    if(!validUuid(callId)||!validUuid(endedBy)) throw new ApiError(400,"Invalid close");
    const rows=await sql`UPDATE crosswave.calls
      SET ended_at=now(),ended_by=${endedBy}::uuid
      WHERE id=${callId}::uuid AND ended_at IS NULL
        AND (guest_a=${endedBy}::uuid OR guest_b=${endedBy}::uuid)
      RETURNING id`;
    return res.status(200).json({closed:rows.length>0});
  }
  throw new ApiError(400,"Invalid action");
});
