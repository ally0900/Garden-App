/* =====================================================================
   GardenGrow AI — projects.js
   ---------------------------------------------------------------------
   Classroom features for a shared kiosk computer:
   • Classes (e.g. "Biology — Period 3") that each hold many projects
   • Projects (one garden each) with their own photos, plan, chat, and progress
   • Teacher tools: optional PIN, auto-return to the project list, backup & restore
   Loaded AFTER script.js, so it can use helpers like $, esc, icon, toast.
   ===================================================================== */

const CLASS_COLORS = ["#2E5D3A", "#6B8F5B", "#6B4F3A", "#C9712E", "#5E8A93", "#8F6B3E", "#7C8B6F", "#A4572B"];
let projectSearch = "";

/* ---------- Small pop-up window helper ----------
   modal({ title, body, confirmText }) shows a dialog and resolves with the form's data, or null if cancelled. */
function modal({ title, body, confirmText = "Save", cancelText = "Cancel", danger = false, onOpen = null, wide = false }) {
  return new Promise(resolve => {
    const d = $("#modal");
    d.classList.toggle("wide", wide);
    d.innerHTML = `
      <form method="dialog" class="modal-card">
        <h2>${esc(title)}</h2>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          ${cancelText ? `<button value="cancel" class="btn btn-ghost" formnovalidate>${esc(cancelText)}</button>` : ""}
          <button value="ok" class="btn ${danger ? "btn-danger" : "btn-primary"}">${esc(confirmText)}</button>
        </div>
      </form>`;
    const form = d.querySelector("form");
    d.returnValue = "";
    d.onclose = () => resolve(d.returnValue === "ok" ? new FormData(form) : null);
    d.showModal();
    const first = d.querySelector("input:not([type=radio]):not([type=hidden]), select, textarea");
    if (first) first.focus();
    if (onOpen) onOpen(d);
  });
}

// Asks for the teacher PIN (only if one has been set). Returns true if it's OK to continue.
async function requirePin(what = "do this") {
  if (!app.teacherPin) return true;
  const fd = await modal({
    title: "Teacher PIN needed",
    body: `<label class="field"><span>Enter the teacher PIN to ${esc(what)}.</span>
           <input name="pin" type="password" inputmode="numeric" autocomplete="off" required maxlength="12" /></label>`,
    confirmText: "Continue"
  });
  if (!fd) return false;
  if (fd.get("pin") === app.teacherPin) return true;
  toast("That PIN isn't right.");
  return false;
}

/* ---------- Current-project chip (sidebar + mobile top bar) ---------- */
function renderProjectChip() {
  const p = currentProject(), c = currentClass();
  $("#projectChip").innerHTML = p
    ? `<span class="pc-dot" style="background:${esc(c?.color || CLASS_COLORS[0])}"></span>
       <span class="pc-text"><small>${esc(c?.name || "Class")}</small><strong>${esc(p.name)}</strong></span>
       <a href="#projects" class="pc-switch">Switch</a>`
    : `<span class="pc-text"><small>No project open</small><strong>Choose a project</strong></span>`;
  $$(".needs-project").forEach(el => el.classList.toggle("is-locked", !p));
}

