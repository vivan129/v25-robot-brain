import http from "node:http";
import fs from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = val;
  }
}

loadDotEnv();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const OPENAI_VOICE_ID = process.env.OPENAI_VOICE_ID || "";

const SYSTEM_INSTRUCTIONS =
  "You are V25, a confident, calm robot brain embedded in a small humanoid. " +
  "Be concise, warm, and practical. Keep responses under 3 short paragraphs or 6 bullets unless asked for more detail.";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function extractOutputText(json) {
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part?.type === "output_text" && typeof part.text === "string") return part.text;
        }
      }
    }
  }
  return "";
}

async function handleChat(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, { error: "Missing OPENAI_API_KEY" });
    return;
  }
  let payload = {};
  try {
    payload = JSON.parse((await readBody(req)).toString("utf-8"));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  const history = Array.isArray(payload.history) ? payload.history.slice(-12) : [];
  const input = history.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "")
  }));

  const body = {
    model: OPENAI_MODEL,
    instructions: SYSTEM_INSTRUCTIONS,
    input,
    temperature: 0.7
  };

  const apiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    sendJson(res, apiRes.status, { error: errText || "OpenAI error" });
    return;
  }

  const json = await apiRes.json();
  const text = extractOutputText(json) || "";
  sendJson(res, 200, { text });
}

async function handleTts(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, { error: "Missing OPENAI_API_KEY" });
    return;
  }
  let payload = {};
  try {
    payload = JSON.parse((await readBody(req)).toString("utf-8"));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  const text = String(payload.text || "").trim();
  if (!text) {
    sendJson(res, 400, { error: "Missing text" });
    return;
  }

  const ttsBody = {
    model: OPENAI_TTS_MODEL,
    input: text,
    format: "mp3",
    voice: OPENAI_VOICE_ID ? { id: OPENAI_VOICE_ID } : "marin"
  };

  const apiRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(ttsBody)
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    sendJson(res, apiRes.status, { error: errText || "OpenAI error" });
    return;
  }

  res.writeHead(200, { "Content-Type": "audio/mpeg" });
  const buf = Buffer.from(await apiRes.arrayBuffer());
  res.end(buf);
}

async function handleTranscribe(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, { error: "Missing OPENAI_API_KEY" });
    return;
  }

  const contentType = req.headers["content-type"] || "audio/webm";
  const audioBuffer = await readBody(req);
  if (!audioBuffer.length) {
    sendJson(res, 400, { error: "Missing audio" });
    return;
  }

  const file = new File([audioBuffer], "audio.webm", { type: contentType });
  const form = new FormData();
  form.append("file", file);
  form.append("model", OPENAI_TRANSCRIBE_MODEL);

  const apiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    sendJson(res, apiRes.status, { error: errText || "OpenAI error" });
    return;
  }

  const json = await apiRes.json();
  sendJson(res, 200, { text: json.text || "" });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^\.+/, "");

  const fullPath = path.join(PUBLIC_DIR, filePath);
  try {
    const data = await fs.readFile(fullPath);
    const ext = path.extname(fullPath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/tts") {
    await handleTts(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/transcribe") {
    await handleTranscribe(req, res);
    return;
  }

  await serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`V25 running at http://localhost:${PORT}`);
});
