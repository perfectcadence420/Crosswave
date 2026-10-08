import { api } from "./_lib/core.js";

// Default-off switch. Preserve proven polling until the new Worker is tested.
export default api(["GET"],async(_req,res) => {
  const url=process.env.REALTIME_WEBSOCKET_URL||"";
  const enabled=process.env.REALTIME_ENABLED==="true" &&
    typeof process.env.REALTIME_SHARED_SECRET==="string" &&
    process.env.REALTIME_SHARED_SECRET.length>=32 &&
    /^wss:\/\/[a-z0-9.-]+\/connect$/i.test(url);
  return res.status(200).json({enabled,url:enabled?url:null});
});
