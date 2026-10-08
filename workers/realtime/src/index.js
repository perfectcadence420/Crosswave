import { DurableObject } from "cloudflare:workers";

const REMATCH_DELAY_MS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const output = (data, code = 200) => new Response(JSON.stringify(data), {
  status:code, headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
});
const decode = s => Uint8Array.from(atob(s.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));
async function checkTicket(ticket, secret) {
  if (!secret || secret.length<32 || !ticket || ticket.length>2000) throw Error("Unauthorized");
  const parts=ticket.split(".");
  if (parts.length!==2 || !parts.every(s=>/^[A-Za-z0-9_-]+$/.test(s))) throw Error("Bad ticket");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const verified=await crypto.subtle.verify("HMAC",key,decode(parts[1]),new TextEncoder().encode(parts[0]));
  if (!verified) throw Error("Bad signature");
  const token=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const now=Math.floor(Date.now()/1000);
  if (!UUID.test(token.sub||"") || token.aud!=="crosswave-realtime-v1" ||
      !Number.isInteger(token.iat) || !Number.isInteger(token.exp) ||
      token.iat>now+15 || token.exp<now || token.exp>now+90 ||
      token.exp-token.iat>90) throw Error("Expired ticket");
  return token.sub;
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (url.pathname==="/health" && request.method==="GET") return output({ok:true,service:"crosswave-realtime",rematchDelayMs:REMATCH_DELAY_MS});
    if (url.pathname!=="/connect") return output({error:"Not found"},404);
    if (request.method!=="GET" || request.headers.get("Upgrade")?.toLowerCase()!=="websocket")
      return output({error:"WebSocket required"},426);
    if (!request.headers.get("Origin") || !(env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).includes(request.headers.get("Origin")))
      return output({error:"Origin denied"},403);
    const parts=(request.headers.get("Sec-WebSocket-Protocol")||"").split(",").map(x=>x.trim());
    if (!parts.includes("crosswave.v1")) return output({error:"Protocol required"},400);
    let guestId;
    try { guestId=await checkTicket(parts.find(x=>x.startsWith("auth."))?.slice(5),env.REALTIME_SHARED_SECRET); }
    catch { return output({error:"Expired or invalid ticket"},401); }
    // Single global pool for beta; later shard by geography.
    const id=env.MATCHMAKER.idFromName("crosswave-global-beta");
    return env.MATCHMAKER.get(id).fetch("https://crosswave.internal/connect",{
      method:"GET",headers:{Upgrade:"websocket","X-Crosswave-Guest":guestId}
    });
  }
};

