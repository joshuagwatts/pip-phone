import { load, save, KIT_LABELS } from "./store.js";
import { chat, draftAnswers, pipStatus, activeBrain, cloudStatus, takePendingTheme, takeLastTurn } from "./brain.js";
import { AGENT_META, agentLabel } from "./crew.js";
import { validateKeyed, providerHealth, hydrateHealth, PROVIDERS, keyTag, keyHint, markHealth, clearHealth, normalizeApiKey, parseAgentRelay, agentRelayComplete, compareProviders, parseCrossAgentIntent, isSpent, clearSpent } from "./cloud.js";
import { desktopConfigured, desktopStatus, connectDesktop, normalizeUrl } from "./desktop.js";
import { ensureCloudKeys, pullCloudKeys, keyedSummary } from "./keysync.js";
import { privacyOn } from "./cloud.js";
import { biometricAvailable, guardSecrets, requireAppUnlock } from "./biometric.js";
import { mergeDraft, newOpp, questionsFromPaste, scrapeUrl, suggestAnswers } from "./opp.js";
import { classify, labelOf } from "./kind.js";
import { ingestLinks, needsIngest } from "./digest.js";
import { hasNativeHttp, openUrl, httpLanGet, httpLanPostJson, httpDiag } from "./net.js";
import { openProtonVpn } from "./proton.js";
import { SHADER_ORDER } from "./shaders.js";
import { pickShader, shaderOf, snapshot as motivSnap, tap as motivTap } from "./motivation.js";
import { compile, startLoop, stopLoop, startMic, stopMic, isListening, lose } from "./vibe.js";
import { bootTheme, tryThemeCommand, applyThemePayload, resetTheme, looksLikeThemeRequest } from "./theme.js";
import { captureMoment, topMoments, rememberReply } from "./memory.js";
import { renderCalendar, syncEventsFromDesktop, pushEventToDesktop, ymd, ym } from "./calendar.js";
import { applyAllOverlays } from "./codefs.js";
import { streamCodeApply, consumeCodeStream } from "./code.js";
import { loadMapConfig, mountMap, destroyMap, setMapLayer, renderWxPanels, layerButtons, researchPin, quickPin, drawHailMarkers, resolveMapCenter, renderWeatherBoot, renderRoofDossier, pinDossier, refetchDossier, startWeatherWatch, filterDossier, filterHailRaw, selectStormDate, bindWxLiveControls, bindWxMapExpand, fetchWeatherBundle, paintLiveWeather, renderHourlyTimeline, geocodeAddress, flyToPin, wxLiveControlsHtml, weatherSummaryHtml, collapseHailByDate, setWxPin } from "./wx.js";
import { pickAndIdentify, detectVisionMode, pickImageFile, fileToDataUrl } from "./vision.js";
import { looksLikeCodeRequest, wantsDesktopCodeUpgrade } from "./command.js";
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
} from "./morning.js";
import { pingNudge, markChatUser } from "./nudge.js";

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
const keyCheckTimers = {};

function paintKeyRows() {
  const health = providerHealth();
  for (const p of PROVIDERS) {
    const input = document.querySelector(`.key-row input[data-field="${p.field}"]`);
    const row = input?.closest(".key-row");
    if (!row) continue;
    const info = keyTag(db.settings, p, health[p.id]);
    row.className = `key-row ${info.state}`;
    const tag = row.querySelector(".key-tag");
    if (tag) {
      const hint = keyHint(db.settings, p);
      tag.textContent = hint ? `${info.tag} · ${hint}` : info.tag;
    }
  }
}

/** Wipe a pasted API key from memory — block desktop from refilling until user pastes again. */
function clearProviderKey(field) {
  if (!field) return;
  clearTimeout(keyCheckTimers[field]);
  db.settings[field] = "";
  db.settings[`${field}_cleared`] = Date.now();
  const prov = PROVIDERS.find((p) => p.field === field);
  if (prov) {
    clearHealth(prov.id);
    clearSpent(prov.id);
    if (db.settings.brain_health && typeof db.settings.brain_health === "object") {
      delete db.settings.brain_health[prov.id];
    }
    const pin = String(db.settings.brain_pin || "auto").toLowerCase();
    const agent = String(db.settings.chat_agent || "pip").toLowerCase();
    if (pin === prov.id) db.settings.brain_pin = "auto";
    if (agent === prov.id) setChatAgent("pip", true);
  }
  persist();
  setStatus(`CLEARED · ${String(field).toUpperCase()}`);
  renderPrivacy();
  paintBrainStrip();
  renderData();
}

function queueKeyValidate(field) {
  clearTimeout(keyCheckTimers[field]);
  keyCheckTimers[field] = setTimeout(async () => {
    const prov = PROVIDERS.find((p) => p.field === field);
    const key = normalizeApiKey(db.settings[field]);
    if (!prov || !key) return;
    clearHealth(prov.id);
    clearSpent(prov.id);
    if (db.settings.brain_health && typeof db.settings.brain_health === "object") {
      delete db.settings.brain_health[prov.id];
    }
    paintBrainStrip();
    paintKeyRows();
    try {
      db.settings[field] = key;
      await validateKeyed(db.settings, { only: prov.id });
      db.settings.brain_health = providerHealth();
      persist();
      paintBrainStrip();
      paintKeyRows();
    } catch {
      /* ignore */
    }
  }, 450);
}
/** Pending chat image (data URL) — attach staple or paste. */
let pendingChatImage = null;
let wxState = { lat: null, lon: null, address: "", data: null };
let wxWatch = null;

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

function leaveWx() {
  if (wxWatch && typeof wxWatch.stop === "function") {
    wxWatch.stop();
    wxWatch = null;
  }
  destroyMap();
}

function render() {
  if (tab === "guide") tab = "opp";
  document.body.classList.toggle("vibe-tab", tab === "vibe");
  document.body.classList.toggle("wx-tab", tab === "wx");
  $("#tabs").querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab !== "vibe") leaveVibe();
  if (tab !== "wx") leaveWx();
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
    chip.hidden = true;
  }
}

function chatAgent() {
  return String(db.settings.chat_agent || "pip").toLowerCase();
}

function setChatAgent(id, silent = false) {
  const next = String(id || "pip").toLowerCase();
  db.settings.chat_agent = next;
  if (next === "pip" || next === "auto") db.settings.brain_pin = "auto";
  else if (next === "compare") db.settings.brain_pin = "compare";
  else db.settings.brain_pin = next;
  persist();
  paintBrainStrip();
  if (!silent) {
    const meta = AGENT_META[next] || { label: agentLabel(next), blurb: "" };
    setStatus(`AGENT · ${meta.label}`);
  }
}

function tryAgentSwitch(text) {
  const t = String(text || "").trim();
  const m = t.match(
    /^\s*(?:talk to|switch to|use|ask)\s+(pip|auto|compare|groq|openrouter|cerebras|mistral|gemini|grok|xai|deepseek|openai|chatgpt|claude|anthropic|haiku|sonnet|desktop)\b\s*$/i,
  );
  if (!m) return null;
  let id = m[1].toLowerCase();
  if (id === "grok") id = "xai";
  if (id === "chatgpt") id = "openai";
  if (id === "claude" || id === "haiku" || id === "sonnet") id = "anthropic";
  if (id !== "pip" && id !== "auto" && id !== "desktop" && id !== "compare") {
    const keyed = cloudStatus(db.settings).keyed || [];
    if (!keyed.includes(id)) {
      return { ok: false, reply: `No ${agentLabel(id)} key yet. DATA → paste key, then pick ${agentLabel(id)}.` };
    }
    if (isSpent(id)) {
      return { ok: false, reply: `${agentLabel(id)} is maxed (quota/rate limit). Pick another brain or wait a bit.` };
    }
  }
  if (id === "desktop" && !desktopConfigured(db.settings)) {
    return { ok: false, reply: "Desktop isn't paired. DATA → CONNECT first." };
  }
  setChatAgent(id);
  const meta = AGENT_META[id] || { label: agentLabel(id), blurb: "" };
  return {
    ok: true,
    reply:
      id === "pip"
        ? "Pip on — your personal consultant. Crew listens; one brain underwrites the answer. Fit over speed."
        : id === "compare"
          ? "COMPARE on — every keyed API answers; one bubble with tabs + overview."
          : id === "auto"
            ? "AUTO on — efficient cascade. Fast/cheap first, light voice, no Pip theater."
            : `You're with ${meta.label}. ${meta.blurb || "Their voice, not Pip's."}`,
  };
}

