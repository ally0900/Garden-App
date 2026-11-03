/* =====================================================================
   GardenGrow AI — script.js
   ---------------------------------------------------------------------
   Plain JavaScript, no frameworks. Read top to bottom:

   1. CONFIG ............ settings you can change
   2. STATE ............. everything the app remembers (saved in localStorage)
   3. HELPERS ........... small utilities (escape text, dates, toasts)
   4. NAVIGATION ........ switching between screens
   5. PHOTO UPLOAD ...... reading, shrinking and previewing photos
   6. ANALYSIS .......... demo mode + live AI mode
   7. ACTION PLAN ....... task library + personalization
   8. RENDERING ......... drawing each screen from STATE
   9. GARDEN TIPS ....... tip content
   10. START ............ wires everything up when the page loads
   ===================================================================== */

/* ---------- 1. CONFIG ---------- */
const CONFIG = {
  apiUrl: "/api/analyze",        // live AI endpoint (served by server.js)
  healthUrl: "/api/health",      // lets the app check whether live AI is set up
  dbName: "gardengrow-ai",       // browser database that holds every class and project
  oldStorageKey: "gardengrow-ai-v1", // where version 1 saved data (moved over automatically)
  maxImageSize: 1280,            // photos are shrunk to this many pixels on the long side
  imageQuality: 0.8,             // JPEG quality for saved photos (0–1)
  maxProgressPhotos: 8,          // keep storage small
  demoDelayMs: 1400              // short pause so the demo feels like a real request
};

/* ---------- 2. STATE & STORAGE ----------
   The app keeps two kinds of data:
   • app   → the classroom: list of classes, list of projects, which project is open, settings.
   • state → the ONE project that's open right now (photos, plan, chat…). Same shape as before.
   Everything is saved in the browser's IndexedDB database, which holds far more than localStorage
   (enough for many classes' photos). Each project is stored separately, so opening one is fast. */

const DEFAULT_APP = {
  classes: [],                   // [{ id, name, teacher, color, createdAt }]
  projects: [],                  // [{ id, classId, name, members, createdAt, updatedAt, thumb, progress, health }]
  activeProjectId: null,
  mode: "demo",                  // "demo" or "live" (for the whole kiosk)
  teacherPin: "",                // optional light lock for teacher actions
  idleMinutes: 10                // kiosk: return to project list after this many idle minutes (0 = off)
};

const DEFAULT_STATE = {
  garden: {
    name: "", location: "", crops: "", goalDate: "",
    sunlight: "", soilTest: "none", drainage: "unknown", budget: "", notes: "",
    soilPH: "", soilOM: "", soilNotes: ""   // filled in once a soil test is done
  },
  chat: { photo: null, messages: [] },     // Garden Chat conversation
  scanPhoto: null,               // photo currently on the Scan screen (data URL)
  analysis: null,                // the latest assessment
  tasks: [],                     // the action plan
  beforePhoto: null,             // { photo, date } — first scanned photo
  progressPhotos: [],            // [{ photo, date, note }]
  log: []                        // [{ type, text, date }]
};

let app = structuredCloneSafe(DEFAULT_APP);
let state = structuredCloneSafe(DEFAULT_STATE);
let liveAvailable = false;       // set by checkLiveAI()
let taskFilter = "all";
let tipFilter = "All";

function structuredCloneSafe(obj) { return JSON.parse(JSON.stringify(obj)); }
function newId(prefix) { return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Fills in any missing fields (useful when a project was saved by an older version of the app).
function normalizeProject(saved) {
  const base = structuredCloneSafe(DEFAULT_STATE);
  if (!saved || typeof saved !== "object") return base;
  return {
    ...base, ...saved,
    garden: { ...base.garden, ...(saved.garden || {}) },
    chat: { photo: null, messages: [], ...(saved.chat || {}) }
  };
}

/* --- Tiny IndexedDB helper (two "tables": meta and projects) --- */
let dbPromise = null;
let memoryOnly = false;          // true if the browser blocks storage (e.g., some private windows)
const memoryDB = { meta: {}, projects: {} };

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB not available"));
      const req = indexedDB.open(CONFIG.dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("meta");
        req.result.createObjectStore("projects");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Database blocked"));
    });
  }
  return dbPromise;
}
async function dbDo(store, mode, fn) {
  if (memoryOnly) return fn(null, memoryDB[store]);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Save was cancelled (storage may be full)."));
  });
}
const dbGet = (store, key) => dbDo(store, "readonly", (s, mem) => mem ? { result: mem[key] } : s.get(key));
const dbPut = (store, key, val) => dbDo(store, "readwrite", (s, mem) => mem ? (mem[key] = structuredCloneSafe(val), null) : s.put(val, key));
const dbDelete = (store, key) => dbDo(store, "readwrite", (s, mem) => mem ? (delete mem[key], null) : s.delete(key));
const dbAllKeys = store => dbDo(store, "readonly", (s, mem) => mem ? { result: Object.keys(mem) } : s.getAllKeys());

// Loads the classroom + the open project when the page starts.
async function loadApp() {
  try {
    await openDB();
  } catch (e) {
    memoryOnly = true;
    setTimeout(() => toast("This browser is blocking storage, so work won't be saved after closing. Try a normal (not private) window."), 600);
  }
  const savedApp = await dbGet("meta", "app").catch(() => null);
  app = { ...structuredCloneSafe(DEFAULT_APP), ...(savedApp || {}) };

  // One-time move of data saved by the first (single-project) version of GardenGrow AI.
  try {
    const old = localStorage.getItem(CONFIG.oldStorageKey);
    if (old && !app.migratedV1) {
      const saved = JSON.parse(old);
      const cls = { id: newId("class"), name: "My Class", teacher: "", color: CLASS_COLORS[0], createdAt: nowISO() };
      const proj = { id: newId("proj"), classId: cls.id, name: saved.garden?.name || "My first garden", members: "", createdAt: nowISO(), updatedAt: nowISO() };
      if (saved.mode) app.mode = saved.mode;
      delete saved.mode;
      app.classes.push(cls);
      app.projects.push(proj);
      await dbPut("projects", proj.id, normalizeProject(saved));
      app.migratedV1 = true;
      await dbPut("meta", "app", app);
    }
  } catch (e) { /* nothing to migrate */ }

  if (app.activeProjectId) {
    const saved = await dbGet("projects", app.activeProjectId).catch(() => null);
    if (saved && app.projects.some(p => p.id === app.activeProjectId)) state = normalizeProject(saved);
    else app.activeProjectId = null;
  }
}

// Saves are queued so they happen in order, even when many happen quickly.
let saveChain = Promise.resolve();
function queueSave(job) {
  saveChain = saveChain.then(job).catch(err => {
    console.error(err);
    const full = /quota|full|abort/i.test(String(err && (err.name + err.message)));
    toast(full ? "Storage is full. Ask your teacher to download a backup and delete old projects."
               : "Couldn't save just now. Please try again.");
  });
  return saveChain;
}

function saveApp() {
  return queueSave(() => dbPut("meta", "app", app));
}

// Saves the open project AND updates its card on the project list (progress, photo thumbnail…).
function saveState() {
  const pid = app.activeProjectId;
  if (!pid) return saveApp();
  updateProjectSummary(pid);
  return queueSave(() => Promise.all([dbPut("projects", pid, state), dbPut("meta", "app", app)]));
}

function currentProject() { return app.projects.find(p => p.id === app.activeProjectId) || null; }
function currentClass() { const p = currentProject(); return p ? app.classes.find(c => c.id === p.classId) || null : null; }

function updateProjectSummary(pid) {
  const p = app.projects.find(x => x.id === pid);
  if (!p) return;
  p.updatedAt = nowISO();
  p.progress = completion();
  p.tasksDone = state.tasks.filter(t => t.done).length;
  p.tasksTotal = state.tasks.length;
  p.health = healthStatus().label;
  const photo = state.progressPhotos.at(-1)?.photo || state.analysis?.photo || state.scanPhoto;
  const key = photo ? photo.length + ":" + photo.slice(-32) : "";
  if (key !== (p.thumbKey || "")) {
    p.thumbKey = key;
    if (!photo) { p.thumb = null; return; }
    makeThumb(photo).then(t => { p.thumb = t; saveApp(); });
  }
}

/* ---------- 3. HELPERS ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Always escape text before putting it into HTML (protects against broken layouts and injected code).
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function icon(name, cls = "icon") { return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function addLog(type, text) {
  state.log.unshift({ type, text, date: nowISO() });
  state.log = state.log.slice(0, 60);
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function cropName() { return (state.garden.crops || "").trim() || "your plants"; }

/* ---------- CROP GUIDE ----------
   Quick facts for common crops, so advice fits whatever each project wants to grow.
   To add a crop: copy an entry, change "match" (words that identify it) and the facts.
   sun = minimum hours of direct sun · ph = preferred soil pH range · family groups crops with similar needs. */
