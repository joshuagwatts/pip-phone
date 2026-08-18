import { load, save, KIT_LABELS } from "./store.js";
import { chat, draftAnswers, ensurePip, pipStatus } from "./brain.js";
import { hunt, mergeDraft, newOpp, questionsFromPaste, scrapeUrl, suggestAnswers } from "./opp.js";
import { hasNativeHttp, openUrl } from "./net.js";
import { SHADER_ORDER } from "./shaders.js";
import { pickShader, shaderOf, snapshot as motivSnap, tap as motivTap } from "./motivation.js";
import { compile, startLoop, stopLoop, startMic, stopMic, isListening } from "./vibe.js";

const $ = (s) => document.querySelector(s);
let db = load();
let tab = "opp";
let pane = "list";
let oppId = "";
let vibeMode = "motivation";
let vibeStem = "sendoff";
let lastShot = "";
let radioClock = 0;
let radioBusy = false;

function setStatus(msg) {
  $("#status").textContent = String(msg || "").toUpperCase();
}

function persist() {
  save(db);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selected() {
  return db.opps.find((o) => o.id === oppId) || null;
}

function render() {
  document.body.classList.toggle("vibe-tab", tab === "vibe");
  $("#tabs").querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab !== "vibe") leaveVibe();
  if (tab === "kit") renderKit();
  else if (tab === "data") renderData();
  else if (tab === "vibe") renderVibe();
  else renderOpp();
}

function leaveVibe() {
  stopLoop();
  if (radioClock) {
    clearInterval(radioClock);
    radioClock = 0;
  }
}

function paintMotiv() {
  const overlay = $("#vibe-action");
  if (!overlay) return;
  const on = vibeMode === "motivation";
  overlay.hidden = !on;
  if (!on) return;
  const mot = motivSnap();
  const nxt = mot.next || {};
  const line = nxt.shot || "NOW";
  const shotEl = overlay.querySelector(".vibe-shot");
  const hintEl = overlay.querySelector(".vibe-hint");
  if (shotEl) {
    if (line !== lastShot) {
      shotEl.classList.remove("swap");
      void shotEl.offsetWidth;
      shotEl.classList.add("swap");
      lastShot = line;
    }
    shotEl.textContent = line;
    shotEl.classList.toggle("long", line.length > 18);
  }
  if (hintEl) hintEl.textContent = mot.hint || "TAP";
  overlay.classList.toggle("sendoff", nxt.kind === "inspire" || nxt.kind === "pip");
  const stem = nxt.vibe || pickShader(line, nxt.kind || "pip", vibeStem).stem;
  if (stem && stem !== vibeStem) {
    vibeStem = stem;
    const err = compile($("#vibe-gl"), shaderOf(stem));
    if (err) setStatus(err);
    const sel = $("#vibe-file");
    if (sel) sel.value = stem;
  }
}

function armRadio() {
  if (radioClock) {
    clearInterval(radioClock);
    radioClock = 0;
  }
  if (tab !== "vibe" || vibeMode !== "motivation") return;
  const nxt = (motivSnap().next || {});
  if (nxt.kind !== "pip") return;
  radioClock = setInterval(() => {
    if (tab !== "vibe" || radioBusy || document.hidden) return;
    tapMotiv(true);
  }, 12000);
}

function tapMotiv(auto) {
  if (radioBusy) return;
  radioBusy = true;
  try {
    motivTap();
    paintMotiv();
    if (!auto) setStatus((motivSnap().next || {}).shot || "PIP");
    armRadio();
  } finally {
    radioBusy = false;
  }
}