function updateBrainChip() {
  renderPrivacy();
  paintBrainStrip();
}

function agentPickTick(kind = "tick") {
  try {
    const H = window.Capacitor?.Plugins?.Haptics;
    if (H?.impact) {
      H.impact({ style: kind === "ok" ? "MEDIUM" : "LIGHT" });
      return;
    }
  } catch {
    /* ignore */
  }
  if (navigator.vibrate) navigator.vibrate(kind === "ok" ? [12, 30, 18] : 14);
}

function agentOptions() {
  const keyed = new Set(cloudStatus(db.settings).keyed || []);
  const active = chatAgent();
  const modes = [
    { id: "pip", section: "modes" },
    { id: "auto", section: "modes" },
    { id: "compare", section: "modes" },
  ];
  const apis = [];
  for (const id of ["anthropic", "groq", "openrouter", "gemini", "cerebras", "deepseek", "openai", "mistral", "xai"]) {
    if (keyed.has(id)) apis.push({ id, section: "apis" });
  }
  if (desktopConfigured(db.settings)) apis.push({ id: "desktop", section: "apis" });
  const opts = [...modes, ...apis];
  // Only show the active agent if it is keyed (or a mode like pip/auto/compare).
  if (active && !opts.some((o) => o.id === active) && (active === "pip" || active === "auto" || active === "compare" || active === "desktop" || keyed.has(active))) {
    opts.push({ id: active, section: "apis", missing: !keyed.has(active) && active !== "desktop" });
  }
  return { opts, keyed, active, health: providerHealth() };
}

function agentStatFor(id, { keyed, health, missing }) {
  if (id === "pip" || id === "auto" || id === "compare") {
    return {
      cls: "mode",
      text: id === "compare" ? "ALL" : id === "auto" ? "FAST" : "CONSULT",
    };
  }
  if (missing || !keyed.has(id)) return { cls: "bad", text: "NO KEY" };
  if (isSpent(id)) return { cls: "bad", text: "MAXED" };
  const ok = health[id]?.ok;
  if (ok === true) return { cls: "live", text: "LIVE" };
  if (ok === false) return { cls: "bad", text: "FAIL" };
  return { cls: "key", text: "KEYED" };
}

function closeAgentSheet() {
  const sheet = $("#agent-sheet");
  const trig = $("#agent-trig");
  if (!sheet || sheet.hidden) return;
  sheet.classList.remove("open");
  if (trig) {
    trig.classList.remove("open");
    trig.setAttribute("aria-expanded", "false");
  }
  window.clearTimeout(closeAgentSheet._t);
  closeAgentSheet._t = window.setTimeout(() => {
    sheet.hidden = true;
  }, 220);
}

function openAgentSheet() {
  fillAgentPick();
  const sheet = $("#agent-sheet");
  const trig = $("#agent-trig");
  if (!sheet) return;
  window.clearTimeout(closeAgentSheet._t);
  sheet.hidden = false;
  // Force reflow so open transition plays.
  void sheet.offsetWidth;
  sheet.classList.add("open");
  if (trig) {
    trig.classList.add("open");
    trig.setAttribute("aria-expanded", "true");
  }
  agentPickTick("tick");
}

function fillAgentPick() {
  const lab = $("#agent-trig-lab");
  const list = $("#agent-sheet-list");
  const { opts, keyed, active, health } = agentOptions();
  if (lab) lab.textContent = agentLabel(active);
  if (!list) return;
  const chunks = [];
  let lastSec = "";
  for (const o of opts) {
    const sec = o.section === "modes" ? "modes" : "apis";
    if (sec !== lastSec) {
      lastSec = sec;
      chunks.push(
        `<div class="agent-sec">${sec === "modes" ? "MODES" : "KEYED APIS"}</div>`,
      );
    }
    const meta = AGENT_META[o.id] || { label: agentLabel(o.id), blurb: "" };
    const stat = agentStatFor(o.id, { keyed, health, missing: !!o.missing });
    const on = o.id === active;
    const blurb = o.missing ? "Key missing — paste in DATA" : meta.blurb || "";
    chunks.push(`
      <button type="button" class="agent-row${on ? " on" : ""}${o.missing ? " dim" : ""}" data-agent="${esc(o.id)}">
        <span class="agent-row-mark" aria-hidden="true"></span>
        <span class="agent-row-body">
          <span class="agent-row-name">${esc(meta.label || agentLabel(o.id))}</span>
          <span class="agent-row-blurb">${esc(blurb)}</span>
        </span>
        <span class="agent-row-stat ${esc(stat.cls)}">${esc(stat.text)}</span>
      </button>`);
  }
  list.innerHTML = chunks.join("");
  list.querySelectorAll("[data-agent]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.agent;
      setChatAgent(id);
      agentPickTick("ok");
      fillAgentPick();
      closeAgentSheet();
    };
  });
  if (!fillAgentPick._bound) {
    fillAgentPick._bound = true;
    const trig = $("#agent-trig");
    const bg = $("#agent-sheet-bg");
    const done = $("#agent-sheet-close");
    if (trig) {
      trig.onclick = () => {
        const sheet = $("#agent-sheet");
        if (sheet && !sheet.hidden && sheet.classList.contains("open")) closeAgentSheet();
        else openAgentSheet();
      };
    }
    if (bg) bg.onclick = () => closeAgentSheet();
    if (done) done.onclick = () => closeAgentSheet();
  }
}

function dataChainHtml() {
  const keyed = cloudStatus(db.settings).keyed || [];
  const health = providerHealth();
  if (!keyed.length) return `<span class="brain-chip off">NO KEYS</span>`;
  return keyed
    .map((id) => {
      const ok = health[id]?.ok;
      const state = ok === true ? "on" : ok === false ? "bad" : "key";
      return `<span class="brain-chip ${state}">${esc(agentLabel(id))}</span>`;
    })
    .join("");
}

function paintBrainStrip() {
  fillAgentPick();
  const data = $("#data-chain");
  if (data) data.innerHTML = dataChainHtml();
}