const CROP_GUIDE = [
  { key: "pumpkins", match: /pumpkin|gourd|winter squash|butternut|acorn squash/i, name: "Pumpkins & winter squash", family: "vine", sun: 6, sunText: "full sun, 6+ hours (8 is ideal)",
    ph: [6.0, 6.8], days: "90–120 days from seed", plant: "Sow seeds outdoors after your last frost, once the soil feels warm (around 70°F).",
    space: "Plant on hills about 3 ft wide, 4–8 ft apart. The vines need lots of room.", water: "About 1 inch per week, more while fruit is growing.",
    pests: "squash bugs, squash vine borers, cucumber beetles, and powdery mildew" },
  { key: "squash", match: /zucchini|squash|courgette/i, name: "Zucchini & summer squash", family: "vine", sun: 6, sunText: "full sun, 6–8 hours",
    ph: [6.0, 6.8], days: "45–65 days from seed", plant: "Sow seeds after your last frost, once the soil is warm.",
    space: "About 3 ft apart. One or two plants make a lot of squash!", water: "About 1 inch per week, at the base of the plant.",
    pests: "squash bugs, squash vine borers, and powdery mildew" },
  { key: "cucumbers", match: /cucumber|melon|watermelon|cantaloupe/i, name: "Cucumbers & melons", family: "vine", sun: 6, sunText: "full sun, 6–8 hours",
    ph: [6.0, 7.0], days: "50–90 days from seed", plant: "Sow seeds after your last frost, once the soil is warm.",
    space: "Cucumbers 12 in apart on a trellis, or hills 3–6 ft apart on the ground.", water: "About 1 inch per week, kept steady.",
    pests: "cucumber beetles and powdery mildew" },
  { key: "tomatoes", match: /tomato/i, name: "Tomatoes", family: "fruiting", sun: 6, sunText: "full sun, 6–8+ hours",
    ph: [6.2, 6.8], days: "60–85 days after transplanting", plant: "Set out young plants 1–2 weeks after your last frost. Buy transplants or start seeds indoors 6–8 weeks earlier.",
    space: "18–36 in apart. Put a stake or cage in at planting time.", water: "1–2 inches per week, kept steady to prevent cracked fruit and blossom-end rot.",
    pests: "tomato hornworms, aphids, and early blight" },
  { key: "peppers", match: /pepper|jalape|chile|chili/i, name: "Peppers", family: "fruiting", sun: 6, sunText: "full sun, 6–8 hours",
    ph: [6.0, 6.8], days: "60–90 days after transplanting", plant: "Set out transplants about 2 weeks after your last frost, once nights stay above 50°F.",
    space: "18–24 in apart.", water: "About 1 inch per week. Don't let the soil dry out completely.", pests: "aphids and hornworms" },
  { key: "beans", match: /bean|pea\b|peas/i, name: "Beans & peas", family: "legume", sun: 6, sunText: "6+ hours",
    ph: [6.0, 7.0], days: "50–70 days from seed", plant: "Sow beans after your last frost (soil around 60°F). Peas go in early, about 4–6 weeks before your last frost.",
    space: "2–4 in apart in rows 18–24 in apart. Pole beans and peas need a trellis.", water: "About 1 inch per week, especially while flowering.",
    pests: "bean beetles and aphids" },
  { key: "greens", match: /lettuce|spinach|kale|chard|green|collard|arugula|cabbage|broccoli|cauliflower|salad/i, name: "Leafy greens & cool-season crops", family: "cool", sun: 4, sunText: "at least 3–4 hours (afternoon shade is fine in warm weather)",
    ph: [6.0, 7.0], days: "30–70 days, depending on the crop", plant: "These like cool weather. Plant in early spring (2–4 weeks before your last frost) or in late summer for a fall harvest.",
    space: "Lettuce and spinach 6–12 in apart, kale and broccoli 12–18 in.", water: "Keep the soil evenly moist, about 1 inch per week.",
    pests: "aphids, cabbage worms, and slugs" },
  { key: "roots", match: /carrot|radish|beet|turnip|onion|garlic|root/i, name: "Root crops (carrots, radishes, beets, onions)", family: "root", sun: 6, sunText: "6+ hours (a little shade is OK)",
    ph: [6.0, 6.8], days: "25–30 days for radishes, 60–80 for carrots and beets", plant: "Sow seeds directly in the ground 2–3 weeks before your last frost, and again in late summer. Plant garlic in fall.",
    space: "Thin seedlings to 2–4 in apart.", water: "Keep the top inch of soil moist until seeds sprout.",
    pests: "flea beetles and carrot rust flies", note: "Roots fork and twist in rocky soil, so clear stones from these beds or use a raised bed." },
  { key: "potatoes", match: /potato/i, name: "Potatoes", family: "root", sun: 6, sunText: "6+ hours",
    ph: [5.0, 6.5], days: "70–120 days", plant: "Plant seed potatoes 2–4 weeks before your last frost, once the soil can be worked.",
    space: "12 in apart in rows about 3 ft apart. Mound soil over the stems as they grow.", water: "1–2 inches per week while plants are flowering.",
    pests: "Colorado potato beetles", note: "Potatoes like slightly acidic soil, so skip lime unless your soil test says otherwise." },
  { key: "corn", match: /corn|maize/i, name: "Sweet corn", family: "corn", sun: 8, sunText: "full sun, 8+ hours",
    ph: [6.0, 6.8], days: "60–100 days", plant: "Sow seeds after your last frost, once the soil is around 60°F.",
    space: "8–12 in apart, planted in a block of at least 4 short rows so the wind can pollinate it.", water: "About 1 inch per week, especially when tassels appear.",
    pests: "corn earworms (and raccoons!)" },
  { key: "herbs", match: /herb|basil|parsley|cilantro|mint|rosemary|thyme|oregano|dill|sage\b|chive/i, name: "Herbs", family: "herb", sun: 6, sunText: "6+ hours (parsley, cilantro, chives, and mint handle some shade)",
    ph: [6.0, 7.0], days: "Basil about 60 days. Most herbs can be picked as they grow", plant: "Plant basil after your last frost. Parsley, cilantro, and dill can go in a few weeks earlier.",
    space: "8–18 in apart, depending on the herb. Grow mint in a pot so it doesn't take over.", water: "About 1 inch per week. Rosemary and thyme like it drier.",
    pests: "aphids and Japanese beetles" },
  { key: "flowers", match: /sunflower|flower|zinnia|marigold|pollinator|wildflower/i, name: "Sunflowers & flowers", family: "flower", sun: 6, sunText: "full sun, 6–8 hours",
    ph: [6.0, 7.5], days: "60–100 days", plant: "Sow most annual flowers after your last frost.",
    space: "Sunflowers 12–24 in apart, smaller flowers 8–12 in.", water: "About 1 inch per week until plants are established.",
    pests: "aphids (and birds eating sunflower seeds)" }
];
const GENERAL_CROP = { key: "general", name: "Most vegetables", family: "general", sun: 6, sunText: "at least 6 hours", ph: [6.0, 7.0],
  days: "see the seed packet", plant: "Check the seed packet and your area's last frost date.", space: "Follow the spacing on the seed packet.",
  water: "About 1 inch per week.", pests: "aphids and other common garden pests" };

// The crop guides that match this project's "Intended plants or crops" field (e.g. "tomatoes, basil").
function cropGuides() {
  const parts = (state.garden.crops || "").split(/,|;|\/|&|\band\b/i).map(x => x.trim()).filter(Boolean);
  const found = [];
  for (const part of parts) {
    const guide = CROP_GUIDE.find(c => c.match.test(part));
    if (guide && !found.includes(guide)) found.push(guide);
  }
  return found;
}
function mainCrop() { return cropGuides()[0] || GENERAL_CROP; }
function sunNeed() { const gs = cropGuides(); return gs.length ? Math.max(...gs.map(g => g.sun)) : 6; }
function hasFamily(f) { return cropGuides().some(g => g.family === f); }
function cropsLabel() {
  const gs = cropGuides();
  if (!gs.length) return (state.garden.crops || "").trim() || "most vegetables";
  return gs.map(g => g.name.toLowerCase().replace(/ \(.*\)/, "")).join(", ");
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

function goalLabel() {
  const g = state.garden.goalDate;
  if (!g || !/^\d{4}-\d{2}$/.test(g)) return "";
  const [y, m] = g.split("-").map(Number);
  const goal = new Date(y, m - 1, 1);
  const now = new Date();
  const months = (goal.getFullYear() - now.getFullYear()) * 12 + (goal.getMonth() - now.getMonth());
  const name = goal.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (months > 0) return `${name} · ${months} month${months === 1 ? "" : "s"} to go`;
  if (months === 0) return `${name} · this month!`;
  return name;
}

/* ---------- 4. NAVIGATION ---------- */
const VIEWS = ["projects", "home", "scan", "chat", "garden", "plan", "progress", "tips"];

function showView(name) {
  if (!VIEWS.includes(name)) name = app.activeProjectId ? "home" : "projects";
  // No project open yet? Everything except Tips sends you to the project list first.
  if (!app.activeProjectId && name !== "tips") name = "projects";
  if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
  renderProjectChip();
  $$(".view").forEach(v => { v.hidden = v.dataset.view !== name; });
  $$("[data-nav]").forEach(a => a.classList.toggle("is-active", a.dataset.nav === name && a.closest(".nav, .bottom-nav")));
  render(name);
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

/* ---------- 5. PHOTO UPLOAD ---------- */

// Reads an image file, shrinks it, and returns a JPEG data URL (small enough to save in the browser).
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file (JPG or PNG)."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, CONFIG.maxImageSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", CONFIG.imageQuality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This browser couldn't open that image. Try a JPG or PNG (iPhone HEIC photos may need converting)."));
    };
    img.src = url;
  });
}

async function handleScanFile(file) {
  try {
    state.scanPhoto = await fileToDataURL(file);
    saveState();
    $("#results").hidden = true;      // old results belong to the old photo
    renderScan();
    toast("Photo added. Tap “Analyze My Garden” when you're ready.");
  } catch (err) {
    toast(err.message);
  }
}

function setupUpload() {
  const input = $("#photoInput");
  const dz = $("#dropzone");

  input.addEventListener("change", () => { if (input.files[0]) handleScanFile(input.files[0]); input.value = ""; });
  $("#replaceBtn").addEventListener("click", () => input.click());
  $("#sampleBtn").addEventListener("click", () => {
    if (!window.SAMPLE_PHOTO) { toast("Sample photo file (sample-photo.js) is missing."); return; }
    state.scanPhoto = window.SAMPLE_PHOTO;
    saveState();
    $("#results").hidden = true;
    renderScan();
  });
  $("#removeBtn").addEventListener("click", () => {
    state.scanPhoto = null;
    saveState();
    $("#results").hidden = true;
    renderScan();
  });

  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) handleScanFile(f); });

  // Progress photos
  $("#progressInput").addEventListener("change", async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const photo = await fileToDataURL(file);
      addProgressPhoto(photo, "Progress photo added");
      saveState();
      renderProgress();
      toast("Progress photo saved.");
    } catch (err) { toast(err.message); }
  });
}

function addProgressPhoto(photo, logText) {
  if (!state.beforePhoto) {
    state.beforePhoto = { photo, date: nowISO() };
    addLog("photo", "Before photo saved");
    return;
  }
  state.progressPhotos.push({ photo, date: nowISO() });
  state.progressPhotos = state.progressPhotos.slice(-CONFIG.maxProgressPhotos);
  addLog("photo", logText);
}

/* ---------- 6. ANALYSIS ---------- */

/*
  Every analysis — demo or live — has the same shape, so the screens don't care where it came from:
  {
    source: "demo" | "live",
    createdAt, photo, summary,
    observations: [{ text, confidence: "clear" | "likely" | "uncertain" }],
    concerns:     [{ text, detail }],
    questions:    [string],
    nextSteps:    [string],
    tasks:        [task]  (optional — live AI can suggest its own; demo uses the task library)
    colors:       { green, earth, gray, shadow, other }  (simple pixel count, not AI)
  }
*/

async function runAnalysis() {
  if (!state.scanPhoto) return;
  const pid = app.activeProjectId;            // remember which project started this analysis
  const btn = $("#analyzeBtn");
  btn.disabled = true;
  $("#results").hidden = true;
  $("#loading").hidden = false;

  const live = app.mode === "live" && liveAvailable;
  $("#loadingText").textContent = live
    ? "Sending your photo and garden details to the AI… this can take 10–30 seconds."
    : "Demo mode: preparing sample results (no AI is looking at your photo)…";

  try {
    const colors = await measureColors(state.scanPhoto);
    let result;
    if (live) {
      result = await analyzeLive(state.scanPhoto, state.garden);
    } else {
      await new Promise(r => setTimeout(r, CONFIG.demoDelayMs));
      result = analyzeDemo(state.garden, colors);
    }
    if (app.activeProjectId !== pid) return;   // someone switched projects while we waited
    result.colors = colors;
    result.photo = state.scanPhoto;
    result.createdAt = nowISO();
    state.analysis = result;

    // Photo history: first scan becomes the "before" photo; later scans become progress photos.
    if (!state.beforePhoto) {
      state.beforePhoto = { photo: state.scanPhoto, date: nowISO() };
    } else if (state.beforePhoto.photo !== state.scanPhoto && !state.progressPhotos.some(p => p.photo === state.scanPhoto)) {
      state.progressPhotos.push({ photo: state.scanPhoto, date: nowISO() });
      state.progressPhotos = state.progressPhotos.slice(-CONFIG.maxProgressPhotos);
    }

    rebuildTasks();
    addLog("scan", live ? "Garden scanned with live AI" : "Garden scanned (demo mode — sample results)");
    saveState();
    $("#loading").hidden = true;
    renderScan();
    $("#results").hidden = false;
    $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    $("#loading").hidden = true;
    toast(err.message || "Something went wrong during analysis.");
  } finally {
    btn.disabled = !state.scanPhoto;
  }
}