function renderVibe() {
  const mot = motivSnap();
  const live = isListening();
  $("#view").innerHTML = `
    <div class="vibe">
      <div class="vibe-bar">
        <button type="button" id="vibe-dance" class="${vibeMode === "dance" ? "on" : ""}">DANCE</button>
        <button type="button" id="vibe-motiv" class="${vibeMode === "motivation" ? "on" : ""}">MOTIVATION</button>
        <button type="button" id="vibe-mic" class="${live ? "hot" : ""}">MIC</button>
        <select id="vibe-file">${SHADER_ORDER.map((s) => `<option value="${s}" ${s === vibeStem ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
      <div class="vibe-stage" id="vibe-stage">
        <canvas id="vibe-gl"></canvas>
        <div id="vibe-action" class="vibe-action" ${vibeMode === "motivation" ? "" : "hidden"}>
          <div class="vibe-shot">${esc((mot.next && mot.next.shot) || "NOW")}</div>
          <div class="vibe-hint">${esc(mot.hint || "TAP")}</div>
        </div>
      </div>
      <div class="vibe-foot" id="vibe-msg">${live ? "LIVE // MIC" : "IDLE // MIC PUMPS THE SHADER"}</div>
    </div>`;
  $("#vibe-dance").onclick = () => {
    vibeMode = "dance";
    renderVibe();
  };
  $("#vibe-motiv").onclick = () => {
    vibeMode = "motivation";
    renderVibe();
  };
  $("#vibe-mic").onclick = async () => {
    try {
      if (isListening()) {
        stopMic();
        setStatus("VIBE IDLE");
      } else {
        await startMic();
        setStatus("VIBE // MIC");
      }
      const msg = $("#vibe-msg");
      const btn = $("#vibe-mic");
      if (msg) msg.textContent = isListening() ? "LIVE // MIC" : "IDLE // MIC PUMPS THE SHADER";
      if (btn) btn.classList.toggle("hot", isListening());
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
  $("#vibe-file").onchange = () => {
    vibeStem = $("#vibe-file").value;
    const err = compile($("#vibe-gl"), shaderOf(vibeStem));
    if (err) setStatus(err);
  };
  const overlay = $("#vibe-action");
  if (overlay) overlay.onclick = () => tapMotiv(false);
  lastShot = "";
  const startStem = vibeMode === "motivation" ? ((mot.next && mot.next.vibe) || vibeStem) : vibeStem;
  vibeStem = startStem;
  const err = compile($("#vibe-gl"), shaderOf(vibeStem));
  if (err) setStatus(err);
  startLoop();
  paintMotiv();
  armRadio();
}

function renderOpp() {
  const rows = db.opps.filter((o) => o.status !== "done");
  const sel = selected();
  if (pane === "add") {
    $("#view").innerHTML = `
      <h3>NEW CALL</h3>
      <p class="muted">Paste the apply URL. Pip reads public questions. You copy. Pip does not submit.</p>
      <div class="field"><span>TITLE</span><input id="new-title" placeholder="Festival name" /></div>
      <div class="field"><span>URL</span><input id="new-url" placeholder="https://" /></div>
      <div class="field"><span>OR PASTE QUESTIONS</span><textarea id="new-qs" placeholder="One question per line"></textarea></div>
      <div class="dock">
        <button type="button" id="opp-back">BACK</button>
        <button type="button" class="primary" id="opp-save">SAVE</button>
      </div>`;
    $("#opp-back").onclick = () => { pane = "list"; render(); };
    $("#opp-save").onclick = saveNew;
    return;
  }
  if (sel && pane === "call") {
    const answers = sel.answers && sel.answers.length ? sel.answers : (sel.questions || []).map((q) => ({ q: q.prompt || q.q, a: "", a5: "", type: q.type }));
    $("#view").innerHTML = `
      <h3>${esc(sel.title)}</h3>
      ${sel.url ? `<p class="muted">${esc(sel.url)}</p>` : ""}
      ${sel.note ? `<p class="muted">${esc(sel.note)}</p>` : ""}
      ${answers.map((a, i) => `
        <div class="copy-block">
          <p>${esc(a.q || a.prompt || "")}${a.required ? " *" : ""}</p>
          <div class="actions">
            <button type="button" data-copy="${i}">COPY</button>
          </div>
          <textarea data-ans="${i}">${esc(a.a || "")}</textarea>
        </div>`).join("") || `<p class="muted">No questions yet. READ PAGE or paste them.</p>`}
      <div class="field"><span>PASTE QUESTIONS</span><textarea id="paste-qs" placeholder="If the page is a wall, paste the questions."></textarea></div>
      <div class="dock">
        <button type="button" id="opp-back">BACK</button>
        <button type="button" id="opp-read">READ PAGE</button>
        <button type="button" class="primary" id="opp-draft">DRAFT THIS</button>
        <button type="button" id="opp-open">OPEN FORM</button>
        <button type="button" id="opp-done">DONE</button>
      </div>`;
    $("#opp-back").onclick = () => { pane = "list"; oppId = ""; render(); };
    $("#opp-read").onclick = readPage;
    $("#opp-draft").onclick = draftThis;
    $("#opp-open").onclick = () => sel.url && openUrl(sel.url);
    $("#opp-done").onclick = () => {
      sel.status = "done";
      persist();
      pane = "list";
      oppId = "";
      render();
    };
    $("#view").querySelectorAll("[data-ans]").forEach((el) => {
      el.oninput = () => {
        const i = Number(el.dataset.ans);
        if (!sel.answers[i]) sel.answers[i] = { q: answers[i].q, a: "" };
        sel.answers[i].a = el.value;
        persist();
      };
    });
    $("#view").querySelectorAll("[data-copy]").forEach((el) => {
      el.onclick = async () => {
        const i = Number(el.dataset.copy);
        const text = (sel.answers[i] && sel.answers[i].a) || "";
        try { await navigator.clipboard.writeText(text); setStatus("COPIED"); } catch { setStatus("COPY FAILED"); }
      };
    });
    $("#paste-qs").onchange = () => {
      const qs = questionsFromPaste($("#paste-qs").value);
      if (!qs.length) return;
      sel.questions = qs;
      sel.answers = qs.map((q) => ({ q: q.prompt, a: "", a5: "" }));
      persist();
      render();
      setStatus(`${qs.length} QUESTIONS`);
    };
    return;
  }
  $("#view").innerHTML = `
    <h3>OPEN CALLS</h3>
    ${rows.map((o) => `
      <button type="button" class="opp-card" data-id="${esc(o.id)}">
        <b>${esc(o.title)}</b>
        <span>${esc(o.url || "")}${o.questions && o.questions.length ? " · " + o.questions.length + " Q" : ""}</span>
      </button>`).join("") || `<p class="muted">Empty. HUNT finds public calls, or ADD a URL you already have.</p>`}
    <div class="dock">
      <button type="button" class="primary" id="opp-hunt">HUNT</button>
      <button type="button" id="opp-add">ADD</button>
    </div>`;
  $("#view").querySelectorAll("[data-id]").forEach((el) => {
    el.onclick = () => { oppId = el.dataset.id; pane = "call"; render(); };
  });
  $("#opp-add").onclick = () => { pane = "add"; render(); };
  $("#opp-hunt").onclick = runHunt;
}

function renderKit() {
  $("#view").innerHTML = `
    <h3>APPLICATION KIT</h3>
    <p class="muted">Same answers every time. Copy. Don't rewrite for sport.</p>
    ${KIT_LABELS.map(([k, label]) => `
      <div class="field"><span>${esc(label).toUpperCase()}</span>
        <textarea id="kit-${k}">${esc(db.kit[k] || "")}</textarea>
      </div>`).join("")}
    <div class="dock"><button type="button" class="primary" id="kit-save">SAVE KIT</button></div>`;
  $("#kit-save").onclick = () => {
    for (const [k] of KIT_LABELS) db.kit[k] = ($("#kit-" + k).value || "").trim();
    persist();
    setStatus("KIT SAVED");
  };
}

function renderData() {
  const s = db.settings;
  $("#view").innerHTML = `
    <h3>PHONE PIP</h3>
    <p class="muted">This is the phone. Memory lives here. KIT is the profile. HUNT logs calls and reads questions. DRAFT THIS writes from KIT. Qwen is Pip. Desktop sync comes later.</p>
    <div class="field"><span>NAME</span><input id="set-op" value="${esc(s.operator || "")}" /></div>
    <div class="field"><span>HUMOR ${esc(s.humor)} · ${Number(s.humor) >= 75 ? "TARS" : "CREW"}</span>
      <input type="range" id="set-humor" min="0" max="100" value="${esc(s.humor)}" />
    </div>
    <div class="field"><span>HONESTY ${esc(s.honesty)}</span>
      <input type="range" id="set-honesty" min="0" max="100" value="${esc(s.honesty)}" />
    </div>
    <h3>OPTIONAL TURBO</h3>
    <p class="muted">Not required. COMM already runs on-device. Leave blank.</p>
    <div class="field"><span>GROQ</span><input id="set-groq" type="password" value="${esc(s.groq)}" placeholder="optional" /></div>
    <div class="field"><span>OPENROUTER</span><input id="set-or" type="password" value="${esc(s.openrouter)}" placeholder="optional" /></div>
    <p class="muted">${hasNativeHttp() ? "Native app: can read public apply pages." : "Browser preview: paste questions if a page blocks the read."}</p>
    <div class="dock"><button type="button" class="primary" id="data-save">SAVE</button></div>`;
  $("#data-save").onclick = () => {
    db.settings.operator = $("#set-op").value.trim();
    db.settings.humor = Number($("#set-humor").value);
    db.settings.honesty = Number($("#set-honesty").value);
    db.settings.groq = $("#set-groq").value.trim();
    db.settings.openrouter = $("#set-or").value.trim();
    persist();
    setStatus("SAVED");
    render();
  };
}

async function saveNew() {
  const title = $("#new-title").value.trim();
  const url = $("#new-url").value.trim();
  const qs = questionsFromPaste($("#new-qs").value);
  if (!title && !url) { setStatus("NEED A TITLE OR URL"); return; }
  const row = newOpp({ title: title || url, url });
  if (qs.length) {
    row.questions = qs;
    row.answers = qs.map((q) => ({ q: q.prompt, a: "", a5: "" }));
  }
  db.opps.unshift(row);
  persist();
  oppId = row.id;
  pane = "call";
  render();
  if (url && !qs.length) await readPage();
}

async function readPage() {
  const sel = selected();
  if (!sel || !sel.url) { setStatus("NO URL"); return; }
  setStatus("READING PAGE…");
  try {
    const found = await scrapeUrl(sel.url);
    if (found.title && (!sel.title || sel.title === sel.url)) sel.title = found.title;
    if (found.url) sel.url = found.url;
    if (found.questions.length) {
      sel.questions = found.questions;
      sel.answers = suggestAnswers(found.questions, db.kit, sel.title);
      sel.note = `Read ${found.questions.length} questions.`;
    } else {
      sel.note = "No questions on that page. Paste them.";
    }
    persist();
    render();
    setStatus(found.questions.length ? `${found.questions.length} QUESTIONS` : "PASTE THE QUESTIONS");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function draftThis() {
  const sel = selected();
  if (!sel) return;
  if (!(sel.questions || []).length) { setStatus("READ PAGE OR PASTE QUESTIONS"); return; }
  const seeded = suggestAnswers(sel.questions, db.kit, sel.title);
  Object.assign(sel, mergeDraft(sel, seeded));
  persist();
  render();
  setStatus("KIT ON THE PAGE · DRAFTING THE REST");
  try {
    const drafted = await draftAnswers(db.settings, { title: sel.title, kit: db.kit, questions: sel.questions }, (msg) => setStatus(msg));
    const merged = drafted.map((row, i) => ({
      ...row,
      a: row.a || (seeded[i] && seeded[i].a) || "",
      a5: row.a5 || (seeded[i] && seeded[i].a5) || "",
    }));
    Object.assign(sel, mergeDraft(sel, merged));
    persist();
    render();
    setStatus("DRAFT READY · COPY");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function runHunt() {
  setStatus("HUNTING…");
  try {
    const found = await hunt();
    const fresh = [];
    let n = 0;
    for (const hit of found) {
      if (db.opps.some((o) => o.url === hit.url)) continue;
      const row = newOpp(hit);
      if ((row.questions || []).length) {
        row.answers = suggestAnswers(row.questions, db.kit, row.title);
      }
      db.opps.unshift(row);
      fresh.push(row);
      n += 1;
    }
    persist();
    render();
    setStatus(n ? `LOGGED ${n}` : found.length ? "ALREADY HAD THOSE" : "NOTHING PUBLIC — ADD A URL");
    for (const row of fresh.slice(0, 8)) {
      if (!row.url) continue;
      setStatus(`READING ${String(row.title || "").slice(0, 22).toUpperCase()}`);
      try {
        const page = await scrapeUrl(row.url, { strict: !(row.questions || []).length });
        if (page.title && (!row.title || row.title === row.url)) row.title = page.title;
        if (page.url) row.url = page.url;
        if ((page.questions || []).length) {
          row.questions = page.questions;
          row.answers = suggestAnswers(page.questions, db.kit, row.title);
          row.note = row.note || `Read ${page.questions.length} questions.`;
        }
        persist();
      } catch {
        /* keep the listing even if the page is a wall */
      }
    }
    render();
    const withQ = db.opps.filter((o) => o.status !== "done" && (o.questions || []).length).length;
    if (n) setStatus(`LOGGED ${n} · ${withQ} WITH QUESTIONS`);
  } catch (e) {
    setStatus("HUNT BLOCKED · ADD A URL");
  }
}

function addLog(role, text) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.innerHTML = `<div class="who">${role === "user" ? "YOU" : "PIP"}</div><div>${esc(text)}</div>`;
  $("#log").appendChild(div);
  $("#log").scrollTop = $("#log").scrollHeight;
}

async function sendChat() {
  const box = $("#input");
  const text = (box.value || "").trim();
  if (!text) return;
  box.value = "";
  db.chat.push({ role: "user", content: text });
  addLog("user", text);
  persist();
  setStatus(pipStatus());
  try {
    const reply = await chat(db.settings, db.chat, text, (msg) => setStatus(msg), db.kit);
    db.chat.push({ role: "pip", content: reply });
    persist();
    addLog("pip", reply);
  } catch (e) {
    addLog("pip", String(e.message || e));
  }
}

function boot() {
  db.chat.slice(-20).forEach((m) => addLog(m.role === "user" ? "user" : "pip", m.content));
  if (!db.chat.length) addLog("pip", "Phone Pip. OPP is the job. Kit stays honest. I draft. You paste. I do not submit.");
  $("#tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    pane = "list";
    document.body.classList.remove("comm");
    render();
  };
  $("#comm-tog").onclick = () => document.body.classList.add("comm");
  $("#comm-close").onclick = () => document.body.classList.remove("comm");
  $("#send").onclick = sendChat;
  $("#input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  render();
  const chip = $("#mode-chip");
  if (chip) chip.textContent = "QWEN";
  setStatus("PIP // WAKING QWEN");
  ensurePip((msg) => setStatus(msg))
    .then(() => setStatus("READY"))
    .catch((e) => setStatus(String(e.message || e).toUpperCase()));
}

boot();
