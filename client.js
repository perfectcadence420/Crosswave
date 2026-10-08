/* Straylo: immersive random video + text chat, backed by HTTP or WebSocket matchmaking. */
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
    nickname: el("nickname"), entryHint: el("entryHint"), typing: el("typingIndicator"),
    chatTitle: el("chatTitle"), safety: el("safety"), safetyText: el("safetyText"),
    reportForm: el("reportForm"), reportReason: el("reportReason"),
    reportDetails: el("reportDetails"), reportSubmit: el("reportSubmit"),
    sound: el("enableSound"), connectionStats: el("connectionStats"),
    entryPage: el("entryPage"), chatPage: el("chatPage"),
    backHome: el("backHome"), modeTitle: el("modeTitle"),
    headerStatus: el("headerStatus"), mobileChatToggle: el("mobileChatToggle"),
    closeChat: el("closeChat"), chatBackdrop: el("chatBackdrop"),
    unreadCount: el("unreadCount"), cancelReport: el("cancelReport")
  };
  const s = {
    mode: "video", running: false, busy: false, epoch: 0,
    callId: null, peerId: null, pc: null, stream: null,
    cursor: "0", queuedIce: [], iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    pollTimer: null, signalTimer: null, statusBusy: false, signalBusy: false,
    lastError: 0, connected: false, connectionFailed: false, reportCallId: null,
    turnAvailable: false, connectionTimer: null, statsTimer: null, statsBusy: false,
    realtime: false, socket: null, pendingSignals: [], unread: 0, previousVideoStats: null,
    nickname: "", peerNickname: "", remoteTypingTimer: null, typingTimer: null,
    lastTypingSent: 0, typingSent: false,
    chatBaseHeight: 0, chatViewportWidth: 0
  };
  // A single high-quality camera target for all users. These are ideal
  // constraints and an outbound bitrate ceiling, not guaranteed stream specs.
  // WebRTC remains free to adapt resolution/bitrate to real network conditions.
  const VIDEO_PROFILE = Object.freeze({
    width: 1920, height: 1080, fps: 30, bitrate: 5000000
  });
  const validNickname = name => /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{1,23}$/u.test(name);
  const getNickname = () => ui.nickname.value.trim();
  const entryReady = () => ui.adult.checked && ui.rules.checked && validNickname(getNickname());
  function updateEntryHint() {
    const name=getNickname();
    ui.entryHint.textContent = !name ? "Choose a nickname to continue."
      : !validNickname(name) ? "Use 2–24 letters, numbers, spaces or _ . ' -"
      : !ui.adult.checked || !ui.rules.checked ? "Confirm both conditions before chatting."
      : "You're all set! Choose Video or Text chat.";
    ui.entryHint.classList.toggle("ready",entryReady());
    ui.nickname.setAttribute("aria-invalid",String(Boolean(name) && !validNickname(name)));
  }
  function resetRemoteTyping() {
    clearTimeout(s.remoteTypingTimer);
    s.remoteTypingTimer=null;
    ui.typing.classList.add("hidden");
  }
  function updateRemoteName() {
    ui.chatTitle.textContent = s.peerNickname ? "Chat with " + s.peerNickname : "Messages";
  }
  function applyTypingSignal(active, callId, epoch) {
    if (!isActive(epoch,callId)) return;
    resetRemoteTyping();
    if(active===true) {
      ui.typing.textContent = (s.peerNickname || "Stranger") + " is typing…";
      ui.typing.classList.remove("hidden");
      s.remoteTypingTimer=setTimeout(()=>{if(isActive(epoch,callId))resetRemoteTyping()},4000);
    }
  }
  function sendTyping(active) {
    if(!s.running||!s.callId)return;
    const epoch=s.epoch,callId=s.callId,now=Date.now();
    if(active) {
      if(s.typingSent && now-s.lastTypingSent<2200)return;
      s.lastTypingSent=now;
    }else if(!s.typingSent)return;
    s.typingSent=active;
    void sendSignal(callId,epoch,"typing",{active}).catch(()=>{});
  }
  function onMessageInput() {
    if(!s.callId||!s.running)return;
    clearTimeout(s.typingTimer);
    if(ui.message.value.trim()) {
      sendTyping(true);
      s.typingTimer=setTimeout(()=>sendTyping(false),2700);
    }else sendTyping(false);
  }
  const STEP_MS = 1400;
  const SIGNAL_MS = 700;
  const isActive = (epoch, callId) => s.running && s.epoch === epoch && s.callId === callId;

  function announce(message) {
    ui.status.textContent = message;
    ui.headerStatus.textContent = s.connected || (s.mode === "text" && s.callId)
      ? "Connected" : s.running ? (s.callId ? "Connecting" : "Searching") : "Ready to connect";
  }
  function showRemote(message) {
    ui.remotePlaceholder.classList.remove("hidden");
    el("remoteMessage").textContent = message;
  }
  function resetMessages(message = "Not connected yet.") {
    ui.messages.replaceChildren();
    appendMessage(message, "system");
  }
  function showQueued() {
    if (!s.running || s.callId) return;
    resetMessages("Waiting for someone to connect…");
    announce("Looking for a stranger…");
    showRemote("Looking for a stranger…");
  }
  function appendMessage(message, role) {
    const div = document.createElement("div");
    div.className = "chat-message " + role;
    div.textContent = message;
    ui.messages.appendChild(div);
    ui.messages.scrollTop = ui.messages.scrollHeight;
    if (role === "remote-text" && s.mode === "video" &&
      window.matchMedia?.("(max-width: 760px)").matches && !ui.textArea.classList.contains("open")) {
      s.unread += 1;
      ui.unreadCount.textContent = s.unread > 9 ? "9+" : String(s.unread);
      ui.unreadCount.classList.remove("hidden");
    }
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
    const eligible = entryReady();
    ui.start.disabled = !eligible || s.running || s.busy || s.stopPending;
    ui.start.textContent = s.busy ? "Connecting…"
      : s.running ? (s.callId
        ? (s.mode === "text" || s.connected ? "✓ Connected" : s.connectionFailed ? "Connection failed" : "Connecting…")
        : "Searching…")
      : eligible ? "Start " + s.mode + " chat" : "Complete setup";
    ui.stop.disabled = !s.running && !s.busy;
    ui.skip.disabled = !s.running || s.busy;
    ui.videoMode.disabled = s.running || s.busy;
    ui.textMode.disabled = s.running || s.busy;
    ui.message.disabled = !s.running || !s.callId;
    ui.send.disabled = ui.message.disabled;
    ui.report.disabled = !s.running || !s.callId;
    updateEntryHint();
    ui.videoMode.classList.toggle("mode-selected", s.mode === "video");
    ui.textMode.classList.toggle("mode-selected", s.mode === "text");
    ui.videoMode.setAttribute("aria-pressed", String(s.mode === "video"));
    ui.textMode.setAttribute("aria-pressed", String(s.mode === "text"));
  }
  function closeChatDrawer() {
    ui.textArea.classList.remove("open");
    ui.chatBackdrop.classList.add("hidden");
    ui.mobileChatToggle.setAttribute("aria-expanded", "false");
  }
  function openChatDrawer() {
    if (s.mode === "text") return;
    ui.textArea.classList.add("open");
    ui.chatBackdrop.classList.remove("hidden");
    ui.mobileChatToggle.setAttribute("aria-expanded", "true");
    s.unread = 0;
    ui.unreadCount.classList.add("hidden");
    ui.messages.scrollTop = ui.messages.scrollHeight;
    ui.message.focus?.();
  }
  function setChatPageVisible(visible) {
    ui.entryPage.classList.toggle("hidden", visible);
    ui.chatPage.classList.toggle("hidden", !visible);
    document.body.classList.toggle("in-session", visible);
    // The entire session is a fixed viewport: prevent Safari from scrolling
    // the document behind the composer when its software keyboard opens.
    document.documentElement.classList.toggle("in-session", visible);
    if (visible) {
      s.chatBaseHeight = window.visualViewport?.height || window.innerHeight || 0;
      s.chatViewportWidth = window.visualViewport?.width || window.innerWidth || 0;
    } else {
      closeChatDrawer();
      ui.chatPage.classList.remove("keyboard-open");
    }
    resizeChatViewport();
  }
  function switchMode(next) {
    if (s.running || s.busy || !["video","text"].includes(next)) return;
    s.mode = next;
    ui.videoArea.classList.toggle("hidden", next !== "video");
    ui.textArea.classList.remove("hidden");
    ui.chatPage.classList.toggle("video-mode", next === "video");
    ui.chatPage.classList.toggle("text-mode", next === "text");
    ui.modeTitle.textContent = next === "video" ? "Video chat" : "Text chat";
    ui.mobileChatToggle.classList.toggle("hidden", next === "text");
    ui.avControls.classList.toggle("hidden", next === "text");
    closeChatDrawer();
    if (next === "text") releaseMedia();
    resetMessages();
    announce(next === "video"
      ? "Preparing your video chat…"
      : "Preparing your text chat…");
    syncControls();
  }
  function openMode(next, pushHistory = true) {
    if (s.running || s.busy) return;
    if (!entryReady()) {
      setChatPageVisible(false);
      updateEntryHint();
      ui.nickname.focus();
      return;
    }
    s.nickname=getNickname();
    switchMode(next);
    setChatPageVisible(true);
    if (pushHistory) window.history.pushState({mode:next},"", "/chat/" + next + window.location.search);
    // A mode choice on the consented homepage is the Start action.
    // In video mode start() requests media immediately in this click gesture.
    void start();
  }
  async function goHome(pushHistory = true) {
    if (s.running || s.busy) await stop();
    setChatPageVisible(false);
    if (pushHistory) window.history.pushState({mode:null},"","/" + window.location.search);
    document.title = "Straylo — Meet the unexpected";
  }
  async function restoreRoute() {
    const mode = /^\/chat\/(video|text)\/?$/.exec(window.location.pathname)?.[1];
    if (s.running || s.busy) await stop();
    if (mode && entryReady()) openMode(mode,false);
    else {
      setChatPageVisible(false);
      if(mode) window.history.replaceState({mode:null},"","/" + window.location.search);
    }
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
    // Prefer full-HD capture when supported; browsers and webcams can select
    // lower resolutions or frame rates when necessary.
    const media = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: VIDEO_PROFILE.width }, height: { ideal: VIDEO_PROFILE.height },
        frameRate: { ideal: VIDEO_PROFILE.fps, max: VIDEO_PROFILE.fps } },
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
    s.previousVideoStats = null;
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
    s.unread = 0;
    s.peerNickname="";
    clearTimeout(s.typingTimer);
    s.typingTimer=null;
    s.typingSent=false;
    s.lastTypingSent=0;
    resetRemoteTyping();
    updateRemoteName();
    ui.unreadCount.classList.add("hidden");
    resetMessages();
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
      let buffer = null, fps = null, receivedResolution = null;
      for (const stat of report.values()) {
        if (stat.type !== "inbound-rtp" || (stat.kind || stat.mediaType) !== "video") continue;
        const count = stat.jitterBufferEmittedCount;
        const delay = stat.jitterBufferDelay;
        if (Number.isFinite(count) && Number.isFinite(delay)) {
          const prev = s.previousVideoStats;
          // Use the last reporting interval, not the lifetime average, so
          // an old high-buffer period doesn't mislead throughout the call.
          const frames = prev ? count-prev.count : count;
          const seconds = prev ? delay-prev.delay : delay;
          if (frames > 0 && seconds >= 0)
            buffer = "Recent buffer: " + Math.round((seconds/frames)*1000) + " ms";
          s.previousVideoStats = {count,delay};
        }
        if (Number.isFinite(stat.framesPerSecond))
          fps = Math.round(stat.framesPerSecond) + " fps";
        if (Number.isFinite(stat.frameWidth) && Number.isFinite(stat.frameHeight))
          receivedResolution = stat.frameWidth + "×" + stat.frameHeight;
        break;
      }
      ui.connectionStats.textContent = [connectionRoute,rtt,buffer,receivedResolution,fps].filter(Boolean).join("  ·  ");
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
          parameters.encodings[0].maxBitrate = VIDEO_PROFILE.bitrate;
          parameters.encodings[0].maxFramerate = VIDEO_PROFILE.fps;
          // Prefer a reasonable trade-off rather than freezing video to
          // preserve resolution on congested links.
          parameters.degradationPreference = "balanced";
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
    // Legacy HTTP signal storage accepts only offer/answer/ice/text.
    // New metadata events are wrapped in a text envelope by our API.
    const kind = message.kind==="text" &&
      ["profile","typing"].includes(message.payload?._strayloEvent)
        ? message.payload._strayloEvent : message.kind;
    if(kind==="profile") {
      const name=message.payload?.nickname;
      if(typeof name==="string" && validNickname(name) && name.length<=24){
        s.peerNickname=name;
        updateRemoteName();
        if(!ui.typing.classList.contains("hidden"))ui.typing.textContent=name+" is typing…";
      }
      return;
    }
    if(kind==="typing") {
      if(typeof message.payload?.active==="boolean")applyTypingSignal(message.payload.active,callId,epoch);
      return;
    }
    if (kind === "text") {
      resetRemoteTyping();
      if (typeof message.payload?.text === "string")
        appendMessage((s.peerNickname ? s.peerNickname + ": " : "") + message.payload.text, "remote-text");
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
    ui.messages.replaceChildren();
    appendMessage("You're connected! Say hello 👋", "system");
    // Exchange session-only nicknames, never permanent identity or public profiles.
    void sendSignal(match.callId,epoch,"profile",{nickname:s.nickname}).catch(()=>{});
    if (s.mode === "text") {
      announce("Connected! Say hello.");
      syncControls();
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
    announce("Connecting to matchmaking…");
    showRemote("Connecting to matchmaking…");
    if (s.realtime) {
      s.socket.send(JSON.stringify({type:"join",mode:s.mode}));
      return;
    }
    const result = await request("match", "POST", { mode: s.mode });
    if (!s.running || s.epoch !== epoch) return;
    if (result.state === "matched") await setMatch(result, epoch);
    else {
      showQueued();
      announce("Looking for a stranger… Keep this tab open.");
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
    }); } catch(error) { if(s.socket===socket)closeRealtime(); throw error; }
    if (!s.running || s.epoch!==epoch || s.socket!==socket) {if(s.socket===socket)closeRealtime();return;}
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
      if(message.type==="waiting"){if(!s.callId){showQueued();syncControls()}}
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
    if (s.running || s.busy || s.stopPending || !entryReady()) return;
    s.nickname=getNickname();
    const epoch = ++s.epoch;
    s.busy = true; syncControls();
    resetMessages("Connecting to matchmaking…");
    showRemote("Connecting to matchmaking…");
    announce("Connecting to matchmaking…");
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
      try {config=await request(new URLSearchParams(window.location.search).get("realtime")==="1" ? "realtime-config?canary=1" : "realtime-config")}catch{}
      if(s.epoch!==epoch || !s.running)return;
      if(config?.enabled && config.url){
        try{
          const {ticket}=await request("socket-ticket","POST");
          if(s.epoch!==epoch||!s.running)return;
          await connectRealtime(config.url,ticket,epoch);
          return;
        }catch(error){
          if(s.epoch!==epoch || !s.running)return;
          closeRealtime();
          if(new URLSearchParams(window.location.search).get("realtime")==="1")
            throw new Error("Realtime test unavailable: "+error.message+". Use the regular site for existing chat.");
          announce("Realtime unavailable; using original matching…");
        }
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
        resetMessages("Connection failed. Press Start to try again.");
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
    resetMessages("Disconnected. Press Start to find someone new.");
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
    if (s.realtime) {
      ++s.epoch;
      clearPeer();
      announce("Finding your next stranger…");
      s.socket?.send(JSON.stringify({ type: "next", mode: s.mode }));
      return;
    }
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
    if (!text || !s.running || !s.callId || text.length > 1000) return;
    const epoch = s.epoch, callId = s.callId;
    ui.send.disabled = true;
    try {
      await sendSignal(callId, epoch, "text", { text });
      if (isActive(epoch, callId)) {
        sendTyping(false);
        clearTimeout(s.typingTimer);
        appendMessage(text, "self-text");
        ui.message.value = "";
      }
    } catch (error) { announce("Message not sent: " + error.message); }
    finally { syncControls(); }
  }
  ui.cam.addEventListener("click", () => void toggleTrack("video"));
  ui.mic.addEventListener("click", () => void toggleTrack("audio"));
  ui.videoMode.addEventListener("click", () => openMode("video"));
  ui.textMode.addEventListener("click", () => openMode("text"));
  ui.adult.addEventListener("change", syncControls);
  ui.rules.addEventListener("change", syncControls);
  ui.nickname.addEventListener("input",syncControls);
  ui.message.addEventListener("input",onMessageInput);
  ui.message.addEventListener("blur",()=>{clearTimeout(s.typingTimer);sendTyping(false)});
  ui.start.addEventListener("click", () => void start());
  ui.stop.addEventListener("click", () => void stop());
  ui.skip.addEventListener("click", () => void skip());
  ui.report.addEventListener("click", openReport);
  ui.reportForm.addEventListener("submit", event => void submitReport(event));
  ui.cancelReport.addEventListener("click", () => ui.safety.close());
  ui.backHome.addEventListener("click", () => void goHome());
  ui.mobileChatToggle.addEventListener("click", () => {
    if (ui.textArea.classList.contains("open")) closeChatDrawer();
    else openChatDrawer();
  });
  ui.closeChat.addEventListener("click", closeChatDrawer);
  ui.chatBackdrop.addEventListener("click", closeChatDrawer);
  window.addEventListener("popstate", () => void restoreRoute());
  // Use the visual viewport when the mobile keyboard opens, so the message
  // composer stays above it without zooming or requiring manual pinch-out.
  function resizeChatViewport() {
    const viewport=window.visualViewport;
    const height=viewport?.height;
    const width=viewport?.width || window.innerWidth || 0;
    const mobile=window.matchMedia?.("(max-width: 760px)")?.matches;
    const inChat=!ui.chatPage.classList.contains("hidden");
    const usable=Number.isFinite(height) && height>200;
    document.documentElement.style.setProperty("--chat-vh",
      usable ? Math.round(height)+"px" : "100dvh");
    // iOS Safari sometimes moves its visual viewport down when focusing a
    // text field; anchor the fixed chat shell to that viewport instead.
    const offset=usable && inChat && mobile && Number.isFinite(viewport.offsetTop)
      ? Math.max(0, Math.round(viewport.offsetTop)) : 0;
    document.documentElement.style.setProperty("--chat-top",offset+"px");
    if(!inChat || !mobile) {
      ui.chatPage.classList.remove("keyboard-open");
      return;
    }
    if(Math.abs(width-s.chatViewportWidth)>50) {
      // Rotation changes the available height; don't mistake it for a keyboard.
      s.chatBaseHeight=usable?height:window.innerHeight;
      s.chatViewportWidth=width;
    }
    const inputFocused=document.activeElement===ui.message;
    if(!inputFocused && usable) s.chatBaseHeight=Math.max(s.chatBaseHeight,height);
    const keyboardOpen=Boolean(inputFocused && s.mode==="text" && usable &&
      s.chatBaseHeight-height>140);
    ui.chatPage.classList.toggle("keyboard-open",keyboardOpen);
  }
  window.visualViewport?.addEventListener("resize",resizeChatViewport);
  window.visualViewport?.addEventListener("scroll",resizeChatViewport);
  window.addEventListener("resize",resizeChatViewport);
  ui.message.addEventListener("focus",resizeChatViewport);
  ui.message.addEventListener("blur",resizeChatViewport);
  resizeChatViewport();
  ui.messageForm.addEventListener("submit", event => void sendText(event));
  ui.sound.addEventListener("click", () => ui.remote.play().then(() => ui.sound.classList.add("hidden")).catch(() => announce("Enable sound in your browser to hear your match.")));
  window.addEventListener("pagehide", () => {
    if (s.running && !s.realtime) navigator.sendBeacon?.("/api/leave", new Blob(["{}"], { type: "text/plain" }));
    closeRealtime();
    stopPolling();
    clearPeer();
    releaseMedia();
  });
  el("year").textContent = String(new Date().getFullYear());
  resetMessages();
  syncControls();
  const initialMode = /^\/chat\/(video|text)\/?$/.exec(window.location.pathname)?.[1];
  if (initialMode && entryReady()) openMode(initialMode,false);
  else {
    setChatPageVisible(false);
    if (initialMode) window.history.replaceState({mode:null},"","/" + window.location.search);
  }
})();
