import { load, save, KIT_LABELS } from "./store.js";
import { chat, draftAnswers, pipStatus, activeBrain, cloudStatus, takePendingTheme, takeLastTurn } from "./brain.js";
import { probeKeyed, providerHealth, hydrateHealth } from "./cloud.js";
import { desktopConfigured, desktopLogin, desktopStatus, findAndPair } from "./desktop.js";
import { privacyOn } from "./cloud.js";
import { biometricAvailable, guardSecrets, requireAppUnlock } from "./biometric.js";
import { mergeDraft, newOpp, questionsFromPaste, scrapeUrl, suggestAnswers } from "./opp.js";
import { classify, labelOf } from "./kind.js";
import { ingestLinks, needsIngest } from "./digest.js";
import { hasNativeHttp, openUrl, httpLanGet, httpLanPostJson } from "./net.js";
import { SHADER_ORDER } from "./shaders.js";
import { pickShader, shaderOf, snapshot as motivSnap, tap as motivTap } from "./motivation.js";
import { compile, startLoop, stopLoop, startMic, stopMic, isListening, lose } from "./vibe.js";
import { bootTheme, tryThemeCommand, applyThemePayload, resetTheme, looksLikeThemeRequest } from "./theme.js";
import { captureMoment, topMoments, rememberReply } from "./memory.js";
import { renderCalendar, syncEventsFromDesktop, pushEventToDesktop, ymd, ym } from "./calendar.js";
import { applyAllOverlays } from "./codefs.js";
import { streamCodeApply, consumeCodeStream } from "./code.js";
import { loadMapConfig, mountMap, setMapLayer, renderDossier, layerButtons, researchPin, quickPin, drawHailMarkers, resolveMapCenter, renderWeatherBoot, pinDossier, refetchDossier, startWeatherWatch, filterDossier } from "./wx.js";
import { describeChain, looksLikeCodeRequest, wantsDesktopCodeUpgrade } from "./command.js";
import {
  mealSnapshot,
  planDay,
  clearDayPlan,
  clearWantedMeals,
  deleteWantedMeal,
  setShoppingChecked,
  tryMealCommand,
  syncMealsFromDesktop,
} from "./meals.js";
import {
  OPP_TYPES,
  APP_STAGES,
  stageLabel,
  filterOpps,
  fitLabel,
  scoreFit,
  huntOpportunities,
  scrapeOpportunityUrl,
  syncOppsFromDesktop,
  fullOppSync,
  fetchOppDigest,
  setOppStage,
  tryOppCommand,
} from "./oppdesk.js";
import { startBackground, toggleKeepAlive } from "./background.js";
import {
  morningStatus,
  wakeNext,
  checkWake,
  fullMorningSync,
  fetchBriefing,
  getBriefing,
  pingPresence,
} from "./morning.js";
import { pullCloudKeys, keyedSummary } from "./keysync.js";

const $ = (s) => document.querySelector(s);
let db = load();
let tab = "opp";
let pane = "list";
let oppId = "";
let oppFilter = { q: "", type: "all" };
let calState = { calMonth: ym(), calDay: ymd() };
let vibeMode = "motivation";
let vibeStem = "sendoff";
let lastShot = "";
let radioClock = 0;
let radioBusy = false;
let codeBusy = false;
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
  if (tab === "guide") tab = "opp";
  document.body.classList.toggle("vibe-tab", tab === "vibe");
  document.body.classList.toggle("wx-tab", tab === "wx");
  $("#tabs").querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab !== "vibe") leaveVibe();
  if (tab === "kit") renderKit();
  else if (tab === "data") renderData();
  else if (tab === "vibe") renderVibe();
  else if (tab === "today") renderToday();
  else if (tab === "code") {
    tab = "data";
    document.body.classList.add("comm");
    setStatus("CODING LIVES IN CHAT — ASK PIP TO EDIT THE APP");
    renderData();
  }
  else if (tab === "wx") renderWx();
  else if (tab === "meals") renderMeals();
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