/* --- Live AI: sends the photo + garden details to YOUR server (server.js), which talks to the AI.
       The API key lives only on the server, never in this file. --- */
async function analyzeLive(photo, garden) {
  let res;
  try {
    res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: photo, garden })
    });
  } catch (e) {
    throw new Error("Couldn't reach the AI server. Is server.js running? (See README.)");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The AI server returned an error (${res.status}).`);
  return normalizeAnalysis(data, "live");
}

// Makes sure whatever the AI sent back has the fields the app expects.
function normalizeAnalysis(d, source) {
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (typeof v === "string" ? v : v == null ? "" : String(v));
  const conf = c => (["clear", "likely", "uncertain"].includes(c) ? c : "likely");
  const prio = p => (["high", "medium", "low"].includes(p) ? p : "medium");
  const cost = c => (["free", "low-cost", "higher-cost"].includes(c) ? c : "low-cost");
  return {
    source,
    summary: str(d.summary),
    observations: arr(d.observations).map(o => typeof o === "string" ? { text: o, confidence: "likely" } : { text: str(o.text), confidence: conf(o.confidence) }).filter(o => o.text),
    concerns: arr(d.concerns).map(c => typeof c === "string" ? { text: c, detail: "" } : { text: str(c.text), detail: str(c.detail) }).filter(c => c.text),
    questions: arr(d.questions).map(str).filter(Boolean),
    nextSteps: arr(d.nextSteps).map(str).filter(Boolean),
    plants: arr(d.plants).map(p => ({
      name: str(p.name), verdict: ["keep", "remove", "identify"].includes(p.verdict) ? p.verdict : "identify",
      reason: str(p.reason), confidence: conf(p.confidence)
    })).filter(p => p.name),
    soilNeeds: arr(d.soilNeeds).map(str).filter(Boolean),
    soilPlan: arr(d.soilPlan).map(s => typeof s === "string" ? { step: s, detail: "" } : { step: str(s.step), detail: str(s.detail) }).filter(s => s.step),
    tasks: arr(d.tasks).map((t, i) => ({
      id: "ai-" + (str(t.id) || i).toString().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      title: str(t.title), priority: prio(t.priority), why: str(t.why),
      steps: arr(t.steps).map(str).filter(Boolean), cost: cost(t.cost), uncertain: str(t.uncertain)
    })).filter(t => t.title)
  };
}

/* --- Demo mode: clearly-labeled SAMPLE results. These are written for the GardenGrow project site
       (rocky soil, exposed soil, pine needles, surrounding trees) and adjusted using the garden form
       and a simple color count of your photo. No AI looks at the photo in demo mode. --- */
function analyzeDemo(g, colors) {
  // Sample observations written from the real GardenGrow project-site photos (October 2026).
  const observations = [
    { text: "Bare, tan-brown soil across most of the cleared area, with little plant cover", confidence: "likely" },
    { text: "Many small pale rocks and gravel on the surface, clustered in patches", confidence: "likely" },
    { text: "Pine needles spread like mulch over part of the bed", confidence: "likely" },
    { text: "Small seedlings coming up through the needles. They may have been sown on purpose", confidence: "uncertain" },
    { text: "The bed sits at the bottom of a grassy slope, with tall evergreen trees uphill", confidence: "likely" },
    { text: "Tall dry grass and cut grass clumps along the slope and edges", confidence: "likely" },
    { text: "Dark patches in the soil. These could be ash, charred debris, or organic matter", confidence: "uncertain" },
    { text: "A gravel driveway and old wooden fence posts along one side", confidence: "likely" }
  ];

  const concerns = [
    { text: "Exposed soil can erode and form a hard crust", detail: "Rain hitting bare soil washes away topsoil and packs the surface, which makes it harder for seeds and roots." },
    { text: "Runoff from the slope above may wash across the bed", detail: "Water running downhill can carry soil away or pool at the bottom. Watch where water flows during the next heavy rain." },
    { text: "Rocks may make planting and root growth harder", detail: "Most plants can grow around small stones, but dense rock in planting spots limits roots and makes digging difficult." + (hasFamily("root") ? " Root crops like carrots fork in rocky soil." : "") },
    { text: "The evergreen trees uphill may shade part of the bed", detail: `For ${cropsLabel()}, aim for at least ${sunNeed()} hours of direct sun. Evergreens shade the same spot all year, and a photo can't show how that shade moves through the day.` },
    { text: "Pale, gravelly soil may be low in organic matter", detail: "This is a guess from how the soil looks. Only a soil test can confirm it." },
    { text: "Dark patches: find out what they are", detail: "If something was burned there, ask what it was. Ash from untreated wood is usually fine. Ash from trash, painted wood, or treated lumber should stay out of a food garden." },
    { text: "A thick needle layer can slow soil warming and block seeds", detail: "This is about the physical layer, not acidity. Pine needles have very little effect on soil pH." }
  ];

  // Personalize with the garden form
  if (g.sunlight === "shade") concerns.unshift({ text: `You reported mostly shade, the biggest concern for ${cropsLabel()}`, detail: sunNeed() >= 6 ? "Under 3 hours of sun usually isn't enough for fruiting crops to flower and ripen. Leafy greens and some herbs are better picks for shady spots." : "Leafy greens can manage with 3–4 hours, but less than that will slow them down." });
  const shadeIdx = concerns.findIndex(c => /shade/.test(c.text));
  if (g.sunlight === "partial") concerns.splice(shadeIdx, 1, { text: "You reported partial sun (3–6 hours)", detail: sunNeed() >= 6 ? `${cap(cropsLabel())} may grow but produce less. Use the sunniest spot, and consider leafy greens or herbs for shadier areas.` : "That's workable for leafy greens and many herbs." });
  if (g.sunlight === "full") concerns.splice(shadeIdx, 1);
  if (g.drainage === "puddles") concerns.splice(1, 0, { text: "You reported puddles after rain", detail: "Standing water can rot roots. Raised beds or mounds and added organic matter usually help." });

  const questions = [];
  if (!g.sunlight || g.sunlight === "unknown") questions.push("How many hours of direct sun does the planting area get on a summer day?");
  if (g.soilTest !== "done") questions.push("What are the soil's pH and nutrient levels? Only a soil test can answer this — a photo can't.");
  if (!g.drainage || g.drainage === "unknown") questions.push("Does water puddle after a heavy rain? How long does it take to soak in?");
  questions.push("Is there a hose or water spigot close enough to reach the garden?");
  questions.push("Are the nearby trees evergreen (like pines) or do they lose their leaves in winter?");
  questions.push("Has anything (like weed killer) been sprayed on this area in past years?");
  if (!g.location) questions.push("Where is the garden? Planting dates depend on your local frost dates.");
  if (!g.budget) questions.push("What budget do you have for supplies like compost or a soaker hose?");

  // Add one honest, measured line from the photo's colors
  if (colors) {
    const parts = [];
    if (colors.earth >= 35) parts.push(`about ${colors.earth}% of the photo is brown or tan (could be soil, needles, or mulch)`);
    if (colors.green <= 20) parts.push(`only about ${colors.green}% is green`);
    else parts.push(`about ${colors.green}% is green (plants or grass)`);
    if (colors.gray >= 15) parts.push(`about ${colors.gray}% is gray (could be rocks or gravel)`);
    observations.unshift({ text: `Color check of your photo: ${parts.join(", ")}.`, confidence: "clear", measured: true });
  }

  const soil = buildSoilPlan(g);
  return {
    source: "demo",
    summary: "Sample assessment of the GardenGrow project site: a cleared bed of bare, rocky soil at the foot of a grassy slope, with pine-needle mulch, new seedlings, and evergreens uphill. Start by testing the soil, mapping sunlight, and watching how water moves before adding anything.",
    observations,
    concerns: concerns.slice(0, 6),
    questions: questions.slice(0, 6),
    nextSteps: [], // filled from the action plan after tasks are built
    plants: DEMO_PLANTS,
    soilNeeds: soil.needs,
    soilPlan: soil.plan,
    tasks: []
  };
}

// Sample plant list for demo mode, written from the GardenGrow project-site photos. NOT detected in the uploaded photo.
const DEMO_PLANTS = [
  { name: "Evergreen trees on the slope (pines or cedars)", verdict: "keep", confidence: "likely",
    reason: "They hold the slope in place and give shade and habitat. Map where their shade falls and plant in the sunniest area instead of removing them." },
  { name: "Seedlings coming up through the pine needles", verdict: "identify", confidence: "uncertain",
    reason: "The rounded leaves look like a radish, turnip, or other cover crop. If someone sowed them on purpose, keep them: they protect and loosen the soil over winter." },
  { name: "Grass on the slope above the bed", verdict: "keep", confidence: "likely",
    reason: "Roots on the slope slow runoff and erosion. Just keep it trimmed so it doesn't creep into the planting area." },
  { name: "Grass clumps and small weeds inside the bed", verdict: "remove", confidence: "likely",
    reason: "These compete with crops for water and nutrients. Pull them from planting spots by hand, roots and all." },
  { name: "Unidentified low-growing plants", verdict: "identify", confidence: "uncertain",
    reason: "Some could be native or pollinator plants worth keeping. Identify them with iNaturalist or PlantNet before removing them." },
  { name: "Any climbing vines", verdict: "identify", confidence: "uncertain",
    reason: "Check for poison ivy (“leaves of three”) before touching any vine. Wear gloves, and never burn it." }
];

