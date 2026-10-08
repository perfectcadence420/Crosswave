"use strict";
const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(Number(n))?new Intl.NumberFormat().format(Number(n)):"—";
const seconds=s=>s===null||!Number.isFinite(Number(s))?"—":Number(s)>=3600?
  Math.floor(s/3600)+"h "+Math.floor(s%3600/60)+"m":Number(s)>=60?
  Math.floor(s/60)+"m "+Math.round(s%60)+"s":Math.round(s)+"s";
let selectedRange="7d",timer=null,pending=false,loggedIn=false;
const setText=(id,value)=>{$(id).textContent=value};
async function api(url,options={}){
 const res=await fetch(url,{credentials:"same-origin",cache:"no-store",...options});
 let data;try{data=await res.json()}catch{data={}}
 if(!res.ok)throw Object.assign(Error(data.error||"Unable to load data"),{status:res.status});
 return data;
}
function showLogin(message=""){
 loggedIn=false;clearInterval(timer);timer=null;
 $("loginView").classList.remove("hidden");$("dashboard").classList.add("hidden");
 $("logoutBtn").classList.add("hidden");$("syncLabel").textContent="Private analytics";
 $("loginError").textContent=message;$("loginError").classList.toggle("hidden",!message);
}
function showDashboard(){
 loggedIn=true;
 $("loginView").classList.add("hidden");$("dashboard").classList.remove("hidden");
 $("logoutBtn").classList.remove("hidden");
 $("syncLabel").textContent="Secure analytics";
 if(!timer)timer=setInterval(()=>void loadData(),30000);
 void loadData();
}
const reasonLabels={nudity:"Nudity / sexual content",harassment:"Harassment",hate:"Hate / threats",
  underage:"Underage",spam:"Spam",other:"Other"};