function paintMotiv(forceShader) {
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
  overlay.classList.toggle("sendoff", nxt.kind === "inspire" || nxt.kind === "pip" || nxt.kind === "wake");
  let stem = nxt.vibe || pickShader(line, nxt.kind || "pip", vibeStem).stem;
  if (forceShader || !stem || stem === vibeStem) {
    stem = pickShader(line, nxt.kind || "pip", vibeStem).stem || stem || vibeStem;
  }
  if (stem && (stem !== vibeStem || forceShader)) {
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

async function tapMotiv(auto) {
  if (radioBusy) return;
  radioBusy = true;
  try {
    const nxt = (motivSnap().next || {});
    if (nxt.kind === "wake" && (nxt.id || nxt.slug)) {
      if (auto) return;
      setStatus("WAKE…");
      try {
        await checkWake(db.settings, nxt.id || nxt.slug, nxt.slug);
      } catch (e) {
        setStatus(String(e.message || e).toUpperCase());
      }
      paintMotiv(true);
      setStatus((motivSnap().next || {}).shot || "WAKE DONE");
      if (tab === "today") renderToday();
      armRadio();
      return;
    }
    motivTap();
    paintMotiv(true);
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
    const fit = scoreFit(sel, db.kit);
    const badge = fitLabel(fit.score);
    const answers = sel.answers && sel.answers.length ? sel.answers : (sel.questions || []).map((q) => ({ q: q.prompt || q.q, a: "", a5: "", type: q.type }));
    $("#view").innerHTML = `
      <h3>${esc(sel.title)}</h3>
      <p class="opp-fit ${badge.cls}">${badge.text} · ${fit.score}% · ${esc(stageLabel(sel.app_stage || (sel.questions?.length ? "scraped" : "new")))}</p>
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
      <div class="opp-stages">
        ${APP_STAGES.filter((s) => s.id !== "new").map((s) => `
          <button type="button" class="opp-stage ${sel.app_stage === s.id ? "on" : ""}" data-stage="${esc(s.id)}">${esc(s.label.toUpperCase())}</button>`).join("")}
      </div>
      <div class="dock">
        <button type="button" id="opp-back">BACK</button>
        <button type="button" id="opp-read">READ PAGE</button>
        <button type="button" class="primary" id="opp-draft">DRAFT THIS</button>
        <button type="button" id="opp-open">OPEN FORM</button>
        <button type="button" id="opp-done">ARCHIVE</button>
      </div>`;
    $("#opp-back").onclick = () => { pane = "list"; oppId = ""; render(); };
    $("#opp-read").onclick = readPage;
    $("#opp-draft").onclick = draftThis;
    $("#opp-open").onclick = () => sel.url && openUrl(sel.url);
    $("#opp-done").onclick = async () => {
      sel.status = "done";
      sel.app_stage = sel.app_stage || "submitted";
      await setOppStage(db.settings, db, sel, sel.app_stage);
      persist();
      pane = "list";
      oppId = "";
      render();
    };
    $("#view").querySelectorAll("[data-stage]").forEach((el) => {
      el.onclick = async () => {
        await setOppStage(db.settings, db, sel, el.dataset.stage);
        persist();
        render();
        setStatus(stageLabel(el.dataset.stage).toUpperCase());
      };
    });
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
  const digest = db.opp_digest;
  const digestLine = digest?.summary
    ? `<div class="opp-digest"><b>TODAY</b> ${esc(digest.summary)}${digest.top?.length ? " · " + digest.top.slice(0, 2).map((t) => esc(t.title)).join(" · ") : ""}</div>`
    : "";
  const listed = filterOpps(rows, oppFilter, db.kit);
  $("#view").innerHTML = `
    <h3>OPPORTUNITIES</h3>
    ${digestLine}
    <p class="muted">Indeed-for-artists — Pip hunts real open calls, scrapes the form, drafts from your KIT. You paste. CHAT: <em>search for bass festival VJ calls</em> or paste a URL to scrape.</p>
    <div class="opp-search">
      <div class="field span2"><span>SEARCH / FOCUS</span>
        <input id="opp-q" value="${esc(oppFilter.q)}" placeholder="e.g. public art RFP Oklahoma · VJ festival" />
      </div>
      <div class="opp-chips">${OPP_TYPES.map((t) => `
        <button type="button" class="opp-chip ${oppFilter.type === t.id ? "on" : ""}" data-opp-type="${esc(t.id)}">${esc(t.label)}</button>`).join("")}</div>
    </div>
    <div class="place-row">
      <div class="field"><span>CITY</span><input id="hunt-city" value="${esc(db.kit.city || "")}" placeholder="Edmond" /></div>
      <div class="field"><span>STATE</span><input id="hunt-state" value="${esc(db.kit.state || "")}" placeholder="Oklahoma" /></div>
      <div class="field span2"><span>COUNTRY</span><input id="hunt-country" value="${esc(db.kit.country || "")}" placeholder="United States" /></div>
    </div>
    <div class="field scrape-row"><span>SCRAPE URL</span>
      <div class="scrape-inline">
        <input id="opp-scrape-url" placeholder="https://… apply form" />
        <button type="button" id="opp-scrape-go">SCRAPE</button>
      </div>
    </div>
    ${listed.map((o) => {
      const badge = fitLabel(o.fitScore || 0);
      return `
      <button type="button" class="opp-card" data-id="${esc(o.id)}">
        <b>${esc(o.title)}</b>
        <span class="opp-fit ${badge.cls}">${badge.text}</span>
        <span>${esc(stageLabel(o.app_stage || "new"))} · ${esc(labelOf(o.kind || classify(o.title, o.url, o.questions).id))}${o.questions && o.questions.length ? " · " + o.questions.length + " Q" : " · scrape"}${o.url ? " · " + esc(o.url.slice(0, 36)) : ""}</span>
      </button>`;
    }).join("") || `<p class="muted">Nothing on the desk. SEARCH hunts profile-fit calls. SCRAPE pulls questions from a URL you already found.</p>`}
    <div class="dock">
      <button type="button" class="primary" id="opp-search-go">SEARCH</button>
      <button type="button" id="opp-hunt">HUNT ALL</button>
      <button type="button" id="opp-add">ADD</button>
      ${desktopConfigured(db.settings) ? `<button type="button" id="opp-sync">SYNC</button>` : ""}
    </div>`;
  $("#view").querySelectorAll("[data-id]").forEach((el) => {
    el.onclick = () => { oppId = el.dataset.id; pane = "call"; render(); };
  });
  $("#view").querySelectorAll("[data-opp-type]").forEach((el) => {
    el.onclick = () => {
      oppFilter.type = el.dataset.oppType;
      render();
    };
  });
  const qEl = $("#opp-q");
  if (qEl) qEl.onchange = () => { oppFilter.q = qEl.value.trim(); };
  $("#opp-add").onclick = () => { pane = "add"; render(); };
  $("#opp-search-go").onclick = () => runHunt(false);
  $("#opp-hunt").onclick = () => runHunt(true);
  $("#opp-scrape-go").onclick = scrapeFromBar;
  const syncBtn = $("#opp-sync");
  if (syncBtn) syncBtn.onclick = syncOpps;
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
  paintBrainStrip();
}

function chainChipsHtml() {
  const keyed = cloudStatus(db.settings).keyed || [];
  const rows = describeChain(keyed, providerHealth(), desktopConfigured(db.settings), db.settings.brain_pin);
  return rows
    .map((r) => `<span class="brain-chip ${esc(r.state)}" data-brain="${esc(r.id)}">${esc(r.label)}</span>`)
    .join("");
}

function paintBrainStrip() {
  const html = chainChipsHtml();
  const chat = $("#brain-strip");
  if (chat) chat.innerHTML = html;
  const data = $("#data-chain");
  if (data) data.innerHTML = html;
}

function softRefresh() {
  if (tab === "opp") renderOpp();
  else if (tab === "data") renderData();
  else if (tab === "today") renderToday();
  else if (tab === "meals") renderMeals();
  else if (tab === "vibe" && vibeMode === "motivation") paintMotiv();
  paintBrainStrip();
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
  const morn = morningStatus();
  const wake = wakeNext();
  const brief = getBriefing();
  const wx = morn.weather;
  const wxLine = wx?.ok
    ? `${wx.city || ""} // ${Math.round(wx.temp_f)}F // ${wx.label || ""}`
    : "";
  const moments = topMoments(db, 5);
  root.innerHTML = `
    <div class="today-wrap">
      <div class="today-morning">
        <div class="wx">${esc(wxLine || (desktopConfigured(db.settings) ? "Syncing morning…" : "Local wake · pair desktop for full briefing"))}</div>
        ${wake ? `
          <div class="morning-now">
            <button type="button" id="today-wake" class="shot">${esc(wake.shot || "NOW")}</button>
            <p class="muted">wake · ${morn.done}/${morn.total} · tap when done · or open VIBE</p>
          </div>` : (morn.complete ? `<p class="muted">Wake complete · ${morn.done}/${morn.total}</p>` : "")}
        <div class="brief-card" id="brief-card">
          ${brief?.text
            ? `<div class="doc-body">${esc(brief.text)}</div>`
            : `<p class="muted">${desktopConfigured(db.settings) ? "Listening for morning…" : "Local morning — pair desktop for the full briefing."}</p>`}
        </div>
        <div class="today-strip">
          <button type="button" id="brief-again">AGAIN</button>
          <button type="button" id="morning-sync">SYNC</button>
          <span class="muted">${esc(morn.source === "desktop" ? "DESKTOP" : "PHONE")}</span>
        </div>
      </div>
      <div id="cal-root"></div>
      <div class="story-strip" id="story-strip">
        ${moments.length
          ? `<h3>YOUR STORY</h3>${moments.map((m) => `<p class="story-line">${esc(m.content)}</p>`).join("")}`
          : `<p class="muted">Substantive CHAT lines stick here — goals, origin, why you make things.</p>`}
      </div>
    </div>`;
  paintCalendar();
  const go = $("#today-wake");
  if (go) {
    go.onclick = () => {
      tab = "vibe";
      vibeMode = "motivation";
      render();
    };
  }
  $("#brief-again").onclick = async () => {
    setStatus("MORNING…");
    try {
      await fetchBriefing(db.settings, { force: true });
      renderToday();
      setStatus("BRIEFING READY");
    } catch (e) {
      setStatus(String(e.message || e).toUpperCase());
    }
  };
  $("#morning-sync").onclick = async () => {
    setStatus("SYNC MORNING…");
    try {
      await fullMorningSync(db.settings);
      renderToday();
      setStatus("MORNING SYNCED");
    } catch (e) {
      setStatus(String(e.message || e).toUpperCase());
    }
  };
  if (!brief?.text) {
    fetchBriefing(db.settings, { force: false })
      .then(() => {
        if (tab === "today") renderToday();
      })
      .catch(() => {});
  }
}

async function renderMeals() {
  document.body.classList.remove("comm");
  const paired = desktopConfigured(db.settings);
  const paint = (m, note = "") => {
    const tgt = m.targets || {};
    const rem = (m.remaining && m.remaining.remaining) || {};
    const diet = (tgt.notes || "").trim();
    $("#view").innerHTML = `
    <h3>MEALS</h3>
    <p class="muted">Want-first planning in CHAT — breakfast: oats · lunch: bowl · dinner: stir fry — or REPLAN. Desktop sync merges; never wipes a good local plan.</p>
    ${note ? `<p class="muted">${esc(note)}</p>` : ""}
    <h3>TARGETS</h3>
    <p>KCAL ${tgt.kcal || 0} · P ${tgt.protein_g || 0}g · C ${tgt.carbs_g || 0}g · F ${tgt.fat_g || 0}g</p>
    <p class="muted">Remaining today: ${Math.round(rem.kcal || 0)} kcal / ${Math.round(rem.protein_g || 0)}g protein${diet ? ` · ${esc(diet)}` : ""}</p>
    <h3>WANTED</h3>
    ${(m.wanted || []).map((w) => `
      <div class="row"><span>${esc(w.name)}</span><span class="muted">${w.kcal || 0} kcal <button type="button" class="tiny" data-unwant="${esc(w.id)}">X</button></span></div>
    `).join("") || `<p class="muted">Tell Pip meals you want in CHAT.</p>`}
    <h3>PLAN ${esc(m.plan_date || "")}</h3>
    ${(m.plan || []).map((p) => `
      <div class="row"><span>${esc(p.slot)} · ${esc(p.meal_name)}</span><span class="muted">${p.kcal || 0}</span></div>
      ${p.ingredients ? `<p class="muted meal-ings">${esc(p.ingredients)}</p>` : ""}
    `).join("") || `<p class="muted">No plan for today yet. REPLAN or ask Pip.</p>`}
    <h3>SHOPPING</h3>
    ${(m.shopping || []).map((s) => `
      <label class="check"><input type="checkbox" data-shop="${esc(s.id)}" ${s.checked ? "checked" : ""} /> ${esc(s.name)} ${esc(s.quantity || "")}</label>
    `).join("") || `<p class="muted">Empty until a plan has ingredients.</p>`}
    <div class="actions">
      <button type="button" id="meal-plan" class="primary">REPLAN TODAY</button>
      <button type="button" id="meal-clear">CLEAR TODAY</button>
      <button type="button" id="meal-wclear">CLEAR WANTED</button>
      ${paired ? `<button type="button" id="meal-sync">SYNC DESKTOP</button>` : ""}
    </div>`;
    const bind = () => {
      const planBtn = $("#meal-plan");
      if (planBtn) planBtn.onclick = () => {
        const out = planDay(db);
        persist();
        paint(mealSnapshot(db));
        setStatus(out.ok ? "MEALS PLANNED" : String(out.error || "PLAN FAILED"));
      };
      const clearBtn = $("#meal-clear");
      if (clearBtn) clearBtn.onclick = () => {
        clearDayPlan(db);
        persist();
        paint(mealSnapshot(db));
        setStatus("TODAY CLEARED");
      };
      const wclear = $("#meal-wclear");
      if (wclear) wclear.onclick = () => {
        clearWantedMeals(db);
        persist();
        paint(mealSnapshot(db));
        setStatus("WANTED CLEARED");
      };
      const syncBtn = $("#meal-sync");
      if (syncBtn) syncBtn.onclick = async () => {
        setStatus("MEALS SYNC…");
        paint(mealSnapshot(db), "Syncing from desktop…");
        await syncMealsFromDesktop(db.settings, db).catch(() => {});
        persist();
        paint(mealSnapshot(db));
        setStatus("MEALS SYNCED");
      };
      $("#view").querySelectorAll("[data-unwant]").forEach((el) => {
        el.onclick = () => {
          deleteWantedMeal(db, el.dataset.unwant);
          persist();
          paint(mealSnapshot(db));
        };
      });
      $("#view").querySelectorAll("[data-shop]").forEach((el) => {
        el.onchange = () => {
          setShoppingChecked(db, el.dataset.shop, el.checked);
          persist();
        };
      });
    };
    bind();
  };

  paint(mealSnapshot(db), paired ? "Checking desktop…" : "");
  if (paired) {
    try {
      await syncMealsFromDesktop(db.settings, db);
      persist();
      paint(mealSnapshot(db));
    } catch {
      paint(mealSnapshot(db), "Desktop sync offline — showing local plan.");
    }
  }
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
    persist();
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
  const onDeep = async () => {
    setStatus("DEEP RESEARCH…");
    const meta = panel.querySelector(".wx-meta");
    if (meta) meta.textContent = "Deep scan running (hail + news)…";
    try {
      const deep = await researchPin(db.settings, lat, lon, wxState.address, true);
      wxState.data = deep;
      const f = filterDossier(deep);
      drawHailMarkers(f.hail, f.wind);
      renderDossier(panel, deep, esc, onDeep, onRefetch);
      setStatus("DOSSIER UPDATED");
    } catch (e) {
      panel.innerHTML = `<p class="muted">${esc(String(e.message || e))}. Check network.</p>`;
      setStatus("WX ERROR");
    }
  };
  const onRefetch = async (filters) => {
    const fresh = await refetchDossier(db.settings, lat, lon, wxState.address, filters);
    wxState.data = fresh;
    return fresh;
  };
  try {
    const data = await pinDossier(db.settings, lat, lon, {
      onPartial: (partial) => {
        wxState.address = partial.address || "";
        renderDossier(panel, partial, esc, onDeep, onRefetch);
        setStatus("PINNED · HAIL NEARBY…");
      },
    });
    wxState.address = data.address || "";
    wxState.data = data;
    const f = filterDossier(data);
    drawHailMarkers(f.hail, f.wind);
    renderDossier(panel, data, esc, onDeep, onRefetch);
    setStatus("WX DOSSIER");
  } catch (e) {
    panel.innerHTML = `<p class="muted">${esc(String(e.message || e))}. Check network.</p>`;
    setStatus("WX ERROR");
  }
}

function renderData() {
  const s = db.settings;
  const paired = desktopConfigured(s);
  const securePosture = privacyOn(s);
  const keyed = keyedSummary(s);
  const synced = s.keys_synced_at ? ` · synced ${String(s.keys_synced_at).slice(0, 16).replace("T", " ")}` : "";
  $("#view").innerHTML = `
    <h3>PHONE PIP</h3>
    <p class="muted">Pair once → keys copy onto this phone. Chat: phone keys first (LEAKED) → desktop GPU (private) → local Qwen. Coding lives in CHAT — ask Pip to edit the app. Flip LEAKY for OPP scrapes and in-chat code tools.</p>
    <div class="field"><span>NAME</span><input id="set-op" value="${esc(s.operator || "")}" /></div>
    <div class="field"><span>HUMOR ${esc(s.humor)} · ${Number(s.humor) >= 75 ? "TARS" : "CREW"}</span>
      <input type="range" id="set-humor" min="0" max="100" value="${esc(s.humor)}" />
    </div>
    <div class="field"><span>HONESTY ${esc(s.honesty)}</span>
      <input type="range" id="set-honesty" min="0" max="100" value="${esc(s.honesty)}" />
    </div>
    <h3>DESKTOP</h3>
    <p class="muted">Same Wi‑Fi: Desktop Pip → DATA → set password → TURN ON LAN → FIND + PAIR here. Or paste the LAN URL and PAIR.</p>
    <div class="field"><span>DESKTOP PASSWORD</span><input id="set-dpass" type="password" placeholder="from desktop DATA → PHONE" autocomplete="off" /></div>
    <div class="field"><span>DESKTOP URL</span><input id="set-durl" value="${esc(s.desktop_url || "")}" placeholder="http://192.168.x.x:7420" /></div>
    <div class="actions">
      <button type="button" id="desk-find" class="primary">FIND + PAIR</button>
      <button type="button" id="desk-pair">${paired ? "RE-PAIR" : "PAIR"}</button>
      <button type="button" id="desk-keys">SYNC KEYS</button>
      <button type="button" id="desk-test">TEST</button>
      <button type="button" id="desk-clear">FORGET</button>
    </div>
    <p class="muted" id="desk-msg">${paired ? `Paired · ${esc(s.desktop_url || "")}${synced}` : "Not paired."}</p>
    <label class="check"><input type="checkbox" id="set-keepalive" ${s.keepalive ? "checked" : ""} /> BACKGROUND SYNC (opps + keys when paired)</label>
    <h3>BRAIN</h3>
    <div id="data-chain" class="brain-strip" aria-label="connected APIs"></div>
    <p class="muted">${keyed.length ? `On this phone: ${keyed.join(" · ").toUpperCase()}.` : "No keys yet — pair desktop and tap SYNC KEYS."} CHAT uses these APIs from the phone. Pin LOCAL only for on-device Qwen.</p>
    <div class="field"><span>PIN</span>
      <select id="brain-pin">
        ${["auto", "local", "groq", "openrouter", "cerebras", "mistral", "gemini", "xai"].map((id) => {
          const on = (s.brain_pin || "auto") === id;
          const label = id === "xai" ? "xai (Grok)" : id;
          return `<option value="${id}" ${on ? "selected" : ""}>${label}</option>`;
        }).join("")}
      </select>
    </div>
    ${securePosture ? `<p class="muted">SECURE: OPP scrapes stay limited. CHAT still uses keyed clouds on this phone. In-chat coding needs LEAKY or desktop upgrade.</p>` : `<p class="muted">LEAKY: cloud unlocked for OPP + in-chat coding tools.</p>`}
    <div class="field"><span>GROQ</span><input id="set-groq" type="password" value="${esc(s.groq)}" placeholder="synced from desktop" autocomplete="off" /></div>
    <div class="field"><span>OPENROUTER</span><input id="set-or" type="password" value="${esc(s.openrouter)}" placeholder="synced from desktop" autocomplete="off" /></div>
    <div class="field"><span>CEREBRAS</span><input id="set-cerebras" type="password" value="${esc(s.cerebras)}" placeholder="synced from desktop" autocomplete="off" /></div>
    <div class="field"><span>MISTRAL</span><input id="set-mistral" type="password" value="${esc(s.mistral)}" placeholder="synced from desktop" autocomplete="off" /></div>
    <div class="field"><span>GEMINI</span><input id="set-gemini" type="password" value="${esc(s.gemini)}" placeholder="synced from desktop" autocomplete="off" /></div>
    <div class="field"><span>GROK / XAI</span><input id="set-xai" type="password" value="${esc(s.xai)}" placeholder="synced from desktop" autocomplete="off" /></div>
    <h3>LOCK</h3>
    <p class="muted">Require fingerprint unlock when Pip opens. ${biometricAvailable() ? "Sensor ready on this device." : "Install Pip.apk for native fingerprint."}</p>
    <label class="check"><input type="checkbox" id="set-bio" ${s.biometric_lock ? "checked" : ""} /> BIOMETRIC LOCK</label>
    <h3>UI THEME</h3>
    <p class="muted">Current: ${esc(s.ui_theme_name || "phosphor default")}. CHAT: "phthalo green" or "reset ui theme".</p>
    <div class="actions">
      <button type="button" id="theme-reset" class="primary">RESET THEME</button>
    </div>
    <h3>UPDATE</h3>
    <p class="muted" id="pip-ver">Opens GitHub. Download Pip.apk. Install over this app. KIT stays.</p>
    <div class="actions"><button type="button" id="pip-update">UPDATE PIP</button></div>
    <p class="muted">${hasNativeHttp() ? "Native app: can read public apply pages." : "Browser preview: paste questions if a page blocks the read."}</p>
    <div class="dock"><button type="button" class="primary" id="data-save">SAVE</button></div>`;

  paintBrainStrip();

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
    db.settings.biometric_lock = Boolean($("#set-bio").checked);
    db.settings.keepalive = Boolean($("#set-keepalive")?.checked);
    persist();
  };

  const afterPair = async () => {
    setStatus("SYNCING KEYS…");
    try {
      const out = await pullCloudKeys(db.settings);
      persist();
      setStatus(out.applied ? `KEYS · ${out.keyed.join(" · ").toUpperCase()}` : "PAIRED · NO KEYS ON DESKTOP");
      renderPrivacy();
      paintBrainStrip();
      if (tab === "data") renderData();
    } catch (e) {
      setStatus(`PAIRED · KEY SYNC FAILED · ${String(e.message || e).slice(0, 40)}`);
      renderPrivacy();
    }
  };

  const keepEl = $("#set-keepalive");
  if (keepEl) keepEl.onchange = async () => {
    await toggleKeepAlive(db, keepEl.checked, persist);
    startBackground(db, { persist, setStatus, softRefresh });
    setStatus(keepEl.checked ? "BACKGROUND ON" : "BACKGROUND OFF");
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
        setStatus("SET DESKTOP URL OR FIND");
        return;
      }
      setStatus("PAIRING…");
      try {
        const out = await desktopLogin(db.settings, pass);
        db.settings.desktop_token = out.token || "loopback";
        db.settings.desktop_paired = true;
        persist();
        await afterPair();
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
        persist();
        $("#set-durl").value = out.url;
        await afterPair();
      } catch (e) {
        setStatus(String(e.message || e));
      }
    }).catch((e) => setStatus(String(e.message || e)));
  };

  $("#desk-keys").onclick = () => {
    guardSecrets(db.settings, async () => {
      grabSettings();
      if (!desktopConfigured(db.settings)) {
        setStatus("PAIR DESKTOP FIRST");
        return;
      }
      setStatus("SYNCING KEYS…");
      try {
        const out = await pullCloudKeys(db.settings);
        persist();
        setStatus(out.applied ? `KEYS · ${out.keyed.join(" · ").toUpperCase()}` : "NO KEYS ON DESKTOP");
        renderData();
      } catch (e) {
        setStatus(String(e.message || e).toUpperCase());
      }
    }).catch((e) => setStatus(String(e.message || e)));
  };

  $("#desk-test").onclick = () => {
    grabSettings();
    setStatus("TESTING DESKTOP…");
    desktopStatus(db.settings).then((st) => {
      if (!st.ok) {
        setStatus(st.error || "DESKTOP OFFLINE");
        return;
      }
      const model = (st.ollama && st.ollama.using) || "ollama";
      setStatus(`DESKTOP OK · ${model}`);
      $("#desk-msg").textContent = `Online · auth ${st.auth ? "yes" : "no"} · ${model}${synced}`;
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
      sel.app_stage = "scraped";
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
    sel.app_stage = "drafted";
    sel.updated_at = Date.now();
    persist();
    if (desktopConfigured(db.settings)) fullOppSync(db.settings, db).catch(() => {});
    render();
    const turn = takeLastTurn();
    setStatus(turn.leaked ? "DRAFT READY · LEAKED TO CLOUD · PASTE IT" : "DRAFT READY · GO PASTE IT");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function scrapeFromBar() {
  const url = ($("#opp-scrape-url")?.value || "").trim();
  if (!url) { setStatus("PASTE A URL"); return; }
  setStatus("SCRAPING…");
  try {
    const row = await scrapeOpportunityUrl(url, db.kit, { settings: db.settings });
    const exists = db.opps.find((o) => o.url === row.url);
    if (exists) Object.assign(exists, row, { id: exists.id });
    else db.opps.unshift(row);
    persist();
    oppId = (exists || row).id;
    pane = "call";
    render();
    setStatus(row.questions?.length ? `${row.questions.length} QUESTIONS` : "SCRAPED · PASTE Qs IF NEEDED");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function syncOpps() {
  setStatus("SYNCING DESKTOP…");
  const out = await syncOppsFromDesktop(db.settings, db);
  persist();
  render();
  setStatus(out.ok ? `SYNCED ${out.synced}` : "SYNC FAILED");
}

async function runHunt(allTypes = false) {
  setStatus("HUNTING…");
  try {
    db.kit.city = ($("#hunt-city")?.value || db.kit.city || "").trim();
    db.kit.state = ($("#hunt-state")?.value || db.kit.state || "").trim();
    db.kit.country = ($("#hunt-country")?.value || db.kit.country || "").trim();
    oppFilter.q = ($("#opp-q")?.value || oppFilter.q || "").trim();
    if (allTypes) oppFilter.type = "all";
    persist();
    const { rows: found } = await huntOpportunities(db.settings, db.kit, {
      focus: oppFilter.q,
      type: oppFilter.type,
      onProgress: setStatus,
    });
    const fresh = [];
    let n = 0;
    for (const hit of found) {
      if (hit.url && db.opps.some((o) => o.url === hit.url)) continue;
      const row = newOpp(hit);
      if ((hit.questions || []).length) {
        row.questions = hit.questions;
        row.kind = hit.kind || classify(row.title, row.url, hit.questions).id;
        row.answers = (hit.answers || []).length
          ? hit.answers
          : suggestAnswers(hit.questions, db.kit, row.title, row.kind);
        row.note = hit.note || `${labelOf(row.kind)} · ${hit.questions.length} questions`;
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

function formatChatBody(text) {
  const raw = String(text || "");
  const parts = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(raw))) {
    if (m.index > last) parts.push({ type: "text", v: raw.slice(last, m.index) });
    parts.push({ type: "code", lang: m[1] || "", v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < raw.length) parts.push({ type: "text", v: raw.slice(last) });
  if (!parts.length) return esc(raw);
  return parts
    .map((p) => {
      if (p.type === "code") {
        const lang = p.lang ? `<span class="code-lang">${esc(p.lang)}</span>` : "";
        return `<pre class="chat-code">${lang}<code>${esc(p.v.replace(/\s+$/, ""))}</code></pre>`;
      }
      return `<span class="chat-text">${esc(p.v)}</span>`;
    })
    .join("");
}

function addLog(role, text, opts = {}) {
  const div = document.createElement("div");
  const leaked = Boolean(opts.leaked);
  div.className = `bubble ${role}${leaked ? " leaked" : ""}`;
  const who =
    role === "user"
      ? leaked
        ? `YOU · LEAKED`
        : "YOU"
      : opts.brain
        ? `PIP · ${String(opts.brain).toUpperCase()}`
        : "PIP";
  const meta = [];
  if (opts.tokens) meta.push(`~${opts.tokens} TOK`);
  if (opts.tools && opts.tools.length) meta.push(opts.tools.join(" · "));
  const metaHtml = meta.length ? `<div class="chat-meta">${esc(meta.join(" · "))}</div>` : "";
  const toolsHtml =
    opts.tools && opts.tools.length && !opts.tokens
      ? ""
      : opts.toolLine
        ? `<div class="chat-tools">${esc(opts.toolLine)}</div>`
        : "";
  div.innerHTML = `<div class="who">${esc(who)}</div><div class="body">${formatChatBody(text)}</div>${toolsHtml}${metaHtml}`;
  $("#log").appendChild(div);
  $("#log").scrollTop = $("#log").scrollHeight;
  return div;
}

function updateLogBody(el, text, opts = {}) {
  if (!el) return;
  const body = el.querySelector(".body");
  if (body) body.innerHTML = formatChatBody(text);
  let meta = el.querySelector(".chat-meta");
  const bits = [];
  if (opts.tokens) bits.push(`~${opts.tokens} TOK`);
  if (opts.toolLine) bits.push(opts.toolLine);
  if (bits.length) {
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "chat-meta";
      el.appendChild(meta);
    }
    meta.textContent = bits.join(" · ");
  }
  $("#log").scrollTop = $("#log").scrollHeight;
}

async function runChatCode(text, userBubble) {
  if (codeBusy) {
    addLog("pip", "Still writing the last change — one beat.");
    return;
  }
  codeBusy = true;
  document.body.classList.add("comm");
  const upgrade = wantsDesktopCodeUpgrade(text);
  markBubbleLeaked(userBubble);
  const last = db.chat.filter((m) => m.role === "user").pop();
  if (last) last.leaked = true;
  persist();
  const pipBubble = addLog("pip", upgrade ? "Upgrading phone www on desktop…" : "Reading the app…", {
    brain: upgrade ? "DESKTOP" : "CODE",
  });
  setStatus(upgrade ? "PC PHONE WWW…" : "CODING…");
  let reply = "";
  const tools = [];
  try {
    await consumeCodeStream(
      streamCodeApply(db.settings, { prompt: text, openPath: "", phoneUpgrade: upgrade }),
      {
        onStatus: (ev) => {
          if (ev.model) setStatus(String(ev.model).toUpperCase());
        },
        onDelta: (t) => {
          reply += t;
          updateLogBody(pipBubble, reply, { toolLine: tools.join(" · ") });
        },
        onTool: (ev) => {
          const bit = `${ev.name}${ev.args?.path ? " " + String(ev.args.path).split(/[\\/]/).pop() : ""}`;
          tools.push(bit);
          updateLogBody(pipBubble, reply || "Working…", { toolLine: tools.join(" · ") });
        },
        onWritten: () => {},
        onError: (t) => {
          reply = reply || t;
          updateLogBody(pipBubble, reply, { toolLine: tools.join(" · ") });
        },
        onDone: async (ev) => {
          if (!reply) reply = (ev.written || []).length ? `Wrote ${(ev.written || []).join(", ")}.` : "Done.";
          if (ev.reload) reply += "\n\nRELOAD the app to apply JS/HTML.";
          updateLogBody(pipBubble, reply, { toolLine: tools.join(" · ") });
          setStatus((ev.written || []).length ? `WROTE ${ev.written.length}` : "CODE DONE");
        },
      },
    );
  } catch (e) {
    reply = reply || String(e.message || e);
    updateLogBody(pipBubble, reply, { toolLine: tools.join(" · ") });
    setStatus("CODE ERROR");
  }
  db.chat.push({ role: "pip", content: reply, brain: upgrade ? "desktop" : "code", leaked: true });
  persist();
  codeBusy = false;
}


function markBubbleLeaked(el, reason) {
  if (!el) return;
  el.classList.add("leaked");
  const who = el.querySelector(".who");
  if (who) who.textContent = reason ? `YOU · LEAKED` : "YOU · LEAKED";
}

async function sendChat() {
  const box = $("#input");
  const text = (box.value || "").trim();
  if (!text) return;
  box.value = "";
  db.chat.push({ role: "user", content: text });
  const userBubble = addLog("user", text);
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

  const mealHit = tryMealCommand(text, db);
  if (mealHit) {
    persist();
    addLog("pip", mealHit.reply);
    if (mealHit.switchTab) {
      tab = mealHit.switchTab;
      render();
    }
    setStatus(mealHit.ok ? "MEALS UPDATED" : "MEALS");
    return;
  }

  if (looksLikeCodeRequest(text)) {
    await runChatCode(text, userBubble);
    return;
  }

  const oppHit = await tryOppCommand(text, db, {
    setStatus,
    persist,
    render,
    setOppId: (id) => { oppId = id; },
    setPane: (p) => { pane = p; },
    selected,
    draftThis,
  });
  if (oppHit) {
    if (oppHit.leaked || /scrape|draft|hunt|apply/i.test(oppHit.reply || "")) {
      markBubbleLeaked(userBubble);
      const last = db.chat[db.chat.length - 1];
      if (last && last.role === "user") last.leaked = true;
      persist();
    }
    addLog("pip", oppHit.reply);
    if (oppHit.switchTab) {
      tab = oppHit.switchTab;
      render();
    }
    persist();
    setStatus(oppHit.ok ? "OPP" : "OPP");
    if (oppHit.run) {
      markBubbleLeaked(userBubble);
      await oppHit.run();
      const turn = takeLastTurn();
      if (turn.leaked) markBubbleLeaked(userBubble);
    }
    return;
  }

  try {
    const out = await chat(db.settings, db.chat, text, (msg) => setStatus(msg), db.kit, db);
    const reply = typeof out === "string" ? out : out.text;
    const leaked = typeof out === "object" ? Boolean(out.leaked) : false;
    const provider = typeof out === "object" ? out.provider : "";
    const pending = takePendingTheme();
    if (pending && applyThemePayload(db.settings, pending)) {
      persist();
      render();
      renderPrivacy();
    }
    if (leaked) {
      markBubbleLeaked(userBubble);
      const last = db.chat.filter((m) => m.role === "user").pop();
      if (last) last.leaked = true;
    }
    db.chat.push({
      role: "pip",
      content: reply,
      brain: provider || "",
      leaked,
    });
    rememberReply(db, reply);
    persist();
    const tokens = typeof out === "object" ? Number(out.tokens) || 0 : 0;
    addLog("pip", reply, {
      brain: provider || activeBrain().label,
      leaked: false,
      tokens,
    });
    updateBrainChip();
    const label = (provider || activeBrain().label || "PIP").toUpperCase();
    const tokBit = tokens ? ` · ~${tokens} TOK` : "";
    setStatus((leaked ? `LEAKED · ${label}` : `PRIVATE · ${label}`) + tokBit);
  } catch (e) {
    addLog("pip", String(e.message || e));
    setStatus("CHAT ERROR");
  }
}

function boot() {
  try {
    bootTheme(db.settings);
    applyAllOverlays();
    hydrateHealth(db.settings.brain_health);
    if (db.settings.biometric_lock === undefined) {
      db.settings.biometric_lock = true;
      persist();
    }
    const startUi = () => {
      db.chat.slice(-20).forEach((m) =>
        addLog(m.role === "user" ? "user" : "pip", m.content, {
          leaked: Boolean(m.leaked),
          brain: m.brain || "",
        }),
      );
      if (!db.chat.length) {
        addLog(
          "pip",
          "Pip is happy to help — mentor, friend, agent. Pair desktop in DATA → SYNC KEYS. Ask in chat to plan meals or edit the app.",
        );
      }
      try {
        startBackground(db, { persist, setStatus, softRefresh });
      } catch {
        /* background sync optional */
      }
      if (desktopConfigured(db.settings)) {
        fetchOppDigest(db.settings, db).then(() => { if (tab === "opp") render(); }).catch(() => {});
      }
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
          setStatus(secure ? "LEAKY // CLOUD OK FOR OPP + CHAT CODE" : "SECURE // PREFER LOCAL · CLOUD = LEAKED");
        };
      }
      $("#send").onclick = sendChat;
      $("#input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
      });
      render();
      renderPrivacy();
      paintBrainStrip();
      setStatus("PIP ON DECK");
      const injectNudge = (line) => {
        if (!line) return;
        const last = db.chat[db.chat.length - 1];
        if (last && last.role === "pip" && last.content === line) return;
        db.chat.push({ role: "pip", content: line });
        persist();
        addLog("pip", line);
        setStatus("WAKE");
        softRefresh();
      };
      const runMorning = () => {
        fullMorningSync(db.settings)
          .then(() => softRefresh())
          .catch(() => {});
      };
      runMorning();
      setInterval(() => {
        if (document.hidden) return;
        pingPresence(db.settings).then(injectNudge).catch(() => {});
      }, 20000);
      const cap = window.Capacitor;
      if (cap?.Plugins?.App?.addListener) {
        cap.Plugins.App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) return;
          runMorning();
          pingPresence(db.settings).then(injectNudge).catch(() => {});
        });
      }
      resolveMapCenter(db.settings).then(() => persist()).catch(() => {});
      startWeatherWatch(
        () => resolveMapCenter(db.settings),
        (live) => {
          const line = (live.outlook && live.outlook.line) || "";
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
      const deferProbe = (fn) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 2500 });
        else setTimeout(fn, 80);
      };
      deferProbe(async () => {
        try {
          if (desktopConfigured(db.settings)) {
            try {
              const keys = await pullCloudKeys(db.settings);
              if (keys.applied) {
                persist();
                setStatus(`KEYS · ${keys.keyed.join(" · ").toUpperCase()}`);
                paintBrainStrip();
              } else if (keys.empty) {
                setStatus("PAIRED · NO KEYS ON DESKTOP YET");
              }
            } catch (e) {
              setStatus(String(e.message || e).toUpperCase());
            }
          }
          const hits = await probeKeyed(db.settings);
          db.settings.brain_health = providerHealth();
          persist();
          paintBrainStrip();
          const live = (hits || []).filter((h) => h.ok).map((h) => h.id);
          const keyed = cloudStatus(db.settings).keyed;
          if (keyed.length && live.length) setStatus(`BRAIN · ${live.join(" · ").toUpperCase()}`);
          else if (keyed.length) setStatus("KEYS ON PHONE · PROBE WEAK");
          else if (desktopConfigured(db.settings)) setStatus("PAIRED · TAP SYNC KEYS");
          else setStatus("PIP ON DECK · PAIR DESKTOP");
          if (desktopConfigured(db.settings)) {
            await syncEventsFromDesktop(db.settings, db);
            await syncMealsFromDesktop(db.settings, db);
            persist();
          }
        } catch (e) {
          setStatus(String(e.message || e).toUpperCase());
        }
      });
    };

    requireAppUnlock(db.settings)
      .then(() => startUi())
      .catch(() => {
        /* keep scan overlay + retry; still mount UI underneath */
        startUi();
      });
  } catch (e) {
    const msg = String(e.message || e);
    $("#view").innerHTML = `<h3>PIP ERROR</h3><p class="muted">${esc(msg)}</p>`;
    setStatus("BOOT ERROR");
    console.error(e);
  }
}

boot();
