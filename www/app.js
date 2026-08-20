import { load, save, KIT_LABELS } from "./store.js";
import { chat, draftAnswers, pipStatus, activeBrain, cloudStatus, takePendingTheme } from "./brain.js";
import { probeProvider, probeKeyed, providerHealth, PROVIDERS } from "./cloud.js";
import { desktopConfigured, desktopLogin, desktopStatus, findAndPair, pairAtUrl } from "./desktop.js";
import { privacyOn } from "./cloud.js";
import { biometricAvailable, guardSecrets } from "./biometric.js";
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
import { listEntries, applyAllOverlays } from "./codefs.js";
import {
  loadFile,
  saveFile,
  getCodeChat,
  resetCodeChat,
  resetOverlays,
  streamCodeApply,
  consumeCodeStream,
} from "./code.js";
import { loadMapConfig, mountMap, setMapLayer, renderDossier, layerButtons, researchPin, quickPin, drawHailMarkers, resolveMapCenter, renderWeatherBoot, pinDossier, refetchDossier, startWeatherWatch, filterDossier } from "./wx.js";
import { describeChain } from "./command.js";
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
import { openProtonVpn, vpnSystemActive, setKeepAlive } from "./proton.js";
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
    $("#view").innerHTML = `<div class="code-wrap"><h3>CODE</h3><p class="muted">Loading…</p></div>`;
    renderCode().catch((e) => {
      $("#view").innerHTML = `<div class="code-wrap"><h3>CODE ERROR</h3><p class="muted">${esc(String(e.message || e))}</p></div>`;
      setStatus("CODE ERROR");
      console.error(e);
    });
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