/*
  Builds the soil needs + amendment plan from the garden details.
  Without a soil test it ONLY gives steps that are safe for almost any garden (testing, mulch, compost, loosening).
  It mentions lime, sulfur, or fertilizer only as "if your report says so", or when the user has entered a pH.
*/
function buildSoilPlan(g) {
  const ph = parseFloat(g.soilPH);
  const om = parseFloat(g.soilOM);
  const tested = g.soilTest === "done" && (!isNaN(ph) || !isNaN(om) || g.soilNotes);
  const crop = mainCrop();
  const [lo, hi] = crop.ph;
  const range = `${lo.toFixed(1)}–${hi.toFixed(1)}`;
  const who = crop === GENERAL_CROP ? "most vegetables" : crop.name.toLowerCase().replace(/ \(.*\)/, "");
  const needs = [];
  const plan = [];

  if (!tested) {
    needs.push("pH and nutrient levels are unknown until you test. A photo can't show them.");
    needs.push("More organic matter, probably. Bare, rocky soil often has little, but only a test confirms it.");
    needs.push("Loosening where the ground is compacted or rocky.");
    needs.push("Protection for bare soil (mulch or a cover crop) to stop erosion and crusting.");
  } else {
    if (!isNaN(ph)) {
      if (ph < lo) needs.push(`Your pH is ${ph}. That's below the ${range} range ${who} prefer, so your soil is too acidic.`);
      else if (ph > hi + 0.4) needs.push(`Your pH is ${ph}. That's above the ${range} range ${who} prefer, so your soil is alkaline.`);
      else needs.push(`Your pH is ${ph}, which is in a good range. No lime or sulfur is needed.`);
    }
    if (!isNaN(om)) needs.push(om < 3 ? `Organic matter is ${om}%, on the low side. Compost will help a lot.` : `Organic matter is ${om}%, which is healthy. Keep it up with yearly compost.`);
    if (g.soilNotes) needs.push(`Your report says: “${g.soilNotes}”`);
    needs.push("Loosening and rock removal where you plan to plant.");
  }

  if (g.soilTest !== "done") plan.push({ step: "Send a soil test now", detail: "Contact your county Cooperative Extension office. Fall results arrive in plenty of time for spring." });
  plan.push({ step: "Cover bare soil", detail: "Spread 2–4 inches of shredded leaves or seed-free straw over exposed areas now. Rake it back 2–3 weeks before planting." });
  plan.push({ step: "Clear rocks and loosen planting spots", detail: "Use a garden fork to loosen the top 8–12 inches where you'll plant, and pull out rocks bigger than a golf ball." });

  if (tested && !isNaN(ph) && ph < lo) plan.push({ step: "Raise the pH with lime, using your report's amount", detail: "Use the exact rate on your soil report. Lime works slowly, so apply it in fall or early spring and mix it into the top few inches. Don't guess the amount; too much is hard to undo." });
  else if (tested && !isNaN(ph) && ph > hi + 0.4) plan.push({ step: "Follow your report for lowering pH", detail: "Lowering pH is slow. Your report may suggest elemental sulfur at a specific rate. Adding compost every year also helps over time." });
  else if (!tested) plan.push({ step: "Wait for results before adding lime, sulfur, or fertilizer", detail: "These can harm soil if it doesn't need them. Your report will say whether to use them and how much." });

  plan.push({ step: "Work in compost before planting", detail: (!isNaN(om) && om >= 5)
    ? "Your organic matter is already good. A 1-inch layer in planting spots is plenty."
    : "Mix 2–3 inches of finished compost into the top 6–8 inches of each planting spot in early spring. Free municipal compost works well." });

  if (tested && g.soilNotes) plan.push({ step: "Apply only what your report recommends", detail: "Follow the fertilizer type and rate on the report. Split it into smaller doses if it says to." });
  if (hasFamily("vine")) plan.push({ step: "Build planting hills for vining crops", detail: "Mound soil mixed with compost into hills about 3 feet wide and a few inches high. Hills drain better and warm up faster." });
  else plan.push({ step: "Shape your planting beds", detail: "Make beds about 3–4 ft wide so you can reach the middle without stepping on the soil. In wet or rocky spots, a raised bed or mound filled with soil and compost is often easiest." });
  plan.push({ step: "Mulch and repeat every year", detail: "Mulch around plants once they're up. Add compost every year and retest every 2–3 years." });

  return { needs, plan };
}

// Simple color count of the photo. This is basic math on pixel colors, NOT AI.
// It can't tell soil from a brown fence — it only says what share of the picture is each color family.
function measureColors(dataURL) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = 160, h = Math.max(1, Math.round(160 * img.height / img.width));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const counts = { green: 0, earth: 0, gray: 0, shadow: 0, other: 0 };
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        const v = max, s = max === 0 ? 0 : d / max;
        let hue = 0;
        if (d) {
          if (max === r) hue = 60 * (((g - b) / d) % 6);
          else if (max === g) hue = 60 * ((b - r) / d + 2);
          else hue = 60 * ((r - g) / d + 4);
        }
        if (hue < 0) hue += 360;
        if (v < 0.16) counts.shadow++;
        else if (s < 0.14) counts[v > 0.85 ? "other" : "gray"]++;
        else if (hue >= 62 && hue <= 170) counts.green++;
        else if (hue >= 8 && hue < 62 && v < 0.9) counts.earth++;
        else counts.other++;
      }
      const total = w * h;
      const pct = k => Math.round((counts[k] / total) * 100);
      resolve({ green: pct("green"), earth: pct("earth"), gray: pct("gray"), shadow: pct("shadow"), other: pct("other") });
    };
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
}

/* ---------- 7. ACTION PLAN ---------- */

/*
  The task library. Each task is a function of the garden details (g) so it can change its
  priority, cost, or wording. Return null to leave a task out.
  To add a task: copy one block, give it a new id, and edit the text.
*/
const TASK_LIBRARY = [
  g => {
    if (g.soilTest === "done") return {
      id: "soil-test", title: "Use your soil test results", priority: "medium", cost: "free",
      why: "Your soil test tells you exactly what your soil needs, so you only add what will actually help.",
      steps: [
        "Find the pH and organic matter numbers on your report.",
        `Look for the recommendations section for vegetables or ${cropName()}.`,
        "Only add lime, sulfur, or fertilizer if the report recommends it — and in the amount it says.",
        "Not sure how to read it? Call your county Cooperative Extension office; they explain results for free."
      ],
      uncertain: ""
    };
    return {
      id: "soil-test", title: g.soilTest === "planned" ? "Finish your soil test" : "Test the soil",
      priority: g.soilTest === "planned" ? "medium" : "high", cost: "low-cost",
      why: "A photo can't show pH or nutrient levels. A soil test tells you what your soil actually needs, so you don't waste money on (or harm your soil with) fertilizer or lime it doesn't need.",
      steps: [
        "Contact your county Cooperative Extension office and ask for a soil test kit (often about $10–$30, depending on your state).",
        "Use a clean trowel and a plastic bucket. Take 10–15 small samples, each about 6 inches deep, from across the planting area.",
        "Mix the samples together, remove rocks and roots, and let the soil air-dry.",
        `Mail the amount the lab asks for. On the form, list ${cropName()} as your crop.`,
        "When results arrive, update “Soil-test status” in My Garden."
      ],
      uncertain: "Fall is a great time to test — labs are less busy and you'll have results well before spring planting."
    };
  },

  g => ({
    id: "sunlight", title: "Map your sunlight",
    priority: g.sunlight === "full" ? "medium" : "high", cost: "free",
    why: cropGuides().length
      ? cropGuides().map(c => `${c.name} need ${c.sunText}.`).join(" ") + " Nearby trees and buildings can shade parts of the garden."
      : "Most vegetables need at least 6 hours of direct sun to grow well. Nearby trees and buildings can shade parts of the garden.",
    steps: [
      "Pick a clear day. Check the garden at about 9 AM, noon, 3 PM, and 6 PM.",
      "Take a photo from the same spot each time, or sketch which areas are sunny vs. shaded.",
      "Mark the area that gets the most hours of direct sun — that's where your plants go.",
      "Remember: trees that drop leaves cast much more shade in summer than in late fall or winter. Pines shade year-round."
    ],
    uncertain: g.sunlight === "shade" || g.sunlight === "partial"
      ? `If the best spot gets under ${sunNeed()} hours, consider shade-tolerant crops like lettuce, spinach, kale, or parsley, or ask the landowner and a certified arborist about pruning options. Don't remove trees without a professional evaluation.`
      : ""
  }),

  g => ({
    id: "drainage", title: "Test your drainage",
    priority: (g.drainage === "unknown" || g.drainage === "puddles" || !g.drainage) ? "high" : "medium", cost: "free",
    why: "Roots need both water and air. Soil that stays soggy can rot roots; soil that drains too fast dries out. Uneven, rocky ground can hide both problems.",
    steps: [
      "Dig a hole about 12 inches deep and 12 inches wide in the planting area.",
      "Fill it with water and let it drain completely (this soaks the surrounding soil).",
      "Fill it again, and measure how far the water drops each hour with a ruler.",
      "About 1–6 inches per hour is good. Slower than 1 inch per hour means poor drainage; faster than 6 means it drains very quickly.",
      "Write your result in My Garden under “Drainage observations.”"
    ],
    uncertain: g.drainage === "puddles"
      ? "Since you've seen puddles: planting on raised hills or mounds and mixing in compost are common, affordable fixes."
      : ""
  }),

  g => ({
    id: "compaction", title: "Check for compacted soil",
    priority: g.drainage === "puddles" ? "high" : "medium", cost: "free",
    why: "Compacted soil is hard for roots to push through and drains slowly. Walking on wet soil is a common cause.",
    steps: [
      "A day or two after rain, push a long screwdriver or wire flag straight down into the soil.",
      "If it stops within the top few inches, the soil is compacted there.",
      "Loosen planting spots with a garden fork — push it in, rock it back and forth. No need to flip the whole bed.",
      "Make clear paths so people walk in the same places, not on planting areas."
    ],
    uncertain: ""
  }),

  g => ({
    id: "plant-id", title: "Identify plants before removing them",
    priority: "medium", cost: "free",
    why: "Some plants compete with your crops for water and light. But not every unfamiliar plant is a weed — some are native or pollinator plants worth keeping, and a few (like poison ivy) need careful handling.",
    steps: [
      "Ask whether anyone on your team sowed seeds (like a cover crop). Seedlings that came up in neat patches were probably planted.",
      "Photograph plants you don't recognize and identify them with a free app like iNaturalist or PlantNet, or ask your Extension office.",
      "Hand-pull confirmed weeds when the soil is moist, getting as much root as you can.",
      "Wear gloves. If you find poison ivy, don't burn it and don't pull it bare-handed.",
      "For a small garden, hand-pulling plus mulch is usually enough — no weed killer needed."
    ],
    uncertain: "Apps are helpful but not always right. Double-check anything you plan to remove in large amounts."
  }),

  g => (g.drainage === "slope" || /slope|hill/i.test(g.notes || "") || state.analysis?.source === "demo") ? ({
    id: "runoff", title: "Slow down runoff from the slope",
    priority: "medium", cost: "free",
    why: "Water running down a slope can wash soil, seeds, and compost off the bed, or pool at the bottom. Slowing it down protects all the work you put into the soil.",
    steps: [
      "During the next heavy rain, watch (or check right after) where water flows and where it collects.",
      "Leave the grass on the slope. Its roots are your first line of defense.",
      "Along the uphill edge of the bed, lay a line of logs, rocks from the bed, or a low mound of soil to slow and spread the water.",
      "Keep bare soil covered with leaves, straw, or needles, especially over winter."
    ],
    uncertain: "Whether runoff is a real problem depends on how steep the slope is and where the water goes. Check during rain before building anything big."
  }) : null,

  g => ({
    id: "rocks", title: "Clear rocks from planting spots",
    priority: "medium", cost: "free",
    why: "Rocks make the ground uneven and get in the way of roots and digging. You don't need to clear the whole garden — just where you'll plant.",
    steps: [
      hasFamily("vine") ? "Mark your planting spots first (hills for vining crops are about 3 ft across)." : "Mark your planting spots, rows, or beds first.",
      ...(hasFamily("root") ? ["Root crops need loose, stone-free soil 8–12 in deep, so be extra thorough in those beds (or build a raised bed)."] : []),
      "Loosen the top 8–12 inches with a garden fork and pull out rocks bigger than a golf ball.",
      "Reuse the rocks to edge paths or beds instead of hauling them away.",
      "Small pebbles are fine to leave."
    ],
    uncertain: "If the rock is very dense, building mounds of soil and compost on top can be easier than digging down."
  }),

  g => ({
    id: "needles", title: "Rake pine needles off planting spots",
    priority: "low", cost: "free",
    why: "A thick layer of needles keeps soil from warming up and can block seeds. Good news: pine needles have very little effect on soil acidity — that's a common myth — and they make great mulch for paths.",
    steps: [
      "Rake needles off the areas you'll plant.",
      "Spread them on walking paths, where they help keep weeds and mud down.",
      "Once your plants are growing, you can use them as mulch — keep them a few inches away from stems."
    ],
    uncertain: ""
  }),

  g => {
    const month = new Date().getMonth(); // 0 = Jan
    const offSeason = month >= 8 || month <= 2; // Sep–Mar
    return {
      id: "cover-soil", title: offSeason ? "Protect bare soil this winter" : "Cover exposed soil",
      priority: "medium", cost: g.budget === "free" ? "free" : "low-cost",
      why: "Bare soil erodes in rain, forms a crust, and loses organic matter. Covering it is one of the cheapest ways to improve soil over time.",
      steps: [
        "Spread 2–4 inches of shredded leaves or straw (look for “seed-free”) over bare areas. Fallen leaves are free.",
        offSeason
          ? "Or sow a winter cover crop such as cereal rye. Ask your Extension office for the latest planting date in your area."
          : "Keep mulch a few inches away from plant stems.",
        "In spring, pull back or rake off the cover 2–3 weeks before planting so the soil can warm."
      ],
      uncertain: offSeason ? "Cover crop planting windows close in late fall in many areas — leaves or straw work any time." : ""
    };
  },

  g => ({
    id: "compost", title: "Add organic matter (if needed)",
    priority: "medium", cost: g.budget === "free" ? "free" : "low-cost",
    why: "Compost improves almost any soil: it helps heavy soil drain and helps sandy soil hold water. Your soil test can show how much organic matter you already have.",
    steps: [
      "If you can, wait for your soil test results first.",
      g.budget === "free"
        ? "Look for free compost or leaf mulch from your town, a community garden, or a local farm."
        : "Buy finished compost in bags or bulk (bulk is cheaper for big areas), or check for free municipal compost.",
      "Spread 2–3 inches over your planting spots and mix it into the top 6–8 inches.",
      "Don't add fertilizer or lime unless your soil test recommends it."
    ],
    uncertain: "Compost is low-risk, but the right amount depends on your soil. This recommendation is general until you have test results."
  }),

  g => ({
    id: "trees", title: "Check how nearby trees affect the garden",
    priority: "low", cost: "free",
    why: "Trees give shade and their roots compete for water. They also provide cooling, wildlife habitat, and erosion control — so the goal is to work with them, not remove them.",
    steps: [
      "Use your sunlight map to see where tree shade falls.",
      "Look for tree roots in the planting area; plant beyond the reach of large roots when you can.",
      "If shade is a major problem, talk with the landowner and a certified arborist about pruning options.",
      "Never remove or heavily prune trees without permission and a professional evaluation."
    ],
    uncertain: ""
  }),

  g => ({
    id: "water", title: "Plan your watering",
    priority: "medium", cost: g.budget === "free" ? "free" : "low-cost",
    why: cropGuides().length
      ? "Steady watering is one of the biggest factors in a good harvest. " + cropGuides().map(c => `${c.name}: ${c.water}`).join(" ")
      : "Steady watering is one of the biggest factors in a good harvest.",
    steps: [
      "Find the closest spigot and measure how much hose you'd need.",
      "Water at the base of plants in the morning, not over the leaves (wet leaves invite disease).",
      g.budget === "free" ? "Collect rainwater in buckets or bins if a spigot is far away." : "A soaker hose (about $15–$30) waters slowly at the roots and saves time.",
      "Mulch around plants to keep moisture in."
    ],
    uncertain: ""
  }),

  // One "get ready to plant" task per crop in the guide (up to 3), or a general one.
  g => {
    const gs = cropGuides().slice(0, 3);
    if (!gs.length) return {
      id: "crop-prep", title: g.crops ? `Get ready to plant ${cropName()}` : "Decide what to grow",
      priority: "medium", cost: "low-cost",
      why: g.crops
        ? "Every crop has its own spacing, timing, and sunlight needs. Planning ahead avoids planting too early or too close together."
        : "Picking crops that match your sunlight, season, and goals makes success much more likely. Add them under “Intended plants or crops” in My Garden and this plan will tailor itself.",
      steps: g.crops ? [
        "Read the seed packet or plant tag for spacing, sun, and days to harvest.",
        "Look up your area's average last frost date (your Extension office has it).",
        "Count backward from your goal date to choose when to plant.",
        "Prepare beds with loose soil and compost before planting day."
      ] : [
        "Map your sunlight first. Fruiting crops (tomatoes, squash, peppers) need 6+ hours; leafy greens manage with 3–4.",
        "Choose crops your group will actually eat, share, or study.",
        "Easy first crops: bush beans, zucchini, cherry tomatoes, lettuce, radishes, sunflowers, and basil.",
        "Enter your choices in My Garden under “Intended plants or crops.”"
      ],
      uncertain: ""
    };
    return gs.map(c => ({
      id: "crop-" + c.key, title: `Prepare to plant ${c.name.replace(/ \(.*\)/, "").toLowerCase()}`,
      priority: "medium", cost: "low-cost",
      why: `${c.name} take ${c.days}. Planting at the right time and spacing helps you reach your goal date.`,
      steps: [
        c.plant,
        c.space,
        "Check the seed packet for your variety's days to harvest, then count backward from your goal date to pick a planting day.",
        ...(c.note ? [c.note] : []),
        `Watering: ${c.water}`
      ],
      uncertain: "Exact dates depend on your area's frost dates and the variety. Your Extension office can confirm the best window."
    }));
  },

  g => ({
    id: "pests", title: "Learn the common pests for your crops",
    priority: "low", cost: "free",
    why: "Catching pests and diseases early is much easier than fixing them later, and it means you rarely need sprays.",
    steps: [
      ...(cropGuides().length ? cropGuides().map(c => `${c.name}: watch for ${c.pests}.`) : ["Common troublemakers include aphids, beetles, caterpillars, slugs, and powdery mildew."]),
      "Once plants are growing, check the tops and undersides of leaves once a week.",
      "Hand-pick larger bugs and drop them into soapy water.",
      "Take a photo of anything unusual and ask your Extension office before spraying anything.",
      "Rotate where each crop family grows from year to year if you can."
    ],
    uncertain: "This is a planning task for the growing season. No action is needed until plants are up."
  })
];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// Builds (or rebuilds) the action plan, keeping the checkmarks on tasks you already finished.
function rebuildTasks() {
  const doneById = Object.fromEntries(state.tasks.map(t => [t.id, { done: t.done, doneAt: t.doneAt }]));
  const fromAI = state.analysis && state.analysis.source === "live" && state.analysis.tasks && state.analysis.tasks.length;
  const list = fromAI
    ? state.analysis.tasks
    : TASK_LIBRARY.flatMap((fn, i) => {
        const r = fn(state.garden);                         // a task, a list of tasks, or null
        return (Array.isArray(r) ? r : [r]).filter(Boolean).map((t, j) => ({ ...t, order: i + j / 10 }));
      });

  list.sort((a, b) => (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) || ((a.order ?? 0) - (b.order ?? 0)));
  state.tasks = list.map(t => ({ ...t, done: doneById[t.id]?.done || false, doneAt: doneById[t.id]?.doneAt || null }));

  if (state.analysis && (!state.analysis.nextSteps.length || state.analysis.source === "demo")) {
    state.analysis.nextSteps = state.tasks.filter(t => !t.done).slice(0, 4).map(t => t.title);
  }
}