function softRefresh() {
  if (tab === "opp") renderOpp();
  else if (tab === "data") {
    const ae = document.activeElement;
    const editing = ae && ae.closest && ae.closest("#view") && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    if (editing) paintBrainStrip();
    else renderData();
  } else if (tab === "today") renderToday();
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
  leaveWx();
  setStatus("");
  $("#view").innerHTML = `
    <div class="wx-wrap">
      <form class="wx-search" id="wx-search" autocomplete="off">
        <input type="search" id="wx-addr-q" placeholder="Address or place…" enterkeyhint="search" />
        <button type="submit" class="primary">GO</button>
      </form>
      <div class="wx-layers" id="wx-layers"></div>
      <div id="wx-panel" class="wx-panel"><p class="muted">Locating…</p></div>
      <div class="wx-map-shell" id="wx-map-shell">
        <span class="wx-map-hint">DOUBLE-TAP · EXPAND MAP</span>
        <div id="wx-map"></div>
      </div>
      <div id="wx-roof-panel" class="wx-roof-panel"></div>
    </div>`;
  const refreshLayers = (cfg) => {
    const el = $("#wx-layers");
    if (!el || !cfg) return;
    el.innerHTML = layerButtons(cfg, esc) + wxLiveControlsHtml();
    bindWxLiveControls(document);
  };
  try {
    const center = await resolveMapCenter(db.settings);
    if (tab !== "wx") return;
    persist();
    const cfg = await loadMapConfig(db.settings);
    if (tab !== "wx") return;
    cfg.center = { ...cfg.center, ...center };
    refreshLayers(cfg);
    $("#wx-layers").onclick = (e) => {
      const b = e.target.closest("button[data-layer]");
      if (!b) return;
      const id = b.dataset.layer;
      const isWx = b.classList.contains("wx-product") || b.classList.contains("overlay");
      setMapLayer(id);
      if (isWx) {
        $("#wx-layers").querySelectorAll("button.wx-product, button.overlay").forEach((x) => x.classList.toggle("on", x === b));
        refreshLayers(cfg);
      } else {
        $("#wx-layers").querySelectorAll("button[data-layer]:not(.wx-product):not(.overlay)").forEach((x) => x.classList.toggle("on", x === b));
      }
    };
    mountMap($("#wx-map"), cfg, { center, onTap: onWxTap });
    bindWxMapExpand($("#wx-map-shell"));
    bindWxLiveControls(document);
    const searchForm = $("#wx-search");
    if (searchForm) {
      searchForm.onsubmit = async (e) => {
        e.preventDefault();
        const q = ($("#wx-addr-q")?.value || "").trim();
        if (!q) return;
        setStatus("GEOCODING…");
        try {
          const hits = await geocodeAddress(q);
          const hit = hits[0];
          if (!hit || !Number.isFinite(hit.lat)) throw new Error("no match");
          flyToPin(hit.lat, hit.lon, 14);
          setStatus(`PINNED · ${String(hit.city || hit.address || q).slice(0, 40)}`);
          await onWxTap(hit.lat, hit.lon);
        } catch (err) {
          setStatus(String(err.message || err).slice(0, 48).toUpperCase());
        }
      };
    }
    wxWatch = startWeatherWatch(
      () => (tab === "wx" ? resolveMapCenter(db.settings) : Promise.resolve(null)),
      (live) => {
        if (tab !== "wx") return;
        const line = (live.outlook && live.outlook.line) || "";
        if (!line) return;
        const nws = (live.alerts || []).slice(0, 2).map((a) => a.event).filter(Boolean);
        const msg = nws.length ? `${line} ${nws.join(". ")}.` : line;
        window.__pipWxLine = msg;
        setStatus("WX ALERT");
        const panel = $("#wx-panel");
        if (panel && !panel.querySelector(".wx-alert")) {
          const div = document.createElement("div");
          div.className = "wx-alert";
          div.textContent = msg;
          panel.prepend(div);
        }
      },
    );
    quickPin(db.settings, center.lat, center.lon).then(async (hit) => {
      if (tab !== "wx") return;
      selectStormDate(null, { fit: false });
      const data = {
        ...hit,
        lat: hit.lat ?? center.lat,
        lon: hit.lon ?? center.lon,
        address: hit.address || hit.geo?.address || "",
      };
      renderWeatherBoot($("#wx-panel"), hit.geo, hit.weather || cfg.weather, hit.hail, esc);
      renderRoofDossier($("#wx-roof-panel"), data, esc, null, null);
      try {
        const bundle = await fetchWeatherBundle(center.lat, center.lon);
        const panel = $("#wx-panel");
        paintLiveWeather(panel, bundle, collapseHailByDate(hit.hail || []), esc);
      } catch {
        /* optional */
      }
    }).catch(() => {
      if (tab !== "wx") return;
      $("#wx-panel").innerHTML = `<p class="muted">Search an address or tap the map for storm dossier.</p>`;
    });
  } catch (e) {
    if (tab !== "wx") return;
    $("#view").innerHTML = `<p class="muted">${esc(String(e.message || e))}</p>`;
  }
}