/* ---------- The project list screen ---------- */
function renderProjects() {
  const box = $("#classList");
  const q = projectSearch.trim().toLowerCase();
  $("#projectSearch").value = projectSearch;
  $("#projectToolbar").hidden = !app.classes.length;

  if (!app.classes.length) {
    box.innerHTML = `
      <div class="card welcome-card">
        <div class="welcome-art">${icon("sprout")}</div>
        <h2>Set up your classroom</h2>
        <p>Start by creating a class, such as <em>“Environmental Science, Period 2”</em>. Each class can hold as many garden projects as you like, and every project keeps its own photos, action plan, chat, and progress.</p>
        <div class="hero-actions" style="justify-content:center">
          <button type="button" class="btn btn-primary btn-lg" data-action="new-class">${icon("sprout")} Create the first class</button>
          <button type="button" class="btn btn-ghost" data-action="teacher">${icon("lock")} Restore from a backup</button>
        </div>
      </div>`;
    return;
  }

  const classes = [...app.classes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let shownAny = false;
  box.innerHTML = classes.map(c => {
    const all = app.projects.filter(p => p.classId === c.id).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const classMatch = !q || c.name.toLowerCase().includes(q) || (c.teacher || "").toLowerCase().includes(q);
    const projects = classMatch ? all : all.filter(p => (p.name + " " + (p.members || "")).toLowerCase().includes(q));
    if (q && !projects.length) return "";
    shownAny = true;
    return `
      <section class="class-block" data-class="${esc(c.id)}">
        <header class="class-head">
          <span class="class-swatch" style="background:${esc(c.color)}">${icon("sprout")}</span>
          <div class="class-title">
            <h2>${esc(c.name)}</h2>
            <p>${c.teacher ? esc(c.teacher) + " · " : ""}${all.length} project${all.length === 1 ? "" : "s"}</p>
          </div>
          <div class="class-actions">
            <button type="button" class="btn btn-small btn-primary" data-action="new-project" data-class="${esc(c.id)}">${icon("sprout")} New project</button>
            <button type="button" class="icon-btn" data-action="edit-class" data-class="${esc(c.id)}" title="Edit class" aria-label="Edit class ${esc(c.name)}">${icon("edit")}</button>
            <button type="button" class="icon-btn" data-action="backup-class" data-class="${esc(c.id)}" title="Download a backup of this class" aria-label="Back up class ${esc(c.name)}">${icon("download")}</button>
            <button type="button" class="icon-btn danger" data-action="delete-class" data-class="${esc(c.id)}" title="Delete class" aria-label="Delete class ${esc(c.name)}">${icon("trash")}</button>
          </div>
        </header>
        <div class="proj-grid">
          ${projects.map(projectCard).join("")}
          ${!q ? `<button type="button" class="proj-new" data-action="new-project" data-class="${esc(c.id)}">
              <span>${icon("sprout")}</span><strong>New project</strong><small>for ${esc(c.name)}</small></button>` : ""}
        </div>
      </section>`;
  }).join("");

  if (!shownAny) box.innerHTML = `<div class="card empty">${icon("eye")}<p>No classes or projects match “${esc(projectSearch)}”.</p></div>`;
}

function projectCard(p) {
  const active = p.id === app.activeProjectId;
  const pct = p.progress || 0;
  const healthCls = p.health === "Needs attention" ? "tag-high" : p.health === "Not scanned" || !p.health ? "tag-cost" : "tag-low";
  return `
    <article class="proj-card ${active ? "is-active" : ""}" data-action="open-project" data-project="${esc(p.id)}" tabindex="0" role="button" aria-label="Open project ${esc(p.name)}">
      <div class="proj-thumb">
        ${p.thumb ? `<img src="${p.thumb}" alt="" />` : `<span class="proj-thumb-empty">${icon("pumpkin")}</span>`}
        ${active ? `<span class="proj-open">Open now</span>` : ""}
      </div>
      <div class="proj-body">
        <h3>${esc(p.name)}</h3>
        ${p.members ? `<p class="proj-members">${icon("sprout")} ${esc(p.members)}</p>` : ""}
        <div class="proj-progress"><div class="bar"><span style="width:${pct}%"></span></div><b>${pct}%</b></div>
        <div class="proj-meta">
          <span class="tag ${healthCls}">${esc(p.health || "Not scanned")}</span>
          <span>Updated ${esc(fmtDate(p.updatedAt))}</span>
        </div>
      </div>
      <div class="proj-actions">
        <button type="button" class="icon-btn" data-action="edit-project" data-project="${esc(p.id)}" title="Rename or move" aria-label="Edit project ${esc(p.name)}">${icon("edit")}</button>
        <button type="button" class="icon-btn danger" data-action="delete-project" data-project="${esc(p.id)}" title="Delete project" aria-label="Delete project ${esc(p.name)}">${icon("trash")}</button>
      </div>
    </article>`;
}

/* ---------- Opening / closing projects ---------- */
async function openProject(id) {
  await saveChain;                                   // finish saving the previous project first
  const data = await dbGet("projects", id).catch(() => null);
  state = normalizeProject(data);
  app.activeProjectId = id;
  taskFilter = "all";
  $("#results").hidden = true;
  $("#loading").hidden = true;
  await saveApp();
  bumpIdle();
  if (location.hash === "#home") showView("home"); else location.hash = "#home";
  toast(`Opened “${currentProject()?.name}”.`);
}

function closeProject(message) {
  app.activeProjectId = null;
  state = structuredCloneSafe(DEFAULT_STATE);
  saveApp();
  if (location.hash === "#projects") showView("projects"); else location.hash = "#projects";
  if (message) toast(message);
}

/* ---------- Classes ---------- */
function classForm(c = {}) {
  const color = c.color || CLASS_COLORS[app.classes.length % CLASS_COLORS.length];
  return `
    <label class="field"><span>Class name</span>
      <input name="name" required maxlength="60" value="${esc(c.name || "")}" placeholder="e.g. Environmental Science, Period 2" /></label>
    <label class="field"><span>Teacher <small>(optional)</small></span>
      <input name="teacher" maxlength="60" value="${esc(c.teacher || "")}" placeholder="e.g. Ms. Rivera" /></label>
    <fieldset class="field"><legend>Color</legend>
      <div class="chips color-chips">
        ${CLASS_COLORS.map(col => `<label class="chip"><input type="radio" name="color" value="${col}" ${col === color ? "checked" : ""} /><span style="background:${col}" aria-label="${col}"></span></label>`).join("")}
      </div>
    </fieldset>`;
}

async function createClass() {
  if (!(await requirePin("create a class"))) return;
  const fd = await modal({ title: "New class", body: classForm(), confirmText: "Create class" });
  if (!fd) return;
  const c = { id: newId("class"), name: fd.get("name").trim(), teacher: fd.get("teacher").trim(), color: fd.get("color") || CLASS_COLORS[0], createdAt: nowISO() };
  app.classes.push(c);
  await saveApp();
  renderProjects();
  toast(`Class “${c.name}” created. Now add a project.`);
}

async function editClass(id) {
  const c = app.classes.find(x => x.id === id);
  if (!c || !(await requirePin("edit this class"))) return;
  const fd = await modal({ title: "Edit class", body: classForm(c) });
  if (!fd) return;
  Object.assign(c, { name: fd.get("name").trim(), teacher: fd.get("teacher").trim(), color: fd.get("color") || c.color });
  await saveApp();
  renderProjects();
  renderProjectChip();
}

async function deleteClass(id) {
  const c = app.classes.find(x => x.id === id);
  if (!c || !(await requirePin("delete this class"))) return;
  const projects = app.projects.filter(p => p.classId === id);
  const fd = await modal({
    title: `Delete “${c.name}”?`,
    body: `<p>This permanently deletes the class${projects.length ? ` and its <strong>${projects.length} project${projects.length === 1 ? "" : "s"}</strong> (photos, plans, and chats)` : ""}. It can't be undone.</p>
           ${projects.length ? `<p class="r-hint">Tip: download a backup of the class first (the ⬇ button) if you might need it later.</p>` : ""}`,
    confirmText: "Delete class", danger: true
  });
  if (!fd) return;
  for (const p of projects) await queueSave(() => dbDelete("projects", p.id));
  app.projects = app.projects.filter(p => p.classId !== id);
  app.classes = app.classes.filter(x => x.id !== id);
  if (projects.some(p => p.id === app.activeProjectId)) { app.activeProjectId = null; state = structuredCloneSafe(DEFAULT_STATE); }
  await saveApp();
  renderProjects();
  renderProjectChip();
  toast("Class deleted.");
}

/* ---------- Projects ---------- */
function projectForm(p = {}, classId) {
  return `
    <label class="field"><span>Project name</span>
      <input name="name" required maxlength="60" value="${esc(p.name || "")}" placeholder="e.g. Pumpkin Patch Team A" /></label>
    <label class="field"><span>Team members <small>(optional, first names are fine)</small></span>
      <input name="members" maxlength="120" value="${esc(p.members || "")}" placeholder="e.g. Ava, Marcus, Lena" /></label>
    <label class="field"><span>Class</span>
      <select name="classId">${app.classes.map(c => `<option value="${esc(c.id)}" ${c.id === (p.classId || classId) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    ${p.id ? "" : `<label class="field"><span>What do you want to grow? <small>(optional)</small></span>
      <input name="crops" maxlength="80" placeholder="e.g. Tomatoes, lettuce, sunflowers (you can decide later)" /></label>`}`;
}

async function createProject(classId) {
  if (!app.classes.length) return createClass();
  const fd = await modal({ title: "New garden project", body: projectForm({}, classId), confirmText: "Create & open" });
  if (!fd) return;
  const p = {
    id: newId("proj"), classId: fd.get("classId"), name: fd.get("name").trim(), members: fd.get("members").trim(),
    createdAt: nowISO(), updatedAt: nowISO(), progress: 0, health: "Not scanned", thumb: null
  };
  const data = structuredCloneSafe(DEFAULT_STATE);
  data.garden.name = p.name;
  data.garden.crops = (fd.get("crops") || "").trim();
  data.log = [{ type: "garden", text: "Project created", date: nowISO() }];
  app.projects.push(p);
  await queueSave(() => dbPut("projects", p.id, data));
  await openProject(p.id);
}

async function editProject(id) {
  const p = app.projects.find(x => x.id === id);
  if (!p) return;
  const fd = await modal({ title: "Edit project", body: projectForm(p) });
  if (!fd) return;
  Object.assign(p, { name: fd.get("name").trim(), members: fd.get("members").trim(), classId: fd.get("classId") });
  await saveApp();
  renderProjects();
  renderProjectChip();
}

async function deleteProject(id) {
  const p = app.projects.find(x => x.id === id);
  if (!p || !(await requirePin("delete this project"))) return;
  const fd = await modal({
    title: `Delete “${p.name}”?`,
    body: `<p>This permanently deletes the project's photos, action plan, chat, and progress log. It can't be undone.</p>`,
    confirmText: "Delete project", danger: true
  });
  if (!fd) return;
  await queueSave(() => dbDelete("projects", id));
  app.projects = app.projects.filter(x => x.id !== id);
  if (app.activeProjectId === id) { app.activeProjectId = null; state = structuredCloneSafe(DEFAULT_STATE); }
  await saveApp();
  renderProjects();
  renderProjectChip();
  toast("Project deleted.");
}

/* ---------- Backup & restore (a .json file teachers can keep or move to another computer) ---------- */
async function downloadBackup(classId = null) {
  await saveChain;
  const classes = classId ? app.classes.filter(c => c.id === classId) : app.classes;
  const ids = new Set(classes.map(c => c.id));
  const projects = app.projects.filter(p => ids.has(p.classId));
  const data = {};
  for (const p of projects) data[p.id] = await dbGet("projects", p.id);
  const payload = { app: "GardenGrow AI", version: 2, exportedAt: nowISO(), classes, projects, data };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const name = classId ? classes[0].name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() : "all-classes";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gardengrow-backup-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`Backup downloaded (${projects.length} project${projects.length === 1 ? "" : "s"}).`);
}

async function restoreBackup(file) {
  let payload;
  try { payload = JSON.parse(await file.text()); } catch (e) { toast("That file isn't a GardenGrow AI backup."); return; }
  if (!payload || payload.app !== "GardenGrow AI" || !Array.isArray(payload.classes)) { toast("That file isn't a GardenGrow AI backup."); return; }
  let added = 0, updated = 0;
  for (const c of payload.classes) {
    const existing = app.classes.find(x => x.id === c.id);
    if (existing) Object.assign(existing, c); else app.classes.push(c);
  }
  for (const p of payload.projects || []) {
    const existing = app.projects.find(x => x.id === p.id);
    if (existing && (existing.updatedAt || "") >= (p.updatedAt || "")) continue;   // keep the newer copy
    await queueSave(() => dbPut("projects", p.id, normalizeProject(payload.data?.[p.id])));
    if (existing) { Object.assign(existing, p); updated++; } else { app.projects.push(p); added++; }
  }
  await saveApp();
  renderProjects();
  toast(`Restored: ${added} new project${added === 1 ? "" : "s"}${updated ? `, ${updated} updated` : ""}.`);
}

/* ---------- Teacher tools ---------- */
async function openTeacherTools() {
  if (!(await requirePin("open teacher tools"))) return;
  let usage = "";
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) usage = `Using about ${Math.max(1, Math.round(est.usage / 1048576))} MB of roughly ${Math.round(est.quota / 1073741824 * 10) / 10 || "<1"} GB available on this computer.`;
  } catch (e) { /* not supported */ }

  const fd = await modal({
    title: "Teacher tools",
    wide: true,
    confirmText: "Save settings",
    body: `
      <div class="tools-grid">
        <label class="field"><span>Teacher PIN <small>(optional)</small></span>
          <input name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" placeholder="${app.teacherPin ? "•••• (leave as-is to keep)" : "No PIN set"}" />
          <small class="r-hint">Needed to create, edit, or delete classes, delete projects, and open these tools. This is a light lock to prevent accidents, not strong security.</small>
        </label>
        <label class="field"><span>Kiosk: return to the project list after</span>
          <select name="idle">
            ${[0, 5, 10, 20, 30].map(m => `<option value="${m}" ${Number(app.idleMinutes) === m ? "selected" : ""}>${m ? m + " minutes of no activity" : "Never"}</option>`).join("")}
          </select>
          <small class="r-hint">Helps the next class start fresh at the project list.</small>
        </label>
      </div>
      ${app.teacherPin ? `<label class="check-row"><input type="checkbox" name="clearPin" /> Remove the teacher PIN</label>` : ""}
      <div class="tools-box">
        <h3>Backup &amp; restore</h3>
        <p class="r-hint">All work is saved on <strong>this computer's browser only</strong>. Download a backup regularly (for example, at the end of each term), or to move projects to another computer. ${esc(usage)}</p>
        <div class="tools-actions">
          <button type="button" class="btn btn-small btn-ghost" id="toolBackup">${icon("download")} Download backup of all classes</button>
          <label class="btn btn-small btn-ghost" for="restoreInput">${icon("upload")} Restore from backup…</label>
          <input type="file" id="restoreInput" accept="application/json,.json" hidden />
        </div>
      </div>
      <div class="tools-box danger-box">
        <h3>Erase everything</h3>
        <p class="r-hint">Deletes every class and project on this computer. Download a backup first.</p>
        <button type="button" class="btn btn-small btn-ghost danger" id="toolErase">${icon("trash")} Erase all data</button>
      </div>`,
    onOpen: d => {
      d.querySelector("#toolBackup").addEventListener("click", () => downloadBackup());
      d.querySelector("#restoreInput").addEventListener("change", async e => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f) { await restoreBackup(f); d.close(); }
      });
      d.querySelector("#toolErase").addEventListener("click", async () => {
        if (!confirm("Erase ALL classes and projects on this computer? This cannot be undone.")) return;
        const keys = await dbAllKeys("projects").catch(() => []);
        for (const k of keys) await queueSave(() => dbDelete("projects", k));
        app = { ...structuredCloneSafe(DEFAULT_APP), migratedV1: true, mode: app.mode };
        state = structuredCloneSafe(DEFAULT_STATE);
        await saveApp();
        d.close();
        closeProject("All data erased.");
      });
    }
  });
  if (!fd) return;
  const pin = (fd.get("pin") || "").trim();
  if (fd.get("clearPin")) app.teacherPin = "";
  else if (pin) app.teacherPin = pin;
  app.idleMinutes = Number(fd.get("idle")) || 0;
  await saveApp();
  bumpIdle();
  toast(app.teacherPin ? "Settings saved. Teacher PIN is on." : "Settings saved.");
}

/* ---------- Kiosk idle timer ---------- */
let idleTimer = null;
function bumpIdle() {
  clearTimeout(idleTimer);
  if (!app.idleMinutes || !app.activeProjectId) return;
  idleTimer = setTimeout(() => {
    if ($("#modal").open || !$("#loading").hidden) { bumpIdle(); return; }   // don't interrupt a dialog or an analysis
    closeProject("Returned to the project list after a period of no activity.");
  }, app.idleMinutes * 60000);
}

/* ---------- Wire everything up ---------- */
function setupProjects() {
  $("#classList").addEventListener("click", e => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const { action } = el.dataset;
    if (action !== "open-project") e.stopPropagation();
    if (action === "open-project") openProject(el.dataset.project);
    if (action === "new-project") createProject(el.dataset.class);
    if (action === "edit-project") editProject(el.dataset.project);
    if (action === "delete-project") deleteProject(el.dataset.project);
    if (action === "new-class") createClass();
    if (action === "edit-class") editClass(el.dataset.class);
    if (action === "delete-class") deleteClass(el.dataset.class);
    if (action === "backup-class") requirePin("download a backup").then(ok => ok && downloadBackup(el.dataset.class));
    if (action === "teacher") openTeacherTools();
  });
  $("#classList").addEventListener("keydown", e => {
    const card = e.target.closest(".proj-card");
    if (card && (e.key === "Enter" || e.key === " ") && e.target === card) { e.preventDefault(); openProject(card.dataset.project); }
  });
  $("#newClassBtn").addEventListener("click", createClass);
  $("#teacherBtn").addEventListener("click", openTeacherTools);
  $("#projectSearch").addEventListener("input", e => { projectSearch = e.target.value; renderProjects(); });
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));
  bumpIdle();
}