async function renderMeals() {
  document.body.classList.remove("comm");
  await syncMealsFromDesktop(db.settings, db).catch(() => {});
  persist();
  const m = mealSnapshot(db);
  const tgt = m.targets || {};
  const rem = (m.remaining && m.remaining.remaining) || {};
  const diet = (tgt.notes || "").trim();
  $("#view").innerHTML = `
    <h3>MEALS</h3>
    <p class="muted">Want-first planning. Tell Pip in CHAT — breakfast: oats · lunch: bowl · dinner: stir fry — or sync from paired desktop.</p>
    <h3>TARGETS</h3>
    <p>KCAL ${tgt.kcal || 0} · P ${tgt.protein_g || 0}g · C ${tgt.carbs_g || 0}g · F ${tgt.fat_g || 0}g</p>
    <p class="muted">Remaining: ${Math.round(rem.kcal || 0)} kcal / ${Math.round(rem.protein_g || 0)}g protein${diet ? ` · ${esc(diet)}` : ""}</p>
    <h3>WANTED</h3>
    ${(m.wanted || []).map((w) => `
      <div class="row"><span>${esc(w.name)}</span><span class="muted">${w.kcal || 0} kcal <button type="button" class="tiny" data-unwant="${esc(w.id)}">X</button></span></div>
    `).join("") || `<p class="muted">Tell Pip meals you want.</p>`}
    <h3>PLAN ${esc(m.plan_date || "")}</h3>
    ${(m.plan || []).map((p) => `
      <div class="row"><span>${esc(p.slot)} · ${esc(p.meal_name)}</span><span class="muted">${p.kcal || 0}</span></div>
      ${p.ingredients ? `<p class="muted meal-ings">${esc(p.ingredients)}</p>` : ""}
    `).join("") || `<p class="muted">No plan yet. REPLAN or ask Pip.</p>`}
    <h3>SHOPPING</h3>
    ${(m.shopping || []).map((s) => `
      <label class="check"><input type="checkbox" data-shop="${esc(s.id)}" ${s.checked ? "checked" : ""} /> ${esc(s.name)} ${esc(s.quantity || "")}</label>
    `).join("") || `<p class="muted">Empty until a plan has ingredients.</p>`}
    <div class="actions">
      <button type="button" id="meal-plan" class="primary">REPLAN TODAY</button>
      <button type="button" id="meal-clear">CLEAR TODAY</button>
      <button type="button" id="meal-wclear">CLEAR WANTED</button>
    </div>`;
  $("#meal-plan").onclick = () => {
    const out = planDay(db);
    persist();
    renderMeals();
    setStatus(out.ok ? "MEALS PLANNED" : String(out.error || "PLAN FAILED"));
  };
  $("#meal-clear").onclick = () => {
    clearDayPlan(db);
    persist();
    renderMeals();
    setStatus("TODAY CLEARED");
  };
  $("#meal-wclear").onclick = () => {
    clearWantedMeals(db);
    persist();
    renderMeals();
    setStatus("WANTED CLEARED");
  };
  $("#view").querySelectorAll("[data-unwant]").forEach((el) => {
    el.onclick = () => {
      deleteWantedMeal(db, el.dataset.unwant);
      persist();
      renderMeals();
    };
  });
  $("#view").querySelectorAll("[data-shop]").forEach((el) => {
    el.onchange = () => {
      setShoppingChecked(db, el.dataset.shop, el.checked);
      persist();
    };
  });
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
      <p class="muted">${leaky ? "LEAKY — cloud coder edits phone www overlay." : "SECURE — flip LEAKY for on-device CODE, or pair desktop for UPGRADE PC."} CSS live · JS/HTML need RELOAD. API keys live in DATA.</p>
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
    <h3>PROTON VPN</h3>
    <p class="muted">Not built inside Pip — connect the Proton VPN app, keep it running in background. Pip detects the system VPN and routes hunt/scrape/chat through it automatically. Pair desktop via VPN URL below (Tailscale/WG still best for reaching home PC).</p>
    <div class="actions">
      <button type="button" id="proton-open">OPEN PROTON VPN</button>
      <button type="button" id="proton-check">CHECK VPN</button>
    </div>
    <p class="muted" id="proton-msg">${s.keepalive ? "Keepalive on — Pip stays ready while VPN runs." : "Enable keepalive to sync opps in background."}</p>
    <label class="check"><input type="checkbox" id="set-keepalive" ${s.keepalive ? "checked" : ""} /> KEEP PIP ALIVE (background sync)</label>
    <div class="field"><span>PROTON / VPN DESKTOP URL</span><input id="set-proton-url" value="${esc(s.proton_url || s.vpn_url || "")}" placeholder="http://your-pc:7420 when on VPN" /></div>
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
    <div id="data-chain" class="brain-strip" aria-label="connected APIs"></div>
    <p class="muted">Green = live · amber = keyed · red = down. CHAT uses every keyed API even in SECURE. Pin LOCAL only if you want on-device Qwen — that model can crash the phone.</p>
    <div class="field"><span>PIN</span>
      <select id="brain-pin">
        ${["auto", "local", "groq", "openrouter", "cerebras", "mistral", "gemini", "xai"].map((id) => {
          const on = (s.brain_pin || "auto") === id;
          const label = id === "xai" ? "xai (Grok)" : id;
          return `<option value="${id}" ${on ? "selected" : ""}>${label}</option>`;
        }).join("")}
      </select>
    </div>
    ${securePosture ? `<p class="muted">OPP/CODE stay on-device while SECURE. CHAT still hits keyed clouds shown in the strip.</p>` : `<p class="muted">LEAKY is on. PIN can lock one cloud brain. Chat prefers desktop when paired.</p>`}
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
    db.settings.vpn_url = ($("#set-vurl") && $("#set-vurl").value.trim()) || "";
    db.settings.proton_url = ($("#set-proton-url") && $("#set-proton-url").value.trim()) || "";
    db.settings.vpn_host = ($("#set-vhost") && $("#set-vhost").value.trim()) || "";
    db.settings.biometric_lock = Boolean($("#set-bio").checked);
    db.settings.vpn_note = $("#set-vpn").value.trim();
    db.settings.keepalive = Boolean($("#set-keepalive")?.checked);
    persist();
  };

  const protonOpen = $("#proton-open");
  if (protonOpen) protonOpen.onclick = async () => {
    await openProtonVpn();
    setStatus("PROTON VPN");
  };
  const protonCheck = $("#proton-check");
  if (protonCheck) protonCheck.onclick = async () => {
    const on = await vpnSystemActive();
    const el = $("#proton-msg");
    if (el) el.textContent = on ? "VPN active — hunt and sync use the tunnel." : "No system VPN detected. Open Proton and connect.";
    setStatus(on ? "VPN ON" : "VPN OFF");
  };
  const keepEl = $("#set-keepalive");
  if (keepEl) keepEl.onchange = async () => {
    await toggleKeepAlive(db, keepEl.checked, persist);
    startBackground(db, { persist, setStatus, softRefresh });
    setStatus(keepEl.checked ? "KEEPALIVE ON" : "KEEPALIVE OFF");
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
    setStatus("DRAFT READY · GO PASTE IT");
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
    addLog("pip", oppHit.reply);
    if (oppHit.switchTab) {
      tab = oppHit.switchTab;
      render();
    }
    persist();
    setStatus(oppHit.ok ? "OPP" : "OPP");
    if (oppHit.run) await oppHit.run();
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
    rememberReply(db, reply);
    persist();
    addLog("pip", reply);
    updateBrainChip();
  } catch (e) {
    addLog("pip", String(e.message || e));
  }
}

