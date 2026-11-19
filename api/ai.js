/* =====================================================================
   GardenGrow AI — AI server (Vercel serverless function)
   ---------------------------------------------------------------------
   The app (index.html) talks to THIS function at /api/... instead of
   talking to OpenAI directly. The function adds the OpenAI key from
   Vercel's environment variables and passes the request on. So:
     • The OpenAI key never reaches anyone's browser.
     • Nobody has to type a key in Settings. Live AI just works.
     • An optional class code keeps strangers out.
     • Limits stop any one person from running up your bill.

   Environment variables (Vercel → Project → Settings → Environment Variables,
   or the .env file when running `vercel dev` on your computer):
     OPENAI_API_KEY   required. Your OpenAI key (starts with sk-).
     OPENAI_MODEL     optional. Chat/vision model to use (default: gpt-6.1-terra).
     CLASS_CODE       optional. A code students enter once to use Live AI.
     DAILY_LIMIT      optional. AI requests per person per day (default: 200).
     ALLOWED_ORIGINS  optional. Other sites allowed to call this server,
                      comma-separated. The app's own Vercel site is always allowed.

   vercel.json sends every /api/<route> request here as /api/ai?route=<route>.
   ===================================================================== */

export const maxDuration = 60;   // seconds; photo analysis can take a while

const OPENAI = "https://api.openai.com/v1";

const DEFAULT_MODEL = "gpt-6.1-terra";
const CHAT_MODELS = ["gpt-6.1-terra", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"];
const TTS_MODELS = ["gpt-4o-mini-tts"];
const STT_MODELS = ["gpt-transcribe"];

const MAX_OUTPUT_TOKENS = 16000;
const MAX_BODY_BYTES = 4.4 * 1024 * 1024;   // Vercel functions accept at most 4.5 MB per request
const MAX_SPEECH_CHARS = 4096;

// Best-effort per-person daily counter. It lives in memory, so it resets when
// Vercel starts a new instance; your OpenAI budget limit is the hard cap.
const usage = new Map();   // "ip|YYYY-MM-DD" → count

const env = name => (process.env[name] || "").trim();
const chatModel = () => env("OPENAI_MODEL") || DEFAULT_MODEL;

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Class-Code",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && originAllowed(request)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// The app's own site (same host) is always allowed; others only if listed in ALLOWED_ORIGINS.
function originAllowed(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host"), new URL(request.url).host].filter(Boolean);
  try { if (hosts.includes(new URL(origin).host)) return true; } catch (e) { /* bad origin */ }
  return env("ALLOWED_ORIGINS").split(",").map(s => s.trim()).filter(Boolean).includes(origin);
}

async function handle(request) {
  const cors = corsHeaders(request);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const fail = (status, code, message) => json(status, { error: { code, message } });

  if (!originAllowed(request)) return fail(403, "origin_not_allowed", "This site isn't allowed to use the GardenGrow AI server.");

  const url = new URL(request.url);
  const route = "/" + String(url.searchParams.get("route") || url.pathname.replace(/^\/api\/?/, "")).replace(/^\/+|\/+$/g, "");
  const apiKey = env("OPENAI_API_KEY");
  const classCode = env("CLASS_CODE");

  // Public status check (no class code needed). Never reveals the key.
  if (route === "/" || route === "/health") {
    return json(200, { ok: true, app: "GardenGrow AI", keySet: !!apiKey, codeRequired: !!classCode, models: [chatModel()] });
  }

  if (!apiKey) return fail(503, "no_key", "Live AI isn't set up yet: the server has no OpenAI key. Add OPENAI_API_KEY in Vercel's environment variables.");

  // Class code
  if (classCode) {
    const given = (request.headers.get("X-Class-Code") || "").trim().toUpperCase();
    if (!sameText(given, classCode.toUpperCase())) {
      return fail(403, "bad_class_code", given ? "That class code isn't right. Check it with your teacher." : "Enter your class code to use Live AI.");
    }
  }

  // Per-person daily limit (counted only for requests that cost money)
  if (route !== "/models") {
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
    const day = new Date().toISOString().slice(0, 10);
    const k = ip + "|" + day;
    const n = (usage.get(k) || 0) + 1;
    const limit = Number(env("DAILY_LIMIT")) || 200;
    if (n > limit) return fail(429, "daily_limit", `This device reached today's Live AI limit (${limit}). It resets tomorrow.`);
    usage.set(k, n);
    if (usage.size > 5000) for (const key of usage.keys()) if (!key.endsWith(day)) usage.delete(key);
  }

  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
    return fail(413, "too_large", "That request is too large. Try a smaller photo or a shorter recording.");
  }

  const auth = { Authorization: `Bearer ${apiKey}` };
  try {
    if (route === "/models" && request.method === "GET") {
      // Used by the class-code check: confirms the server, key and code work.
      const r = await fetch(`${OPENAI}/models`, { headers: auth });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json(r.status, data);
      return json(200, { data: [{ id: chatModel() }] });
    }

    if (route === "/responses" && request.method === "POST") {
      const body = await readJSON(request);
      if (!body) return fail(413, "too_large", "That request is too large. Try a smaller photo.");
      const forced = env("OPENAI_MODEL");
      body.model = forced || (CHAT_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL);
      body.max_output_tokens = Math.min(Number(body.max_output_tokens) || 4000, MAX_OUTPUT_TOKENS);
      body.store = false;
      delete body.tools; delete body.background; delete body.previous_response_id;
      return relay(await fetch(`${OPENAI}/responses`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), cors);
    }

    if (route === "/audio/speech" && request.method === "POST") {
      const body = await readJSON(request);
      if (!body || typeof body.input !== "string") return fail(400, "bad_request", "Nothing to read aloud.");
      if (!TTS_MODELS.includes(body.model)) body.model = TTS_MODELS[0];
      body.input = body.input.slice(0, MAX_SPEECH_CHARS);
      return relay(await fetch(`${OPENAI}/audio/speech`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), cors);
    }

    if (route === "/audio/transcriptions" && request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string" || file.size > MAX_BODY_BYTES) return fail(400, "bad_request", "No recording was received.");
      const out = new FormData();
      out.append("file", file, file.name || "question.webm");
      out.append("model", STT_MODELS.includes(form.get("model")) ? form.get("model") : STT_MODELS[0]);
      if (form.get("prompt")) out.append("prompt", String(form.get("prompt")).slice(0, 500));
      return relay(await fetch(`${OPENAI}/audio/transcriptions`, { method: "POST", headers: auth, body: out }), cors);
    }

    return fail(404, "not_found", "Unknown request.");
  } catch (err) {
    return fail(502, "upstream", "The AI server couldn't reach OpenAI. Please try again.");
  }
}

// Passes OpenAI's answer (JSON or audio) back to the app.
function relay(r, cors) {
  const headers = { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json" };
  return new Response(r.body, { status: r.status, headers });
}

async function readJSON(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// Compares two strings without revealing how many characters matched.
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