function toggleTask(id, done) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = done;
  t.doneAt = done ? nowISO() : null;
  if (done) addLog("task", `Completed: ${t.title}`);
  saveState();
  const pct = completion();
  if (done) toast(pct === 100 ? "Every task done — amazing work! 🎃" : `Nice work! Plan is ${pct}% complete.`);
}

function completion() {
  if (!state.tasks.length) return 0;
  return Math.round(state.tasks.filter(t => t.done).length / state.tasks.length * 100);
}

function healthStatus() {
  if (!state.analysis) return { label: "Not scanned", note: "Scan your garden to get started." };
  const openHigh = state.tasks.filter(t => !t.done && t.priority === "high").length;
  const pct = completion();
  if (openHigh) return { label: "Needs attention", note: `${openHigh} high-priority task${openHigh === 1 ? "" : "s"} to go. Based on your plan, not a plant diagnosis.` };
  if (pct < 100) return { label: "Improving", note: "High-priority tasks done. Keep going!" };
  return { label: "On track", note: "All tasks complete. Time for a new scan?" };
}

/* ---------- 8. RENDERING ---------- */
function render(view) {
  renderMode();
  if (view === "home") renderHome();
  if (view === "scan") renderScan();
  if (view === "garden") renderGardenForm();
  if (view === "plan") renderPlan();
  if (view === "progress") renderProgress();
  if (view === "tips") renderTips();
  if (view === "chat") renderChat();
  if (view === "projects") renderProjects();
}

function renderMode() {
  const live = app.mode === "live" && liveAvailable;
  $$(".mode-switch button").forEach(b => {
    b.setAttribute("aria-checked", String(b.dataset.mode === (live ? "live" : "demo")));
    if (b.dataset.mode === "live") b.setAttribute("aria-disabled", String(!liveAvailable));
  });
  $("#modeNote").textContent = live
    ? "Live AI is on. Photos are sent to your local server for analysis."
    : liveAvailable
      ? "Demo mode shows sample results. Switch to Live AI for a real analysis."
      : "Demo mode shows sample results. Live AI needs the local server (see README).";
  const pill = $("#mobileModeBtn");
  pill.textContent = live ? "Live AI" : "Demo";
  pill.classList.toggle("live", live);
}

function setMode(mode) {
  if (mode === "live" && !liveAvailable) {
    toast(location.protocol === "file:"
      ? "Live AI needs the local server. Run “node server.js” and open http://localhost:3000 (see README)."
      : "The server is running but no API key is set. Add it to your .env file (see README).");
    return;
  }
  app.mode = mode;
  saveApp();
  renderMode();
  renderScan();
  toast(mode === "live" ? "Live AI mode on." : "Demo mode on — results will be samples.");
}

/* --- Home --- */
function renderHome() {
  const h = healthStatus();
  $("#statHealth").textContent = h.label;
  $("#statHealthNote").textContent = h.note;

  const done = state.tasks.filter(t => t.done).length;
  $("#statTasks").textContent = `${done} / ${state.tasks.length}`;
  $("#statTasksNote").textContent = state.tasks.length ? "Tasks in your action plan" : "Your action plan appears after a scan.";

  const next = state.tasks.find(t => !t.done);
  $("#statNext").textContent = !state.analysis ? "Scan your garden" : next ? next.title : "All done — rescan to update";

  const pct = completion();
  $("#statProgress").textContent = pct + "%";
  $("#statProgressBar").style.width = pct + "%";
  const goal = goalLabel();
  $("#statGoal").textContent = goal ? `Goal: ${goal}` : (state.garden.crops ? `Growing ${cropName()}` : "Set a goal in My Garden");
  const proj = currentProject(), cls = currentClass();
  $("#heroProject").textContent = proj ? `${proj.name}${cls ? " · " + cls.name : ""}` : "";

  const g = state.garden;
  const photo = state.progressPhotos.at(-1)?.photo || state.analysis?.photo || state.scanPhoto;
  const sunText = { full: "Full sun", partial: "Partial sun", shade: "Mostly shade", unknown: "Not sure" }[g.sunlight] || "Not set";
  const soilText = { none: "Not tested", planned: "Test planned", done: "Tested" }[g.soilTest] || "Not tested";
  $("#homeGarden").innerHTML = `
    ${photo ? `<img class="snap-photo" src="${photo}" alt="Latest garden photo" />` : `<div class="snap-placeholder">${icon("camera")}</div>`}
    <div>
      <h3 style="margin-bottom:8px">${esc(g.name || "My garden")}</h3>
      <ul class="snap-list">
        <li><b>Growing</b> ${esc(state.garden.crops || "Not chosen yet")}</li>
        <li><b>Sunlight</b> ${esc(sunText)}</li>
        <li><b>Soil test</b> ${esc(soilText)}</li>
        <li><b>Last scan</b> ${state.analysis ? esc(fmtDate(state.analysis.createdAt)) + (state.analysis.source === "demo" ? " (demo)" : "") : "Not yet"}</li>
      </ul>
    </div>`;

  // three tips, rotating daily
  const day = Math.floor(Date.now() / 86400000);
  const picks = [0, 1, 2].map(i => TIPS[(day + i * 3) % TIPS.length]);
  $("#homeTips").innerHTML = picks.map(t => `
    <li>${icon(t.icon)}<div><strong>${esc(t.title)}</strong><span>${esc(t.short)}</span></div></li>`).join("");
}