function boot() {
  try {
    bootTheme(db.settings);
    applyAllOverlays();
    db.chat.slice(-20).forEach((m) => addLog(m.role === "user" ? "user" : "pip", m.content));
    if (!db.chat.length) addLog("pip", "Pip is happy to help! Hunt opps in CHAT — or connect Proton VPN in DATA for private search.");
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
      setStatus(secure ? "LEAKY // CLOUD UNLOCKED" : "SECURE // ON-DEVICE");
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
      .then((out) => {
        softRefresh();
        if (out?.briefing?.text && !db.chat.some((m) => m.role === "pip" && String(m.content || "").startsWith("Good morning"))) {
          /* briefing stays on TODAY — wake lines come from presence */
        }
      })
      .catch(() => {});
  };
  runMorning();
  setInterval(() => {
    if (document.hidden) return;
    pingPresence(db.settings)
      .then(injectNudge)
      .catch(() => {});
  }, 20000);
  const cap = window.Capacitor;
  if (cap?.Plugins?.App?.addListener) {
    cap.Plugins.App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      runMorning();
      pingPresence(db.settings).then(injectNudge).catch(() => {});
    });
  }
  resolveMapCenter(db.settings)
    .then(() => persist())
    .catch(() => {});
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
  const deferProbe = (fn) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 2500 });
    else setTimeout(fn, 80);
  };
  deferProbe(() => {
    probeKeyed(db.settings)
      .then((hits) => {
        db.settings.brain_health = providerHealth();
        persist();
        paintBrainStrip();
        const live = (hits || []).filter((h) => h.ok).map((h) => h.id);
        const keyed = cloudStatus(db.settings).keyed;
        if (keyed.length && live.length) setStatus(`BRAIN · ${live.join(" · ").toUpperCase()}`);
        else if (keyed.length) setStatus("KEYS SAVED · PROBE FAILED");
        else setStatus("PIP ON DECK · ADD KEYS IN DATA");
        if (desktopConfigured(db.settings)) {
          return syncEventsFromDesktop(db.settings, db)
            .then(() => syncMealsFromDesktop(db.settings, db))
            .then(() => persist());
        }
      })
      .catch((e) => setStatus(String(e.message || e).toUpperCase()));
  });
  } catch (e) {
    const msg = String(e.message || e);
    $("#view").innerHTML = `<h3>PIP ERROR</h3><p class="muted">${esc(msg)}</p>`;
    setStatus("BOOT ERROR");
    console.error(e);
  }
}

boot();
