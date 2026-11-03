/* =====================================================================
   GardenGrow AI — server.js  (optional: only needed for LIVE AI mode)
   ---------------------------------------------------------------------
   What it does:
     1. Serves the app (index.html, style.css, script.js) at http://localhost:3000
     2. Keeps your AI API key secret. The browser never sees it.
     3. /api/analyze → sends a photo + garden details to a vision AI model, returns structured JSON
     4. /api/chat    → Garden Chat: sends the conversation + photo to the AI, returns a reply
     5. /api/health  → tells the app whether live AI is set up

   Requirements: Node.js 18 or newer. No packages to install.
   Run it:       node server.js
   API key:      put ANTHROPIC_API_KEY=your-key in a file named .env next to this file
   ===================================================================== */

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------- Load .env (simple version, so you don't need extra packages) ----------
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";   // any vision-capable Claude model works
const API_URL = process.env.AI_API_URL || "https://api.anthropic.com/v1/messages";
const MAX_BODY = 12 * 1024 * 1024;                           // 12 MB upload limit

// ---------- The rules the AI must follow (from the project's accuracy & safety guidelines) ----------
const GARDEN_RULES = `You are GardenGrow AI, a friendly, practical gardening assistant for beginner and community gardeners.
Rules you must always follow:
- Separate what is VISIBLE in the photo from possible explanations. Say when you're unsure.
- Never claim specific nutrient deficiencies or pH from a photo. Recommend a soil test (e.g., through the local Cooperative Extension office) when pH or nutrients matter.
- Never recommend lime, sulfur, or fertilizer unless the user has soil test results that call for it. If they do, follow the report's amounts.
- Don't assume an unfamiliar plant is a weed. If unsure, say "identify first" and suggest iNaturalist, PlantNet, or the Extension office.
- Never recommend removing trees without the landowner's permission and a professional (certified arborist) evaluation.
- Prefer free and low-cost solutions: compost, leaf mulch, hand-pulling, raised hills.
- Plant identifications from photos are uncertain. Give your best guess with a confidence level.
- Warn about poison ivy or other hazards if you see possible signs.
- Keep language simple and encouraging, and explain WHY each recommendation matters.`;

const ANALYSIS_FORMAT = `Respond with ONLY a JSON object (no markdown fences, no extra text) in exactly this shape:
{
  "summary": "2-3 sentence plain-language overview",
  "observations": [{ "text": "something visible in the photo", "confidence": "clear|likely|uncertain" }],
  "concerns": [{ "text": "possible problem", "detail": "why it might matter; note uncertainty" }],
  "questions": ["things a photo can't answer (soil, sun hours, drainage, water access...)"],
  "nextSteps": ["short action, most important first"],
  "plants": [{ "name": "best-guess plant name or description", "verdict": "keep|remove|identify", "confidence": "clear|likely|uncertain", "reason": "why" }],
  "soilNeeds": ["what the soil may need, phrased carefully"],
  "soilPlan": [{ "step": "short step name", "detail": "how to do it and when" }],
  "tasks": [{ "id": "kebab-case-id", "title": "task name", "priority": "high|medium|low", "cost": "free|low-cost|higher-cost",
              "why": "why it matters", "steps": ["instruction 1", "instruction 2"], "uncertain": "caveat, or empty string" }]
}
Use 3-8 items per list and 6-10 tasks, ordered by priority. Look at the visible conditions such as exposed soil, possible compaction, rocks, weeds or unwanted vegetation, plant discoloration, drainage signs, sunlight limits from trees or structures, and pest damage. Only report what you can actually see.`;

function gardenContext(g = {}) {
  const v = x => (x && String(x).trim()) || "not provided";
  return `Garden details from the user:
- Name: ${v(g.name)}
- Location: ${v(g.location)}
- Intended crops: ${v(g.crops)}
- Goal date: ${v(g.goalDate)}
- Sunlight: ${v(g.sunlight)}
- Soil test status: ${v(g.soilTest)}${g.soilTest === "done" ? `; pH: ${v(g.soilPH)}; organic matter %: ${v(g.soilOM)}; report notes: ${v(g.soilNotes)}` : ""}
- Drainage: ${v(g.drainage)}
- Budget: ${v(g.budget)}
- Notes: ${v(g.notes)}
Today's date: ${new Date().toDateString()}`;
}

function imageBlock(dataURL) {
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(dataURL || "");
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

async function callAI({ system, messages, maxTokens = 3000 }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `AI request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

// ---------- API handlers ----------
async function handleAnalyze(body) {
  const img = imageBlock(body.image);
  if (!img) throw Object.assign(new Error("Please send a JPG, PNG, GIF or WebP photo."), { status: 400 });
  const text = await callAI({
    system: GARDEN_RULES,
    messages: [{
      role: "user",
      content: [img, { type: "text", text: `${gardenContext(body.garden)}\n\nAnalyze this garden photo.\n\n${ANALYSIS_FORMAT}` }]
    }],
    maxTokens: 4000
  });
  // Pull the JSON object out of the reply (in case the model adds anything around it)
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw Object.assign(new Error("The AI's answer couldn't be read. Please try again."), { status: 502 });
  }
}

async function handleChat(body) {
  const history = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const clean = history
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (clean.length && clean[0].role !== "user") clean.shift();          // conversations must start with the user
  if (!clean.length || clean[clean.length - 1].role !== "user") {
    throw Object.assign(new Error("No question to answer."), { status: 400 });
  }

  // Attach the photo + garden details to the first user message
  const img = imageBlock(body.image);
  const intro = `${gardenContext(body.garden)}\n\n${img ? "Here is a photo of my garden." : "(No photo has been shared yet. Ask for one if it would help.)"}\n\n`;
  clean[0] = { role: "user", content: [...(img ? [img] : []), { type: "text", text: intro + clean[0].content }] };

  const reply = await callAI({
    system: `${GARDEN_RULES}
You are chatting with the user about their garden photo. When useful, cover: which plants you can see (with confidence), which to keep, remove, or identify first and why, what the soil may need (without guessing nutrients), and a step-by-step plan to amend the soil and build a productive garden.
Format: short paragraphs, "- " bullet lists, or "1. " numbered steps, and **bold** for key words. No headings or tables. Keep replies under about 250 words unless the user asks for more detail.`,
    messages: clean,
    maxTokens: 1500
  });
  return { reply };
}

// ---------- Static file server (only the app's own files) ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8" };
const BLOCKED = new Set(["server.js", ".env", ".env.example"]);

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(__dirname, rel);
  const base = path.basename(file);
  if (!file.startsWith(__dirname + path.sep) || base.startsWith(".") || BLOCKED.has(base) || !TYPES[path.extname(file).toLowerCase()]) {
    res.writeHead(404); return res.end("Not found");
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] });
    res.end(data);
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Photo is too large."), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(Object.assign(new Error("Bad request."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  try {
    if (url === "/api/health") return sendJSON(res, 200, { ok: true, aiConfigured: !!API_KEY, model: MODEL });
    if (url === "/api/analyze" || url === "/api/chat") {
      if (req.method !== "POST") return sendJSON(res, 405, { error: "Use POST." });
      if (!API_KEY) return sendJSON(res, 503, { error: "No API key set. Add ANTHROPIC_API_KEY to your .env file and restart the server." });
      const body = await readBody(req);
      const result = url === "/api/analyze" ? await handleAnalyze(body) : await handleChat(body);
      return sendJSON(res, 200, result);
    }
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (err) {
    console.error("[GardenGrow AI]", err.message);
    sendJSON(res, err.status || 500, { error: err.message || "Server error." });
  }
});

server.listen(PORT, () => {
  console.log(`\n🌱 GardenGrow AI is running at http://localhost:${PORT}`);
  console.log(API_KEY ? `   Live AI: ON (model: ${MODEL})` : "   Live AI: OFF. Add ANTHROPIC_API_KEY to .env to turn it on. Demo mode still works.");
  console.log("   Press Ctrl+C to stop.\n");
});