/* --- Scan --- */
function renderScan() {
  const has = !!state.scanPhoto;
  $("#dropzone").hidden = has;
  $("#sampleBtn").hidden = has;
  $("#preview").hidden = !has;
  if (has) {
    $("#previewImg").src = state.scanPhoto;
    const analyzed = state.analysis && state.analysis.photo === state.scanPhoto;
    $("#previewMeta").textContent = analyzed ? `Analyzed ${fmtDate(state.analysis.createdAt)}` : "Photo ready to analyze";
  }
  $("#analyzeBtn").disabled = !has;

  const live = app.mode === "live" && liveAvailable;
  const banner = $("#scanModeBanner");
  banner.classList.toggle("live", live);
  banner.innerHTML = live
    ? `<strong>Live AI mode.</strong> Your photo and garden details will be sent to an AI model through your local server.`
    : `<strong>Demo mode.</strong> You'll see sample results to show how the app works — an AI won't actually look at your photo.`;

  const filledForm = state.garden.sunlight && state.garden.budget;
  $("#gardenInfoReminder").hidden = !!filledForm;

  // Show results if the current photo was analyzed
  if (state.analysis && state.analysis.photo === state.scanPhoto && has) {
    renderResults(state.analysis);
    $("#results").hidden = false;
  }
}

function renderResults(a) {
  const demo = a.source === "demo";
  const badge = $("#resultBadge");
  badge.textContent = demo ? "Demo · sample results" : "Live AI result";
  badge.classList.toggle("live", !demo);

  const notice = $("#resultNotice");
  notice.classList.toggle("live", !demo);
  notice.innerHTML = demo
    ? `<strong>These are simulated results, not an AI analysis of your photo.</strong> They show how GardenGrow AI works using sample observations written from the GardenGrow project-site photos, adjusted with your garden details. Only the color check below was measured from your photo.`
    : `<strong>AI-generated assessment.</strong> ${esc(a.summary)} AI can misread photos — treat these as observations to check in person, not a diagnosis.`;

  const c = a.colors;
  $("#colorCard").hidden = !c;
  if (c) {
    const seg = [
      ["green", "#6B8F5B", "Green (plants, grass)"],
      ["earth", "#8A6A4E", "Brown & tan (soil, needles, mulch)"],
      ["gray", "#A9A79E", "Gray (rocks, gravel)"],
      ["shadow", "#3B3A33", "Dark / shadow"],
      ["other", "#D7C9B8", "Other (sky, flowers…)"]
    ];
    $("#colorCard").innerHTML = `
      <h3>Photo color check</h3>
      <div class="color-bar">${seg.map(([k, col]) => `<span style="width:${c[k]}%;background:${col}" title="${k}: ${c[k]}%"></span>`).join("")}</div>
      <div class="color-legend">${seg.map(([k, col, label]) => `<span><i style="background:${col}"></i>${label} · ${c[k]}%</span>`).join("")}</div>
      <p>A simple count of pixel colors — not AI. It can't tell soil from a brown fence, but it's a useful way to compare photos over time (more green = more plant cover).</p>`;
  }

  const confTag = o => o.measured ? `<span class="tag tag-low">measured</span>`
    : o.confidence === "uncertain" ? `<span class="tag tag-uncertain">uncertain</span>`
    : demo ? `<span class="tag tag-uncertain">sample</span>`
    : o.confidence === "likely" ? `<span class="tag tag-uncertain">likely</span>` : "";

  $("#rSee").innerHTML = a.observations.map(o => `<li>${esc(o.text)}${confTag(o)}</li>`).join("") || "<li>No observations returned.</li>";
  $("#rConcerns").innerHTML = a.concerns.map(c => `<li>${esc(c.text)}${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</li>`).join("") || "<li>No concerns returned.</li>";
  $("#rQuestions").innerHTML = a.questions.map(q => `<li>${esc(q)}</li>`).join("") || "<li>Nothing else needed right now.</li>";
  $("#rNext").innerHTML = a.nextSteps.map(s => `<li>${esc(s)}</li>`).join("") || "<li>Open the action plan.</li>";

  const VERDICT = { keep: "Keep", remove: "Remove", identify: "Identify first" };
  const plants = a.plants || [];
  $("#rPlants").innerHTML = plants.length ? plants.map(p => `
    <div class="plant ${p.verdict}">
      <div class="plant-head"><strong>${esc(p.name)}</strong><span class="verdict ${p.verdict}">${VERDICT[p.verdict]}</span></div>
      <p>${esc(p.reason)}</p>
      ${demo ? `<span class="tag tag-uncertain" style="margin-top:8px">sample</span>` : p.confidence === "uncertain" ? `<span class="tag tag-uncertain" style="margin-top:8px">uncertain ID</span>` : ""}
    </div>`).join("") : `<p class="r-hint">No plants identified.</p>`;

  $("#rSoilHint").textContent = state.garden.soilTest === "done" && (state.garden.soilPH || state.garden.soilNotes)
    ? "Based on the soil test results you entered."
    : "Without a soil test, this plan only includes steps that are safe for almost any garden. Add test results in My Garden to make it specific.";
  $("#rSoilNeeds").innerHTML = (a.soilNeeds || []).map(s => `<li>${esc(s)}</li>`).join("") || "<li>Run a soil test to find out.</li>";
  $("#rSoilPlan").innerHTML = (a.soilPlan || []).map(s => `<li><strong>${esc(s.step)}</strong>${s.detail ? `<small>${esc(s.detail)}</small>` : ""}</li>`).join("");
}

/* --- My Garden form --- */
function renderGardenForm() {
  const form = $("#gardenForm");
  const g = state.garden;
  Object.entries(g).forEach(([key, val]) => {
    const fields = form.elements[key];
    if (!fields) return;
    if (fields instanceof RadioNodeList) {
      [...fields].forEach(r => { r.checked = r.value === val; });
    } else {
      fields.value = val ?? "";
    }
  });
  $("#soilResults").hidden = form.elements.soilTest.value !== "done";
}

function setupGardenForm() {
  $("#soilTestSelect").addEventListener("change", e => { $("#soilResults").hidden = e.target.value !== "done"; });
  $("#gardenForm").addEventListener("submit", e => {
    e.preventDefault();
    const data = new FormData(e.target);
    Object.keys(DEFAULT_STATE.garden).forEach(key => {
      const v = data.get(key);
      state.garden[key] = typeof v === "string" ? v.trim() : "";
    });
    if (state.analysis && state.analysis.source === "demo") {
      // refresh the demo assessment with the new details
      const fresh = analyzeDemo(state.garden, state.analysis.colors);
      Object.assign(state.analysis, {
        observations: fresh.observations, concerns: fresh.concerns, questions: fresh.questions,
        soilNeeds: fresh.soilNeeds, soilPlan: fresh.soilPlan
      });
    }
    if (state.analysis) rebuildTasks();
    addLog("garden", "Garden details updated");
    saveState();
    const msg = $("#savedMsg");
    msg.innerHTML = `${icon("check")} ${state.analysis
      ? (state.analysis.source === "live" ? "Saved. Re-run the scan so the AI can use your new details." : "Saved — your action plan was updated.")
      : "Saved. Now scan your garden to build your plan."}`;
    msg.hidden = false;
    setTimeout(() => { msg.hidden = true; }, 4000);
  });
}

/* --- Action plan --- */
const COST_LABEL = { "free": "Free", "low-cost": "Low-cost", "higher-cost": "Higher-cost" };
const PRIORITY_LABEL = { high: "High priority", medium: "Medium priority", low: "Low priority" };

function renderPlan() {
  const summary = $("#planSummary");
  const list = $("#taskList");

  if (!state.tasks.length) {
    summary.hidden = true;
    $(".filters", $("#view-plan")).hidden = true;
    list.innerHTML = `
      <div class="card empty">
        ${icon("list")}
        <h3>No action plan yet</h3>
        <p>Scan a photo of your garden and we'll build a step-by-step plan for you.</p>
        <a href="#scan" class="btn btn-primary">${icon("camera")} Scan My Garden</a>
      </div>`;
    return;
  }

  summary.hidden = false;
  $(".filters", $("#view-plan")).hidden = false;
  const done = state.tasks.filter(t => t.done).length;
  const pct = completion();
  const demo = state.analysis?.source === "demo";
  summary.innerHTML = `
    <div class="big">${pct}%</div>
    <div>
      <div class="bar" style="margin-bottom:8px"><span style="width:${pct}%"></span></div>
      <p>${done} of ${state.tasks.length} tasks complete${goalLabel() ? ` · Goal: ${esc(goalLabel())}` : ""}</p>
    </div>
    <span class="badge ${demo ? "" : "live"}">${demo ? "Built from garden details" : "Suggested by AI"}</span>`;

  $$(".filter", $("#view-plan")).forEach(b => b.classList.toggle("is-active", b.dataset.filter === taskFilter));

  const shown = state.tasks.filter(t => taskFilter === "all" || (taskFilter === "done" ? t.done : !t.done));
  if (!shown.length) {
    list.innerHTML = `<div class="card empty">${icon("check")}<p>${taskFilter === "done" ? "Nothing checked off yet — you've got this." : "Everything's done! 🎉"}</p></div>`;
    return;
  }

  list.innerHTML = shown.map(t => `
    <article class="card task ${t.done ? "done" : ""}" data-id="${esc(t.id)}">
      <div class="task-row">
        <label class="task-check" title="Mark as done">
          <input type="checkbox" ${t.done ? "checked" : ""} aria-label="Mark “${esc(t.title)}” as done" />
          <span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </label>
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            <span class="tag tag-${t.priority}">${PRIORITY_LABEL[t.priority]}</span>
            <span class="tag tag-cost">${COST_LABEL[t.cost] || esc(t.cost)}</span>
            ${t.done && t.doneAt ? `<span class="tag tag-low">Done ${esc(fmtDate(t.doneAt))}</span>` : ""}
          </div>
          <p class="task-why"><strong>Why it matters:</strong> ${esc(t.why)}</p>
        </div>
        <button type="button" class="task-toggle" aria-expanded="false" aria-label="Show how to do this">${icon("arrow")}</button>
      </div>
      <div class="task-body">
        <h4>How to do it</h4>
        <ol>${t.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
        ${t.uncertain ? `<p class="uncertain">${icon("question")} ${esc(t.uncertain)}</p>` : ""}
      </div>
    </article>`).join("");
}