export class Matchmaker extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.ctx=ctx;
    this.env=env;
    this.sessions=new Map();
    this.queue=Promise.resolve();
    for(const ws of ctx.getWebSockets()) {
      const s=ws.deserializeAttachment();
      if (s?.guestId && UUID.test(s.guestId)) this.sessions.set(ws,s);
    }
  }
  save(ws,s) { this.sessions.set(ws,s);ws.serializeAttachment(s); }
  send(ws,obj) { if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
  findGuest(id) {
    for(const [ws,s] of this.sessions) if(s.guestId===id) return [ws,s];
    return null;
  }
  async fetch(req) {
    const guestId=req.headers.get("X-Crosswave-Guest");
    if(req.headers.get("Upgrade")?.toLowerCase()!=="websocket"||!UUID.test(guestId||""))
      return output({error:"Unauthorized"},401);
    if(this.sessions.size>=2500) return output({error:"Lobby at capacity"},503);
    const old=this.findGuest(guestId);
    if(old) {
      await this.leave(old[0],false);
      old[0].close(4000,"New session");
      this.sessions.delete(old[0]);
    }
    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server,[guestId]);
    this.save(server,{guestId,mode:null,state:"idle",peerId:null,callId:null,
      joinedAt:0,lastPeerId:null,lastPeerAt:0,windowStart:Date.now(),messages:0});
    this.send(server,{type:"ready"});
    return new Response(null,{status:101,webSocket:client,
      headers:{"Sec-WebSocket-Protocol":"crosswave.v1"}});
  }
  sequence(task) {
    this.queue=this.queue.catch(()=>{}).then(task);
    this.ctx.waitUntil(this.queue);
  }
  async alarm() {
    // Durable Object alarms continue the search after the 5-second exclusion
    // expires, even when neither client sends another WebSocket message.
    this.sequence(async()=>{
      for(const [ws,s] of [...this.sessions]) {
        if(s.state==="waiting" && s.mode && ws.readyState===WebSocket.OPEN)
          await this.join(ws,s.mode);
      }
    });
    await this.queue;
  }
  async scheduleRematch() {
    // Only arm the alarm if two eligible waiting guests are temporarily
    // excluded because they recently spoke to one another.
    const now=Date.now();
    let earliest=Infinity;
    for(const [ws,s] of this.sessions) {
      if(s.state!=="waiting" || !s.lastPeerId || ws.readyState!==WebSocket.OPEN) continue;
      const partner=this.findGuest(s.lastPeerId);
      if(!partner || partner[0].readyState!==WebSocket.OPEN ||
         partner[1].state!=="waiting" || partner[1].mode!==s.mode) continue;
      const availableAt=Math.max(s.lastPeerAt||0,partner[1].lastPeerAt||0)+REMATCH_DELAY_MS;
      if(availableAt>now) earliest=Math.min(earliest,availableAt);
    }
    if(!Number.isFinite(earliest)) return;
    const scheduled=await this.ctx.storage.getAlarm();
    if(scheduled===null || scheduled<=now || scheduled>earliest)
      await this.ctx.storage.setAlarm(earliest);
  }
  webSocketMessage(ws,raw) {
    this.sequence(async()=>{
      const s=this.sessions.get(ws);
      if(!s||typeof raw!=="string"||raw.length>70000) {
        this.send(ws,{type:"error",message:"Invalid message"});return;
      }
      if(Date.now()-s.windowStart>=60000) {s.windowStart=Date.now();s.messages=0;}
      s.messages++;
      this.save(ws,s);
      if(s.messages>240) {
        this.send(ws,{type:"error",message:"Too many messages"});
        await this.leave(ws,false);
        ws.close(1008,"Rate limit");
        return;
      }
      let msg;
      try {msg=JSON.parse(raw);}catch {this.send(ws,{type:"error",message:"Invalid JSON"});return;}
      if(!msg||typeof msg!=="object"||Array.isArray(msg)) return;
      if(msg.type==="join") await this.join(ws,msg.mode);
      else if(msg.type==="next") {
        await this.leave(ws,false);
        await this.join(ws,msg.mode||s.mode);
      } else if(msg.type==="leave") await this.leave(ws,false);
      else if(msg.type==="signal") this.signal(ws,msg);
      else this.send(ws,{type:"error",message:"Unknown action"});
    });
  }
  async backend(body) {
    if(!this.env.API_BASE_URL||!this.env.REALTIME_SHARED_SECRET) throw Error("Bridge unconfigured");
    const res=await fetch(this.env.API_BASE_URL.replace(/\/+$/,"")+"/api/internal/realtime-call",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Crosswave-Realtime-Key":this.env.REALTIME_SHARED_SECRET},
      body:JSON.stringify(body),signal:AbortSignal.timeout(8000)
    });
    if(res.status===409) return null;
    if(!res.ok) throw Error("Bridge HTTP "+res.status);
    return res.json();
  }
  async join(ws,mode) {
    const s=this.sessions.get(ws);
    if(!s||!["video","text"].includes(mode)) {this.send(ws,{type:"error",message:"Invalid mode"});return;}
    if(s.callId) {this.send(ws,{type:"error",message:"Leave current call first"});return;}
    if(s.state!=="waiting") s.joinedAt=Date.now();
    s.mode=mode;s.state="waiting";this.save(ws,s);
    const now=Date.now();
    const candidates=[...this.sessions.entries()].filter(([w,p])=>w!==ws &&
      p.mode===mode && p.state==="waiting" && w.readyState===WebSocket.OPEN &&
      !(s.lastPeerId===p.guestId && now-s.lastPeerAt<REMATCH_DELAY_MS) &&
      !(p.lastPeerId===s.guestId && now-p.lastPeerAt<REMATCH_DELAY_MS))
      .sort((a,b)=>{
        // If a fresh stranger is also waiting, pair with them before
        // falling back to the person this guest most recently skipped.
        const repeatA=Number(s.lastPeerId===a[1].guestId || a[1].lastPeerId===s.guestId);
        const repeatB=Number(s.lastPeerId===b[1].guestId || b[1].lastPeerId===s.guestId);
        return repeatA-repeatB || a[1].joinedAt-b[1].joinedAt;
      });
    for(const [w,p] of candidates.slice(0,16)) {
      if(ws.readyState!==WebSocket.OPEN || w.readyState!==WebSocket.OPEN) break;
      s.state="matching";p.state="matching";this.save(ws,s);this.save(w,p);
      const callId=crypto.randomUUID();
      let match;
      try {match=await this.backend({action:"open",callId,guestA:p.guestId,guestB:s.guestId,mode});}
      catch {
        s.state="waiting";p.state="waiting";this.save(ws,s);this.save(w,p);
        this.send(ws,{type:"error",message:"Match service unavailable"});return;
      }
      if(!match?.callId) {
        s.state="waiting";p.state="waiting";this.save(ws,s);this.save(w,p);continue;
      }
      s.state="matched";s.callId=callId;s.peerId=p.guestId;
      p.state="matched";p.callId=callId;p.peerId=s.guestId;
      this.save(ws,s);this.save(w,p);
      this.send(w,{type:"matched",callId,initiator:true,mode});
      this.send(ws,{type:"matched",callId,initiator:false,mode});
      return;
    }
    s.state="waiting";this.save(ws,s);this.send(ws,{type:"waiting",mode});
    await this.scheduleRematch();
  }
  signal(ws,msg) {
    const s=this.sessions.get(ws);
    if(!s?.callId || s.callId!==msg.callId || !["offer","answer","ice","text","profile","typing"].includes(msg.kind) ||
       !msg.payload || typeof msg.payload!=="object" || Array.isArray(msg.payload)) return;
    if(msg.kind==="text" && (typeof msg.payload.text!=="string" ||
        msg.payload.text.length<1 || msg.payload.text.length>1000)) return;
    if(msg.kind==="profile" && (typeof msg.payload.nickname!=="string" ||
      !/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{1,23}$/u.test(msg.payload.nickname))) return;
    if(msg.kind==="typing" && (typeof msg.payload.active!=="boolean" ||
      Object.keys(msg.payload).length!==1)) return;
    const peer=this.findGuest(s.peerId);
    if(!peer||peer[1].callId!==s.callId||peer[1].peerId!==s.guestId) return;
    this.send(peer[0],{type:"signal",callId:s.callId,kind:msg.kind,payload:msg.payload});
  }
  async leave(ws,notifySelf=true) {
    const s=this.sessions.get(ws);
    if(!s) return;
    const callId=s.callId,peerId=s.peerId;
    if (callId && peerId) {s.lastPeerId=peerId;s.lastPeerAt=Date.now();}
    s.callId=null;s.peerId=null;s.state="idle";this.save(ws,s);
    if(callId) {
      const peer=this.findGuest(peerId);
      if(peer && peer[1].callId===callId) {
        peer[1].lastPeerId=s.guestId;peer[1].lastPeerAt=Date.now();
        peer[1].callId=null;peer[1].peerId=null;peer[1].state="waiting";
        peer[1].joinedAt=Date.now();
        this.save(peer[0],peer[1]);this.send(peer[0],{type:"peer-left"});
      }
      try {await this.backend({action:"close",callId,endedBy:s.guestId});}
      catch {console.warn("Crosswave: failed to persist call end");}
    }
    if(notifySelf) this.send(ws,{type:"left"});
  }
  webSocketClose(ws) {this.sequence(async()=>{await this.leave(ws,false);this.sessions.delete(ws);});}
  webSocketError(ws) {this.webSocketClose(ws);}
}
