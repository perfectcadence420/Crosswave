import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "./core.js";
const COOKIE="__Host-straylo_admin", TTL_MS=12*60*60*1000;
function config(){
 const password=process.env.STRAYLO_ADMIN_PASSWORD,key=process.env.STRAYLO_ADMIN_SESSION_SECRET;
 if(!password||password.length<24||!key||key.length<48)throw new ApiError(503,"Admin access not configured");
 return {password,key};
}
function safeEqual(a,b){
 const x=Buffer.from(String(a)),y=Buffer.from(String(b));
 return x.length===y.length&&timingSafeEqual(x,y);
}
export function validPassword(candidate){
 const {password}=config();
 if(typeof candidate!=="string"||candidate.length>200)return false;
 return safeEqual(createHash("sha256").update(candidate).digest("hex"),
   createHash("sha256").update(password).digest("hex"));
}
const mac=(payload,key)=>createHmac("sha256",key).update(payload).digest("hex");
export function requireAdmin(req){
 const {key}=config();
 const cookie=String(req.headers.cookie||"").split(";").map(x=>x.trim())
   .find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1)||"";
 const [payload,signature,...extra]=cookie.split(".");
 if(extra.length||!payload||!signature||!/^[A-Za-z0-9_-]{30,200}$/.test(payload)||
   !/^[a-f0-9]{64}$/.test(signature)||!safeEqual(signature,mac(payload,key)))
   throw new ApiError(401,"Admin sign-in required");
 let data;
 try{data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"))}catch{}
 if(data?.v!==1||!Number.isSafeInteger(data.exp)||data.exp<Date.now()||
   data.exp>Date.now()+TTL_MS+60000)throw new ApiError(401,"Admin session expired");
}
export function issueAdminCookie(res){
 const {key}=config(),payload=Buffer.from(JSON.stringify({v:1,exp:Date.now()+TTL_MS,
   nonce:randomBytes(16).toString("hex")})).toString("base64url");
 res.setHeader("Set-Cookie",COOKIE+"="+payload+"."+mac(payload,key)+
   "; Max-Age="+TTL_MS/1000+"; Path=/; HttpOnly; Secure; SameSite=Strict");
}
export function clearAdminCookie(res){
 res.setHeader("Set-Cookie",COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
}