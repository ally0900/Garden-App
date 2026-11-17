/* =====================================================================
   GardenGrow AI — School AI Server (Cloudflare Worker)
   ---------------------------------------------------------------------
   What this does
     The GardenGrow app (on GitHub Pages) talks to THIS small server instead
     of talking to OpenAI directly. This server adds your OpenAI key and
     passes the request on. So:
       • The OpenAI key never reaches anyone's browser.
       • Nobody has to type a key on each device. Live AI just works.
       • A class code (optional but recommended) keeps strangers out.
       • Limits stop any one person from running up your bill.

   Setup (no installs; all in your web browser). Full steps are in the README.
     1. dash.cloudflare.com → Workers & Pages → Create → Worker → Deploy.
     2. Edit code → delete what's there → paste this whole file → Deploy.
     3. Settings → Variables and Secrets → add:
          OPENAI_API_KEY   (type: Secret)  your OpenAI key, starts with sk-
          CLASS_CODE       (type: Secret)  a code you give students, e.g. GROW2027
        Optional (type: Text):
          ALLOWED_ORIGINS  sites allowed to use this server, comma-separated
                           (default: https://ally0900.github.io,null)
          DAILY_LIMIT      AI requests per person per day (default: 200)
     4. Copy the worker's address (https://….workers.dev) into the app.

   Cost: Cloudflare's free plan allows 100,000 requests a day. OpenAI usage is
   billed to the OpenAI account; set a monthly budget limit there too.
   ===================================================================== */

const DEFAULT_ORIGINS = "https://ally0900.github.io,null";   // "null" = the app opened as a file on a computer
const OPENAI = "https://api.openai.com/v1";

// Only these models can be used through this server (protects your bill).
const CHAT_MODELS = ["gpt-6.1-terra", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"];
const TTS_MODELS = ["gpt-4o-mini-tts"];
const STT_MODELS = ["gpt-transcribe"];

const MAX_OUTPUT_TOKENS = 16000;
const MAX_JSON_BYTES = 12 * 1024 * 1024;     // photos are sent inside the request
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_SPEECH_CHARS = 4096;

// Best-effort per-person daily counter. It lives in memory, so it resets when
// Cloudflare restarts the worker; your OpenAI budget limit is the hard cap.
const usage = new Map();   // "ip|YYYY-MM-DD" → count

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map(s => s.trim()).filter(Boolean);
    const originOK = !origin || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOK && origin ? origin : allowed[0] || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Class-Code",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
    const fail = (status, code, message) => json(status, { error: { code, message } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!originOK) return fail(403, "origin_not_allowed", "This site isn't allowed to use the GardenGrow AI server.");

    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    // Public status check (no class code needed). Never reveals the key.
    if (path === "/" || path === "/health") {
      return json(200, { ok: true, app: "GardenGrow AI", keySet: !!env.OPENAI_API_KEY, codeRequired: !!env.CLASS_CODE, models: CHAT_MODELS });
    }

    if (!env.OPENAI_API_KEY) return fail(503, "no_key", "The school AI server has no OpenAI key yet. Add OPENAI_API_KEY in the worker's settings.");

    // Class code
    if (env.CLASS_CODE) {
      const given = (request.headers.get("X-Class-Code") || "").trim().toUpperCase();
      if (!sameText(given, String(env.CLASS_CODE).trim().toUpperCase())) {
        return fail(403, "bad_class_code", given ? "That class code isn't right. Check it with your teacher." : "Enter your class code to use Live AI.");
      }
    }

    // Per-person daily limit (counted only for requests that cost money)
    const costs = path !== "/models";
    if (costs) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const day = new Date().toISOString().slice(0, 10);
      const k = ip + "|" + day;
      const n = (usage.get(k) || 0) + 1;
      const limit = Number(env.DAILY_LIMIT) || 200;
      if (n > limit) return fail(429, "daily_limit", `This device reached today's Live AI limit (${limit}). It resets tomorrow.`);
      usage.set(k, n);
      if (usage.size > 5000) for (const key of usage.keys()) if (!key.endsWith(day)) usage.delete(key);
    }

    const auth = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
    try {
      if (path === "/models" && request.method === "GET") {
        // Used by "Test connection": confirms the server and class code work.
        const r = await fetch(`${OPENAI}/models`, { headers: auth });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return json(r.status, data);
        const ids = (data.data || []).map(m => m.id).filter(id => CHAT_MODELS.includes(id));
        return json(200, { data: ids.map(id => ({ id })) });
      }

      if (path === "/responses" && request.method === "POST") {
        const body = await readJSON(request);
        if (!body) return fail(413, "too_large", "That request is too large. Try a smaller photo.");
        if (!CHAT_MODELS.includes(body.model)) body.model = CHAT_MODELS[0];
        body.max_output_tokens = Math.min(Number(body.max_output_tokens) || 4000, MAX_OUTPUT_TOKENS);
        body.store = false;
        delete body.tools; delete body.background; delete body.previous_response_id;
        return relay(await fetch(`${OPENAI}/responses`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), cors);
      }

      if (path === "/audio/speech" && request.method === "POST") {
        const body = await readJSON(request);
        if (!body || typeof body.input !== "string") return fail(400, "bad_request", "Nothing to read aloud.");
        if (!TTS_MODELS.includes(body.model)) body.model = TTS_MODELS[0];
        body.input = body.input.slice(0, MAX_SPEECH_CHARS);
        return relay(await fetch(`${OPENAI}/audio/speech`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), cors);
      }

      if (path === "/audio/transcriptions" && request.method === "POST") {
        if (Number(request.headers.get("Content-Length") || 0) > MAX_AUDIO_BYTES) return fail(413, "too_large", "That recording is too long.");
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file === "string" || file.size > MAX_AUDIO_BYTES) return fail(400, "bad_request", "No recording was received.");
        const out = new FormData();
        out.append("file", file, file.name || "question.webm");
        out.append("model", STT_MODELS.includes(form.get("model")) ? form.get("model") : STT_MODELS[0]);
        if (form.get("prompt")) out.append("prompt", String(form.get("prompt")).slice(0, 500));
        return relay(await fetch(`${OPENAI}/audio/transcriptions`, { method: "POST", headers: auth, body: out }), cors);
      }

      return fail(404, "not_found", "Unknown request.");
    } catch (err) {
      return fail(502, "upstream", "The school AI server couldn't reach OpenAI. Please try again.");
    }
  }
};

// Passes OpenAI's answer (JSON or audio) back to the app.
function relay(r, cors) {
  const headers = { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json" };
  return new Response(r.body, { status: r.status, headers });
}

async function readJSON(request) {
  if (Number(request.headers.get("Content-Length") || 0) > MAX_JSON_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// Compares two strings without revealing how many characters matched.
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