function setupPlan() {
  $("#view-plan").addEventListener("click", e => {
    const f = e.target.closest(".filter");
    if (f) { taskFilter = f.dataset.filter; renderPlan(); return; }
    const toggle = e.target.closest(".task-toggle");
    const title = e.target.closest(".task-title, .task-why");
    if (toggle || title) {
      const card = e.target.closest(".task");
      const open = card.classList.toggle("open");
      card.querySelector(".task-toggle").setAttribute("aria-expanded", String(open));
    }
  });
  $("#view-plan").addEventListener("change", e => {
    if (e.target.matches(".task-check input")) {
      const id = e.target.closest(".task").dataset.id;
      toggleTask(id, e.target.checked);
      renderPlan();
    }
  });
}

/* --- Progress --- */
function renderProgress() {
  const pct = completion();
  $("#ring").style.setProperty("--p", pct);
  $("#ringValue").textContent = pct + "%";
  const done = state.tasks.filter(t => t.done).length;
  $("#ringText").textContent = state.tasks.length ? `${done} of ${state.tasks.length} tasks complete.` : "Scan your garden to create a plan.";

  const a = state.analysis;
  $("#assessmentCard").innerHTML = a ? `
      <img src="${a.photo}" alt="Photo from latest assessment" />
      <div>
        <h3>Current assessment <span class="badge ${a.source === "demo" ? "" : "live"}" style="margin-left:6px">${a.source === "demo" ? "Demo" : "Live AI"}</span></h3>
        <p>${fmtDate(a.createdAt)} · ${esc(healthStatus().label)}</p>
        <p style="margin-top:6px">${esc(a.summary)}</p>
        <div class="actions">
          <a href="#scan" class="btn btn-small btn-ghost">${icon("eye")} View assessment</a>
          <a href="#plan" class="btn btn-small btn-ghost">${icon("list")} Action plan</a>
        </div>
      </div>`
    : `<div class="empty" style="grid-column:1/-1">${icon("camera")}<p>No assessment yet.</p><a href="#scan" class="btn btn-primary btn-small">Scan My Garden</a></div>`;

  // Before / after
  const before = state.beforePhoto;
  const after = state.progressPhotos.at(-1);
  const box = $("#compare");
  if (!before) {
    box.innerHTML = `<div class="empty">${icon("camera")}<p>Your first scan becomes your “before” photo. Then add progress photos here as the garden changes.</p></div>`;
  } else if (!after) {
    box.innerHTML = `
      <div class="side-by-side">
        <figure><img src="${before.photo}" alt="Before photo" /><figcaption>Before · ${fmtDate(before.date)}</figcaption></figure>
        <div class="empty" style="border:2px dashed var(--sage);border-radius:var(--radius-sm)">${icon("camera")}<p>Add a progress photo from the same spot to compare.</p></div>
      </div>`;
  } else {
    box.innerHTML = `
      <div class="compare-wrap">
        <div class="compare" id="compareBox">
          <img src="${before.photo}" alt="Before photo" />
          <div class="after-clip" id="afterClip"><img src="${after.photo}" alt="Latest progress photo" /></div>
          <div class="divider" id="divider"></div>
          <span class="label l">Before · ${fmtDate(before.date)}</span>
          <span class="label r">Latest · ${fmtDate(after.date)}</span>
          <input type="range" min="0" max="100" value="50" id="compareRange" aria-label="Slide to compare before and after" />
        </div>
        <p class="compare-note">Drag across the photo to compare. ${state.progressPhotos.length > 1 ? `${state.progressPhotos.length} progress photos saved — the newest is shown.` : ""}</p>
      </div>`;
    $("#compareRange").addEventListener("input", e => {
      const v = e.target.value;
      $("#afterClip").style.clipPath = `inset(0 0 0 ${v}%)`;
      $("#divider").style.left = v + "%";
    });
  }

  // Log
  const tl = $("#timeline");
  if (!state.log.length) {
    tl.innerHTML = `<li style="display:block"><div class="empty">${icon("calendar")}<p>Your garden journal will fill in as you scan, add photos, and finish tasks.</p></div></li>`;
    return;
  }
  const iconFor = { task: "check", photo: "camera", scan: "sparkle", garden: "sprout" };
  tl.innerHTML = state.log.map(item => `
    <li>
      <span class="dot ${item.type === "photo" || item.type === "scan" ? "photo" : ""}">${icon(iconFor[item.type] || "leaf", "")}</span>
      <div class="t-text">${esc(item.text)}<small>${fmtDate(item.date)}</small></div>
    </li>`).join("");
}

/* ---------- 8b. GARDEN CHAT ----------
   Live mode: the conversation + photo + garden details go to /api/chat on your server, which asks the AI.
   Demo mode: a simple scripted helper that answers common questions. It does NOT see the photo. */

function quickQuestions() {
  return [
    "What plants are growing here?",
    "Which plants should stay and which should go?",
    "What does my soil need?",
    "Make me a soil amendment plan",
    state.garden.crops ? `How do I grow ${cropName().toLowerCase()} here?` : "What should we grow here?"
  ];
}

function chatPhoto() { return state.chat.photo || state.analysis?.photo || state.scanPhoto || null; }

// Turns the bot's simple markdown (**bold**, "- " bullets, "1. " lists) into safe HTML.
function miniMarkdown(text) {
  const lines = esc(text).split(/\r?\n/);
  let html = "", list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${m[1]}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${m[1]}</li>`; }
    else if (line.trim() === "") { close(); }
    else { close(); html += `<p>${line.replace(/^#+\s*/, "")}</p>`; }
  }
  close();
  return html;
}

function renderChat() {
  const photo = chatPhoto();
  $("#chatPhotoBox").innerHTML = photo
    ? `<img src="${photo}" alt="Garden photo being discussed" />`
    : `<div class="snap-placeholder">${icon("camera")}</div>`;
  $("#chatPhotoBtnText").textContent = photo ? "Send a different photo" : "Send a photo";

  const live = app.mode === "live" && liveAvailable;
  const banner = $("#chatModeBanner");
  banner.classList.toggle("live", live);
  banner.innerHTML = live
    ? "<strong>Live AI.</strong> The assistant can see your photo. It can still make mistakes, so double-check plant IDs before removing anything."
    : "<strong>Demo mode.</strong> Scripted answers to common questions. The assistant can't see your photo yet.";

  const log = $("#chatLog");
  const msgs = state.chat.messages;
  if (!msgs.length) {
    log.innerHTML = `<div class="msg bot"><span class="msg-tag ${live ? "live" : ""}">${live ? "GardenGrow AI" : "Demo · scripted"}</span>${miniMarkdown(
      `Hi! I'm your garden assistant. ${photo ? "I've got your garden photo." : "Send me a photo of your garden to get started."}\n\nI can help with:\n- Which plants are growing and which to **keep** or **remove**\n- What your soil may need\n- A step-by-step plan to improve your soil and grow ${cropName()}`
    )}</div>`;
  } else {
    log.innerHTML = msgs.map(m => m.role === "user"
      ? `<div class="msg user">${m.thumb ? `<img src="${m.thumb}" alt="Photo you sent" />` : ""}${m.text ? miniMarkdown(m.text) : ""}</div>`
      : `<div class="msg bot"><span class="msg-tag ${m.source === "live" ? "live" : ""}">${m.source === "live" ? "GardenGrow AI" : "Demo · scripted"}</span>${miniMarkdown(m.text)}</div>`
    ).join("");
  }
  $("#quickReplies").innerHTML = quickQuestions().map(q => `<button type="button">${esc(q)}</button>`).join("");
  log.scrollTop = log.scrollHeight;
}

async function sendChat(text, thumb) {
  text = (text || "").trim();
  if (!text && !thumb) return;
  state.chat.messages.push({ role: "user", text, thumb: thumb || null, date: nowISO() });
  saveState();
  renderChat();

  const log = $("#chatLog");
  log.insertAdjacentHTML("beforeend", `<div class="msg bot typing" id="typing"><i></i><i></i><i></i></div>`);
  log.scrollTop = log.scrollHeight;
  $("#chatSend").disabled = true;

  const live = app.mode === "live" && liveAvailable;
  const pid = app.activeProjectId;
  let reply, source = live ? "live" : "demo";
  try {
    if (live) {
      reply = await chatLive();
    } else {
      await new Promise(r => setTimeout(r, 700));
      reply = demoReply(text, !!thumb);
    }
  } catch (err) {
    reply = `Sorry, I couldn't reach the AI. ${err.message}\n\nYou can switch to Demo mode to keep exploring.`;
    source = "demo";
  }
  if (app.activeProjectId !== pid) { $("#chatSend").disabled = false; return; }   // project was switched mid-reply
  state.chat.messages.push({ role: "assistant", text: reply, source, date: nowISO() });
  state.chat.messages = state.chat.messages.slice(-40);
  saveState();
  $("#chatSend").disabled = false;
  renderChat();
}

