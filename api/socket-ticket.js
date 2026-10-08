import { createHmac } from "node:crypto";
import { api, db, currentGuest, ApiError } from "./_lib/core.js";

// Mint short-lived, signed tickets for the Cloudflare WebSocket service.
// Never expose REALTIME_SHARED_SECRET or include tickets in URLs.
export default api(["POST"], async (req,res) => {
  const secret=process.env.REALTIME_SHARED_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503,"Realtime not configured");
  const guestId=await currentGuest(req,db());
  const now=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({
    sub:guestId,aud:"crosswave-realtime-v1",iat:now,exp:now+60
  })).toString("base64url");
  const signature=createHmac("sha256",secret).update(payload).digest("base64url");
  return res.status(200).json({ticket:payload+"."+signature,expiresIn:60});
});
