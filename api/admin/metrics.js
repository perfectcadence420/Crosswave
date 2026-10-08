import { api,db,ApiError } from "../_lib/core.js";
import { requireAdmin } from "../_lib/admin-auth.js";
const WINDOWS={"24h":86400000,"7d":604800000,"30d":2592000000};
async function realtimeSummary(){
 const endpoint=process.env.REALTIME_WEBSOCKET_URL,secret=process.env.REALTIME_SHARED_SECRET;
 if(!endpoint||!secret||secret.length<32)return {available:false,reason:"Not configured"};
 if(!/^wss:\/\/[a-z0-9.-]+\.workers\.dev\/connect$/i.test(endpoint))
   return {available:false,reason:"Invalid Worker address"};
 try{
  const url=endpoint.replace(/^wss:/,"https:").replace(/\/connect$/,"/internal/metrics");
  const r=await fetch(url,{headers:{"X-Crosswave-Realtime-Key":secret},cache:"no-store",
    signal:AbortSignal.timeout(3500)});
  if(!r.ok)throw new Error("Worker response "+r.status);
  const data=await r.json();
  if(data.service!=="crosswave-matchmaker"||!Number.isInteger(data.connected))throw Error("Bad data");
  return {...data,available:true};
 }catch{return {available:false,reason:"Worker stats unavailable"}}
}
export default api(["GET"],async(req,res)=>{
 requireAdmin(req);
 const range=String(req.query?.range||"7d");
 if(!Object.hasOwn(WINDOWS,range))throw new ApiError(400,"Invalid range");
 const since=new Date(Date.now()-WINDOWS[range]).toISOString();
 const unit=range==="24h"?"hour":"day",sql=db();
 const [summary,matches,guests,reports,reasons,live]=await Promise.all([
  sql`SELECT
   (SELECT count(*)::int FROM crosswave.guests WHERE created_at>=${since}::timestamptz) AS guest_sessions,
   (SELECT count(*)::int FROM crosswave.calls WHERE started_at>=${since}::timestamptz) AS matches_formed,
   (SELECT count(*)::int FROM crosswave.calls WHERE started_at>=${since}::timestamptz AND ended_at IS NOT NULL) AS finished_calls,
   (SELECT count(*)::int FROM crosswave.calls WHERE started_at>=${since}::timestamptz AND ended_at IS NOT NULL AND ended_at-started_at>=interval '30 seconds') AS conversations_30s,
   (SELECT round(avg(EXTRACT(EPOCH FROM ended_at-started_at)))::int FROM crosswave.calls
    WHERE started_at>=${since}::timestamptz AND ended_at IS NOT NULL AND ended_at>=started_at) AS average_seconds,
   (SELECT count(*)::int FROM crosswave.reports WHERE created_at>=${since}::timestamptz) AS reports,
   (SELECT count(*)::int FROM crosswave.reports WHERE status='open') AS open_reports,
   (SELECT count(*)::int FROM crosswave.calls WHERE ended_at IS NULL) AS database_open_calls`,
  sql`SELECT date_trunc(${unit}::text,started_at AT TIME ZONE 'UTC') AS bucket,count(*)::int AS total
    FROM crosswave.calls WHERE started_at>=${since}::timestamptz GROUP BY 1 ORDER BY 1`,
  sql`SELECT date_trunc(${unit}::text,created_at AT TIME ZONE 'UTC') AS bucket,count(*)::int AS total
    FROM crosswave.guests WHERE created_at>=${since}::timestamptz GROUP BY 1 ORDER BY 1`,
  sql`SELECT date_trunc(${unit}::text,created_at AT TIME ZONE 'UTC') AS bucket,count(*)::int AS total
    FROM crosswave.reports WHERE created_at>=${since}::timestamptz GROUP BY 1 ORDER BY 1`,
  sql`SELECT reason,count(*)::int AS total FROM crosswave.reports
    WHERE created_at>=${since}::timestamptz GROUP BY reason ORDER BY total DESC`,
  realtimeSummary()
 ]);
 const row=summary[0]||{},total=Number(row.matches_formed||0),reportCount=Number(row.reports||0);
 return res.status(200).json({
  at:new Date().toISOString(),range,timezone:"UTC",live,
  summary:{
   guestSessions:Number(row.guest_sessions||0),matchesFormed:total,
   finishedCalls:Number(row.finished_calls||0),conversations30s:Number(row.conversations_30s||0),
   averageSeconds:row.average_seconds===null?null:Number(row.average_seconds),
   reports:reportCount,openReports:Number(row.open_reports||0),
   databaseOpenCalls:Number(row.database_open_calls||0),
   reportsPer100Matches:total?Math.round(reportCount/total*1000)/10:null
  },
  buckets:{matches,guests,reports},reportReasons:reasons
 });
});