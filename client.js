/* Crosswave phase 2: real two-person WebRTC and text matchmaking. */
(() => {
  "use strict";
  const el = id => document.getElementById(id);
  const ui = {
    local: el("local"), localPlaceholder: el("localplaceholder"),
    remote: el("remote"), remotePlaceholder: el("remoteplaceholder"),
    videoArea: el("videoarea"), textArea: el("textarea"),
    messages: el("messages"), message: el("msg"), messageForm: el("msgForm"),
    send: el("send"), cam: el("cam"), mic: el("mic"),
    start: el("start"), skip: el("skip"), stop: el("stop"),
    report: el("report"), status: el("status"),
    videoMode: el("videoMode"), textMode: el("textMode"),
    avControls: el("avControls"), adult: el("adult"), rules: el("rules"),
    consent: el("consent"), safety: el("safety"), safetyText: el("safetyText"),
    reportForm: el("reportForm"), reportReason: el("reportReason"),
    reportDetails: el("reportDetails"), reportSubmit: el("reportSubmit"),
    sound: el("enableSound"), connectionStats: el("connectionStats")
  };
  const s = {
    mode: "video", running: false, busy: false, epoch: 0,
    callId: null, peerId: null, pc: null, stream: null,
    cursor: "0", queuedIce: [], iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    pollTimer: null, signalTimer: null, statusBusy: false, signalBusy: false,
    lastError: 0, connected: false, connectionFailed: false, reportCallId: null,
    turnAvailable: false, connectionTimer: null, statsTimer: null, statsBusy: false,
    realtime: false, socket: null, pendingSignals: []
  };
  const STEP_MS = 1400;
  const SIGNAL_MS = 700;
  const isActive = (epoch, callId) => s.running && s.epoch === epoch && s.callId === callId;

  function announce(message) { ui.status.textContent = message; }
  function showRemote(message) {
    ui.remotePlaceholder.classList.remove("hidden");
    el("remoteMessage").textContent = message;
  }
  function resetMessages() {
    ui.messages.replaceChildren();
    appendMessage("Waiting for someone to connect…", "system");
  }
  function appendMessage(message, role) {
    const div = document.createElement("div");
    div.className = "chat-message " + role;
    div.textContent = message;
    ui.messages.appendChild(div);
    ui.messages.scrollTop = ui.messages.scrollHeight;
  }
  async function request(path, method = "GET", data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/" + path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: method === "GET" ? {} : { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(data || {}),
        signal: controller.signal
      });
      let result;
      try { result = await response.json(); } catch { result = {}; }
      if (!response.ok) throw new Error(result.error || "Request failed (" + response.status + ")");
      return result;
    } finally { clearTimeout(timeout); }
  }
  function syncControls() {
    const eligible = ui.adult.checked && ui.rules.checked;
    ui.start.disabled = !eligible || s.running || s.busy || s.stopPending;
    ui.start.textContent = s.busy ? "Connecting…"
      : s.running ? (s.callId
        ? (s.mode === "text" || s.connected ? "✓ Connected" : s.connectionFailed ? "Connection failed" : "Connecting…")
        : "Searching…")
      : eligible ? "Start " + s.mode + " chat" : "Agree to start";
    ui.stop.disabled = !s.running && !s.busy;
    ui.skip.disabled = !s.running || s.busy;
    ui.videoMode.disabled = s.running || s.busy;
    ui.textMode.disabled = s.running || s.busy;
    ui.message.disabled = !s.running || !s.callId || s.mode !== "text";
    ui.send.disabled = ui.message.disabled;
    ui.report.disabled = !s.running || !s.callId;
    ui.consent.textContent = eligible
      ? s.running ? "You're in a session. Click Stop before changing modes." : "Ready when you are."
      : "Accept both conditions to enable matching.";
    ui.videoMode.className = s.mode === "video" ? "primary" : "secondary";
    ui.textMode.className = s.mode === "text" ? "primary" : "secondary";
    ui.videoMode.setAttribute("aria-pressed", String(s.mode === "video"));
    ui.textMode.setAttribute("aria-pressed", String(s.mode === "text"));
  }
  function switchMode(next) {
    if (s.running || s.busy || s.mode === next) return;
    s.mode = next;
    ui.videoArea.classList.toggle("hidden", next !== "video");
    ui.textArea.classList.toggle("hidden", next !== "text");
    ui.avControls.classList.toggle("hidden", next !== "video");
    if (next === "text") releaseMedia();
    resetMessages();
    announce(next === "video" ? "Camera and microphone can be previewed before starting." : "Text chat selected. Click Start to find someone.");
    syncControls();
  }
  function updateTrackButtons() {
    const vt = s.stream?.getVideoTracks()[0];
    const at = s.stream?.getAudioTracks()[0];
    ui.cam.setAttribute("aria-pressed", String(Boolean(vt && !vt.enabled)));
    ui.mic.setAttribute("aria-pressed", String(Boolean(at && !at.enabled)));
    ui.cam.title = vt?.enabled ? "Mute camera" : "Enable camera";
    ui.mic.title = at?.enabled ? "Mute microphone" : "Enable microphone";
  }
  async function openMedia() {
    if (s.stream?.getTracks().every(t => t.readyState === "live")) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser.");
    // Prefer responsiveness over high resolution for stranger-to-stranger video.
    // These are ideal constraints; browsers may choose other sizes when necessary.
    const media = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 },
        frameRate: { ideal: 24, max: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    s.stream = media;
    ui.local.srcObject = media;
    ui.local.classList.remove("hidden");
    ui.localPlaceholder.classList.add("hidden");
    updateTrackButtons();
    try { await ui.local.play(); } catch { /* user can interact with the video */ }
  }
  function releaseMedia() {
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    s.stream = null;
    ui.local.srcObject = null;
    ui.local.classList.add("hidden");
    ui.localPlaceholder.classList.remove("hidden");
    updateTrackButtons();
  }
  async function toggleTrack(kind) {
    if (s.busy || s.mode !== "video") return;
    try {
      if (!s.stream) await openMedia();
      else {
        const track = (kind === "video" ? s.stream.getVideoTracks() : s.stream.getAudioTracks())[0];
        if (track) track.enabled = !track.enabled;
        updateTrackButtons();
      }
      if (!s.running) announce("Local preview ready. Click Start to meet someone.");
    } catch (error) { announce("Media permission error: " + error.message); }
  }

  function clearPeer() {
    clearTimeout(s.connectionTimer);
    clearInterval(s.statsTimer);
    s.connectionTimer = null;
    s.statsTimer = null;
    s.statsBusy = false;
    ui.connectionStats.textContent = "";
    ui.connectionStats.classList.add("hidden");
    if (s.pc) {
      const old = s.pc;
      s.pc = null;
      old.ontrack = null;
      old.onicecandidate = null;
      old.onconnectionstatechange = null;
      old.oniceconnectionstatechange = null;
      try { old.close(); } catch { /* already closed */ }
    }
    ui.remote.pause();
    ui.remote.srcObject = null;
    ui.remote.classList.add("hidden");
    ui.sound.classList.add("hidden");
    s.connected = false;
    s.connectionFailed = false;
    s.queuedIce = [];
    s.pendingSignals = [];
    s.cursor = "0";
    s.callId = null;
    s.peerId = null;
    showRemote("Searching for someone…");
    syncControls();
  }
  async function updateConnectionStats() {
    const pc = s.pc;
    const callId = s.callId;
    if (!pc || !s.connected || !callId || s.statsBusy || typeof pc.getStats !== "function") return;
    s.statsBusy = true;
    try {
      const report = await pc.getStats();
      if (pc !== s.pc || !s.connected || callId !== s.callId) return;
      // Aggregate only anonymous network-quality counters. Do not reveal peer
      // addresses, TURN credentials, device IDs, or session IDs.
      let pair = null;
      for (const stat of report.values()) {
        if (stat.type === "transport" && stat.selectedCandidatePairId) {
          pair = report.get(stat.selectedCandidatePairId);
          if (pair) break;
        }
      }
      if (!pair) for (const stat of report.values()) {
        if (stat.type === "candidate-pair" && (stat.selected || (stat.nominated && stat.state === "succeeded"))) {
          pair = stat;
          break;
        }
      }
      const local = pair?.localCandidateId ? report.get(pair.localCandidateId) : null;
      const remote = pair?.remoteCandidateId ? report.get(pair.remoteCandidateId) : null;
      const connectionRoute = !pair ? "Route: determining…"
        : (local?.candidateType === "relay" || remote?.candidateType === "relay") ? "Route: TURN relay"
        : "Route: direct";
      const rtt = typeof pair?.currentRoundTripTime === "number"
        ? "RTT: " + Math.round(pair.currentRoundTripTime * 1000) + " ms"
        : null;
      let buffer = null, fps = null;
      for (const stat of report.values()) {
        if (stat.type !== "inbound-rtp" || (stat.kind || stat.mediaType) !== "video") continue;
        if (stat.jitterBufferEmittedCount > 0 && Number.isFinite(stat.jitterBufferDelay)) {
          // Average time video frames spend in the receive jitter buffer,
          // not the full end-to-end delay.
          buffer = "Video buffer: " + Math.round(
            (stat.jitterBufferDelay / stat.jitterBufferEmittedCount) * 1000
          ) + " ms";
        }
        if (Number.isFinite(stat.framesPerSecond)) fps = Math.round(stat.framesPerSecond) + " fps";
        break;
      }
      ui.connectionStats.textContent = [connectionRoute,rtt,buffer,fps].filter(Boolean).join("  ·  ");
      ui.connectionStats.classList.remove("hidden");
    } catch {
      // Diagnostics are best-effort; never interrupt a working video call.
    } finally {
      s.statsBusy = false;
    }
  }

  async function sendSignal(callId, epoch, kind, payload) {
    if (!isActive(epoch, callId)) return;
    if (s.realtime) {
      if (s.socket?.readyState !== WebSocket.OPEN) throw new Error("Socket closed");
      s.socket.send(JSON.stringify({type:"signal",callId,kind,payload}));
      return;
    }
    return request("signal", "POST", { callId, kind, payload });
  }
  async function startPeer(callId, epoch, initiator) {
    if (!isActive(epoch, callId) || s.mode !== "video" || !s.stream) return;
    const pc = new RTCPeerConnection({ iceServers: s.iceServers });
    s.connectionTimer = setTimeout(() => {
      if (isActive(epoch, callId) && !s.connected) announce(s.turnAvailable
        ? "Video is taking longer than expected. The relay is configured; try Next if it fails."
        : "Still trying a direct connection. These networks may need a TURN relay.");
    }, 22000);
    s.pc = pc;
    s.queuedIce = [];
    for (const track of s.stream.getTracks()) {
      const sender = pc.addTrack(track, s.stream);
      // Avoid large encoded frames building a queue on slower connections.
      if (track.kind === "video" && sender.getParameters && sender.setParameters) {
        const parameters = sender.getParameters();
        if (parameters.encodings?.length) {
          parameters.encodings[0].maxBitrate = 900000;
          parameters.encodings[0].maxFramerate = 24;
          parameters.degradationPreference = "maintain-framerate";
          sender.setParameters(parameters).catch(() => {});
        }
      }
    }
    pc.ontrack = event => {
      if (!isActive(epoch, callId)) return;
      // Newer browsers support a small preferred jitter buffer for live video.
      // The browser may increase it to maintain playback on unstable networks.
      try {
        if (event.receiver && "jitterBufferTarget" in event.receiver) {
          event.receiver.jitterBufferTarget = event.track.kind === "video" ? 80 : 60;
        }
      } catch { /* Older browsers retain their default jitter settings. */ }
      if (ui.remote.srcObject !== event.streams[0]) {
        ui.remote.srcObject = event.streams[0];
        ui.remote.classList.remove("hidden");
        ui.remotePlaceholder.classList.add("hidden");
        ui.remote.play().catch(() => ui.sound.classList.remove("hidden"));
      }
    };
    pc.onicecandidate = event => {
      if (event.candidate && isActive(epoch, callId)) {
        sendSignal(callId, epoch, "ice", event.candidate.toJSON()).catch(() => {
          if (isActive(epoch, callId)) announce("Connection signaling interrupted; trying to continue…");
        });
      }
    };
    pc.onicecandidateerror = event => {
      if (isActive(epoch, callId) && event.errorCode !== 701)
        console.warn("Crosswave ICE error code:", event.errorCode);
    };
    const showConnection = () => {
      if (!isActive(epoch, callId)) return;
      if (pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        s.connected = true;
        s.connectionFailed = false;
        clearTimeout(s.connectionTimer);
        s.connectionTimer = null;
        syncControls();
        if (!s.statsTimer) {
          s.statsTimer = setInterval(() => { void updateConnectionStats(); }, 3000);
          void updateConnectionStats();
        }
        announce("Connected! You're talking to a stranger.");
      } else if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
        s.connected = false;
        s.connectionFailed = true;
        syncControls();
        clearTimeout(s.connectionTimer);
        s.connectionTimer = null;
        announce(s.turnAvailable
          ? "Couldn't secure video, despite having a TURN relay. Try Next or another network."
          : "Couldn't secure video: no TURN relay configured. Try another network for now.");
      } else if (pc.connectionState === "disconnected") {
        s.connected = false;
        s.connectionFailed = false;
        syncControls();
        announce("Connection interrupted. Attempting to reconnect…");
      }
    };
    pc.onconnectionstatechange = showConnection;
    pc.oniceconnectionstatechange = showConnection;
    if (initiator) {
      const offer = await pc.createOffer();
      if (!isActive(epoch, callId)) return;
      await pc.setLocalDescription(offer);
      await sendSignal(callId, epoch, "offer", { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    }
  }
  async function drainIce(pc) {
    const candidates = s.queuedIce.splice(0);
    for (const candidate of candidates) await pc.addIceCandidate(candidate).catch(() => {});
  }
  async function handleSignal(message, epoch, callId) {
    if (!isActive(epoch, callId)) return;
    if (message.kind === "text") {
      if (s.mode === "text" && typeof message.payload?.text === "string") appendMessage("Stranger: " + message.payload.text, "remote-text");
      return;
    }
    const pc = s.pc;
    if (!pc || s.mode !== "video") return;
    if (message.kind === "ice") {
      const candidate = message.payload;
      if (!candidate || typeof candidate.candidate !== "string") return;
      if (pc.remoteDescription) await pc.addIceCandidate(candidate).catch(() => {});
      else s.queuedIce.push(candidate);
      return;
    }
    if (message.kind === "offer" && !pc.remoteDescription) {
      await pc.setRemoteDescription(message.payload);
      await drainIce(pc);
      const answer = await pc.createAnswer();
      if (!isActive(epoch, callId)) return;
      await pc.setLocalDescription(answer);
      await sendSignal(callId, epoch, "answer", { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } else if (message.kind === "answer" && pc.signalingState === "have-local-offer") {
      await pc.setRemoteDescription(message.payload);
      await drainIce(pc);
    }
  }
  async function checkSignals() {
    if (!s.running || !s.callId || s.signalBusy || s.busy) return;
    s.signalBusy = true;
    const epoch = s.epoch, callId = s.callId;
    try {
      if (s.mode === "video" && !s.pc) return;
      const inbox = await request("signal?callId=" + encodeURIComponent(callId) + "&after=" + encodeURIComponent(s.cursor));
      if (!isActive(epoch, callId)) return;
      for (const message of inbox.signals || []) {
        if (!isActive(epoch, callId)) break;
        try { await handleSignal(message, epoch, callId); }
        catch (error) { announce("Call setup error: " + error.message); }
        s.cursor = message.id;
      }
    } catch (error) {
      if (isActive(epoch, callId)) announce("Checking connection: " + error.message);
    } finally { s.signalBusy = false; }
  }
  async function setMatch(match, epoch) {
    if (!s.running || s.epoch !== epoch || !match?.callId) return;
    if (s.callId === match.callId) return;
    clearPeer();
    s.callId = match.callId;
    s.peerId = match.peerId;
    syncControls();
    announce(s.mode === "video"
      ? (s.turnAvailable ? "Match found! Securing video (TURN relay available)…" : "Match found! Trying direct video (TURN unavailable)…")
      : "Connected! Say hello.");
    if (s.mode === "text") {
      ui.messages.replaceChildren();
      appendMessage("Connected to a stranger. Be respectful and stay safe.", "system");
      return;
    }
    showRemote("Connecting securely…");
    try {
      await startPeer(match.callId, epoch, match.initiator);
      if (isActive(epoch, match.callId)) {
        const pending=s.pendingSignals.splice(0);
        for(const msg of pending) await handleSignal(msg,epoch,match.callId);
      }
    } catch (error) { if (isActive(epoch, match.callId)) announce("Video setup failed: " + error.message); }
  }
  async function joinQueue(epoch) {
    if (!s.running || s.epoch !== epoch) return;
    announce("Looking for a stranger…");
    showRemote("Looking for a stranger…");
    if (s.realtime) {
      s.socket.send(JSON.stringify({type:"join",mode:s.mode}));
      return;
    }
    const result = await request("match", "POST", { mode: s.mode });
    if (!s.running || s.epoch !== epoch) return;
    if (result.state === "matched") await setMatch(result, epoch);
    else {
      announce("Looking for a stranger… Keep this tab open.");
      if (s.mode === "text") resetMessages();
    }
  }
  async function checkStatus() {
    if (!s.running || s.busy || s.statusBusy) return;
    s.statusBusy = true;
    const epoch = s.epoch;
    try {
      const result = await request("status");
      if (!s.running || s.epoch !== epoch) return;
      if (result.state === "matched") {
        if (s.callId !== result.callId) await setMatch(result, epoch);
      } else if (s.callId) {
        clearPeer();
        announce("Stranger left. Looking for someone new…");
        await joinQueue(epoch);
      } else if (result.state === "idle") {
        await joinQueue(epoch);
      }
    } catch (error) {
      if (s.running && s.epoch === epoch && Date.now() - s.lastError > 4000) {
        s.lastError = Date.now();
        announce("Unable to reach matchmaking. Retrying… (" + error.message + ")");
      }
    } finally { s.statusBusy = false; }
  }
  function startPolling() {
    stopPolling();
    s.pollTimer = setInterval(() => { void checkStatus(); }, STEP_MS);
    s.signalTimer = setInterval(() => { void checkSignals(); }, SIGNAL_MS);
  }
  function stopPolling() {
    clearInterval(s.pollTimer);
    clearInterval(s.signalTimer);
    s.pollTimer = null;
    s.signalTimer = null;
  }
  function closeRealtime() {
    const socket = s.socket;
    s.socket = null; s.realtime = false;
    if (socket) {
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      try { socket.close(1000,"Leaving"); } catch {}
    }
  }
  async function connectRealtime(url,ticket,epoch) {
    if (typeof WebSocket === "undefined") throw new Error("WebSocket unsupported");
    const socket = new WebSocket(url,["crosswave.v1","auth."+ticket]);
    s.socket = socket; s.realtime = true;
    try { await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error("Realtime timeout")),8000);
      socket.onopen=()=>{clearTimeout(timeout);resolve()};
      socket.onerror=()=>{clearTimeout(timeout);reject(new Error("Socket failure"))};
      socket.onclose=()=>{clearTimeout(timeout);reject(new Error("Socket closed"))};
    }); } catch(error) { closeRealtime(); throw error; }
    if (!s.running || s.epoch!==epoch || s.socket!==socket) {closeRealtime();return;}
    socket.onerror=()=>{if(s.socket===socket)announce("Realtime network trouble…");};
    socket.onclose=()=>{
      if(s.socket!==socket||!s.running)return;
      closeRealtime(); s.epoch++; s.running=false;stopPolling();
      clearPeer();releaseMedia();syncControls();
      announce("Realtime disconnected. Click Start to reconnect.");
    };
    socket.onmessage=event=>{
      if(s.socket!==socket||!s.running)return;
      let message; try{message=JSON.parse(event.data)}catch{return}
      if(!message||typeof message!=="object")return;
      if(message.type==="waiting"){if(!s.callId){announce("Looking for a stranger…");syncControls()}}
      else if(message.type==="matched" && typeof message.callId==="string"){
        void setMatch({callId:message.callId,initiator:message.initiator===true},s.epoch);
      } else if(message.type==="signal" && message.callId===s.callId) {
        if(s.mode==="video"&&!s.pc){s.pendingSignals.push(message);return}
        void handleSignal(message,s.epoch,s.callId).catch(()=>{});
      } else if(message.type==="peer-left") {
        clearPeer();announce("Stranger left. Looking for someone new…");
      } else if(message.type==="error") announce("Realtime: "+String(message.message||"Temporary issue"));
    };
    await joinQueue(epoch);
  }

  async function start() {
    if (s.running || s.busy || s.stopPending || !ui.adult.checked || !ui.rules.checked) return;
    const epoch = ++s.epoch;
    s.busy = true; syncControls();
    try {
      if (s.mode === "video") await openMedia();
      if (s.epoch !== epoch) { releaseMedia(); return; }
      await request("guest", "POST", { ageConfirmed: true, rulesAccepted: true });
      if (s.epoch !== epoch) return;
      if (s.mode === "video") {
        try {
          const ice = await request("ice");
          if (Array.isArray(ice.iceServers) && ice.iceServers.length) s.iceServers = ice.iceServers;
          s.turnAvailable = ice.turnAvailable === true;
        } catch { /* use fallback public STUN servers */ }
      }
      if (s.epoch !== epoch) return;
      s.running = true;
      s.busy = false;
      syncControls();
      let config;
      try {config=await request("realtime-config")}catch{}
      if(s.epoch!==epoch || !s.running)return;
      if(config?.enabled && config.url){
        try{
          const {ticket}=await request("socket-ticket","POST");
          if(s.epoch!==epoch||!s.running)return;
          await connectRealtime(config.url,ticket,epoch);
          return;
        }catch{closeRealtime();announce("Realtime unavailable; using original matching…");}
      }
      startPolling();
      await joinQueue(epoch);
    } catch (error) {
      if (s.epoch === epoch) {
        s.running = false;
        s.busy = false;
        stopPolling();
        releaseMedia();
        syncControls();
        announce("Can't start chat: " + error.message);
      }
    } finally {
      if (s.epoch === epoch) { s.busy = false; syncControls(); }
    }
  }
  async function stop() {
    if ((!s.running && !s.busy) || s.stopPending) return;
    const wasRunning = s.running;
    s.stopPending = wasRunning;
    s.epoch++;
    s.running = false;
    s.busy = false;
    stopPolling();
    const usingSocket = s.realtime;
    closeRealtime();
    clearPeer();
    releaseMedia();
    syncControls();
    announce("Disconnected. Click Start whenever you're ready.");
    if (usingSocket) { s.stopPending = false; syncControls(); return; }
    if (wasRunning) {
      try { await request("leave", "POST"); }
      catch { /* heartbeat expires stale sessions */ }
      finally { s.stopPending = false; syncControls(); }
    }
  }
  async function skip() {
    if (!s.running || s.busy) return;
    const epoch = ++s.epoch;
    s.busy = true;
    clearPeer();
    syncControls();
    announce("Finding your next stranger…");
    try {
      await request("leave", "POST");
      if (s.epoch !== epoch) return;
      await joinQueue(epoch);
    } catch (error) {
      if (s.epoch === epoch) announce("Couldn't skip: " + error.message);
    } finally {
      if (s.epoch === epoch) {
        s.busy = false;
        syncControls();
      }
    }
  }
  function openReport() {
    if (!s.callId) return;
    s.reportCallId = s.callId;
    ui.reportForm.classList.remove("hidden");
    ui.safetyText.textContent = "Report this stranger and prevent this guest session from matching with you again.";
    ui.reportReason.value = "nudity";
    ui.reportDetails.value = "";
    ui.safety.showModal();
  }
  async function submitReport(event) {
    event.preventDefault();
    if (!s.reportCallId) return;
    ui.reportSubmit.disabled = true;
    try {
      await request("report", "POST", {
        callId: s.reportCallId, reason: ui.reportReason.value, details: ui.reportDetails.value.trim()
      });
      ui.safety.close();
      await skip();
      announce("Report submitted and stranger blocked for this guest session. Searching for someone new…");
    } catch (error) {
      ui.safetyText.textContent = "Unable to submit report: " + error.message;
    } finally {
      s.reportCallId = null;
      ui.reportSubmit.disabled = false;
    }
  }
  async function sendText(event) {
    event.preventDefault();
    const text = ui.message.value.trim();
    if (!text || !s.running || !s.callId || s.mode !== "text" || text.length > 1000) return;
    const epoch = s.epoch, callId = s.callId;
    ui.send.disabled = true;
    try {
      await sendSignal(callId, epoch, "text", { text });
      if (isActive(epoch, callId)) {
        appendMessage("You: " + text, "self-text");
        ui.message.value = "";
      }
    } catch (error) { announce("Message not sent: " + error.message); }
    finally { syncControls(); }
  }
  ui.cam.addEventListener("click", () => void toggleTrack("video"));
  ui.mic.addEventListener("click", () => void toggleTrack("audio"));
  ui.videoMode.addEventListener("click", () => switchMode("video"));
  ui.textMode.addEventListener("click", () => switchMode("text"));
  ui.adult.addEventListener("change", syncControls);
  ui.rules.addEventListener("change", syncControls);
  ui.start.addEventListener("click", () => void start());
  ui.stop.addEventListener("click", () => void stop());
  ui.skip.addEventListener("click", () => void skip());
  ui.report.addEventListener("click", openReport);
  ui.reportForm.addEventListener("submit", event => void submitReport(event));
  ui.messageForm.addEventListener("submit", event => void sendText(event));
  ui.sound.addEventListener("click", () => ui.remote.play().then(() => ui.sound.classList.add("hidden")).catch(() => announce("Enable sound in your browser to hear your match.")));
  window.addEventListener("pagehide", () => {
    if (s.running) navigator.sendBeacon?.("/api/leave", new Blob(["{}"], { type: "text/plain" }));
    stopPolling();
    clearPeer();
    releaseMedia();
  });
  el("year").textContent = String(new Date().getFullYear());
  resetMessages();
  syncControls();
})();