async function chatLive() {
  // Only text goes in the history; the current photo is attached separately by the server.
  const messages = state.chat.messages
    .map(m => ({ role: m.role, content: m.text || (m.thumb ? "(I sent a new photo of my garden.)" : "") }))
    .filter(m => m.content);
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, image: chatPhoto(), garden: state.garden })
    });
  } catch (e) { throw new Error("Is server.js running?"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}.`);
  return String(data.reply || "I didn't get a reply. Please try again.");
}

// Demo mode's scripted replies: matches keywords and answers from the sample plant list + soil plan.
function demoReply(text, sentPhoto) {
  const t = text.toLowerCase();
  const note = "\n\n(Demo answer: I can't see your photo in demo mode. Switch to Live AI for a real review.)";
  const soil = buildSoilPlan(state.garden);
  const plants = state.analysis?.source === "live" && state.analysis.plants?.length ? state.analysis.plants : DEMO_PLANTS;
  const keep = plants.filter(p => p.verdict === "keep"), remove = plants.filter(p => p.verdict === "remove"), ident = plants.filter(p => p.verdict === "identify");

  if (sentPhoto && !t) return "Thanks for the photo! In a live review I'd look at:\n- Which plants are already growing\n- Bare soil, rocks, and compaction\n- Shade from trees\n- Signs of drainage trouble\n\nTry one of the questions below to see the kind of answers you'll get." + note;
  if (/\b(hi|hello|hey)\b/.test(t) && t.length < 20) return "Hello! Ask me about your plants, soil, or how to build a productive garden. The quick questions below are a good place to start.";
  if (/what should (we|i) (grow|plant)|which crops|what to grow/.test(t)) {
    return "Good crops depend mostly on sunlight and season:\n- **6+ hours of sun:** tomatoes, peppers, zucchini, beans, cucumbers, sunflowers, basil\n- **3–6 hours:** lettuce, spinach, kale, chard, parsley, radishes\n- **Easy first crops:** bush beans, zucchini, cherry tomatoes, lettuce, radishes, sunflowers\n\nMap your sunlight first, then add your picks to My Garden and your plan will update." + note;
  }
  if (/keep|remove|stay|pull|get rid|weed|go\b/.test(t)) {
    return `Here's how I'd sort what's typically in a garden like this:\n\n**Keep**\n${keep.map(p => `- ${p.name}: ${p.reason}`).join("\n")}\n\n**Remove**\n${remove.map(p => `- ${p.name}: ${p.reason}`).join("\n")}\n\n**Identify first**\n${ident.map(p => `- ${p.name}: ${p.reason}`).join("\n")}\n\nGood rule: if you don't know what it is, don't pull it yet.` + note;
  }
  if (/what.*(plant|grow)|plants? (are|is)|identify|which plant/.test(t)) {
    return `In the GardenGrow project-site photos, I'd point out:\n${plants.map(p => `- **${p.name}**`).join("\n")}\n\nA photo is a good start, but for a confident ID, take close-ups of leaves and flowers and check them with iNaturalist or PlantNet. Ask "which should stay?" and I'll sort them.` + note;
  }
  if (/amend|plan|improve|fix|compost|lime|fertili|step/.test(t)) {
    return `Here's a soil amendment plan, in order:\n${soil.plan.map((s, i) => `${i + 1}. **${s.step}**: ${s.detail}`).join("\n")}\n\n${state.garden.soilTest === "done" ? "This uses the soil test results you entered." : "Add your soil test results in My Garden and this plan will get more specific."}` + note;
  }
  if (/soil|ph|nutrient|need|dirt/.test(t)) {
    return `What your soil may need:\n${soil.needs.map(n => `- ${n}`).join("\n")}\n\nI won't guess nutrient levels from a photo. A soil test from your Cooperative Extension office is the reliable way to know, and it usually costs about $10–$30.` + note;
  }
  if (/grow|plant|harvest|when|timing|patch|crop|seed/.test(t) || cropGuides().some(c => c.match.test(t))) {
    const gs = cropGuides();
    const cropLines = gs.length
      ? gs.map(c => `- **${c.name}:** ${c.plant} ${c.space} Harvest in ${c.days}.`).join("\n")
      : "- Add what you want to grow in My Garden (e.g. “tomatoes, basil”) and I'll give crop-specific timing and spacing.";
    return `Here's a path to growing ${cropsLabel()} here:\n1. **Now:** send a soil test, clear weeds and rocks from planting spots, and cover bare soil with leaves or straw.\n2. **Before planting:** map your sunlight and work compost into the planting spots. Add lime or fertilizer only if the soil test says to.\n3. **Planting:**\n${cropLines}\n4. **Growing season:** water about 1 inch a week at the base of plants, mulch, and check leaves weekly for pests.` + note;
  }
  if (/sun|shade|tree|light/.test(t)) return `For ${cropsLabel()}, aim for at least ${sunNeed()} hours of direct sun. Check the garden at 9 AM, noon, 3 PM, and 6 PM on a clear day and plant in the sunniest area. Shady spots can still grow leafy greens and some herbs. Please don't remove trees without the landowner's permission and an arborist's evaluation; pruning is often enough.` + note;
  if (/water|drain|puddle|wet/.test(t)) return "Try a simple drainage test: dig a hole 12 inches deep, fill it with water, let it drain, refill it, and measure how fast the water drops. About 1–6 inches per hour is good. If it's slower, plant on raised hills and add compost." + note;
  return "In demo mode I can answer common questions like:\n- What plants are growing here?\n- Which should stay or go?\n- What does my soil need?\n- Make me a soil amendment plan\n\nFor open-ended questions about your specific photo, switch to Live AI (see the README)." + note;
}

async function makeThumb(dataURL) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 320 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
}

function setupChat() {
  const input = $("#chatInput");
  $("#chatForm").addEventListener("submit", e => {
    e.preventDefault();
    const v = input.value;
    input.value = "";
    input.style.height = "";
    sendChat(v);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); }
  });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  $("#quickReplies").addEventListener("click", e => { const b = e.target.closest("button"); if (b) sendChat(b.textContent); });
  $("#chatPhotoInput").addEventListener("change", async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      state.chat.photo = await fileToDataURL(file);
      const thumb = await makeThumb(state.chat.photo);
      await sendChat("", thumb);
    } catch (err) { toast(err.message); }
  });
  $("#chatClearBtn").addEventListener("click", () => {
    state.chat = { photo: null, messages: [] };
    saveState();
    renderChat();
  });
}

/* ---------- 9. GARDEN TIPS ---------- */
const TIPS = [
  { cat: "Soil", icon: "soil", color: "#6B4F3A", title: "Test before you treat",
    short: "Only a soil test can tell you pH and nutrients.",
    body: "Soil can look healthy and still be missing nutrients — or look poor and be fine. A soil test from your Cooperative Extension office is usually inexpensive and tells you exactly what to add.",
    list: ["Test every 2–3 years", "Sample about 6 inches deep", "Fall testing = results before spring"] },
  { cat: "Soil", icon: "soil", color: "#8A6A4E", title: "Compost fixes almost everything", tall: true,
    short: "Organic matter helps soil drain and hold water.",
    body: "Compost loosens heavy clay, helps sandy soil hold water, and feeds the living things in your soil. It's one of the few amendments that's hard to overdo in moderate amounts.",
    list: ["Spread 2–3 inches on planting areas", "Check your town for free compost", "Fallen leaves make free mulch"] },
  { cat: "Sun", icon: "sun", color: "#C9A23E", title: "Six hours of sun",
    short: "Most fruiting crops need 6+ hours of direct sun.",
    body: "Tomatoes, peppers, squash, and corn need full sun to flower and ripen. Leafy greens like lettuce, spinach, and kale tolerate partial shade.",
    myth: "Tip: shade from trees that lose their leaves is much heavier in summer than when you look in fall." },
  { cat: "Water", icon: "drop", color: "#5E8A93", title: "Water deeply, not daily",
    short: "About 1 inch per week, at the roots, in the morning.",
    body: "Deep, less frequent watering grows deeper roots. Water at the base of the plant in the morning so leaves dry quickly, which helps prevent disease.",
    list: ["Stick a finger in — water when the top inch is dry", "Mulch to keep moisture in", "Soaker hoses save water"] },
  { cat: "Crops", icon: "sprout", color: "#C4472F", title: "Tomatoes 101", tall: true,
    short: "Warm weather, full sun, steady water.",
    body: "Tomatoes are one of the most popular garden crops. Set out young plants after your last frost, give them support, and water consistently.",
    list: ["Plant 18–36 in apart with a stake or cage", "Water deeply 1–2 inches a week", "Mulch to prevent soil splashing on leaves"] },
  { cat: "Crops", icon: "sprout", color: "#6B8F5B", title: "Leafy greens for shady spots",
    short: "Lettuce, spinach, and kale need only 3–4 hours of sun.",
    body: "Greens love cool weather and are among the fastest crops, often ready in 30–60 days. They're great for spots that don't get full sun.",
    list: ["Plant in early spring or late summer", "Pick outer leaves and let the center keep growing", "Keep the soil evenly moist"] },
  { cat: "Crops", icon: "pumpkin", color: "#C9712E", title: "Pumpkins 101", tall: true,
    short: "90–120 days from seed to harvest, in full sun.",
    body: "Pumpkins love warm soil, full sun, lots of water, and plenty of space. Sow seeds outdoors after your last frost when the soil feels warm.",
    list: ["Plant on hills 4–8 ft apart", "Water at the base, ~1 inch per week", "Harvest when the rind is hard and the stem is drying"] },
  { cat: "Weeds", icon: "sprout", color: "#6B8F5B", title: "Not every plant is a weed",
    short: "Identify before you pull.",
    body: "Some 'weeds' are native wildflowers that feed pollinators — which many fruiting crops need! Use iNaturalist or PlantNet to identify plants, and ask your Extension office if you're unsure.",
    myth: "Watch for poison ivy: “leaves of three, let it be.” Never burn it." },
  { cat: "Soil", icon: "leaf-alt", color: "#2E5D3A", title: "The pine needle myth",
    short: "Pine needles barely change soil pH.",
    body: "It's a common belief that pine needles make soil acidic. Research shows the effect on established soil is very small. They're excellent mulch for paths and around plants.",
    myth: "The real issue: a thick layer can block seeds and keep soil cool in spring. Rake it off planting spots." },
  { cat: "Seasonal", icon: "calendar", color: "#7C8B6F", title: "Fall is prep season",
    short: "What you do now pays off next summer.",
    body: "Late fall and winter are perfect for soil testing, clearing rocks, mulching bare soil with leaves, and planning where everything will go.",
    list: ["Cover bare soil with leaves or straw", "Send a soil sample", "Sketch your garden layout"] },
  { cat: "Crops", icon: "bug", color: "#8F6B3E", title: "Pests of squash & pumpkins",
    short: "Check leaves weekly once plants are up.",
    body: "Squash bugs, squash vine borers, cucumber beetles, and powdery mildew are the most common problems for squash-family crops. Catching them early makes them easy to manage.",
    list: ["Check under leaves for eggs", "Hand-pick bugs into soapy water", "Ask Extension before spraying"] },
  { cat: "Soil", icon: "soil", color: "#A7896B", title: "Don't walk on the beds",
    short: "Footsteps compact soil, especially when wet.",
    body: "Compacted soil drains poorly and roots struggle to grow through it. Make clear paths and keep planting areas for plants only.",
    myth: "Quick test: a screwdriver should push into moist soil easily. If it stops after an inch or two, loosen the soil." }
];

function renderTips() {
  const cats = ["All", ...new Set(TIPS.map(t => t.cat))];
  $("#tipFilters").innerHTML = cats.map(c => `<button type="button" class="filter ${c === tipFilter ? "is-active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  const shown = TIPS.filter(t => tipFilter === "All" || t.cat === tipFilter);
  $("#tipsBoard").innerHTML = shown.map(t => `
    <article class="card tip">
      <div class="tip-art ${t.tall ? "tall" : ""}" style="background:${t.color};color:#F8F6ED">${icon(t.icon === "leaf-alt" ? "sprout" : t.icon)}</div>
      <div class="tip-body">
        <span class="tip-cat">${esc(t.cat)}</span>
        <h3>${esc(t.title)}</h3>
        <p>${esc(t.body)}</p>
        ${t.list ? `<ul>${t.list.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
        ${t.myth ? `<p class="myth">${esc(t.myth)}</p>` : ""}
      </div>
    </article>`).join("");
}

/* ---------- 10. START ---------- */

// Asks the local server (if there is one) whether live AI is set up.
async function checkLiveAI() {
  if (location.protocol === "file:") { liveAvailable = false; return; }
  try {
    const res = await fetch(CONFIG.healthUrl, { cache: "no-store" });
    const data = await res.json();
    liveAvailable = !!data.aiConfigured;
  } catch (e) {
    liveAvailable = false;
  }
}

function setupGlobalEvents() {
  $$(".mode-switch button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#mobileModeBtn").addEventListener("click", () => setMode(app.mode === "live" && liveAvailable ? "demo" : "live"));
  $("#analyzeBtn").addEventListener("click", runAnalysis);
  $("#tipFilters").addEventListener("click", e => {
    const b = e.target.closest(".filter");
    if (b) { tipFilter = b.dataset.cat; renderTips(); }
  });
}

async function start() {
  await loadApp();
  setupUpload();
  setupGardenForm();
  setupPlan();
  setupChat();
  setupGlobalEvents();
  setupProjects();               // in projects.js
  showView(location.hash.slice(1) || (app.activeProjectId ? "home" : "projects"));
  await checkLiveAI();
  if (app.mode === "live" && !liveAvailable) app.mode = "demo";
  renderMode();
  if (app.activeProjectId) renderScan();
}

document.addEventListener("DOMContentLoaded", start);
