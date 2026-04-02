const transcriptEl = document.getElementById("transcript");
const micBtn = document.getElementById("mic");
const sendBtn = document.getElementById("send");
const textInput = document.getElementById("textInput");
const statusPill = document.getElementById("status-pill");
const clockEl = document.getElementById("clock");
const waveEl = document.getElementById("wave");
const wakeToggle = document.getElementById("wakeToggle");

let mediaRecorder = null;
let chunks = [];
let isRecording = false;
const history = [];
let micStream = null;
let wakeMode = false;
let awaitingCommand = false;
const WAKE_WORD = "v25";
const CHUNK_MS = 1600;

function addBubble(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  transcriptEl.appendChild(bubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function setStatus(text) {
  statusPill.textContent = text;
}

function pulseWave(active) {
  waveEl.style.opacity = active ? 0.9 : 0.4;
}

async function speak(text) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error(await res.text());
  const audioBuf = await res.arrayBuffer();
  const audio = new Audio(URL.createObjectURL(new Blob([audioBuf], { type: "audio/mpeg" })));
  await audio.play();
}

async function sendChat(text) {
  if (!text.trim()) return;
  addBubble("user", text);
  history.push({ role: "user", content: text });
  setStatus("thinking");
  pulseWave(true);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history })
  });

  if (!res.ok) {
    const err = await res.text();
    addBubble("assistant", `Error: ${err}`);
    setStatus("idle");
    pulseWave(false);
    return;
  }

  const data = await res.json();
  const reply = data.text || "";
  history.push({ role: "assistant", content: reply });
  addBubble("assistant", reply);

  setStatus("speaking");
  try {
    await speak(reply);
  } catch (err) {
    addBubble("assistant", "Audio error: " + err.message);
  }
  setStatus("idle");
  pulseWave(false);
}

async function transcribeAndSend(blob) {
  setStatus("listening");
  pulseWave(true);
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob
  });

  if (!res.ok) {
    const err = await res.text();
    addBubble("assistant", `Transcription error: ${err}`);
    setStatus("idle");
    pulseWave(false);
    return;
  }

  const data = await res.json();
  const text = (data.text || "").trim();
  if (text) {
    await sendChat(text);
  } else {
    addBubble("assistant", "I didn't catch that. Try again?");
    setStatus("idle");
    pulseWave(false);
  }
}

async function ensureStream() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function recordChunk(ms = CHUNK_MS) {
  await ensureStream();
  return new Promise((resolve, reject) => {
    const rec = new MediaRecorder(micStream, { mimeType: "audio/webm" });
    const local = [];
    rec.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) local.push(event.data);
    });
    rec.addEventListener("stop", () => {
      resolve(new Blob(local, { type: "audio/webm" }));
    });
    rec.addEventListener("error", (event) => reject(event.error || event));
    rec.start();
    setTimeout(() => rec.stop(), ms);
  });
}

function normalizeWake(text) {
  return text.toLowerCase().replace(/\\s+/g, "");
}

async function wakeLoop() {
  setStatus("wake");
  pulseWave(true);
  while (wakeMode) {
    const blob = await recordChunk();
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob
    });

    if (!res.ok) {
      const err = await res.text();
      addBubble("assistant", `Transcription error: ${err}`);
      setStatus("idle");
      pulseWave(false);
      return;
    }

    const data = await res.json();
    const text = (data.text || "").trim();
    if (!text) continue;

    if (awaitingCommand) {
      awaitingCommand = false;
      await sendChat(text);
      setStatus("wake");
      continue;
    }

    if (normalizeWake(text).includes(WAKE_WORD)) {
      awaitingCommand = true;
      setStatus("awake");
    }
  }
  setStatus("idle");
  pulseWave(false);
}

async function startRecording() {
  await ensureStream();
  mediaRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm" });
  chunks = [];

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  mediaRecorder.addEventListener("stop", async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    await transcribeAndSend(blob);
  });

  mediaRecorder.start();
  isRecording = true;
  setStatus("listening");
  micBtn.classList.add("active");
}

function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  mediaRecorder.stop();
  isRecording = false;
  micBtn.classList.remove("active");
}

micBtn.addEventListener("click", async () => {
  if (isRecording) {
    stopRecording();
  } else {
    try {
      await startRecording();
    } catch (err) {
      addBubble("assistant", "Mic error: " + err.message);
      setStatus("idle");
    }
  }
});

sendBtn.addEventListener("click", () => {
  const text = textInput.value;
  textInput.value = "";
  sendChat(text);
});

wakeToggle.addEventListener("click", async () => {
  wakeMode = !wakeMode;
  wakeToggle.classList.toggle("on", wakeMode);
  wakeToggle.textContent = wakeMode ? "Wake: on" : "Wake: off";
  awaitingCommand = false;
  if (wakeMode) {
    try {
      await ensureStream();
      wakeLoop();
    } catch (err) {
      addBubble("assistant", "Mic error: " + err.message);
      wakeMode = false;
      wakeToggle.classList.remove("on");
      wakeToggle.textContent = "Wake: off";
      setStatus("idle");
    }
  } else {
    setStatus("idle");
    pulseWave(false);
  }
});

textInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const text = textInput.value;
    textInput.value = "";
    sendChat(text);
  }
});

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  clockEl.textContent = `${hh}:${mm}`;
}

updateClock();
setInterval(updateClock, 10000);
setStatus("idle");
