import { load, save, KIT_LABELS } from "./store.js";
import { chat, draftAnswers, ensurePip, pipStatus, activeBrain, cloudStatus, takePendingTheme } from "./brain.js";
import { probeProvider, PROVIDERS } from "./cloud.js";
import { desktopConfigured, desktopLogin, desktopStatus, findAndPair, pairAtUrl } from "./desktop.js";
import { privacyOn } from "./cloud.js";
import { biometricAvailable, guardSecrets } from "./biometric.js";
import { hunt, mergeDraft, newOpp, questionsFromPaste, scrapeUrl, suggestAnswers } from "./opp.js";
import { classify, labelOf } from "./kind.js";
import { ingestLinks, needsIngest } from "./digest.js";
import { hasNativeHttp, openUrl, httpLanGet, httpLanPostJson } from "./net.js";
import { SHADER_ORDER } from "./shaders.js";
import { pickShader, shaderOf, snapshot as motivSnap, tap as motivTap } from "./motivation.js";
import { compile, startLoop, stopLoop, startMic, stopMic, isListening, lose } from "./vibe.js";
import { bootTheme, tryThemeCommand, applyThemePayload, resetTheme, looksLikeThemeRequest } from "./theme.js";
import { captureMoment, topMoments } from "./memory.js";
import { renderCalendar, syncEventsFromDesktop, pushEventToDesktop, ymd, ym } from "./calendar.js";
import { listEntries, applyAllOverlays } from "./codefs.js";
import { loadMapConfig, mountMap, setMapLayer, renderDossier, layerButtons, researchPin, quickPin, drawHailMarkers, resolveMapCenter, renderWeatherBoot, pinDossier, startWeatherWatch, filterDossier } from "./wx.js";

const $ = (s) => document.querySelector(s);
let db = load();
let tab = "opp";
let pane = "list";
let oppId = "";
let calState = { calMonth: ym(), calDay: ymd() };
let vibeMode = "motivation";
let vibeStem = "sendoff";
let lastShot = "";
let radioClock = 0;
let radioBusy = false;
let codeState = { openFile: "style.css", body: "", dirty: false, chat: [], busy: false, model: "" };
let wxState = { lat: null, lon: null, address: "", data: null };

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
  document.body.classList.toggle("wx-tab", tab === "wx");
  $("#tabs").querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab !== "vibe") leaveVibe();
  if (tab === "kit") renderKit();
  else if (tab === "data") renderData();
  else if (tab === "vibe") renderVibe();
  else if (tab === "today") renderToday();
  else if (tab === "code") renderCode();
  else if (tab === "wx") renderWx();
  else renderOpp();
}

function leaveVibe() {
  stopLoop();
  lose();
  if (radioClock) {
    clearInterval(radioClock);
    radioClock = 0;
  }
}

function bootShader(stem) {
  vibeStem = stem || vibeStem;
  const go = () => {
    const canvas = $("#vibe-gl");
    if (!canvas || tab !== "vibe") return;
    const err = compile(canvas, shaderOf(vibeStem));
    if (err) setStatus(err);
    startLoop();
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
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
    bootShader(stem);
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
      <div class="vibe-foot" id="vibe-msg">${live ? "LIVE // THE ROOM IS LISTENING" : "TAP THE SHOT. MIC PUMPS THE SHADER."}</div>
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
    bootShader($("#vibe-file").value);
  };
  const overlay = $("#vibe-action");
  if (overlay) overlay.onclick = () => tapMotiv(false);
  lastShot = "";
  const startStem = vibeMode === "motivation" ? ((mot.next && mot.next.vibe) || vibeStem) : vibeStem;
  bootShader(startStem);
  paintMotiv();
  armRadio();
}