function reportReasons(rows){
 const root=$("reportReasons");root.replaceChildren();
 if(!rows.length){const p=document.createElement("p");p.className="empty";p.textContent="No reports in this period.";root.append(p);return}
 const max=Math.max(1,...rows.map(row=>Number(row.total)||0));
 for(const row of rows){
  const wrap=document.createElement("div");wrap.className="reason";
  const name=document.createElement("span");name.textContent=reasonLabels[row.reason]||"Other";
  const meter=document.createElement("div");meter.className="meter";
  const fill=document.createElement("div");fill.className="fill";
  fill.style.width=Math.max(3,Number(row.total||0)/max*100)+"%";meter.append(fill);
  const count=document.createElement("strong");count.textContent=fmt(row.total);
  wrap.append(name,meter,count);root.append(wrap);
 }
}
function plotChart(data){
 const root=$("trendChart");root.replaceChildren();
 const hourly=selectedRange==="24h",count=hourly?24:selectedRange==="7d"?7:30;
 const lookups={};
 for(const [type,rows] of Object.entries(data)){
  lookups[type]=new Map((rows||[]).map(item=>{
   const str=String(item.bucket);return [str.slice(0,hourly?13:10),Number(item.total)||0];
  }));
 }
 const now=new Date(),basis=new Date(now.getTime());
 if(hourly)basis.setUTCMinutes(0,0,0);else basis.setUTCHours(0,0,0,0);
 const points=[];
 for(let i=count-1;i>=0;i--){
  const at=new Date(basis.getTime()-i*(hourly?3600000:86400000));
  const key=at.toISOString().slice(0,hourly?13:10);
  points.push({key,guests:lookups.guests.get(key)||0,matches:lookups.matches.get(key)||0});
 }
 const peak=Math.max(1,...points.flatMap(p=>[p.matches,p.guests]));
 if(!points.some(p=>p.guests||p.matches)){
  const empty=document.createElement("p");empty.className="chart-empty";
  empty.textContent="No matches or new sessions in this period.";root.append(empty);return;
 }
 for(const p of points){
  const col=document.createElement("div");col.className="bar-column";col.tabIndex=0;
  const label=hourly?p.key.slice(11)+":00 UTC":p.key.slice(5);
  col.title=label+" · "+p.guests+" guest sessions · "+p.matches+" matches";
  col.setAttribute("aria-label",col.title);
  for(const type of ["guests","matches"]){
   const bar=document.createElement("div");bar.className="bar"+(type==="matches"?" match":"");
   bar.style.height=(p[type]?Math.max(2,p[type]/peak*100):0)+"%";col.append(bar);
  }
  root.append(col);
 }
 root.setAttribute("aria-label","Guest sessions and matches over "+selectedRange+" (UTC)");
}
function render(data){
 const {live,summary:s,buckets,reportReasons:reasonRows}=data;
 setText("livePeople",live.available?fmt(live.connected):"—");
 setText("liveWaiting",live.available?fmt(live.waiting):"—");
 setText("liveCalls",live.available?fmt(live.activeCalls):"—");
 setText("waitingSplit",live.available?fmt(live.waitingText)+" text · "+fmt(live.waitingVideo)+" video":"Worker stats unavailable");
 setText("activeSplit",live.available?fmt(live.activeText)+" text · "+fmt(live.activeVideo)+" video":"Worker stats unavailable");
 setText("liveBadge",live.available?"● Live":"Not available");
 $("liveBadge").classList.toggle("offline",!live.available);
 setText("newGuests",fmt(s.guestSessions));setText("matches",fmt(s.matchesFormed));
 setText("avgDuration",seconds(s.averageSeconds));setText("longCalls",fmt(s.conversations30s));
 setText("durationSub","Based on "+fmt(s.finishedCalls)+" finished calls");
 setText("totalReports",fmt(s.reports));setText("openReports",fmt(s.openReports));
 setText("reportRate",s.reportsPer100Matches===null?"—":fmt(s.reportsPer100Matches));
 setText("periodLabel",selectedRange==="24h"?"Last 24 hours · UTC":selectedRange==="7d"?"Last 7 days · UTC":"Last 30 days · UTC");
 setText("lastChecked","Updated "+new Date(data.at).toLocaleTimeString()+" · auto-refresh 30s");
 plotChart(buckets);reportReasons(reasonRows);
}
async function loadData(){
 if(!loggedIn||pending)return;
 pending=true;$("refreshBtn").disabled=true;
 $("dashError").classList.add("hidden");
 try{render(await api("/api/admin/metrics?range="+encodeURIComponent(selectedRange)))}
 catch(err){
  if(err.status===401){showLogin("Your admin session expired. Please sign in again.");return}
  $("dashError").textContent="Couldn't update the dashboard: "+err.message;
  $("dashError").classList.remove("hidden");
 }finally{pending=false;$("refreshBtn").disabled=false}
}
$("loginForm").addEventListener("submit",async(event)=>{
 event.preventDefault();const button=$("loginBtn");button.disabled=true;
 $("loginError").classList.add("hidden");
 try{
  await api("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({password:$("password").value})});
  $("password").value="";showDashboard();
 }catch(err){showLogin(err.message==="Incorrect password"?"Incorrect password. Please try again.":err.message)}
 finally{button.disabled=false}
});
$("logoutBtn").addEventListener("click",async()=>{
 try{await api("/api/admin/logout",{method:"POST"})}catch{}
 showLogin();
});
$("refreshBtn").addEventListener("click",()=>void loadData());
document.querySelectorAll("[data-range]").forEach(button=>button.addEventListener("click",()=>{
 if(selectedRange===button.dataset.range)return;
 selectedRange=button.dataset.range;
 document.querySelectorAll("[data-range]").forEach(other=>other.classList.toggle("selected",other===button));
 void loadData();
}));
(async()=>{
 try{(await api("/api/admin/session")).authenticated?showDashboard():showLogin()}
 catch(err){showLogin(err.message)}
})();