async function onWxTap(lat, lon) {
  wxState.lat = lat;
  wxState.lon = lon;
  setWxPin(lat, lon);
  selectStormDate(null, { fit: false });
  setStatus("PINNED · ADDRESS…");
  const panel = $("#wx-panel");
  const roofPanel = $("#wx-roof-panel");
  const paintHail = (data) => {
    const f = filterDossier(data);
    drawHailMarkers(filterHailRaw(data), f.wind, { fit: false });
  };
  const renderPanels = (d) => renderWxPanels(d, esc, onDeep, onRefetch);
  const onDeep = async () => {
    setStatus("DEEP RESEARCH…");
    const meta = roofPanel?.querySelector(".wx-meta");
    if (meta) meta.textContent = "Deep scan running (hail zones + news)…";
    try {
      const deep = await researchPin(db.settings, lat, lon, wxState.address, true);
      wxState.data = deep;
      paintHail(deep);
      renderPanels(deep);
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
        renderPanels(partial);
        setStatus("PINNED · HAIL NEARBY…");
      },
    });
    wxState.address = data.address || "";
    wxState.data = data;
    paintHail(data);
    renderPanels(data);
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
  const health = providerHealth();
  const deskLive = s.desktop_live;
  const deskLine = !paired
    ? "Not linked — tap CONNECT."
    : deskLive === true
      ? `ONLINE · ${s.desktop_url || ""}`
      : deskLive === false
        ? `OFFLINE · ${s.desktop_url || ""}`
        : `Paired · ${s.desktop_url || ""} · tap CONNECT`;

  const keyRows = PROVIDERS.map((p) => {
    const info = keyTag(s, p, health[p.id]);
    const hint = keyHint(s, p);
    const has = Boolean(normalizeApiKey(s[p.field]));
    const get = p.keyUrl
      ? `<a class="key-get" href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">GET KEY</a>`
      : "";
    const ph = has ? `paste to replace · ${hint || "••••"}` : "paste key — saves as you type";
    return `<div class="key-row ${esc(info.state)}">
      <div class="key-meta">
        <span class="key-name">${esc(p.label.toUpperCase())}</span>
        <span class="key-tag">${esc(info.tag)}${hint ? ` · ${esc(hint)}` : ""}</span>
      </div>
      <p class="muted key-tip">${esc(p.tip || "")} ${get}${has ? ` · <button type="button" class="key-clear" data-field="${esc(p.field)}">CLEAR</button>` : ""}</p>
      <input id="set-${esc(p.field)}" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="" placeholder="${esc(ph)}" data-keep="${has ? "1" : "0"}" data-field="${esc(p.field)}" />
    </div>`;
  }).join("");

  const keyedNow = PROVIDERS.filter((p) => normalizeApiKey(s[p.field])).map((p) => p.label.toUpperCase());
  const diag = httpDiag();
  const httpLine = `HTTP: ${diag.nativeHttp ? "NATIVE OK" : "NO NATIVE — cloud may fail"} · ${diag.platform}`;

  const pinModes = ["auto", "compare", "desktop", "lite", "local", "qwen"];
  const pinKeyed = ["anthropic", "groq", "openrouter", "cerebras", "deepseek", "openai", "mistral", "gemini", "xai"].filter((id) =>
    String(s[id] || "").trim(),
  );
  const pinIds = [...pinModes, ...pinKeyed];
  if ((s.brain_pin || "auto") && !pinIds.includes(s.brain_pin)) pinIds.push(s.brain_pin);

  $("#view").innerHTML = `
    <h3>PHONE PIP</h3>
    <p class="muted">Pair desktop for private GPU. Paste cloud keys below — they save as you type. Bad keys turn red automatically.</p>
    <div class="field"><span>NAME</span><input id="set-op" value="${esc(s.operator || "")}" /></div>
    <div class="field"><span>HUMOR ${esc(s.humor)} · ${Number(s.humor) >= 75 ? "TARS" : "CREW"}</span>
      <input type="range" id="set-humor" min="0" max="100" value="${esc(s.humor)}" />
    </div>
    <div class="field"><span>HONESTY ${esc(s.honesty)}</span>
      <input type="range" id="set-honesty" min="0" max="100" value="${esc(s.honesty)}" />
    </div>

    <h3>DESKTOP GPU</h3>
    <p class="muted">Same Wi‑Fi. Tap CONNECT (scans your whole subnet). If it fails: desktop DATA → COPY URL → paste below → CONNECT. Windows may need Open-Firewall.bat once.</p>
    <div class="desk-status ${paired ? (deskLive === false ? "bad" : deskLive === true ? "on" : "key") : "off"}" id="desk-status">${esc(deskLine)}</div>
    <div class="field"><span>DESKTOP URL (optional)</span><input id="set-durl" value="${esc(s.desktop_url || "")}" placeholder="blank = auto-find · or http://192.168.x.x:7420" /></div>
    <div class="actions">
      <button type="button" id="desk-connect" class="primary">CONNECT</button>
      <button type="button" id="desk-clear">FORGET</button>
    </div>
    <p class="muted" id="desk-msg">${esc(deskLine)}</p>
    <h3>PROTON VPN</h3>
    <p class="muted">Keep Proton on. Enable <strong>Allow LAN connections</strong> in Proton (Settings → Features). Then CONNECT works without turning VPN off.</p>
    <div class="actions">
      <button type="button" id="proton-open">OPEN PROTON</button>
    </div>
    <label class="check"><input type="checkbox" id="set-keepalive" ${s.keepalive ? "checked" : ""} /> BACKGROUND OPP SYNC</label>

    <h3>BRAIN KEYS</h3>
    <div id="data-chain" class="brain-strip" aria-label="connected APIs"></div>
    <p class="muted" id="keys-memory">${keyedNow.length ? `IN MEMORY: ${esc(keyedNow.join(" · "))}` : "NO KEYS IN MEMORY — paste below"}</p>
    <p class="muted">${esc(httpLine)}</p>
    <div class="actions">
      ${paired ? `<button type="button" id="keys-sync">SYNC FROM DESKTOP</button>` : ""}
    </div>
    <p class="muted">Paste keys below (save as you type). Who you talk to = agent chip next to LENS in CHAT.</p>
    <div class="field"><span>PIN (power override)</span>
      <select id="brain-pin">
        ${pinIds.map((id) => {
          const on = (s.brain_pin || "auto") === id;
          const label =
            id === "xai"
              ? "xai (Grok)"
              : id === "desktop"
                ? "desktop GPU"
                : id === "lite" || id === "local"
                  ? "pip lite (guide)"
                  : id === "qwen"
                    ? "qwen (slow)"
                    : id === "compare"
                      ? "compare (keyed only)"
                      : id === "auto"
                        ? "auto (CHAT dropdown decides)"
                        : id;
          return `<option value="${id}" ${on ? "selected" : ""}>${label}</option>`;
        }).join("")}
      </select>
    </div>
    ${securePosture
      ? `<p class="muted">SECURE: OPP/vision scrapes limited · chat still uses pasted keys when present · desktop if no keys.</p>`
      : `<p class="muted">LEAKY: cloud hierarchy speaks as Pip first · desktop only if PIN=desktop or no keys.</p>`}
    <div class="key-list">${keyRows}</div>

    <h3>LOCK</h3>
    <p class="muted" id="bio-help">Press & hold the phosphor print until the ring fills. Pip-themed lock — no Android popup.</p>
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
    const pinNow = String(db.settings.brain_pin || "auto").toLowerCase();
    if (pinNow === "auto") db.settings.chat_agent = db.settings.chat_agent || "pip";
    else if (["compare", "desktop", "auto", "groq", "openrouter", "cerebras", "deepseek", "openai", "mistral", "gemini", "xai", "anthropic"].includes(pinNow)) {
      db.settings.chat_agent = pinNow;
    }
    for (const p of PROVIDERS) {
      const el = $(`#set-${p.field}`);
      if (!el) continue;
      const v = normalizeApiKey(el.value);
      // Blank field = keep existing key (so re-open DATA doesn't wipe).
      if (v) {
        db.settings[p.field] = v;
        clearSpent(p.id);
      }
    }
    if (PROVIDERS.some((p) => String(db.settings[p.field] || "").trim()) && privacyOn(db.settings)) {
      setStatus("KEYS SAVED · TAP LEAKY TO USE CLOUD");
    }
    db.settings.desktop_url = normalizeUrl($("#set-durl").value.trim());
    if ($("#set-durl")) $("#set-durl").value = db.settings.desktop_url;
    db.settings.biometric_lock = Boolean($("#set-bio").checked);
    db.settings.keepalive = Boolean($("#set-keepalive")?.checked);
    persist();
  };

  // Save API keys as you type — don't wait for SAVE / biometric.
  for (const p of PROVIDERS) {
    const el = $(`#set-${p.field}`);
    if (!el) continue;
    el.addEventListener("input", () => {
      const v = normalizeApiKey(el.value);
      if (!v) return;
      delete db.settings[`${p.field}_cleared`];
      db.settings[p.field] = v;
      clearHealth(p.id);
      clearSpent(p.id);
      if (db.settings.brain_health && typeof db.settings.brain_health === "object") {
        delete db.settings.brain_health[p.id];
      }
      persist();
      const mem = $("#keys-memory");
      const names = PROVIDERS.filter((x) => String(db.settings[x.field] || "").trim()).map((x) => x.label.toUpperCase());
      if (mem) mem.textContent = names.length ? `IN MEMORY: ${names.join(" · ")}` : "NO KEYS IN MEMORY — paste below";
      renderPrivacy();
      paintBrainStrip();
      queueKeyValidate(p.field);
    });
  }

  const setDeskMsg = (text, cls) => {
    const msg = $("#desk-msg");
    const st = $("#desk-status");
    if (msg) msg.textContent = text;
    if (st) {
      st.textContent = text;
      st.className = `desk-status ${cls || ""}`;
    }
  };

  const runConnect = async () => {
    grabSettings();
    setStatus("CONNECTING…");
    setDeskMsg("Connecting…", "key");
    try {
      const out = await connectDesktop(db.settings, (msg) => setStatus(msg));
      persist();
      if ($("#set-durl")) $("#set-durl").value = out.url;
      const model = String(out.model || "ollama").toUpperCase();
      const ok = out.ping && out.ping.ok;
      db.settings.desktop_live = true;
      persist();
      let keyBit = "";
      try {
        const sync = await ensureCloudKeys(db.settings, { force: true, replace: false });
        if (sync.applied) {
          keyBit = ` · ${sync.applied} KEY${sync.applied > 1 ? "S" : ""}`;
          persist();
          renderPrivacy();
        }
      } catch {
        /* keys optional */
      }
      setDeskMsg(ok ? `ONLINE · GPU OK · ${model}${keyBit}` : `ONLINE · GPU WEAK · ${model}${keyBit}`, "on");
      setStatus(ok ? `GPU OK · ${model}${keyBit}` : `CONNECTED · ${model}${keyBit}`);
      paintBrainStrip();
    } catch (e) {
      db.settings.desktop_live = false;
      persist();
      const msg = String(e.message || e);
      setDeskMsg(msg.slice(0, 90), "bad");
      setStatus(msg.toUpperCase().slice(0, 80));
      paintBrainStrip();
    }
  };

  const deskConnect = $("#desk-connect");
  if (deskConnect) {
    deskConnect.onclick = () => {
      guardSecrets(db.settings, runConnect).catch((e) => setStatus(String(e.message || e)));
    };
  }

  const protonOpen = $("#proton-open");
  if (protonOpen) {
    protonOpen.onclick = async () => {
      setStatus("OPENING PROTON…");
      const ok = await openProtonVpn();
      setStatus(ok ? "PROTON · TURN ON ALLOW LAN CONNECTIONS" : "INSTALL PROTON VPN FROM PLAY STORE");
    };
  }

    $("#desk-clear").onclick = () => {
    db.settings.desktop_token = "";
    db.settings.desktop_password = "";
    db.settings.desktop_paired = false;
    db.settings.desktop_live = null;
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

  biometricAvailable().then(() => {
    const lockP = $("#bio-help");
    if (lockP) {
      lockP.textContent = "Press & hold the phosphor print until the ring fills. Pip-themed lock — no Android popup.";
    }
  }).catch(() => {});

  document.querySelectorAll(".key-get").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const href = a.getAttribute("href");
      if (href) openUrl(href, { system: true }).catch(() => window.open(href, "_blank"));
    });
  });

  const saveBtn = $("#data-save");
  if (saveBtn) {
    saveBtn.onclick = () => {
      guardSecrets(db.settings, () => {
        grabSettings();
        setStatus("SAVED");
        updateBrainChip();
        paintBrainStrip();
        validateKeyed(db.settings).then(() => {
          db.settings.brain_health = providerHealth();
          persist();
          paintBrainStrip();
          paintKeyRows();
        });
        renderData();
      }).catch((e) => setStatus(String(e.message || e)));
    };
  }

  const themeResetBtn = $("#theme-reset");
  if (themeResetBtn) {
    themeResetBtn.onclick = () => {
      resetTheme(db.settings);
      persist();
      renderData();
      renderPrivacy();
      setStatus("THEME RESET · PHOSPHOR GREEN");
    };
  }

  const keysSyncBtn = $("#keys-sync");
  if (keysSyncBtn) {
    keysSyncBtn.onclick = async () => {
      grabSettings();
      setStatus("SYNCING KEYS…");
      try {
        const out = await pullCloudKeys(db.settings, { replace: true });
        persist();
        renderPrivacy();
        paintBrainStrip();
        const n = out.applied || keyedSummary(db.settings).length;
        if (n) await validateKeyed(db.settings);
        db.settings.brain_health = providerHealth();
        persist();
        setStatus(n ? `SYNCED ${n} KEY${n > 1 ? "S" : ""}` : "DESKTOP HAS NO KEYS — paste on PC DATA first");
        renderData();
      } catch (e) {
        setStatus(String(e.message || e).toUpperCase().slice(0, 80));
      }
    };
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

function formatInlineMd(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code class=\"chat-inline\">$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  return t;
}

/** Markdown-ish → HTML (lists, headers, bold) so compare tabs aren't raw ** walls. */
function formatMdBlocks(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let list = null;
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushList();
      const n = h[1].length;
      out.push(`<h${n} class="chat-h">${formatInlineMd(h[2])}</h${n}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.+)$/);
    if (ul) {
      if (!list || list.tag !== "ul") {
        flushList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(`<li>${formatInlineMd(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ol) {
      if (!list || list.tag !== "ol") {
        flushList();
        list = { tag: "ol", items: [] };
      }
      list.items.push(`<li>${formatInlineMd(ol[1])}</li>`);
      continue;
    }
    flushList();
    if (!line.trim()) {
      out.push("<br/>");
      continue;
    }
    out.push(`<p class="chat-p">${formatInlineMd(line)}</p>`);
  }
  flushList();
  return out.join("");
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
  if (!parts.length) return `<div class="chat-md">${formatMdBlocks(raw)}</div>`;
  return parts
    .map((p) => {
      if (p.type === "code") {
        const lang = p.lang ? `<span class="code-lang">${esc(p.lang)}</span>` : "";
        return `<pre class="chat-code">${lang}<code>${esc(p.v.replace(/\s+$/, ""))}</code></pre>`;
      }
      return `<div class="chat-md">${formatMdBlocks(p.v)}</div>`;
    })
    .join("");
}

function routeKind(opts = {}) {
  if (opts.local || opts.provider === "lite" || opts.provider === "qwen") return "local";
  if (opts.leaked) return "leaked";
  if (opts.route) return opts.route;
  return "secure";
}

function routePillHtml(kind) {
  if (!kind) return "";
  const label = kind === "leaked" ? "LEAKED" : kind === "local" ? "LOCAL" : "SECURE";
  return `<span class="route-pill ${kind}"><span class="route-dot" aria-hidden="true"></span>${label}</span>`;
}

function markBubbleRoute(el, kind) {
  if (!el || !kind) return;
  el.dataset.route = kind;
  let row = el.querySelector(".who-row");
  if (!row) {
    const who = el.querySelector(".who");
    if (!who) return;
    row = document.createElement("div");
    row.className = "who-row";
    who.replaceWith(row);
    row.appendChild(who);
  }
  const old = row.querySelector(".route-pill");
  if (old) old.remove();
  row.insertAdjacentHTML("beforeend", routePillHtml(kind));
}

function addLog(role, text, opts = {}) {
  const div = document.createElement("div");
  const route =
    role === "user"
      ? opts.route || (opts.leaked ? "leaked" : opts.local ? "local" : opts.secure ? "secure" : "")
      : routeKind(opts);
  div.className = `bubble ${role}${role === "pip" ? " pip" : ""}`;
  const who =
    role === "user"
      ? "YOU"
      : opts.agent === "compare"
        ? "COMPARE"
        : opts.agent && opts.agent !== "pip" && opts.agent !== "auto"
          ? // Show who actually answered. Never "CEREBRAS · GEMINI" mashups.
            agentLabel(opts.brain || opts.provider || opts.agent)
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
  const pill = routePillHtml(route);
  div.innerHTML = `<div class="who-row"><span class="who">${esc(who)}</span>${pill}</div><div class="body">${formatChatBody(text)}</div>${toolsHtml}${metaHtml}`;
  $("#log").appendChild(div);
  $("#log").scrollTop = $("#log").scrollHeight;
  return div;
}

/** Clean compare overview — stats + ok summaries only (fail syntax lives on ERRORS tab). */
function compareOverview(compare) {
  const rows = Array.isArray(compare) ? compare : [];
  const ok = rows.filter((c) => c && c.ok && c.text);
  const bad = rows.filter((c) => c && !c.ok && !c.pending);
  const pending = rows.filter((c) => c && c.pending);
  const lines = [];
  lines.push(
    `${ok.length} answered${pending.length ? ` · ${pending.length} waiting` : ""} · ${bad.length} failed · ${rows.length} keyed`,
  );
  if (ok.length >= 2) {
    const lens = ok.map((c) => String(c.text).length);
    const spread = Math.max(...lens) - Math.min(...lens);
    lines.push("");
    lines.push(
      spread > 120
        ? "Variance: reply lengths differ — tab each brain; don't assume they agree."
        : "Variance: similar length — still skim each tab; tone and facts can diverge.",
    );
    lines.push("");
    lines.push("Opening lines:");
    for (const c of ok) {
      const name = String(c.label || c.provider || "?").toUpperCase();
      const t = String(c.text).trim().split(/(?<=[.!?])\s+/)[0] || "";
      lines.push(`  ${name}: ${t.slice(0, 100)}${t.length > 100 ? "…" : ""}`);
    }
  } else if (ok.length === 1) {
    lines.push("");
    lines.push(
      `Only ${String(ok[0].label || ok[0].provider).toUpperCase()} answered${bad.length ? " — errors on last tab" : ""}.`,
    );
  } else if (bad.length) {
    lines.push("");
    lines.push("No clean answers — open ERRORS tab.");
  }
  return lines.join("\n");
}

function compareErrorsText(bad) {
  if (!bad.length) return "No failures.";
  return bad
    .map((c) => {
      const name = String(c.label || c.provider || "?").toUpperCase();
      return `${name}\n${c.error || "no reply"}`;
    })
    .join("\n\n");
}

function buildCompareTabs(rows) {
  const okRows = rows.filter((r) => r.ok && r.text);
  const badRows = rows.filter((r) => !r.ok && !r.pending);
  const pendingRows = rows.filter((r) => r.pending);
  const overview = {
    provider: "overview",
    label: "OVERVIEW",
    text: compareOverview(rows),
    ok: true,
    overview: true,
  };
  const tabs = [overview, ...okRows];
  for (const p of pendingRows) {
    tabs.push({
      provider: p.provider,
      label: p.label || p.provider,
      text: "Waiting for reply…",
      ok: false,
      pending: true,
    });
  }
  if (badRows.length) {
    tabs.push({
      provider: "errors",
      label: "ERRORS",
      text: compareErrorsText(badRows),
      ok: false,
      errors: true,
    });
  }
  return { tabs, okRows, badRows, pendingRows, rows };
}

function paintCompareBubble(div, state) {
  const { tabs, okRows, badRows, rows } = buildCompareTabs(state.rows);
  let idx = state.idx;
  if (idx >= tabs.length) idx = 0;
  state.idx = idx;
  const row = tabs[idx] || tabs[0];
  const tabHtml = tabs
    .map((c, i) => {
      const name = String(c.label || c.provider || "?").toUpperCase();
      const mark = c.errors ? " fail" : c.pending ? " wait" : "";
      const live = c.ok && c.text && !c.overview && !c.errors ? " live" : "";
      return `<button type="button" class="compare-tab ${i === idx ? "on" : ""}${mark}${live}" data-ci="${i}">${esc(name)}</button>`;
    })
    .join("");
  let body;
  let meta;
  if (row.overview) {
    body = formatChatBody(row.text);
    meta = `${okRows.length}/${rows.length} answered`;
  } else if (row.errors) {
    body = formatChatBody(row.text);
    meta = `${badRows.length} failed`;
  } else if (row.pending) {
    body = `<p class="muted">Waiting for ${esc(String(row.label || row.provider || "?").toUpperCase())}…</p>`;
    meta = "IN FLIGHT";
  } else if (row.ok && row.text) {
    body = formatChatBody(row.text);
    meta = `${esc(String(row.model || row.provider || ""))}${row.tokens ? ` · ~${row.tokens} TOK` : ""}`;
  } else {
    body = formatChatBody(row.text || row.error || "no reply");
    meta = "FAIL";
  }
  div.innerHTML = `<div class="who-row"><span class="who">COMPARE</span>${routePillHtml("leaked")}</div><div class="compare-tabs">${tabHtml}</div><div class="body">${body}</div><div class="chat-meta">${meta}</div>`;
  div.querySelectorAll(".compare-tab").forEach((b) => {
    b.onclick = () => {
      state.idx = Number(b.dataset.ci) || 0;
      paintCompareBubble(div, state);
    };
  });
  $("#log").scrollTop = $("#log").scrollHeight;
}

/** Live compare bubble — updates as each API returns. */
function beginCompareLog(providers) {
  const rows = (providers || []).map((p) => ({
    provider: p.id,
    label: p.label || p.id,
    text: "",
    ok: false,
    pending: true,
  }));
  const div = document.createElement("div");
  div.className = "bubble pip compare-bubble compare-live";
  const state = { rows, idx: 0, div, finalized: false };
  paintCompareBubble(div, state);
  $("#log").appendChild(div);
  return state;
}

function updateCompareLog(state, allRows, meta = {}, latestRow = null) {
  if (!state || state.finalized) return;
  state.rows = (allRows || []).map((r) => ({ ...r, pending: Boolean(r.pending) }));
  if (latestRow && latestRow.ok && latestRow.text) {
    const { tabs } = buildCompareTabs(state.rows);
    const ci = tabs.findIndex((t) => t.provider === latestRow.provider && !t.overview && !t.errors);
    if (ci >= 0) state.idx = ci;
  }
  paintCompareBubble(state.div, state);
  const ok = state.rows.filter((r) => r.ok && r.text).length;
  const done = meta.done != null ? meta.done : state.rows.filter((r) => !r.pending).length;
  const total = meta.total != null ? meta.total : state.rows.length;
  setStatus(`COMPARE · ${ok}/${total}${done < total ? " · streaming" : ""}`);
}

function finalizeCompareLog(state, rows) {
  if (!state) return null;
  state.finalized = true;
  state.rows = (rows || state.rows).map((r) => ({ ...r, pending: false }));
  paintCompareBubble(state.div, state);
  const overview = compareOverview(state.rows);
  db.chat.push({
    role: "pip",
    content: overview,
    brain: "compare",
    agent: "compare",
    leaked: true,
    compare: state.rows,
  });
  // Seed crew floor into history so the next turn everyone can hear each other.
  for (const c of state.rows.filter((r) => r.ok && r.text)) {
    db.chat.push({
      role: "pip",
      content: c.text,
      brain: c.provider,
      agent: c.provider,
      leaked: true,
      crewLine: true,
    });
  }
  return state.div;
}

/** One-shot crew listen: addressed agent answers the speaker once. CANCEL stops it. */
const crewFloor = { abort: false, busy: false };

function showCrewBar(msg) {
  const bar = document.getElementById("crew-bar");
  const lab = document.getElementById("crew-msg");
  if (!bar) return;
  bar.hidden = false;
  bar.classList.add("on");
  if (lab) lab.textContent = msg || "CREW";
}

function hideCrewBar() {
  const bar = document.getElementById("crew-bar");
  if (!bar) return;
  bar.hidden = true;
  bar.classList.remove("on");
}

function bindCrewCancel() {
  const btn = document.getElementById("crew-cancel");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.onclick = () => {
    crewFloor.abort = true;
    hideCrewBar();
    setStatus("CREW · CANCELLED");
  };
}

function findCrewRow(rows, agentId) {
  const id = String(agentId || "").toLowerCase();
  if (!id) return null;
  const wantLabel = String(agentLabel(id) || "").toLowerCase();
  return (rows || []).find((r) => {
    if (!r?.ok || !r.text) return false;
    const pid = String(r.provider || "").toLowerCase();
    const lab = String(r.label || "").toLowerCase();
    return pid === id || lab === wantLabel || lab === id;
  }) || null;
}

/**
 * One-shot listen: addressed agent answers the speaker once. CANCEL stops it.
 * Works after COMPARE or after a speak-mode relay (speakerText already known).
 */
async function maybeCrewHandoff(userText, compareRows, forced = null) {
  if (crewFloor.busy) return;
  const hint = parseCrossAgentIntent(userText) || parseAgentRelay(userText);
  const fromId = forced?.fromId || hint?.from || null;
  const toId = forced?.toId || hint?.to || hint?.target || null;
  if (!fromId || !toId || fromId === toId) return;

  const spoken =
    String(forced?.speakerText || "").trim() ||
    findCrewRow(compareRows, fromId)?.text ||
    "";
  if (!spoken) return;

  crewFloor.abort = false;
  crewFloor.busy = true;
  bindCrewCancel();
  showCrewBar(`${agentLabel(fromId)} spoke · ${agentLabel(toId)} listening…`);
  setStatus(`CREW · ${agentLabel(toId).toUpperCase()}…`);

  // Brief beat so CANCEL is usable before the call fires.
  await new Promise((r) => setTimeout(r, 900));
  if (crewFloor.abort) {
    crewFloor.busy = false;
    hideCrewBar();
    return;
  }

  try {
    const out = await agentRelayComplete(db.settings, {
      fromId: null,
      toId,
      payload:
        `${agentLabel(fromId)} said to you:\n\n${spoken}\n\n` +
        `Joshua's ask was: ${userText}\n\n` +
        `Answer ${agentLabel(fromId)} briefly as yourself, then include Joshua. One turn only — do not request another reply.`,
      operator: db.settings?.operator || "Joshua",
      speak: false,
    });
    if (crewFloor.abort) {
      crewFloor.busy = false;
      hideCrewBar();
      return;
    }
    const reply = String(out.text || "").trim();
    if (!reply) throw new Error(`${agentLabel(toId)} returned empty`);
    db.chat.push({
      role: "pip",
      content: reply,
      brain: out.provider,
      agent: toId,
      leaked: true,
      crewLine: true,
    });
    persist();
    addLog("pip", reply, {
      brain: out.provider,
      provider: out.provider,
      agent: toId,
      leaked: true,
      tokens: out.tokens,
    });
    setStatus(`CREW · ${agentLabel(toId).toUpperCase()} · DONE`);
  } catch (e) {
    if (!crewFloor.abort) {
      addLog("pip", String(e.message || e));
      setStatus("CREW FAIL");
    }
  } finally {
    crewFloor.busy = false;
    hideCrewBar();
  }
}

/** One compare bubble: OVERVIEW → each ok reply → ERRORS last. */
function addCompareLog(compare, opts = {}) {
  const rows = (compare || []).filter(Boolean);
  if (!rows.length) {
    addLog("pip", "Compare found no replies.", opts);
    return;
  }
  const div = document.createElement("div");
  div.className = "bubble pip compare-bubble";
  const state = { rows, idx: 0 };
  paintCompareBubble(div, state);
  $("#log").appendChild(div);
  db.chat.push({
    role: "pip",
    content: compareOverview(rows),
    brain: "compare",
    agent: "compare",
    leaked: true,
    compare: rows,
  });
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


function markBubbleLeaked(el) {
  markBubbleRoute(el, "leaked");
}

function clearChatAttach() {
  pendingChatImage = null;
  const host = $("#chat-attach");
  const attachBtn = $("#attach-btn");
  if (attachBtn) attachBtn.classList.remove("on");
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
}

function setChatAttach(dataUrl) {
  pendingChatImage = dataUrl;
  const host = $("#chat-attach");
  const attachBtn = $("#attach-btn");
  if (attachBtn) attachBtn.classList.add("on");
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `<img src="${dataUrl}" alt="attach" /><button type="button" id="chat-attach-clear">✕</button>`;
  const clr = $("#chat-attach-clear");
  if (clr) clr.onclick = () => clearChatAttach();
}

async function attachChatPhoto({ capture = false } = {}) {
  try {
    const file = await pickImageFile({ capture });
    const dataUrl = await fileToDataUrl(file, 1280, 0.72);
    setChatAttach(dataUrl);
    document.body.classList.add("comm");
    setStatus("ATTACHED · ADD TEXT OR SEND");
  } catch (e) {
    if (!/cancelled/i.test(String(e.message || e))) setStatus(String(e.message || e).slice(0, 60).toUpperCase());
  }
}

let chatBusy = false;

async function sendChat() {
  const box = $("#input");
  const text = (box.value || "").trim();
  const image = pendingChatImage;
  if ((!text && !image) || chatBusy) return;
  chatBusy = true;
  const sendBtn = $("#send");
  if (sendBtn) sendBtn.disabled = true;
  box.value = "";
  const userLine = image ? (text ? `${text}\n[photo attached]` : "[photo attached]") : text;
  db.chat.push({ role: "user", content: userLine, image: Boolean(image) });
  markChatUser();
  const userBubble = addLog("user", userLine);
  if (image) {
    // Keep a thumb in the bubble for clarity.
    try {
      const img = document.createElement("img");
      img.src = image;
      img.className = "chat-thumb";
      img.alt = "attached";
      userBubble.querySelector(".body")?.appendChild(img);
    } catch {
      /* ignore */
    }
  }
  clearChatAttach();
  captureMoment(db, text || "photo");
  persist();
  setStatus(pipStatus());

  try {
    await ensureCloudKeys(db.settings).then((sync) => {
      if (sync.source === "desktop" && sync.applied) {
        persist();
        paintBrainStrip();
      }
    });
  } catch {
    /* optional */
  }

  try {
  if (!image) {
  const switchHit = tryAgentSwitch(text);
  if (switchHit) {
    addLog("pip", switchHit.reply, { agent: "pip" });
    db.chat.push({ role: "pip", content: switchHit.reply, brain: "pip" });
    persist();
    setStatus(switchHit.ok ? `WITH · ${agentLabel(chatAgent())}` : "AGENT");
    return;
  }
  }

  if (!image && chatAgent() !== "compare" && String(db.settings.brain_pin || "").toLowerCase() !== "compare") {
  const relay = parseAgentRelay(text);
  if (relay) {
    setStatus("RELAY…");
    const lastPip = [...db.chat].reverse().find((m) => m.role === "pip" && m.content);
    const payload = relay.direct && !relay.from ? text : relay.speak ? text : lastPip?.content || text;
    let fromId = relay.from;
    if (!fromId) {
      const cur = chatAgent();
      if (cur && cur !== "pip" && cur !== "auto" && cur !== "compare") fromId = cur;
      else fromId = lastPip?.brain || lastPip?.agent || null;
      if (fromId === "pip" || fromId === "auto" || fromId === "compare") fromId = null;
    }
    if (fromId && relay.to && fromId === relay.to) fromId = null;
    // Speak needs a speaker; if only target named, use current keyed agent or fail clear.
    if (relay.speak && !fromId && relay.to) {
      addLog("pip", `Name who should speak — e.g. "tell Gemini to say something to Groq".`);
      setStatus("RELAY · NEED SPEAKER");
      return;
    }
    if (!relay.to && !relay.speak) {
      addLog("pip", `Name the target agent — e.g. "share with Groq".`);
      setStatus("RELAY · NEED TARGET");
      return;
    }
    try {
      const out = await agentRelayComplete(db.settings, {
        fromId,
        toId: relay.to,
        payload,
        operator: db.settings?.operator || "Joshua",
        speak: Boolean(relay.speak && fromId),
      });
      markBubbleLeaked(userBubble);
      const last = db.chat.filter((m) => m.role === "user").pop();
      if (last) last.leaked = true;
      const speaker = out.speaker || out.to || fromId;
      const via = out.speak && fromId && relay.to
        ? `${agentLabel(fromId)} → ${agentLabel(relay.to)}`
        : fromId && relay.to
          ? `${agentLabel(fromId)} → ${agentLabel(relay.to)}`
          : agentLabel(speaker);
      const reply = out.text;
      db.chat.push({
        role: "pip",
        content: reply,
        brain: out.provider,
        agent: speaker,
        leaked: true,
      });
      rememberReply(db, reply);
      persist();
      addLog("pip", reply, {
        brain: out.provider,
        provider: out.provider,
        agent: speaker,
        leaked: true,
        tokens: out.tokens,
      });
      setStatus(`RELAY · ${via}`);
      // Speak mode only runs the speaker — give the addressed agent one reply (CANCEL stops).
      if (out.speak && fromId && relay.to && reply) {
        await maybeCrewHandoff(text, null, {
          fromId,
          toId: relay.to,
          speakerText: reply,
        });
      }
    } catch (e) {
      addLog("pip", String(e.message || e));
      setStatus("RELAY FAIL");
    }
    return;
  }
  }

  if (!image && /^\s*(test\s+(brain|keys?|cloud)|\/test)\s*$/i.test(text)) {
    setStatus("CHECKING KEYS…");
    try {
      const hits = await validateKeyed(db.settings);
      db.settings.brain_health = providerHealth();
      persist();
      paintBrainStrip();
      const lines = [];
      for (const hit of hits || []) {
        const p = PROVIDERS.find((x) => x.id === hit.id);
        if (!p) continue;
        lines.push(`${p.label}: ${hit.ok ? "LIVE" : `KEY BAD · ${hit.error || "failed"}`}`);
      }
      const reply = lines.length
        ? lines.join("\n")
        : "No keys on phone. DATA → paste keys, or SYNC FROM DESKTOP.";
      addLog("pip", reply, { brain: "TEST" });
      db.chat.push({ role: "pip", content: reply, brain: "test" });
      persist();
      setStatus(lines.some((l) => /LIVE/.test(l)) ? "KEYS OK" : "KEY CHECK");
    } catch (e) {
      addLog("pip", String(e.message || e));
      setStatus("TEST ERROR");
    }
    return;
  }

  if (!image) {
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
  }

  try {
  const isCompare =
    !image &&
    (chatAgent() === "compare" ||
      String(db.settings.brain_pin || "").toLowerCase() === "compare" ||
      /^\s*(compare|ask all|all brains?)\s*[:\-]?\s*/i.test(text));
  let compareLive = null;
  if (isCompare) {
    const provs = compareProviders(db.settings, providerHealth());
    if (provs.length) {
      compareLive = beginCompareLog(provs);
      setStatus(`COMPARE · 0/${provs.length} · streaming`);
    }
  }

  const out = await chat(
    db.settings,
    db.chat,
    text || (image ? "What's in this image?" : ""),
    (msg) => setStatus(msg),
    db.kit,
    db,
    {
      ...(image ? { image } : {}),
      onComparePartial: compareLive
        ? (row, allRows, meta) => updateCompareLog(compareLive, allRows, meta, row)
        : undefined,
    },
  );
    const reply = typeof out === "string" ? out : out.text;
    const leaked = typeof out === "object" ? Boolean(out.leaked) : false;
    const provider = typeof out === "object" ? out.provider : "";
    const agent = typeof out === "object" ? out.agent || chatAgent() : chatAgent();
    const compare = typeof out === "object" ? out.compare : null;
    const pending = takePendingTheme();
    if (pending && applyThemePayload(db.settings, pending)) {
      persist();
      render();
      renderPrivacy();
    }
    const local = typeof out === "object" ? Boolean(out.local) : false;
    if (leaked) {
      markBubbleLeaked(userBubble);
      const last = db.chat.filter((m) => m.role === "user").pop();
      if (last) last.leaked = true;
    } else {
      markBubbleRoute(userBubble, local ? "local" : "secure");
    }
    const tokens = typeof out === "object" ? Number(out.tokens) || 0 : 0;
    if (compare && Array.isArray(compare) && compare.length) {
      if (compareLive) {
        finalizeCompareLog(compareLive, compare);
      } else {
        addCompareLog(compare, { leaked, tokens });
      }
      persist();
      rememberReply(db, reply);
      setStatus(`COMPARE · ${compare.filter((c) => c.ok).length}/${compare.length}`);
      // One-shot listen: addressed agent answers the speaker (CANCEL stops). No loop.
      await maybeCrewHandoff(text, compare);
    } else {
      db.chat.push({
        role: "pip",
        content: reply,
        brain: provider || "",
        agent: agent || "pip",
        leaked,
      });
      rememberReply(db, reply);
      persist();
      addLog("pip", reply, {
        brain: provider || activeBrain().label,
        provider,
        agent,
        leaked,
        local,
        tokens,
      });
      // If user pinned X but Y answered, surface it (shouldn't happen after strict pin).
      if (
        agent &&
        agent !== "pip" &&
        agent !== "auto" &&
        agent !== "compare" &&
        provider &&
        String(provider).toLowerCase() !== String(agent).toLowerCase()
      ) {
        setStatus(`WANTED ${agentLabel(agent)} · GOT ${String(provider).toUpperCase()}`);
      } else {
        const label = agentLabel(
          agent === "pip" || agent === "auto" ? provider || agent : provider || agent,
        );
        const tokBit = tokens ? ` · ~${tokens} TOK` : "";
        setStatus((leaked ? `LEAKED · ${label}` : `PRIVATE · ${label}`) + tokBit);
      }
    }
    updateBrainChip();
  } catch (e) {
    addLog("pip", String(e.message || e));
    setStatus("CHAT ERROR");
  }
  } finally {
    chatBusy = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function boot() {
  try {
    bootTheme(db.settings);
    applyAllOverlays();
    hydrateHealth(db.settings.brain_health);
    // Drop stale KEY BAD poison from the old chat-ping probe.
    db.settings.brain_health = providerHealth();
    // Keys on device — user chooses SECURE vs LEAKY via header toggle.
    if (!db.settings.chat_agent) db.settings.chat_agent = "pip";
    persist();
    if (db.settings.biometric_lock === undefined) {
      db.settings.biometric_lock = true;
      persist();
    }
    const startUi = () => {
      paintBrainStrip();
      db.chat.slice(-40).filter((m) => !m.crewLine).forEach((m) =>
        addLog(m.role === "user" ? "user" : "pip", m.content, {
          leaked: Boolean(m.leaked),
          route: m.role === "user" && m.leaked ? "leaked" : "",
          brain: m.brain || "",
          agent: m.agent || "",
        }),
      );
      if (!db.chat.length) {
        addLog(
          "pip",
          "Pip on deck. Tap the agent chip next to LENS for PIP / AUTO / COMPARE / GEMINI…. COMPARE: overview first, tab each brain, errors last.",
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
      $("#view")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".key-clear");
        if (!btn || tab !== "data") return;
        e.preventDefault();
        e.stopPropagation();
        clearProviderKey(btn.getAttribute("data-field"));
      });
      $("#comm-tog").onclick = () => document.body.classList.add("comm");
      $("#comm-close").onclick = () => {
        closeAgentSheet();
        document.body.classList.remove("comm");
      };
      const privacyTog = $("#privacy-tog");
      if (privacyTog) {
        privacyTog.onclick = () => {
          const secure = privacyOn(db.settings);
          db.settings.privacy_mode = secure ? "leaky" : "secure";
          persist();
          renderPrivacy();
          setStatus(secure ? "LEAKY // MASTER BRAIN · LIVE KEYS FIRST" : "SECURE // DESKTOP FIRST · CLOUD = FALLBACK");
        };
      }
      $("#send").onclick = sendChat;
      const attachBtn = $("#attach-btn");
      if (attachBtn) attachBtn.onclick = () => attachChatPhoto({ capture: false });
      const inputEl = $("#input");
      if (inputEl) {
        inputEl.addEventListener("paste", (e) => {
          const items = e.clipboardData && e.clipboardData.items;
          if (!items) return;
          for (const item of items) {
            if (!/^image\//.test(item.type)) continue;
            e.preventDefault();
            const file = item.getAsFile();
            if (!file) return;
            fileToDataUrl(file, 1280, 0.72)
              .then((url) => {
                setChatAttach(url);
                setStatus("ATTACHED · ADD TEXT OR SEND");
              })
              .catch(() => setStatus("PASTE IMAGE FAILED"));
            break;
          }
        });
      }
      const lensBtn = $("#lens-btn");
      const runLens = async () => {
        const mode = detectVisionMode($("#input")?.value || "");
        setStatus("LENS · SNAP…");
        try {
          const hit = await pickAndIdentify(db.settings, mode);
          document.body.classList.add("comm");
          addLog("user", `[lens · ${mode}]`);
          db.chat.push({ role: "user", content: `[lens · ${mode}]`, leaked: true });
          addLog("pip", hit.text, { brain: String(hit.provider || "LENS").toUpperCase(), leaked: true });
          db.chat.push({ role: "pip", content: hit.text, leaked: true, provider: hit.provider });
          persist();
          setStatus(`LENS · ${String(hit.provider || "").toUpperCase()}`);
        } catch (e) {
          const msg = String(e.message || e);
          if (/cancelled/i.test(msg)) {
            setStatus("LENS CANCELLED");
            return;
          }
          document.body.classList.add("comm");
          addLog("pip", msg);
          setStatus(msg.slice(0, 60).toUpperCase());
        }
      };
      if (lensBtn) lensBtn.onclick = () => runLens();
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
        pingNudge(db.settings, db).then(injectNudge).catch(() => {});
      }, 20000);
      const cap = window.Capacitor;
      if (cap?.Plugins?.App?.addListener) {
        cap.Plugins.App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) return;
          runMorning();
          pingNudge(db.settings, db).then(injectNudge).catch(() => {});
        });
      }
      // Map / weather watch only while WX tab is open (see renderWx / leaveWx).
      const deferProbe = (fn) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 2500 });
        else setTimeout(fn, 80);
      };
      deferProbe(async () => {
        try {
          if (desktopConfigured(db.settings)) {
            try {
              await ensureCloudKeys(db.settings);
              persist();
            } catch {
              /* optional */
            }
            try {
              const st = await desktopStatus(db.settings);
              db.settings.desktop_live = Boolean(st.ok);
              persist();
              paintBrainStrip();
              if (st.ok) {
                const model = (st.ollama && st.ollama.using) || "ollama";
                setStatus(`DESKTOP GPU · ${String(model).toUpperCase()}`);
              } else {
                setStatus(`DESKTOP OFFLINE · ${String(st.error || "CHECK").slice(0, 40)}`);
              }
            } catch {
              db.settings.desktop_live = false;
              persist();
            }
          }
          await validateKeyed(db.settings);
          db.settings.brain_health = providerHealth();
          persist();
          paintBrainStrip();
          const keyed = cloudStatus(db.settings).keyed;
          const live = keyed.filter((id) => providerHealth()[id]?.ok === true);
          const bad = keyed.filter((id) => providerHealth()[id]?.ok === false);
          if (live.length) setStatus(`LIVE · ${live.join(" · ").toUpperCase()}`);
          else if (bad.length) setStatus(`${bad.length} BAD KEY${bad.length > 1 ? "S" : ""} · DATA`);
          else if (keyed.length) setStatus("KEYS SET");
          else if (db.settings.desktop_live) setStatus("DESKTOP ONLINE · CLOUD KEYS OPTIONAL");
          else if (desktopConfigured(db.settings)) setStatus("DESKTOP PAIRED · OFFLINE — CHECK / FIND");
          else setStatus("PIP ON DECK · PAIR DESKTOP OR PASTE KEYS");
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
        /* stay locked — only a completed hold unlocks */
      });
  } catch (e) {
    const msg = String(e.message || e);
    $("#view").innerHTML = `<h3>PIP ERROR</h3><p class="muted">${esc(msg)}</p>`;
    setStatus("BOOT ERROR");
    console.error(e);
  }
}

boot();