function renderOpp() {
  const rows = db.opps.filter((o) => o.status !== "done");
  const sel = selected();
  if (pane === "add") {
    $("#view").innerHTML = `
      <h3>NEW CALL</h3>
      <p class="muted">Drop the live apply URL. I read. I write. You paste. We don't submit.</p>
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
      <p class="muted">${esc(labelOf(sel.kind || classify(sel.title, sel.url, sel.questions).id))}</p>
      ${answers.map((a, i) => `
        <div class="copy-block">
          <p>${esc(a.q || a.prompt || "")}${a.required ? " *" : ""}</p>
          <div class="actions">
            <button type="button" data-copy="${i}">COPY</button>
          </div>
          <textarea data-ans="${i}">${esc(a.a || "")}</textarea>
        </div>`).join("") || `<p class="muted">Form's shy. READ PAGE or paste the questions — I'll write them with you.</p>`}
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
      sel.answers = suggestAnswers(qs, db.kit, sel.title, sel.kind);
      persist();
      render();
      setStatus(`${qs.length} QUESTIONS`);
    };
    return;
  }
  $("#view").innerHTML = `
    <h3>OPEN CALLS</h3>
    <div class="place-row">
      <div class="field"><span>CITY</span><input id="hunt-city" value="${esc(db.kit.city || "")}" placeholder="Edmond" /></div>
      <div class="field"><span>STATE</span><input id="hunt-state" value="${esc(db.kit.state || "")}" placeholder="Oklahoma" /></div>
      <div class="field span2"><span>COUNTRY</span><input id="hunt-country" value="${esc(db.kit.country || "")}" placeholder="United States" /></div>
    </div>
    ${rows.map((o) => `
      <button type="button" class="opp-card" data-id="${esc(o.id)}">
        <b>${esc(o.title)}</b>
        <span>${esc(labelOf(o.kind || classify(o.title, o.url, o.questions).id))}${o.questions && o.questions.length ? " · " + o.questions.length + " Q" : " · NO FORM"}${o.url ? " · " + esc(o.url.slice(0, 42)) : ""}</span>
      </button>`).join("") || `<p class="muted">Nothing on the desk yet. HUNT a call, or ADD a URL you already want.</p>`}
    <div class="dock">
      <button type="button" class="primary" id="opp-hunt">HUNT</button>
      <button type="button" id="opp-add">ADD</button>
    </div>`;
  $("#view").querySelectorAll("[data-id]").forEach((el) => {
    el.onclick = () => { oppId = el.dataset.id; pane = "call"; render(); };
  });
  $("#opp-add").onclick = () => { pane = "add"; render(); };
  $("#opp-hunt").onclick = runHunt;
  bindPlace();
}

function bindPlace() {
  const grab = () => {
    db.kit.city = ($("#hunt-city")?.value || "").trim();
    db.kit.state = ($("#hunt-state")?.value || "").trim();
    db.kit.country = ($("#hunt-country")?.value || "").trim();
    persist();
  };
  ["hunt-city", "hunt-state", "hunt-country"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.onchange = grab;
  });
}

function renderKit() {
  const fields = KIT_LABELS.filter(([k]) => k !== "links");
  $("#view").innerHTML = `
    <h3>APPLICATION KIT</h3>
    <p class="muted">Paste the site. Ingest. Ingest again anytime — it rebuilds the resume. Do not uninstall Pip to update it.</p>
    <div class="field kit-links-box">
      <span>LINKS</span>
      <textarea id="kit-links" placeholder="https://yoursite.com">${esc(db.kit.links || "")}</textarea>
    </div>
    <div class="actions">
      <button type="button" class="primary" id="kit-ingest-top">INGEST LINKS</button>
    </div>
    ${fields.map(([k, label]) => {
      const short = k === "city" || k === "state" || k === "country";
      return `<div class="field"><span>${esc(label).toUpperCase()}</span>
        <textarea id="kit-${k}"${short ? ' class="short"' : ""}>${esc(db.kit[k] || "")}</textarea>
      </div>`;
    }).join("")}
    ${db.kit.resume ? `<h3>ASSEMBLED RESUME</h3><div class="copy-block"><p>${esc(String(db.kit.resume).slice(0, 1600))}${String(db.kit.resume).length > 1600 ? "…" : ""}</p></div>` : ""}
    <div class="dock">
      <button type="button" class="primary" id="kit-save">SAVE KIT</button>
      <button type="button" id="kit-ingest">INGEST LINKS</button>
    </div>`;
  $("#kit-save").onclick = () => {
    grabKitFields();
    persist();
    setStatus("KIT SAVED");
  };
  $("#kit-ingest").onclick = runIngest;
  const top = $("#kit-ingest-top");
  if (top) top.onclick = runIngest;
}

function grabKitFields() {
  for (const [k] of KIT_LABELS) db.kit[k] = ($("#kit-" + k)?.value || "").trim();
}

async function runIngest() {
  grabKitFields();
  if (!String(db.kit.links || "").trim()) {
    setStatus("PASTE LINKS FIRST");
    return;
  }
  setStatus("READING LINKS…");
  try {
    db.kit = await ingestLinks(db.kit, setStatus);
    persist();
    render();
    const box = $("#kit-links");
    if (box) {
      box.scrollIntoView({ block: "start" });
      box.focus();
    }
    const n = (db.kit.digest && db.kit.digest.sources && db.kit.digest.sources.length) || 0;
    setStatus(n ? `READ ${n} · RESUME READY` : "NOTHING PUBLIC ON THOSE LINKS");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

function renderPrivacy() {
  const secure = privacyOn(db.settings);
  const tog = $("#privacy-tog");
  const chip = $("#mode-chip");
  if (tog) {
    tog.classList.toggle("on", secure);
    tog.classList.toggle("leaky", !secure);
    tog.textContent = secure ? "SECURE" : "LEAKY";
  }
  if (chip) {
    const labels = { secure: "SECURE", local: "LOCAL", leak: "LEAK", leaky: "LEAKY", cloud: "CLOUD" };
    const shown = secure ? "secure" : "leaky";
    chip.textContent = labels[shown] || "LEAKY";
    chip.classList.remove("leak", "leaky", "secure", "cloud", "local");
    chip.classList.add(shown);
  }
}

function updateBrainChip() {
  renderPrivacy();
}

function paintCalendar() {
  const root = $("#cal-root");
  if (!root) return;
  renderCalendar(root, db, calState, {
    esc,
    persist,
    onChange: paintCalendar,
  });
}

function renderToday() {
  const root = $("#view");
  if (!root.querySelector("#cal-root")) {
    root.innerHTML = `<div class="today-wrap"><div id="cal-root"></div><div class="story-strip" id="story-strip"></div></div>`;
    const moments = topMoments(db, 5);
    const strip = root.querySelector("#story-strip");
    if (moments.length) {
      strip.innerHTML = `<h3>YOUR STORY</h3>${moments.map((m) => `<p class="story-line">${esc(m.content)}</p>`).join("")}`;
    } else {
      strip.innerHTML = `<p class="muted">Substantive CHAT lines stick here — goals, origin, why you make things. Not "bug again."</p>`;
    }
  }
  paintCalendar();
}

async function openCodeFile(name) {
  const f = await loadFile(name);
  codeState.openFile = f.path;
  codeState.body = f.body;
  codeState.dirty = false;
}

function paintCodeChat(scroll) {
  const log = $("#code-log");
  if (!log) return;
  log.innerHTML = codeState.chat
    .map(
      (m) => `<div class="code-msg ${m.role}">
      <div class="who">${m.role === "user" ? "YOU" : "PIP"}</div>
      <div>${esc(m.text)}</div>
      ${(m.tools || []).length ? `<div class="muted tools">${esc(m.tools.join(" · "))}</div>` : ""}
    </div>`,
    )
    .join("");
  if (scroll) log.scrollTop = log.scrollHeight;
}

async function sendCodePrompt(phoneUpgrade) {
  if (codeState.busy) return;
  const input = $("#code-input");
  const prompt = (input?.value || "").trim();
  if (!prompt) {
    setStatus("SAY WHAT TO CHANGE");
    return;
  }
  if (codeState.dirty) {
    try {
      await saveFile(codeState.openFile, $("#code-body").value);
      codeState.dirty = false;
    } catch (e) {
      setStatus(String(e.message || e));
      return;
    }
  }
  input.value = "";
  codeState.busy = true;
  codeState.chat.push({ role: "user", text: prompt, tools: [] });
  const pipMsg = { role: "pip", text: "", tools: [] };
  codeState.chat.push(pipMsg);
  paintCodeChat(true);
  setStatus(phoneUpgrade ? "PC PHONE WWW…" : "CODE…");
  try {
    await consumeCodeStream(
      streamCodeApply(db.settings, { prompt, openPath: codeState.openFile, phoneUpgrade }),
      {
        onStatus: (ev) => {
          if (ev.model) codeState.model = ev.model;
        },
        onDelta: (t) => {
          pipMsg.text += t;
          paintCodeChat(true);
        },
        onTool: (ev) => {
          pipMsg.tools.push(`${ev.name}${ev.args?.path ? " " + String(ev.args.path).split(/[\\/]/).pop() : ""}`);
          paintCodeChat(true);
        },
        onWritten: async (path) => {
          if (path === codeState.openFile || String(path).endsWith(codeState.openFile)) {
            await openCodeFile(codeState.openFile);
            const ta = $("#code-body");
            if (ta) ta.value = codeState.body;
          }
        },
        onError: (t) => {
          pipMsg.text = pipMsg.text || t;
          paintCodeChat(true);
        },
        onDone: async (ev) => {
          if (ev.model) codeState.model = ev.model;
          await openCodeFile(codeState.openFile);
          const ta = $("#code-body");
          if (ta) ta.value = codeState.body;
          setStatus((ev.written || []).length ? `WROTE ${ev.written.length}` : "CODE DONE");
          if (ev.reload) setStatus("RELOAD APP TO APPLY JS/HTML");
        },
      },
    );
  } catch (e) {
    pipMsg.text = pipMsg.text || String(e.message || e);
    paintCodeChat(true);
    setStatus("CODE ERROR");
  }
  codeState.busy = false;
}

async function renderWx() {
  document.body.classList.remove("comm");
  document.body.classList.add("wx-tab");
  $("#view").innerHTML = `
    <div class="wx-wrap">
      <div class="wx-layers" id="wx-layers"></div>
      <div id="wx-map"></div>
      <div id="wx-panel" class="wx-panel"><p class="muted">Locating…</p></div>
    </div>`;
  try {
    const center = await resolveMapCenter(db.settings);
    const cfg = await loadMapConfig(db.settings);
    cfg.center = { ...cfg.center, ...center };
    $("#wx-layers").innerHTML = layerButtons(cfg, esc);
    $("#wx-layers").onclick = (e) => {
      const b = e.target.closest("[data-layer]");
      if (!b) return;
      setMapLayer(b.dataset.layer);
      $("#wx-layers").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    };
    mountMap($("#wx-map"), cfg, { center, onTap: onWxTap });
    quickPin(db.settings, center.lat, center.lon).then((hit) => {
      renderWeatherBoot($("#wx-panel"), hit.geo, hit.weather || cfg.weather, hit.hail, esc);
    }).catch(() => {
      $("#wx-panel").innerHTML = `<p class="muted">Tap the map for storm dossier.</p>`;
    });
  } catch (e) {
    $("#view").innerHTML = `<p class="muted">${esc(String(e.message || e))}</p>`;
  }
}

async function onWxTap(lat, lon) {
  wxState.lat = lat;
  wxState.lon = lon;
  setStatus("PINNED · ADDRESS…");
  const panel = $("#wx-panel");
  try {
    const data = await pinDossier(db.settings, lat, lon, {
      onPartial: (partial) => {
        wxState.address = partial.address || "";
        renderDossier(panel, partial, esc, null);
        setStatus("PINNED · STORMS + HAIL…");
      },
    });
    wxState.address = data.address || "";
    wxState.data = data;
    drawHailMarkers(data.hail, data.wind);
    renderDossier(panel, data, esc, async () => {
      setStatus("DEEP RESEARCH…");
      const deep = await researchPin(db.settings, lat, lon, wxState.address, true);
      wxState.data = deep;
      const f = filterDossier(deep);
      drawHailMarkers(f.hail, f.wind);
      renderDossier(panel, deep, esc, null);
      setStatus("DOSSIER UPDATED");
    });
    setStatus("WX DOSSIER");
  } catch (e) {
    panel.innerHTML = `<p class="muted">${esc(String(e.message || e))}. Check network.</p>`;
    setStatus("WX ERROR");
  }
}

async function renderCode() {
  document.body.classList.remove("comm");
  if (!codeState.body) {
    try {
      await openCodeFile(codeState.openFile || "style.css");
    } catch {
      codeState.body = "";
    }
  }
  codeState.chat = getCodeChat();
  const entries = listEntries();
  const paired = desktopConfigured(db.settings);
  const leaky = !privacyOn(db.settings);
  $("#view").innerHTML = `
    <div class="code-wrap">
      <h3>CODE</h3>
      <p class="muted">${leaky ? "LEAKY — cloud coder edits phone www overlay." : "SECURE — flip LEAKY for on-device CODE, or pair desktop for UPGRADE PC."} CSS live · JS/HTML need RELOAD.</p>
      <div class="code-bar">
        <select id="code-file">${entries.map((e) => `<option value="${esc(e.name)}" ${e.name === codeState.openFile ? "selected" : ""}>${esc(e.name)}${e.overlay ? " *" : ""}</option>`).join("")}</select>
        <button type="button" id="code-save">SAVE</button>
        <button type="button" id="code-reload">RELOAD</button>
      </div>
      <textarea id="code-body" spellcheck="false">${esc(codeState.body)}</textarea>
      <div class="code-chat">
        <div id="code-log"></div>
        <textarea id="code-input" rows="2" placeholder="Change the UI, fix a bug, add a tab…"></textarea>
        <div class="code-actions">
          <button type="button" id="code-send" class="primary">SEND</button>
          ${paired ? `<button type="button" id="code-pc">UPGRADE PC</button>` : ""}
          <button type="button" id="code-reset">RESET OVERLAY</button>
          <button type="button" id="code-clear">CLEAR CHAT</button>
        </div>
        <p class="muted" id="code-model">${esc(codeState.model || "")}</p>
      </div>
    </div>`;
  paintCodeChat(false);
  $("#code-file").onchange = async (e) => {
    if (codeState.dirty && !confirm("Discard unsaved edits?")) {
      e.target.value = codeState.openFile;
      return;
    }
    await openCodeFile(e.target.value);
    $("#code-body").value = codeState.body;
    codeState.dirty = false;
  };
  $("#code-body").oninput = () => {
    codeState.dirty = true;
  };
  $("#code-save").onclick = async () => {
    try {
      await saveFile(codeState.openFile, $("#code-body").value);
      codeState.body = $("#code-body").value;
      codeState.dirty = false;
      setStatus("SAVED · RELOAD IF JS");
      renderCode();
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
  $("#code-reload").onclick = () => location.reload();
  $("#code-send").onclick = () => sendCodePrompt(false);
  const pc = $("#code-pc");
  if (pc) pc.onclick = () => sendCodePrompt(true);
  $("#code-reset").onclick = () => {
    if (!confirm("Clear all local code overlays and restore bundled files?")) return;
    resetOverlays();
    resetCodeChat();
    codeState.chat = [];
    codeState.dirty = false;
    setStatus("OVERLAY CLEARED · RELOAD");
    location.reload();
  };
  $("#code-clear").onclick = () => {
    resetCodeChat();
    codeState.chat = [];
    paintCodeChat(false);
    setStatus("CODE CHAT CLEARED");
  };
  $("#code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCodePrompt(false);
    }
  });
}

function renderData() {
  const s = db.settings;
  const cloud = cloudStatus(s);
  const paired = desktopConfigured(s);
  const securePosture = privacyOn(s);
  $("#view").innerHTML = `
    <h3>PHONE PIP</h3>
    <p class="muted">Crew in your pocket. KIT is you. OPP is the job. CHAT routes: desktop GPU → all keyed clouds → on-device Qwen. Same Pip voice on every brain.</p>
    <div class="field"><span>NAME</span><input id="set-op" value="${esc(s.operator || "")}" /></div>
    <div class="field"><span>HUMOR ${esc(s.humor)} · ${Number(s.humor) >= 75 ? "TARS" : "CREW"}</span>
      <input type="range" id="set-humor" min="0" max="100" value="${esc(s.humor)}" />
    </div>
    <div class="field"><span>HONESTY ${esc(s.honesty)}</span>
      <input type="range" id="set-honesty" min="0" max="100" value="${esc(s.honesty)}" />
    </div>
    <h3>REMOTE DESKTOP</h3>
    <p class="muted">Pair to your PC for GPU/Ollama. Same Wi‑Fi, or off-network via Tailscale / WireGuard. Desktop Pip DATA → password + Phone LAN + VPN mode → copy a URL here.</p>
    <div class="field"><span>DESKTOP PASSWORD</span><input id="set-dpass" type="password" placeholder="from desktop DATA → PHONE" autocomplete="off" /></div>
    <div class="field"><span>VPN URL</span><input id="set-vurl" value="${esc(s.vpn_url || "")}" placeholder="http://100.x.x.x:7420 or http://10.8.0.1:7420" /></div>
    <div class="field"><span>TAILSCALE HOST</span><input id="set-vhost" value="${esc(s.vpn_host || "")}" placeholder="optional · mypc.tail-scale.ts.net" /></div>
    <div class="actions">
      <button type="button" id="desk-find" class="primary">FIND + PAIR</button>
      <button type="button" id="desk-vpn">PAIR VPN URL</button>
      <button type="button" id="desk-pair">${paired ? "RE-PAIR" : "PAIR"}</button>
      <button type="button" id="desk-test">TEST</button>
      <button type="button" id="desk-clear">FORGET</button>
    </div>
    <div class="field"><span>DESKTOP URL</span><input id="set-durl" value="${esc(s.desktop_url || "")}" placeholder="auto-filled by FIND" /></div>
    <p class="muted" id="desk-msg">${paired ? `Paired · ${esc(s.desktop_url || "")}` : "Not paired."}</p>
    <div class="field"><span>VPN NOTES</span><input id="set-vpn" value="${esc(s.vpn_note || "")}" placeholder="WireGuard profile name, backup URLs…" /></div>
    <h3>BRAIN</h3>
    <p class="muted">${cloud.leaky ? `LEAKY on. Keyed: ${cloud.keyed.join(", ") || "none"}. Pin: ${cloud.pin}.` : "SECURE — cloud keys saved but not used until LEAKY. Tap SECURE/LEAKY in the header."} Grok needs LEAKY + pin xai + XAI key.</p>
    <div class="field"><span>PIN</span>
      <select id="brain-pin">
        ${["auto", "local", "groq", "openrouter", "cerebras", "mistral", "gemini", "xai"].map((id) => {
          const on = (s.brain_pin || "auto") === id;
          const label = id === "xai" ? "xai (Grok)" : id;
          return `<option value="${id}" ${on ? "selected" : ""}>${label}</option>`;
        }).join("")}
      </select>
    </div>
    ${securePosture ? `<p class="muted">PIN is stored but ignored while SECURE is on.</p>` : `<p class="muted">LEAKY is on. PIN picks the cloud brain. Chat prefers desktop when paired.</p>`}
    <div class="field"><span>GROQ</span><input id="set-groq" type="password" value="${esc(s.groq)}" placeholder="optional" autocomplete="off" /></div>
    <div class="field"><span>OPENROUTER</span><input id="set-or" type="password" value="${esc(s.openrouter)}" placeholder="optional" autocomplete="off" /></div>
    <div class="field"><span>CEREBRAS</span><input id="set-cerebras" type="password" value="${esc(s.cerebras)}" placeholder="optional" autocomplete="off" /></div>
    <div class="field"><span>MISTRAL</span><input id="set-mistral" type="password" value="${esc(s.mistral)}" placeholder="optional" autocomplete="off" /></div>
    <div class="field"><span>GEMINI</span><input id="set-gemini" type="password" value="${esc(s.gemini)}" placeholder="pin-only · optional" autocomplete="off" /></div>
    <div class="field"><span>GROK / XAI</span><input id="set-xai" type="password" value="${esc(s.xai)}" placeholder="pin-only · grok-3-mini" autocomplete="off" /></div>
    <div class="actions">
      <button type="button" id="probe-grok">PROBE GROK</button>
      <button type="button" id="probe-groq">PROBE GROQ</button>
    </div>
    <h3>LOCK</h3>
    <p class="muted">Require biometric unlock before opening keys or pairing. ${biometricAvailable() ? "Sensor available on this device." : "No sensor — lock is a soft gate."}</p>
    <label class="check"><input type="checkbox" id="set-bio" ${s.biometric_lock ? "checked" : ""} /> BIOMETRIC LOCK</label>
    <h3>UI THEME</h3>
    <p class="muted">Current: ${esc(s.ui_theme_name || "phosphor default")}. CHAT: "phthalo green" or "reset ui theme". Phone does not edit code files — only CSS variables.</p>
    <div class="actions">
      <button type="button" id="theme-reset" class="primary">RESET THEME</button>
    </div>
    <h3>UPDATE</h3>
    <p class="muted" id="pip-ver">Opens GitHub. Download Pip.apk. Install over this app. KIT stays.</p>
    <div class="actions"><button type="button" id="pip-update">UPDATE PIP</button></div>
    <p class="muted">${hasNativeHttp() ? "Native app: can read public apply pages." : "Browser preview: paste questions if a page blocks the read."}</p>
    <div class="dock"><button type="button" class="primary" id="data-save">SAVE</button></div>`;

  const grabSettings = () => {
    db.settings.operator = $("#set-op").value.trim();
    db.settings.humor = Number($("#set-humor").value);
    db.settings.honesty = Number($("#set-honesty").value);
    db.settings.brain_pin = ($("#brain-pin") && $("#brain-pin").value) || db.settings.brain_pin;
    db.settings.groq = $("#set-groq").value.trim();
    db.settings.openrouter = $("#set-or").value.trim();
    db.settings.cerebras = $("#set-cerebras").value.trim();
    db.settings.mistral = $("#set-mistral").value.trim();
    db.settings.gemini = $("#set-gemini").value.trim();
    db.settings.xai = $("#set-xai").value.trim();
    db.settings.desktop_url = $("#set-durl").value.trim();
    db.settings.vpn_url = ($("#set-vurl") && $("#set-vurl").value.trim()) || "";
    db.settings.vpn_host = ($("#set-vhost") && $("#set-vhost").value.trim()) || "";
    db.settings.biometric_lock = Boolean($("#set-bio").checked);
    db.settings.vpn_note = $("#set-vpn").value.trim();
    persist();
  };

  $("#data-save").onclick = () => {
    guardSecrets(db.settings, () => {
      grabSettings();
      setStatus("SAVED");
      updateBrainChip();
      render();
    }).catch((e) => setStatus(String(e.message || e)));
  };

  const themeResetBtn = $("#theme-reset");
  if (themeResetBtn) {
    themeResetBtn.onclick = () => {
      resetTheme(db.settings);
      persist();
      render();
      renderPrivacy();
      setStatus("THEME RESET · PHOSPHOR GREEN");
    };
  }

  $("#desk-pair").onclick = () => {
    guardSecrets(db.settings, async () => {
      grabSettings();
      const pass = ($("#set-dpass").value || "").trim();
      if (!db.settings.desktop_url) {
        setStatus("FIND DESKTOP OR SET URL");
        return;
      }
      setStatus("PAIRING…");
      try {
        const out = await desktopLogin(db.settings, pass);
        db.settings.desktop_token = out.token || "loopback";
        db.settings.desktop_paired = true;
        persist();
        $("#desk-msg").textContent = `Paired · ${db.settings.desktop_url}`;
        setStatus("DESKTOP PAIRED");
        renderPrivacy();
      } catch (e) {
        setStatus(String(e.message || e));
      }
    }).catch((e) => setStatus(String(e.message || e)));
  };

  $("#desk-find").onclick = () => {
    guardSecrets(db.settings, async () => {
      grabSettings();
      const pass = ($("#set-dpass").value || "").trim();
      if (!pass) {
        setStatus("SET DESKTOP PASSWORD FIRST");
        return;
      }
      try {
        const out = await findAndPair(db.settings, pass, (msg) => setStatus(msg));
        db.settings.desktop_url = out.url;
        db.settings.desktop_token = out.token || "loopback";
        db.settings.desktop_paired = true;
        if (!db.settings.vpn_url && out.via && out.via !== out.url) db.settings.vpn_url = out.via;
        persist();
        $("#set-durl").value = out.url;
        $("#desk-msg").textContent = `Paired · ${out.url}${out.vpn ? " · VPN" : ""}`;
        setStatus("DESKTOP FOUND + PAIRED");
        renderPrivacy();
      } catch (e) {
        setStatus(String(e.message || e));
      }
    }).catch((e) => setStatus(String(e.message || e)));
  };

  const deskVpn = $("#desk-vpn");
  if (deskVpn) {
    deskVpn.onclick = () => {
      guardSecrets(db.settings, async () => {
        grabSettings();
        const pass = ($("#set-dpass").value || "").trim();
        const url = ($("#set-vurl").value || "").trim();
        if (!pass || !url) {
          setStatus("NEED PASSWORD + VPN URL");
          return;
        }
        setStatus("PAIRING VPN…");
        try {
          const out = await pairAtUrl(db.settings, pass, url, (msg) => setStatus(msg));
          db.settings.desktop_url = out.url;
          db.settings.desktop_token = out.token || "loopback";
          db.settings.desktop_paired = true;
          db.settings.vpn_url = url;
          persist();
          $("#set-durl").value = out.url;
          $("#desk-msg").textContent = `Paired via VPN · ${out.url}`;
          setStatus("VPN PAIRED");
          renderPrivacy();
        } catch (e) {
          setStatus(String(e.message || e));
        }
      }).catch((e) => setStatus(String(e.message || e)));
    };
  }

  $("#desk-test").onclick = () => {
    grabSettings();
    setStatus("TESTING DESKTOP…");
    desktopStatus(db.settings).then((st) => {
      if (!st.ok) {
        setStatus(st.error || "DESKTOP OFFLINE");
        return;
      }
      const model = (st.ollama && st.ollama.using) || "ollama";
      const vpn = st.phone_vpn ? ` · VPN ${st.vpn_mode || "on"}` : "";
      setStatus(`DESKTOP OK · ${model}${vpn}`);
      $("#desk-msg").textContent = `Online · auth ${st.auth ? "yes" : "no"} · ${model}${vpn}`;
    });
  };

  $("#desk-clear").onclick = () => {
    db.settings.desktop_token = "";
    db.settings.desktop_paired = false;
    persist();
    setStatus("DESKTOP FORGOTTEN");
    updateBrainChip();
    render();
  };

  const runProbe = (id) => {
    grabSettings();
    setStatus(`PROBING ${id.toUpperCase()}…`);
    probeProvider(db.settings, id).then((r) => {
      setStatus(r.ok ? `${id.toUpperCase()} OK` : (r.error || "PROBE FAILED"));
    });
  };
  $("#probe-grok").onclick = () => runProbe("xai");
  $("#probe-groq").onclick = () => runProbe("groq");

  const upd = $("#pip-update");
  if (upd) {
    upd.onclick = async () => {
      setStatus("OPENING GITHUB…");
      try {
        await openUrl("https://github.com/joshuagwatts/pip-phone/releases/latest", { system: true });
        setStatus("DOWNLOAD PIP.APK · INSTALL OVER THIS APP");
      } catch (e) {
        setStatus(String(e.message || e));
      }
    };
  }
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.App && cap.Plugins.App.getInfo) {
    cap.Plugins.App.getInfo().then((info) => {
      const el = $("#pip-ver");
      if (el && info && info.version) el.textContent = `This build ${info.version}. Opens GitHub. Download Pip.apk. Install over this app.`;
    }).catch(() => {});
  }
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
      sel.answers = suggestAnswers(found.questions, db.kit, sel.title, sel.kind);
      sel.kind = classify(sel.title, sel.url, found.questions).id;
      sel.note = `Read ${found.questions.length} questions (${found.source || "page"}).`;
    } else {
      sel.note = "No form on that page yet. Paste the questions.";
    }
    persist();
    render();
    setStatus(found.questions.length ? `${found.questions.length} QUESTIONS` : "NO FORM · PASTE THE QUESTIONS");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function draftThis() {
  const sel = selected();
  if (!sel) return;
  if (!(sel.questions || []).length) { setStatus("READ PAGE OR PASTE QUESTIONS"); return; }
  if (needsIngest(db.kit)) {
    setStatus("READING LINKS…");
    try {
      db.kit = await ingestLinks(db.kit, setStatus);
      persist();
    } catch (e) {
      setStatus(String(e.message || e));
    }
  }
  const kind = classify(sel.title, sel.url, sel.questions).id;
  sel.kind = kind;
  const seeded = suggestAnswers(sel.questions, db.kit, sel.title, kind);
  Object.assign(sel, mergeDraft(sel, seeded));
  persist();
  render();
  setStatus("KIT ON THE PAGE · DRAFTING THE REST");
  try {
    const drafted = await draftAnswers(db.settings, { title: sel.title, kit: db.kit, questions: sel.questions, kind }, (msg) => setStatus(msg));
    const merged = drafted.map((row, i) => ({
      ...row,
      a: row.a || (seeded[i] && seeded[i].a) || "",
      a5: row.a5 || (seeded[i] && seeded[i].a5) || "",
    }));
    Object.assign(sel, mergeDraft(sel, merged));
    persist();
    render();
    setStatus("DRAFT READY · GO PASTE IT");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function runHunt() {
  setStatus("HUNTING…");
  try {
    db.kit.city = ($("#hunt-city")?.value || db.kit.city || "").trim();
    db.kit.state = ($("#hunt-state")?.value || db.kit.state || "").trim();
    db.kit.country = ($("#hunt-country")?.value || db.kit.country || "").trim();
    persist();
    const found = await hunt("", {
      city: db.kit.city,
      state: db.kit.state,
      country: db.kit.country,
      onProgress: setStatus,
    });
    const fresh = [];
    let n = 0;
    for (const hit of found) {
      if (db.opps.some((o) => o.url === hit.url)) continue;
      const row = newOpp(hit);
      if ((row.questions || []).length) {
        row.kind = classify(row.title, row.url, row.questions).id;
        row.answers = suggestAnswers(row.questions, db.kit, row.title, row.kind);
      }
      db.opps.unshift(row);
      fresh.push(row);
      n += 1;
    }
    persist();
    render();
    setStatus(n ? `LOGGED ${n}` : found.length ? "ALREADY HAD THOSE" : "NOTHING PUBLIC — ADD A URL");
    const queue = fresh.slice(0, 24);
    let i = 0;
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (i < queue.length) {
        const idx = i;
        i += 1;
        const row = queue[idx];
        if (!row.url) continue;
        setStatus(`READING ${idx + 1}/${queue.length}`);
        try {
          const page = await scrapeUrl(row.url, { strict: false });
          if (page.title && (!row.title || row.title === row.url)) row.title = page.title;
          if (page.url) row.url = page.url;
          if ((page.questions || []).length) {
            row.questions = page.questions;
            row.kind = classify(row.title, row.url, page.questions).id;
            row.answers = suggestAnswers(page.questions, db.kit, row.title, row.kind);
            row.note = `${labelOf(row.kind)} · ${page.questions.length} questions`;
          } else {
            row.note = "No form on that page yet. Open it and paste the questions.";
          }
          persist();
        } catch {
          /* keep the listing */
        }
      }
    });
    await Promise.all(workers);
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
  captureMoment(db, text);
  persist();
  setStatus(pipStatus());

  const themeHit = tryThemeCommand(text, db.settings);
  if (themeHit) {
    persist();
    addLog("pip", themeHit.reply);
    setStatus(themeHit.ok ? "THEME APPLIED" : "THEME");
    render();
    renderPrivacy();
    if (desktopConfigured(db.settings) && themeHit.ok) {
      try {
        const tok = String(db.settings.desktop_token || "").trim();
        const base = db.settings.desktop_url.replace(/\/+$/, "");
        await httpLanPostJson(`${base}/api/theme`, tok ? { Cookie: `pip_gate=${tok}` } : {}, { accent: themeHit.name }, 8000);
      } catch {
        /* local theme still applied */
      }
    }
    return;
  }

  if (looksLikeThemeRequest(text)) {
    addLog("pip", "Name the color clearly — e.g. phthalo green. Or say refresh ui color / reset ui theme.");
    setStatus("THEME · NEED COLOR NAME");
    return;
  }

  try {
    const reply = await chat(db.settings, db.chat, text, (msg) => setStatus(msg), db.kit, db);
    const pending = takePendingTheme();
    if (pending && applyThemePayload(db.settings, pending)) {
      persist();
      render();
      renderPrivacy();
    }
    db.chat.push({ role: "pip", content: reply });
    persist();
    addLog("pip", reply);
    updateBrainChip();
  } catch (e) {
    addLog("pip", String(e.message || e));
  }
}

function boot() {
  bootTheme(db.settings);
  applyAllOverlays();
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
  const privacyTog = $("#privacy-tog");
  if (privacyTog) {
    privacyTog.onclick = () => {
      const secure = privacyOn(db.settings);
      db.settings.privacy_mode = secure ? "leaky" : "secure";
      persist();
      renderPrivacy();
      setStatus(secure ? "LEAKY // CLOUD UNLOCKED" : "SECURE // ON-DEVICE");
    };
  }
  $("#send").onclick = sendChat;
  $("#input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  render();
  renderPrivacy();
  setStatus("PIP // WAKING");
  startWeatherWatch(
    () => resolveMapCenter(db.settings),
    (live) => {
      const line = (live.severity && live.severity.line) || "";
      if (!line) return;
      const nws = (live.alerts || []).slice(0, 2).map((a) => a.event).filter(Boolean);
      const msg = nws.length ? `${line} ${nws.join(". ")}.` : line;
      window.__pipWxLine = msg;
      db.chat.push({ role: "pip", content: msg });
      persist();
      addLog("pip", msg);
      setStatus("WX ALERT");
    },
  );
  ensurePip((msg) => setStatus(msg))
    .then(async () => {
      if (desktopConfigured(db.settings)) {
        await syncEventsFromDesktop(db.settings, db).catch(() => {});
        persist();
      }
      setStatus("PIP ON DECK");
      updateBrainChip();
    })
    .catch((e) => setStatus(String(e.message || e).toUpperCase()));
}

boot();
