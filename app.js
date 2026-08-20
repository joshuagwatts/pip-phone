const $ = (sel) => document.querySelector(sel);

function applyThemeCss(css) {
  if (!css || typeof css !== "object") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(css)) {
    if (typeof v === "string" && v.startsWith("#")) root.style.setProperty(`--${k}`, v);
  }
}

function applyThemeVars(theme) {
  if (!theme) return;
  const css = {};
  for (const [k, v] of Object.entries(theme)) {
    if (typeof v === "string" && v.startsWith("#")) css[k.replace(/_/g, "-")] = v;
  }
  applyThemeCss(css);
}

function renderCalMini(b, t) {
  return "";
}

function deviceLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { timeout: 7000, maximumAge: 600000, enableHighAccuracy: false },
    );
  });
}

function wxWeatherHtml(geo, wx, hail) {
  const addr = (geo && geo.address) || (geo && geo.city) || "Your area";
  const line = wx && wx.ok
    ? `${Math.round(wx.temp_f)}°F · ${esc(wx.label || "Weather")}${wx.wind_mph ? ` · wind ${Math.round(wx.wind_mph)} mph` : ""}`
    : "";
  const hailRows = (hail || []).slice(0, 4);
  return `
    <div class="wx-boot">
      <div class="wx-addr">${esc(addr)}</div>
      ${line ? `<div class="wx-now">${line}</div>` : ""}
      ${hailRows.length ? `<div class="wx-hail">${hailRows.map((h) => `<div class="wx-hail-row"><span class="date">${esc(h.date)}</span><span class="size">${esc(h.size_in)} in</span> ${esc(h.location || "")}</div>`).join("")}</div>` : `<p class="muted">Tap the map on a roof for storm dossier.</p>`}
    </div>`;
}

const state = {
  tab: "today",
  health: null,
  today: null,
  goals: [],
  tasks: [],
  lists: [],
  docs: [],
  mail: [],
  budget: null,
  meals: null,
  studioProjects: [],
  studioProject: null,
  studioTemplates: [],
  studioId: null,
  studioPath: localStorage.getItem("pip.studioPath") || "",
  codeRoot: localStorage.getItem("pip.codeRoot") || "",
  codeKids: {},
  codeOpen: {},
  codeTabs: [],
  codeChat: [],
  codeBusy: false,
  codeModel: "",
  codeParent: "",
  codeFile: null,
  studioEditId: null,
  studioLevel: Number(localStorage.getItem("pip.studioLevel") || "1") || 1,
  studioBlockId: null,
  studioPrompt: localStorage.getItem("pip.studioPrompt") || "",
  previewKey: 0,
  briefing: null,
  board: { x: 80, y: 60, zoom: 0.85, cards: [], resumes: [], jobs: [], selected: null, clip: localStorage.getItem("pip.clip") !== "0", panel: localStorage.getItem("pip.boardPanel") === "1" },
  profile: null,
  profileUrl: localStorage.getItem("pip.profileUrl") || "",
  tts: true,
  recording: false,
  listen: false,
  audio: null,
  micId: localStorage.getItem("pip.micId") || "",
  vuPeak: 0,
  speechPeak: 0,
  hang: 0,
  calibrating: false,
  calBuf: [],
  calFloor: parseFloat(localStorage.getItem("pip.noiseFloor") || "0") || 0,
  rmsHist: [],
  opps: [],
  oppId: null,
  oppKit: null,
  oppDetail: null,
  oppPane: "list",
  oppQuery: localStorage.getItem("pip.oppQuery") || "",
  oppKind: localStorage.getItem("pip.oppKind") || "all",
  oppScrapeUrl: "",
  vibe: {
    files: [],
    path: "",
    name: "",
    source: "",
    fft: { bass: 0, mid: 0, high: 0, energy: 0, bins: [], listening: false, source: "", error: "", device: "" },
    speed: parseFloat(localStorage.getItem("pip.vibeSpeed") || "1") || 1,
    bassGain: parseFloat(localStorage.getItem("pip.vibeBass") || "2") || 2,
    srcOpen: localStorage.getItem("pip.vibeSrc") === "1",
    mode: (localStorage.getItem("pip.vibeMode") === "action" ? "motivation" : (localStorage.getItem("pip.vibeMode") || "dance")),
    picked: false,
    actionKind: "",
    err: "",
  },
  wxConfig: null,
  calState: { calMonth: new Date().toISOString().slice(0, 7), calDay: new Date().toISOString().slice(0, 10) },
  calEvents: [],
  calEventsMonth: "",
};

function setStatus(msg) {
  $("#status").textContent = msg;
}

function paneMap(name) {
  const map = { today: "today", tasks: "tasks", vault: "vault", studio: "studio", code: "code", vibe: "vibe", board: "board", opp: "opp", mail: "mail", caps: "caps", meals: "meals", data: "data", hands: "hands" };
  return map[name] || name;
}

function isPhoneHud() {
  const h = location.hostname;
  return h !== "127.0.0.1" && h !== "localhost" && h !== "[::1]";
}

async function api(path, opts = {}) {
  const { timeout, headers, ...rest } = opts;
  const ctrl = new AbortController();
  const long = /\/(chat|briefing|code\/apply|voice\/transcribe)/.test(path);
  const ms = timeout === 0 ? 0 : (timeout ?? (long ? 120000 : 8000));
  const timer = ms ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    const res = await fetch(path, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      signal: rest.signal || ctrl.signal,
    });
    if (!res.ok) {
      if (res.status === 401 && !location.pathname.startsWith("/login")) {
        location.href = "/login";
      }
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.detail || JSON.stringify(j);
      } catch (_) {
        detail = await res.text();
      }
      throw new Error(detail);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("audio")) return res.blob();
    return res.json();
  } catch (e) {
    if (e && (e.name === "AbortError" || e.message === "The user aborted a request.")) {
      throw new Error("timed out");
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pct(n, d) {
  if (!d) return 0;
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
}

function tickClock() {
  const d = new Date();
  $("#clock").textContent = d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function renderPrivacy() {
  const r = (state.health && state.health.router) || {};
  const tog = $("#privacy-tog");
  const chip = $("#mode-chip");
  const privateOn = !!(r.privacy);
  if (tog) {
    tog.classList.toggle("on", privateOn);
    tog.classList.toggle("leaky", !privateOn);
    tog.textContent = privateOn ? "SECURE" : "LEAKY";
  }
  if (chip) {
    const labels = { secure: "SECURE", local: "LOCAL", leak: "LEAK", leaky: "LEAKY", cloud: "CLOUD" };
    const shown = privateOn ? "secure" : "leaky";
    chip.textContent = labels[shown] || "LEAKY";
    chip.classList.remove("leak", "leaky", "secure", "cloud", "local");
    chip.classList.add(shown);
  }
}

function fmtTok(n) {
  n = Math.max(0, Number(n) || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

function meter(label, value) {
  return `<div class="meter"><span class="lbl">${esc(label)}</span><span class="val">${esc(value)}</span></div>`;
}

function renderMeters() {
  const t = state.today || {};
  const extra = (t.routine || []).filter((r) => !r.slug);
  const rt = extra.length;
  const rd = extra.filter((r) => r.checked).length;
  const wx = t.weather && t.weather.ok ? `${Math.round(t.weather.temp_f)}F` : "—";
  const u = (state.health && state.health.router && state.health.router.usage) || {};
  const privateOn = !!(state.health && state.health.router && state.health.router.privacy);
  const acting = ((((state.health || {}).router || {}).main || {}).boost || {}).acting || {};
  const last = ((state.health || {}).router || {}).last || {};
  const brain = privateOn
    ? "OLLAMA"
    : (last.provider ? String(last.provider).toUpperCase() : (acting.id ? String(acting.id).toUpperCase() : ""));
  $("#meters").innerHTML = [
    meter("HP", `${rd}/${rt || 0}`),
    meter("WX", wx),
    meter("TOK", fmtTok(u.tokens)),
    brain ? meter("BRAIN", brain) : "",
  ].join("");
}

function addLog(role, text, cls) {
  const div = document.createElement("div");
  div.className = `bubble ${cls || role}`;
  div.innerHTML = `<div class="who">${role === "user" ? "YOU" : "PIP"}</div><div>${esc(text)}</div>`;
  $("#log").appendChild(div);
  $("#log").scrollTop = $("#log").scrollHeight;
}

const PRIMARY_TABS = new Set(["today", "wx", "studio", "board", "opp", "code", "vibe", "tasks", "mail", "meals"]);

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const more = $("#tab-more");
  if (more) more.classList.toggle("on", !PRIMARY_TABS.has(tab));
  if (tab !== "board") state.detail = false;
  renderView();
}

function inspect(title, html) {
  $("#inspect-h").textContent = title;
  $("#inspect-body").innerHTML = html;
  state.detail = true;
  if (state.tab === "board") {
    state.board.panel = true;
    localStorage.setItem("pip.boardPanel", "1");
  }
  $("#workspace").classList.add("detail-on");
  $("#workspace").classList.remove("panel-off");
}

function closeInspect() {
  state.detail = false;
  if (state.tab === "board") {
    state.board.panel = false;
    localStorage.setItem("pip.boardPanel", "0");
  }
  $("#workspace").classList.remove("detail-on");
}

function focusPane(focus) {
  if (!focus || !focus.pane) return;
  const tab = paneMap(focus.pane);
  if (tab !== state.tab) switchTab(tab);
  if (focus.draft_id) openMail(focus.draft_id);
  if (focus.doc_id) openDoc(focus.doc_id);
  if (focus.project_id) state.studioId = focus.project_id;
  if (focus.opp_id) state.oppId = focus.opp_id;
}

async function refreshToday() {
  state.today = await api("/api/today");
  renderMeters();
  if (state.tab === "today") renderView();
  if (state.tab === "vibe") paintVibeAction();
}

async function loadTabData() {
  if (state.tab === "today") await refreshToday();
  if (state.tab === "wx") {
    if (!state.wxConfig) state.wxConfig = await api("/api/storm/map");
  }
  if (state.tab === "tasks") {
    state.goals = await api("/api/goals");
    state.tasks = await api("/api/tasks?status=open");
    state.lists = await api("/api/lists");
  }
  if (state.tab === "vault") state.docs = await api("/api/docs");
  if (state.tab === "mail") state.mail = await api("/api/mail");
  if (state.tab === "caps") state.budget = await api("/api/budget");
  if (state.tab === "meals") state.meals = await api("/api/meals");
  if (state.tab === "studio") await loadStudio();
  if (state.tab === "code") await loadCode();
  if (state.tab === "vibe") await loadVibe();
  if (state.tab === "board") await loadBoard();
    if (state.tab === "opp") {
    state.opps = await api("/api/opp");
    try { state.oppKit = await api("/api/opp/kit"); } catch (_) { state.oppKit = null; }
    if (state.oppId && !(state.opps || []).some((o) => o.id === state.oppId)) {
      state.oppId = null;
      state.oppDetail = null;
    }
    if (!state.oppId && state.opps[0]) state.oppId = state.opps[0].id;
    if (state.oppId) {
      try { state.oppDetail = await api(`/api/opp/${state.oppId}`); } catch (_) { state.oppDetail = null; }
    }
  }
  if (state.tab === "data") {
    state.health = await api("/api/health");
    try { state.profile = await api("/api/profile"); } catch (_) { state.profile = null; }
    try { state.brainKeys = await api("/api/brains/keys"); } catch (_) { state.brainKeys = { keys: [] }; }
  }
  if (state.tab === "hands") state.hands = await api("/api/hands");
}

function renderView() {
  const b = $("#view-body");
  const desk = state.tab === "board";
  const code = state.tab === "code";
  const vibe = state.tab === "vibe";
  const wx = state.tab === "wx";
  if (!code) flushIdeEditor();
  if (!vibe) pauseVibeGl();
  if (!wx && state._wxMap) { state._wxMap.remove(); state._wxMap = null; state._wxPin = null; }
  b.classList.toggle("board-mode", desk);
  b.classList.toggle("studio-mode", state.tab === "studio");
  b.classList.toggle("code-mode", code);
  b.classList.toggle("vibe-mode", vibe);
  document.body.classList.toggle("tab-board", desk);
  document.body.classList.toggle("tab-code", code);
  document.body.classList.toggle("tab-vibe", vibe);
  document.body.classList.toggle("tab-wx", wx);
  const ws = $("#workspace");
  ws.classList.toggle("board-desk", desk);
  ws.classList.toggle("code-ide", code);
  if (desk) {
    ws.classList.toggle("panel-off", !state.board.panel);
    ws.classList.toggle("detail-on", !!state.board.panel);
  } else {
    ws.classList.toggle("detail-on", !!state.detail && !code);
  }
  const draw = {
    today: renderToday,
    wx: renderWx,
    tasks: renderTasks,
    vault: renderVault,
    mail: renderMail,
    caps: renderCaps,
    meals: renderMeals,
    studio: renderStudio,
    code: renderCode,
    vibe: renderVibe,
    board: renderBoard,
    opp: renderOpp,
    hands: renderHands,
    data: renderData,
  };
  (draw[state.tab] || renderToday)(b);
}

function renderToday(b) {
  const t = state.today || {};
  const wx = t.weather || {};
  const wxLine = wx.ok
    ? `${esc(wx.city || "")} // ${Math.round(wx.temp_f)}F // ${esc(wx.label)}`
    : esc(wx.error || "Set a city in DATA.");
  const tasks = [...(t.overdue || []), ...(t.due_today || []), ...(t.top_tasks || [])].slice(0, 3);
  const extra = (t.routine || []).filter((r) => !r.slug);
  const extraDone = extra.filter((r) => r.checked).length;
  const day = t.date || "";
  const brief = state.briefing && state.briefing.date === day ? state.briefing.text : "";
  const money = t.budget || {};
  const mot = t.motivation || {};
  const hour = new Date().getHours();
  const shot = mot.next && mot.next.shot;
  const showShot = shot && hour >= 5 && hour < 22;
  const kind = (mot.next && mot.next.kind) || "wake";
  const kindHint = kind === "inspire" ? "let it in" : kind === "audit" ? "look inward" : kind === "act" ? "then move" : kind === "pip" ? "pip's still going" : "one shot · go do it";
  b.innerHTML = `
    <div class="today-desk">
      <div id="cal-root"></div>
      <div class="today-side">
        <div class="wx">${wxLine}</div>
        ${showShot ? `
          <div class="morning-now">
            <button type="button" id="today-action" class="shot">${esc(shot)}</button>
            <p class="muted">${esc((mot.label || "").toLowerCase())} · ${kindHint}</p>
          </div>` : ""}
        <div class="brief-card">${brief ? `<div class="doc-body">${esc(brief)}</div>` : `<p class="muted">${isPhoneHud() ? "Tap AGAIN for the briefing." : "Listening for morning…"}</p>`}</div>
        <div class="today-now">
          ${tasks.map((x) => `
            <div class="row" data-task="${x.id}">
              <span><span class="pri">P${x.priority}</span> ${esc(x.title)}</span>
              <span class="muted">${esc(x.due_date || "")}</span>
            </div>`).join("") || `<p class="muted">Clear deck. Tell Pip when something matters.</p>`}
        </div>
        <div class="today-strip">
          ${extra.length ? `<button type="button" id="today-checks">CHECKS ${extraDone}/${extra.length}</button>` : ""}
          <span>P ${t.macros ? Math.round(t.macros.remaining.protein_g) : "--"}g</span>
          <span>IN ${money.income_run_rate ?? "--"}</span>
          <span>SUBS ${money.subs_month ?? "--"}</span>
          <button type="button" id="brief-again">AGAIN</button>
        </div>
      </div>
    </div>
  `;
  paintDeskCalendar(b.querySelector("#cal-root"));
  const checks = b.querySelector("#today-checks");
  if (checks) checks.onclick = () => inspectRoutine(t);
  const again = b.querySelector("#brief-again");
  if (again) again.onclick = () => fillBriefing(true);
  if (!brief && !isPhoneHud()) fillBriefing(false);
  const go = b.querySelector("#today-action");
  if (go) go.onclick = () => openVibeAction();
}

async function loadDeskCalEvents(month) {
  if (state.calEventsMonth === month && state.calEvents.length) return state.calEvents;
  try {
    state.calEvents = await api(`/api/events?month=${encodeURIComponent(month)}`);
    state.calEventsMonth = month;
  } catch {
    state.calEvents = [];
  }
  return state.calEvents;
}

async function paintDeskCalendar(root, reloadMonth) {
  if (!root || !window.pipCal) return;
  const month = state.calState.calMonth || pipCal.ym();
  if (reloadMonth !== false) await loadDeskCalEvents(month);
  pipCal.render(root, state.calState, state.calEvents, {
    esc,
    onChange: (m, reload) => paintDeskCalendar(root, reload !== false),
    onAdd: async (ev) => {
      try {
        await api("/api/events", {
          method: "POST",
          body: JSON.stringify({
            title: ev.title,
            event_date: ev.event_date,
            event_time: ev.event_time || "",
            note: ev.note || "",
          }),
        });
        state.calEventsMonth = "";
        await loadDeskCalEvents(state.calState.calMonth);
        paintDeskCalendar(root, false);
        setStatus("EVENT ADDED");
      } catch (e) {
        setStatus(String(e.message || e));
      }
    },
    onDelete: async (id) => {
      try {
        await api(`/api/events/${id}`, { method: "DELETE" });
        state.calEventsMonth = "";
        await loadDeskCalEvents(state.calState.calMonth);
        paintDeskCalendar(root, false);
        setStatus("EVENT REMOVED");
      } catch (e) {
        setStatus(String(e.message || e));
      }
    },
  });
}

function renderWx(b) {
  const cfg = state.wxConfig || { center: { lat: 39.74, lon: -104.99 }, layers: [] };
  const c = cfg.center || {};
  const bootWx = cfg.weather || {};
  b.innerHTML = `
    <div class="wx-desk">
      <div class="wx-layers" id="wx-layers">${(cfg.layers || []).map((l) => `<button type="button" data-layer="${esc(l.id)}" class="${l.kind === "overlay" ? "overlay" : ""} ${l.id === "dark" || l.id === "radar" ? "on" : ""}">${esc(l.label)}</button>`).join("")}</div>
      <div id="wx-map" class="wx-map"></div>
      <div id="wx-panel" class="wx-panel scroll">${wxWeatherHtml({ address: c.city, city: c.city }, bootWx, [])}</div>
    </div>`;
  if (!window.L) {
    b.innerHTML = `<p class="muted">Leaflet failed to load.</p>`;
    return;
  }
  initWxMap(b, cfg, c);
}

async function initWxMap(b, cfg, center) {
  const geo = await deviceLocation();
  const lat = geo?.lat ?? center.lat ?? 39.74;
  const lon = geo?.lon ?? center.lon ?? -104.99;
  state._wxLat = lat;
  state._wxLon = lon;
  state._wxMap = window.L.map($("#wx-map")).setView([lat, lon], geo ? 12 : 11);
  state._wxLayers = {};
  state._wxOverlays = {};
  state._wxActiveOverlays = new Set(["radar"]);
  for (const layer of cfg.layers || []) {
    const tile = window.L.tileLayer(layer.url, { attribution: layer.attribution || "", opacity: layer.opacity ?? 1, maxZoom: 19 });
    if (layer.kind === "overlay") state._wxOverlays[layer.id] = tile;
    else state._wxLayers[layer.id] = tile;
  }
  (state._wxLayers.dark || state._wxLayers.osm || Object.values(state._wxLayers)[0])?.addTo(state._wxMap);
  Object.keys(state._wxOverlays).forEach((id) => {
    if (state._wxActiveOverlays.has(id)) state._wxOverlays[id].addTo(state._wxMap);
  });
  state._wxPin = window.L.marker([lat, lon]).addTo(state._wxMap);
  $("#wx-layers").onclick = (e) => {
    const btn = e.target.closest("[data-layer]");
    if (!btn) return;
    const id = btn.dataset.layer;
    if (state._wxOverlays[id]) {
      if (state._wxActiveOverlays.has(id)) {
        state._wxActiveOverlays.delete(id);
        state._wxMap.removeLayer(state._wxOverlays[id]);
      } else {
        state._wxActiveOverlays.add(id);
        state._wxOverlays[id].addTo(state._wxMap);
      }
      btn.classList.toggle("on", state._wxActiveOverlays.has(id));
      return;
    }
    Object.values(state._wxLayers).forEach((l) => state._wxMap.removeLayer(l));
    state._wxLayers[id]?.addTo(state._wxMap);
    Object.keys(state._wxOverlays).forEach((oid) => {
      if (state._wxActiveOverlays.has(oid)) state._wxOverlays[oid].addTo(state._wxMap);
    });
    $("#wx-layers").querySelectorAll("button:not(.overlay)").forEach((x) => x.classList.toggle("on", x === btn));
  };
  setTimeout(() => state._wxMap?.invalidateSize(), 120);
  try {
    const pin = await api("/api/storm/pin", { method: "POST", body: JSON.stringify({ lat, lon }) });
    $("#wx-panel").innerHTML = wxWeatherHtml(pin.geo || { city: center.city }, pin.weather || cfg.weather, pin.hail);
  } catch (_) {
    /* keep boot panel */
  }
  wireWxMapClick();
}

function wireWxMapClick() {
  async function paintHail(hailRows, windRows) {
    if (!state._wxMap || !window.L) return;
    if (state._wxHailLayer) state._wxHailLayer.remove();
    if (state._wxWindLayer) state._wxWindLayer.remove();
    state._wxHailLayer = window.L.layerGroup();
    state._wxWindLayer = window.L.layerGroup();
    for (const h of (hailRows || []).slice(0, 40)) {
      const sz = parseFloat(h.size_in);
      const r = Number.isNaN(sz) ? 6 : Math.min(18, 4 + sz * 4);
      const color = Number.isNaN(sz) ? "#7dff5a" : sz >= 2 ? "#ff3a3a" : sz >= 1 ? "#d4a84b" : "#7dff5a";
      window.L.circleMarker([h.lat, h.lon], {
        radius: r,
        color,
        fillColor: color,
        fillOpacity: 0.7,
        weight: 1,
      })
        .bindPopup(`${h.date} · ${h.size_in} in hail<br>${h.location}, ${h.state}<br>${h.distance_km} km from pin`)
        .addTo(state._wxHailLayer);
    }
    for (const w of (windRows || []).slice(0, 40)) {
      const mph = Number(w.wind_mph) || 0;
      window.L.circleMarker([w.lat, w.lon], {
        radius: Math.min(16, 4 + mph / 12),
        color: "#4a9eff",
        fillColor: "#4a9eff",
        fillOpacity: 0.55,
        weight: 1,
      })
        .bindPopup(`${w.date} · ${mph} mph wind<br>${w.location}, ${w.state}<br>${w.distance_km} km from pin`)
        .addTo(state._wxWindLayer);
    }
    state._wxHailLayer.addTo(state._wxMap);
    state._wxWindLayer.addTo(state._wxMap);
  }
  async function paintDossier(data) {
    const storms = data.storms || [];
    const hail = data.hail || [];
    const wind = data.wind || [];
    const news = data.news || [];
    const addr = data.address || "";
    const z = data.zillow_url || (addr ? `https://www.zillow.com/homes/${encodeURIComponent(addr)}_rb/` : "");
    await paintHail(hail, wind);
    $("#wx-panel").innerHTML = `
      <div class="wx-addr">${esc(addr)}</div>
      <div class="wx-links">${z ? `<a href="${esc(z)}" target="_blank" rel="noopener">ZILLOW SEARCH</a>` : ""}
        <button type="button" id="wx-deep" class="primary">REFRESH DEEP</button></div>
      <p class="muted">Reports within ~15 km of this pin. Hail size and wind are NOAA SPC.</p>
      <div class="wx-contacts">
        ${data.owner_name ? `<div>Owner: ${esc(data.owner_name)}</div>` : ""}
        ${data.owner_phone ? `<div>Phone: ${esc(data.owner_phone)}</div>` : ""}
        ${data.owner_email ? `<div>Email: ${esc(data.owner_email)}</div>` : ""}
      </div>
      <h4>HAIL NEAR PIN</h4>
      <div class="wx-hail">${hail.length ? hail.slice(0, 14).map((h) => `
        <div class="wx-hail-row"><span class="date">${esc(h.date)}</span>
        <span class="size">${esc(h.size_in)} in</span>
        <span class="dist">${esc(String(h.distance_km))} km</span>
        ${esc(h.location)}, ${esc(h.state)}</div>`).join("") : `<p class="muted">No hail this close to the pin.</p>`}</div>
      <h4>WIND NEAR PIN</h4>
      <div class="wx-wind">${wind.length ? wind.slice(0, 12).map((w) => `
        <div class="wx-hail-row"><span class="date">${esc(w.date)}</span>
        <span class="size">${esc(String(w.wind_mph))} mph</span>
        <span class="dist">${esc(String(w.distance_km))} km</span>
        ${esc(w.location)}, ${esc(w.state)}</div>`).join("") : `<p class="muted">No wind reports this close.</p>`}</div>
      <h4>STORM DATES (THIS PIN)</h4>
      <div class="wx-storms">${storms.slice(0, 16).map((s) => `<div class="wx-storm"><span class="date">${esc(s.date)}</span><span class="score">${esc(String(s.wind_mph || s.score))}${s.wind_mph ? " mph" : ""}</span>${esc((s.reasons || []).join(" · ") || s.label)}</div>`).join("") || `<p class="muted">No scored days yet.</p>`}</div>
      <h4>NEWS</h4>
      <div class="wx-news">${news.slice(0, 10).map((n) => `<a href="${esc(n.url)}" target="_blank">${esc(n.title)}</a>`).join("") || `<p class="muted">Run DEEP RESEARCH for headlines.</p>`}</div>`;
    const deep = $("#wx-deep");
    if (deep) deep.onclick = async () => {
      setStatus("DEEP RESEARCH…");
      const out = await api("/api/storm/research", { method: "POST", body: JSON.stringify({ lat: state._wxLat, lon: state._wxLon, address: addr, deep: true }) });
      await paintDossier(out);
      setStatus("DOSSIER UPDATED");
    };
  }
  state._wxMap.on("click", async (e) => {
    state._wxLat = e.latlng.lat;
    state._wxLon = e.latlng.lng;
    if (state._wxPin) state._wxPin.setLatLng(e.latlng);
    else state._wxPin = window.L.marker(e.latlng).addTo(state._wxMap);
    setStatus("RESEARCHING…");
    $("#wx-panel").innerHTML = `<p class="muted">Looking up address…</p>`;
    try {
      const out = await api("/api/storm/research", { method: "POST", body: JSON.stringify({ lat: state._wxLat, lon: state._wxLon, deep: true }) });
      await paintDossier(out);
      setStatus("WX DOSSIER");
    } catch (err) {
      $("#wx-panel").innerHTML = `<p class="muted">${esc(String(err.message || err))}</p>`;
      setStatus(String(err.message || err));
    }
  });
}

function inspectRoutine(t) {
  const extra = (t.routine || []).filter((r) => !r.slug);
  inspect("CHECKS", `
    <p class="muted">One thing at a time lives in VIBE MOTIVATION. This is the rest.</p>
    ${extra.map((r) => `
      <label class="check">
        <input type="checkbox" data-routine="${r.id}" ${r.checked ? "checked" : ""} />
        ${esc(r.title)}
      </label>`).join("") || "<p class='muted'>Nothing else on the board.</p>"}
  `);
  document.querySelectorAll("#inspect-body [data-routine]").forEach((el) => {
    el.addEventListener("change", async () => {
      await api(`/api/routine/${el.dataset.routine}/check`, {
        method: "POST",
        body: JSON.stringify({ done: el.checked }),
      });
      await refreshToday();
    });
  });
}

async function fillBriefing(force) {
  const day = (state.today && state.today.date) || new Date().toISOString().slice(0, 10);
  if (!force && state.briefing && state.briefing.date === day) return;
  if (state._briefingBusy) return;
  state._briefingBusy = true;
  if (force) state.briefing = null;
  setStatus("MORNING…");
  try {
    const out = await api("/api/briefing", { method: "POST", body: JSON.stringify({ days: 7, save: false }) });
    state.briefing = { date: day, text: out.text };
    if (state.tab === "today") renderView();
    setStatus("READY");
  } catch (e) {
    setStatus("BRIEFING FAILED");
    if (state.tab === "today") {
      const card = document.querySelector(".brief-card");
      if (card) card.innerHTML = `<p class="muted">${esc(e.message || e)}</p>`;
    }
  } finally {
    state._briefingBusy = false;
  }
}

function renderTasks(b) {
  b.innerHTML = `
    <h3>GOALS</h3>
    ${(state.goals || []).map((g) => `
      <div class="row">
        <span><span class="pri">P${g.priority}</span> ${esc(g.title)}</span>
        <span class="muted">${esc(g.horizon)} // ${esc(g.status)}</span>
      </div>`).join("") || "<p class='muted'>No goals yet.</p>"}
    <h3>OPEN TASKS</h3>
    ${(state.tasks || []).map((x) => `
      <div class="row" data-task="${x.id}">
        <span><input type="checkbox" data-done="${x.id}" /> <span class="pri">P${x.priority}</span> ${esc(x.title)}</span>
        <span class="muted">${esc(x.due_date || x.goal_title || "")}</span>
      </div>`).join("") || "<p class='muted'>Inbox empty.</p>"}
    <h3>LISTS</h3>
    ${(state.lists || []).map((l) => `
      <div class="row"><span>${esc(l.title)}</span><span class="muted">${(l.items || []).length}</span></div>
      ${(l.items || []).map((it) => `
        <label class="check"><input type="checkbox" data-li="${it.id}" ${it.done ? "checked" : ""} /> ${esc(it.text)}</label>
      `).join("")}
    `).join("")}
    <p class="muted">Create goals, tasks, and lists by talking to Pip.</p>
  `;
  b.querySelectorAll("[data-done]").forEach((el) => {
    el.addEventListener("change", async () => {
      await api(`/api/tasks/${el.dataset.done}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
      await loadTabData();
      renderView();
      refreshToday();
    });
  });
  b.querySelectorAll("[data-li]").forEach((el) => {
    el.addEventListener("change", async () => {
      await api(`/api/list-items/${el.dataset.li}`, { method: "PATCH", body: JSON.stringify({ done: el.checked }) });
    });
  });
}

function renderVault(b) {
  b.innerHTML = `
    ${(state.docs || []).map((d) => `
      <div class="row" data-doc="${d.id}">
        <span>${esc(d.title)}</span>
        <span class="muted">${esc((d.updated_at || "").slice(0, 16))}</span>
      </div>`).join("") || "<p class='muted'>Vault empty. Ask Pip to write a one-pager.</p>"}
  `;
  b.querySelectorAll("[data-doc]").forEach((el) => {
    el.onclick = () => openDoc(el.dataset.doc);
  });
}

async function openDoc(id) {
  const doc = await api(`/api/docs/${id}`);
  inspect("VAULT", `
    <h2>${esc(doc.title)}</h2>
    <p class="muted">${esc(doc.filename)}</p>
    <div class="mail-body doc-body">${esc(doc.body)}</div>
  `);
}

function readingLevel(text) {
  const raw = String(text || "").trim();
  const words = raw.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  if (!words.length) {
    return { grade: null, ease: null, label: "empty", words: 0, sentences: 0, avg_sentence: 0, syllables: 0 };
  }
  const sentences = Math.max(1, (raw.split(/[.!?]+/).filter((p) => p.trim()).length) || 1);
  const sylOf = (word) => {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    let n = 0, prev = false;
    for (const ch of w) {
      const v = "aeiouy".includes(ch);
      if (v && !prev) n += 1;
      prev = v;
    }
    if (w.endsWith("e") && !w.endsWith("le") && !w.endsWith("ye") && n > 1) n -= 1;
    if (w.endsWith("ed") && w.length > 3 && !"aeiouy".includes(w[w.length - 3]) && n > 1) n -= 1;
    return Math.max(1, n);
  };
  const syllables = words.reduce((s, w) => s + sylOf(w), 0);
  const wps = words.length / sentences;
  const spw = syllables / words.length;
  const grade = Math.max(1, Math.min(18, Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10));
  const ease = Math.max(0, Math.min(100, Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10));
  const label = grade <= 6 ? "plain" : grade <= 8 ? "clear" : grade <= 10 ? "professional" : grade <= 12 ? "dense" : "hard";
  return { grade, ease, label, words: words.length, sentences, avg_sentence: Math.round(wps * 10) / 10, syllables };
}

function mailReading(m) {
  return (m && m.reading && m.reading.label) ? m.reading : readingLevel(m && m.body);
}

function renderMail(b) {
  b.innerHTML = `
    ${(state.mail || []).map((m) => {
      const r = mailReading(m);
      const grade = r.grade != null ? `G${r.grade}` : "";
      const label = r.label && r.label !== "empty" ? r.label : "";
      return `
      <div class="row" data-mail="${m.id}">
        <span>${esc(m.subject || "(no subject)")}</span>
        <span class="muted">${esc(m.to_addr || "")} ${grade ? `// ${esc(grade)} ${esc(label)}` : ""}</span>
      </div>`;
    }).join("") || "<p class='muted'>No drafts. Ask Pip to write an email.</p>"}
  `;
  b.querySelectorAll("[data-mail]").forEach((el) => {
    el.onclick = () => openMail(el.dataset.mail);
  });
}

function readingBlock(r) {
  if (!r || r.label === "empty" || r.grade == null) {
    return `<div class="read-level"><span class="muted">READING // empty</span></div>`;
  }
  const pct = Math.max(8, Math.min(100, Math.round(((r.grade - 1) / 17) * 100)));
  const tone = r.grade <= 10 ? "ok" : r.grade <= 12 ? "mid" : "hot";
  return `
    <div class="read-level">
      <div class="read-h">READING // GRADE ${esc(r.grade)} // ${esc(String(r.label).toUpperCase())}</div>
      <div class="read-bar ${tone}"><i style="width:${pct}%"></i></div>
      <p class="muted">${r.words} words · ${r.sentences} sentences · ${r.avg_sentence} w/sent · ease ${r.ease}</p>
    </div>`;
}

async function openMail(id) {
  const m = await api(`/api/mail/${id}`);
  inspect("MAIL DRAFT", `
    <div class="field"><span>TO</span><div>${esc(m.to_addr || "(blank)")}</div></div>
    <div class="field"><span>SUBJECT</span><div>${esc(m.subject)}</div></div>
    ${readingBlock(mailReading(m))}
    <div class="field"><span>BODY</span><div class="mail-body" id="mail-body">${esc(m.body)}</div></div>
    <div class="actions">
      <button id="copy-mail">COPY BODY</button>
      <button class="primary" id="open-mail">OPEN MAIL APP</button>
    </div>
    <p class="hint" id="mail-hint">Pip does not send. Copy + open, then paste.</p>
  `);
  $("#copy-mail").onclick = async () => {
    const out = await api(`/api/mail/${id}/copy`, { method: "POST", body: "{}" });
    try { await navigator.clipboard.writeText(out.body); } catch (_) {}
    $("#mail-hint").textContent = "Body copied. Paste into the new message.";
  };
  $("#open-mail").onclick = async () => {
    const out = await api(`/api/mail/${id}/open`, { method: "POST", body: "{}" });
    try { await navigator.clipboard.writeText(out.copied || m.body); } catch (_) {}
    $("#mail-hint").textContent = out.hint || "Body copied. Paste into the new message.";
    setStatus("MAIL CLIENT LAUNCHED");
  };
}

function money(n) {
  if (n === null || n === undefined || n === "") return "--";
  const x = Number(n);
  if (Number.isNaN(x)) return "--";
  return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function renderCaps(b) {
  const s = state.budget || {};
  b.innerHTML = `
    <div class="grid-2">
      <div><div class="muted">INCOME / MO</div><div class="num">${money(s.income_run_rate)}</div></div>
      <div><div class="muted">SUBS / MO</div><div class="num">${money(s.subs_month)}</div></div>
      <div><div class="muted">DEBT</div><div class="num">${money(s.debt_total)}</div></div>
      <div><div class="muted">INVESTED</div><div class="num">${money(s.invest_total)}</div></div>
    </div>
    <p class="muted">Booked this month ${money(s.income)} in / ${money(s.spent)} out // net ${money(s.net)}</p>
    <h3>INCOME</h3>
    ${(s.income_streams || []).map((i) => `
      <div class="row"><span>${esc(i.name)}</span><span>${money(i.amount)} / ${esc(i.cadence)}</span></div>
    `).join("") || "<p class='muted'>Tell Pip: add income stream client retainer 2500 monthly.</p>"}
    <div class="caps-add">
      <input id="inc-name" placeholder="source" /><input id="inc-amt" placeholder="amount" />
      <button id="inc-add">ADD</button>
    </div>
    <h3>SUBSCRIPTIONS</h3>
    ${(s.subscriptions || []).map((x) => `
      <div class="row"><span>${esc(x.name)}</span><span>${money(x.amount)} / ${esc(x.cadence)}</span></div>
    `).join("") || "<p class='muted'>Tell Pip: add subscription Adobe 60 monthly.</p>"}
    <div class="caps-add">
      <input id="sub-name" placeholder="name" /><input id="sub-amt" placeholder="amount" />
      <button id="sub-add">ADD</button>
    </div>
    <h3>DEBT</h3>
    ${(s.debts || []).map((d) => `
      <div class="row"><span>${esc(d.name)}</span><span>${money(d.balance)}${d.apr ? ` @ ${d.apr}%` : ""}</span></div>
    `).join("") || "<p class='muted'>Tell Pip: add debt car loan 8400 at 7.2 apr.</p>"}
    <div class="caps-add">
      <input id="debt-name" placeholder="name" /><input id="debt-bal" placeholder="balance" />
      <button id="debt-add">ADD</button>
    </div>
    <h3>INVESTMENTS</h3>
    ${(s.investments || []).map((i) => `
      <div class="row"><span>${esc(i.name)} <span class="muted">${esc(i.kind)}</span></span><span>${money(i.value)}</span></div>
    `).join("") || "<p class='muted'>Tell Pip: add investment brokerage 12000.</p>"}
    <div class="caps-add">
      <input id="inv-name" placeholder="name" /><input id="inv-val" placeholder="value" />
      <button id="inv-add">ADD</button>
    </div>
    <h3>MILEAGE</h3>
    ${(s.vehicles || []).map((v) => `
      <div class="row"><span>${esc(v.name)}</span><span>${money(v.odometer)} mi${v.mpg ? ` // ${v.mpg} mpg` : ""}</span></div>
    `).join("") || "<p class='muted'>Tell Pip: log mileage 88420 on the civic.</p>"}
    <div class="caps-add">
      <input id="car-name" placeholder="car" /><input id="car-odo" placeholder="odometer" />
      <button id="car-add">LOG</button>
    </div>
    <h3>LEDGER ${esc(s.month || "")}</h3>
    ${(s.transactions || []).map((tx) => `
      <div class="row">
        <span>${esc(tx.note || tx.category)} <span class="muted">${esc(tx.occurred_on)}</span></span>
        <span>${tx.amount}</span>
      </div>`).join("") || "<p class='muted'>No cash movements this month.</p>"}
  `;
  const post = async (path, body) => {
    const out = await api(path, { method: "POST", body: JSON.stringify(body) });
    state.budget = out.summary || (await api("/api/budget"));
    renderView();
  };
  $("#inc-add").onclick = () => post("/api/caps/income", { name: $("#inc-name").value, amount: Number($("#inc-amt").value) });
  $("#sub-add").onclick = () => post("/api/caps/subscriptions", { name: $("#sub-name").value, amount: Number($("#sub-amt").value) });
  $("#debt-add").onclick = () => post("/api/caps/debts", { name: $("#debt-name").value, balance: Number($("#debt-bal").value) });
  $("#inv-add").onclick = () => post("/api/caps/investments", { name: $("#inv-name").value, value: Number($("#inv-val").value) });
  $("#car-add").onclick = async () => {
    state.budget = await api("/api/caps/mileage", {
      method: "POST",
      body: JSON.stringify({ vehicle: $("#car-name").value || "Car", odometer: Number($("#car-odo").value) }),
    });
    state.budget = await api("/api/budget");
    renderView();
  };
}

function renderMeals(b) {
  const m = state.meals || {};
  const tgt = m.targets || {};
  const rem = (m.remaining && m.remaining.remaining) || {};
  const diet = (tgt.notes || "").trim();
  b.innerHTML = `
    <h3>TARGETS (WHAT YOU WANT)</h3>
    <p>KCAL ${tgt.kcal} // P ${tgt.protein_g}g // C ${tgt.carbs_g}g // F ${tgt.fat_g}g</p>
    <p class="muted">Remaining today: ${Math.round(rem.kcal || 0)} kcal / ${Math.round(rem.protein_g || 0)}g protein${diet ? ` // DIET ${esc(diet)}` : ""}</p>
    <h3>WANTED MEALS</h3>
    ${(m.wanted || []).map((w) => `
      <div class="row">
        <span>${esc(w.name)}</span>
        <span class="muted">${w.kcal} / P${w.protein_g} <button type="button" class="tiny" data-unwant="${w.id}">X</button></span>
      </div>
    `).join("") || "<p class='muted'>Tell Pip meals you want. Planning starts there.</p>"}
    <h3>PLAN ${esc(m.plan_date || "")}</h3>
    ${(m.plan || []).map((p) => `
      <div class="row"><span>${esc(p.slot)} // ${esc(p.meal_name)}</span><span class="muted">${p.kcal || 0}</span></div>
      ${p.ingredients ? `<p class="muted meal-ings">${esc(p.ingredients)}</p>` : ""}
    `).join("") || "<p class='muted'>No plan yet. Ask Pip, or REPLAN TODAY from wanted meals.</p>"}
    <h3>SHOPPING (THE GAP)</h3>
    ${(m.shopping || []).map((s) => `
      <label class="check"><input type="checkbox" data-shop="${s.id}" ${s.checked ? "checked" : ""} /> ${esc(s.name)} ${esc(s.quantity || "")}</label>
    `).join("") || "<p class='muted'>Empty until a plan has ingredients.</p>"}
    <div class="actions">
      <button class="primary" id="plan-btn">REPLAN TODAY</button>
      <button id="plan-clear">CLEAR TODAY</button>
      <button id="wanted-clear">CLEAR WANTED</button>
    </div>
    <p class="muted">REPLAN TODAY overwrites today's slots from WANTED. Ask Pip for a new menu as many times as you want — it replaces the tab, it does not stack.</p>
  `;
  const planBtn = b.querySelector("#plan-btn");
  if (planBtn) {
    planBtn.onclick = async () => {
      try {
        const out = await api("/api/meals/plan", { method: "POST", body: JSON.stringify({}) });
        state.meals = await api("/api/meals");
        renderView();
        setStatus(out.note ? String(out.note).slice(0, 80).toUpperCase() : `PLANNED ${(out.plan || []).length} SLOTS`);
      } catch (e) {
        setStatus(String(e.message || e));
      }
    };
  }
  const clearPlan = b.querySelector("#plan-clear");
  if (clearPlan) {
    clearPlan.onclick = async () => {
      await api("/api/meals/clear", { method: "POST", body: "{}" });
      state.meals = await api("/api/meals");
      renderView();
      setStatus("TODAY CLEARED");
    };
  }
  const clearWanted = b.querySelector("#wanted-clear");
  if (clearWanted) {
    clearWanted.onclick = async () => {
      await api("/api/meals/wanted/clear", { method: "POST", body: "{}" });
      state.meals = await api("/api/meals");
      renderView();
      setStatus("WANTED CLEARED");
    };
  }
  b.querySelectorAll("[data-unwant]").forEach((el) => {
    el.addEventListener("click", async () => {
      await api(`/api/meals/wanted/${el.dataset.unwant}`, { method: "DELETE" });
      state.meals = await api("/api/meals");
      renderView();
    });
  });
  b.querySelectorAll("[data-shop]").forEach((el) => {
    el.addEventListener("change", async () => {
      await api(`/api/shopping/${el.dataset.shop}/check?done=${el.checked}`, { method: "POST" });
    });
  });
}

async function loadStudio() {
  state.studioTemplates = await api("/api/studio/templates");
  state.studioProjects = await api("/api/studio/projects");
  const id = state.studioId || (state.studioProjects[0] && state.studioProjects[0].id);
  if (id) {
    const prev = state.studioId;
    state.studioId = id;
    state.studioProject = await api(`/api/studio/projects/${id}`);
    if (state.studioProject.source_path) state.studioPath = state.studioProject.source_path;
    if (prev !== id && state.studioProject.studio_level) {
      state.studioLevel = Math.max(1, Math.min(3, Number(state.studioProject.studio_level) || 1));
      state.studioEditId = null;
    }
  } else {
    state.studioProject = null;
  }
}

async function refreshStudio(keepPreview) {
  await loadStudio();
  if (!keepPreview) state.previewKey = Date.now();
  renderView();
}

function studioAssetById(id) {
  const assets = (state.studioProject && state.studioProject.assets) || [];
  return assets.find((a) => a.id === id) || null;
}

function studioEditAsset() {
  const assets = (state.studioProject && state.studioProject.assets) || [];
  if (!assets.length || !state.studioEditId) return null;
  return assets.find((x) => x.id === state.studioEditId) || null;
}

function xformNums(a) {
  return {
    scale: Math.max(0.2, Math.min(8, Number(a.scale) || 1)),
    panX: a.pan_x == null ? 0.5 : Math.max(0, Math.min(1, Number(a.pan_x))),
    panY: a.pan_y == null ? 0.5 : Math.max(0, Math.min(1, Number(a.pan_y))),
    rot: Number(a.rotate) || 0,
  };
}

function xformCss(a) {
  const n = xformNums(a);
  const px = n.panX * 100;
  const py = n.panY * 100;
  return `object-position:${px}% ${py}%;transform:scale(${n.scale}) rotate(${n.rot}deg);transform-origin:${px}% ${py}%;`;
}

function applyXformCss(a) {
  if (!a) return;
  const n = xformNums(a);
  const media = document.querySelector(".xform-media");
  if (media) {
    media.style.objectFit = "cover";
    media.style.objectPosition = `${n.panX * 100}% ${n.panY * 100}%`;
    media.style.transform = `scale(${n.scale}) rotate(${n.rot}deg)`;
    media.style.transformOrigin = `${n.panX * 100}% ${n.panY * 100}%`;
  }
  const scaleEl = document.querySelector("#xform-scale");
  const rotEl = document.querySelector("#xform-rot");
  const inspScale = document.querySelector("#insp-scale");
  const inspRot = document.querySelector("#insp-rot");
  const read = document.querySelector("#xform-read");
  if (scaleEl && document.activeElement !== scaleEl) scaleEl.value = String(n.scale);
  if (rotEl && document.activeElement !== rotEl) rotEl.value = String(n.rot);
  if (inspScale && document.activeElement !== inspScale) inspScale.value = String(n.scale);
  if (inspRot && document.activeElement !== inspRot) inspRot.value = String(n.rot);
  if (read) read.textContent = `${n.scale.toFixed(2)}×  ${n.rot.toFixed(0)}°`;
}

async function patchAssetXform(id, fields, refreshPage) {
  const proj = await api(`/api/studio/assets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  state.studioProject = proj;
  if (refreshPage && proj) {
    state.previewKey = Date.now();
    const img = document.querySelector(".studio-preview");
    if (img) img.src = `/api/studio/projects/${proj.id}/preview?t=${state.previewKey}`;
  }
  renderStudioInspect();
}

function bindXformStage(asset) {
  const clip = document.querySelector(".xform-clip");
  const media = document.querySelector(".xform-media");
  if (!clip || !media || !asset) return;
  applyXformCss(asset);
  let dragging = false;
  let last = null;
  let wheelT = 0;
  clip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    clip.setPointerCapture(e.pointerId);
  });
  clip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const a = studioAssetById(asset.id);
    if (!a) return;
    const dx = (e.clientX - last.x) / Math.max(1, clip.clientWidth);
    const dy = (e.clientY - last.y) / Math.max(1, clip.clientHeight);
    last = { x: e.clientX, y: e.clientY };
    a.pan_x = Math.max(0, Math.min(1, (a.pan_x == null ? 0.5 : Number(a.pan_x)) - dx));
    a.pan_y = Math.max(0, Math.min(1, (a.pan_y == null ? 0.5 : Number(a.pan_y)) - dy));
    applyXformCss(a);
  });
  const endDrag = async () => {
    if (!dragging) return;
    dragging = false;
    const a = studioAssetById(asset.id);
    if (!a) return;
    await patchAssetXform(a.id, { pan_x: a.pan_x, pan_y: a.pan_y }, true);
  };
  clip.addEventListener("pointerup", endDrag);
  clip.addEventListener("pointercancel", endDrag);
  clip.addEventListener("wheel", (e) => {
    e.preventDefault();
    const a = studioAssetById(asset.id);
    if (!a) return;
    const cur = Number(a.scale) || 1;
    a.scale = Math.max(0.2, Math.min(8, cur * (e.deltaY < 0 ? 1.08 : 0.92)));
    applyXformCss(a);
    clearTimeout(wheelT);
    wheelT = setTimeout(() => patchAssetXform(a.id, { scale: a.scale }, true), 180);
  }, { passive: false });
  const bindRange = (sel, key) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener("input", () => {
      const a = studioAssetById(asset.id);
      if (!a) return;
      a[key] = Number(el.value);
      applyXformCss(a);
    });
    el.addEventListener("change", async () => {
      const a = studioAssetById(asset.id);
      if (!a) return;
      await patchAssetXform(a.id, { [key]: Number(el.value) }, true);
    });
  };
  bindRange("#xform-scale", "scale");
  bindRange("#xform-rot", "rotate");
  const reset = document.querySelector("#xform-reset");
  if (reset) {
    reset.onclick = async () => {
      const a = studioAssetById(asset.id);
      if (a) {
        a.scale = 1;
        a.pan_x = 0.5;
        a.pan_y = 0.5;
        a.rotate = 0;
        applyXformCss(a);
      }
      await patchAssetXform(asset.id, { scale: 1, pan_x: 0.5, pan_y: 0.5, rotate: 0 }, true);
      renderView();
    };
  }
}

async function loadCode() {
  const root = state.codeRoot || "";
  const q = root ? `?path=${encodeURIComponent(root)}&depth=0` : "?depth=0";
  try {
    const tree = await api(`/api/code/tree${q}`);
    state.codeTree = tree;
    state.codeRoot = tree.root || state.codeRoot;
    state.codeParent = tree.parent || "";
    state.codeKids[state.codeRoot] = tree.entries || [];
    if (state.codeRoot) localStorage.setItem("pip.codeRoot", state.codeRoot);
  } catch (e) {
    state.codeTree = { root: state.codeRoot, entries: [], error: String(e.message || e) };
    state.codeKids[state.codeRoot || ""] = [];
  }
  if (!state._codeHistLoaded) {
    try {
      const hist = await api("/api/code/history");
      state.codeChat = (hist || []).map((m) => ({
        role: m.role === "user" ? "user" : "pip",
        text: m.content || "",
        tools: [],
      }));
    } catch (_) {
      state.codeChat = state.codeChat || [];
    }
    state._codeHistLoaded = true;
  }
  try {
    const h = state.health || await api("/api/health");
    state.health = h;
    state.codeModel = (h.ollama && (h.ollama.code || h.ollama.using)) || "";
  } catch (_) {}
}

function flushIdeEditor() {
  const ta = $("#ide-body");
  if (!ta || !ta.dataset.path) return;
  const tab = (state.codeTabs || []).find((t) => t.path === ta.dataset.path);
  if (!tab) return;
  tab.body = ta.value;
  tab.dirty = tab.body !== tab.saved;
}

function activeCodeTab() {
  const path = state.codeFile && state.codeFile.path;
  return (state.codeTabs || []).find((t) => t.path === path) || null;
}

function paintIdeTree() {
  const box = $("#ide-tree-body");
  if (!box) return;
  const root = state.codeRoot || "";
  const err = state.codeTree && state.codeTree.error;
  const rows = [];
  if (state.codeParent) {
    rows.push(`<div class="ide-row dir" data-codeup="1"><span class="ide-twist">◂</span><span class="ide-name">..</span></div>`);
  }
  const walk = (entries, depth) => {
    (entries || []).forEach((e) => {
      const on = state.codeFile && state.codeFile.path === e.path;
      const open = !!(e.dir && state.codeOpen[e.path]);
      rows.push(`
        <div class="ide-row ${e.dir ? "dir" : "file"} ${on ? "on" : ""}" data-codepath="${esc(e.path)}" data-dir="${e.dir ? "1" : "0"}" style="padding-left:${0.35 + depth * 0.85}rem">
          <span class="ide-twist">${e.dir ? (open ? "▾" : "▸") : "·"}</span>
          <span class="ide-name">${esc(e.name)}</span>
        </div>`);
      if (e.dir && open) walk(state.codeKids[e.path] || [], depth + 1);
    });
  };
  walk(state.codeKids[root] || [], 0);
  box.innerHTML = rows.join("") || `<p class="muted ide-empty">${esc(err || "Empty.")}</p>`;
  box.querySelectorAll("[data-codeup]").forEach((el) => {
    el.onclick = async () => {
      if (!state.codeParent) return;
      state.codeRoot = state.codeParent;
      localStorage.setItem("pip.codeRoot", state.codeRoot);
      await loadCode();
      paintIdeChrome();
      paintIdeTree();
    };
  });
  box.querySelectorAll("[data-codepath]").forEach((el) => {
    el.onclick = async () => {
      const path = el.dataset.codepath;
      if (el.dataset.dir === "1") {
        state.codeOpen[path] = !state.codeOpen[path];
        if (state.codeOpen[path] && !state.codeKids[path]) {
          try {
            const tree = await api(`/api/code/tree?path=${encodeURIComponent(path)}&depth=0`);
            state.codeKids[path] = tree.entries || [];
          } catch (e) { setStatus(String(e.message || e)); }
        }
        paintIdeTree();
        return;
      }
      try { await openCodeFile(path); } catch (e) { setStatus(String(e.message || e)); }
    };
  });
}

function paintIdeTabs() {
  const bar = $("#ide-tabs");
  if (!bar) return;
  const active = activeCodeTab();
  bar.innerHTML = (state.codeTabs || []).map((t) => `
    <div class="ide-tab ${active && active.path === t.path ? "on" : ""}" data-tabpath="${esc(t.path)}">
      <span>${esc(t.name)}${t.dirty ? " *" : ""}</span>
      <button type="button" class="x" data-closepath="${esc(t.path)}" title="Close">✕</button>
    </div>`).join("") || `<div class="ide-tab">no file open</div>`;
  bar.querySelectorAll("[data-tabpath]").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest("[data-closepath]")) return;
      flushIdeEditor();
      const tab = state.codeTabs.find((t) => t.path === el.dataset.tabpath);
      if (tab) {
        state.codeFile = tab;
        paintIdeTabs();
        paintIdeEditor(true);
        paintIdeTree();
      }
    };
  });
  bar.querySelectorAll("[data-closepath]").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      closeCodeTab(el.dataset.closepath);
    };
  });
}

function paintIdeEditor(force) {
  const ta = $("#ide-body");
  const name = $("#ide-file-name");
  const tab = activeCodeTab();
  if (!ta) return;
  if (!tab) {
    ta.value = "";
    ta.disabled = true;
    ta.dataset.path = "";
    if (name) name.textContent = "BUFFER";
    return;
  }
  ta.disabled = false;
  if (force || ta.dataset.path !== tab.path) {
    ta.value = tab.body;
    ta.dataset.path = tab.path;
  }
  if (name) name.textContent = tab.name + (tab.dirty ? " *" : "");
}

function paintIdeChat(force) {
  const log = $("#ide-log");
  if (!log) return;
  if (state.codeBusy && log.children.length && !force) return;
  const rows = (state.codeChat || []).map(ideBubbleHtml);
  log.innerHTML = rows.join("") || `<p class="muted ide-empty">Local coder on this GPU. Tree on the left, buffer in the middle, agent on the right. Ctrl+S saves. Ctrl+Enter sends.</p>`;
  log.scrollTop = log.scrollHeight;
}

function ideBubbleHtml(m) {
  const tools = (m.tools || []).map((t) => `<span class="ide-chip">${esc(t)}</span>`).join("");
  return `<div class="bubble ${m.role === "user" ? "user" : "pip"}"><div class="who">${m.role === "user" ? "YOU" : "PIP"}</div><div>${esc(m.text || "")}</div>${tools ? `<div>${tools}</div>` : ""}</div>`;
}

function paintIdeChrome() {
  const input = $("#code-root");
  if (input && input !== document.activeElement) input.value = state.codeRoot || "";
  const chip = $("#ide-model");
  if (chip) chip.textContent = state.codeModel || "local";
}

async function openCodeFile(path) {
  flushIdeEditor();
  let tab = state.codeTabs.find((t) => t.path === path);
  if (!tab) {
    const file = await api(`/api/code/file?path=${encodeURIComponent(path)}`);
    tab = { path: file.path, name: file.name, body: file.body, saved: file.body, dirty: false };
    state.codeTabs.push(tab);
  }
  state.codeFile = tab;
  paintIdeTabs();
  paintIdeEditor(true);
  paintIdeTree();
}

function closeCodeTab(path) {
  flushIdeEditor();
  const tab = state.codeTabs.find((t) => t.path === path);
  if (tab && tab.dirty && !confirm(`Close ${tab.name} without saving?`)) return;
  state.codeTabs = state.codeTabs.filter((t) => t.path !== path);
  if (state.codeFile && state.codeFile.path === path) {
    state.codeFile = state.codeTabs[state.codeTabs.length - 1] || null;
  }
  paintIdeTabs();
  paintIdeEditor(true);
  paintIdeTree();
}

async function saveIdeFile() {
  flushIdeEditor();
  const tab = activeCodeTab();
  if (!tab) { setStatus("NO FILE"); return; }
  try {
    await api("/api/code/file", { method: "PUT", body: JSON.stringify({ path: tab.path, body: tab.body }) });
    tab.saved = tab.body;
    tab.dirty = false;
    paintIdeTabs();
    paintIdeEditor();
    setStatus("SAVED");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function saveDirtyTabs() {
  flushIdeEditor();
  for (const tab of state.codeTabs) {
    if (!tab.dirty) continue;
    await api("/api/code/file", { method: "PUT", body: JSON.stringify({ path: tab.path, body: tab.body }) });
    tab.saved = tab.body;
    tab.dirty = false;
  }
  paintIdeTabs();
}

async function refreshWritten(path) {
  try {
    const file = await api(`/api/code/file?path=${encodeURIComponent(path)}`);
    let tab = state.codeTabs.find((t) => t.path === file.path);
    if (!tab) {
      tab = { path: file.path, name: file.name, body: file.body, saved: file.body, dirty: false };
      state.codeTabs.push(tab);
    } else if (!tab.dirty) {
      tab.body = file.body;
      tab.saved = file.body;
    }
    state.codeFile = tab;
    paintIdeTabs();
    paintIdeEditor(true);
    paintIdeTree();
  } catch (_) {}
}

const CODE_TOOL = {
  list_code_dir: "list",
  read_code_file: "read",
  write_code_file: "write",
  grep_code: "grep",
  run_code_cmd: "run",
};

async function sendCodeChat(selfUpgrade) {
  const input = $("#ide-input");
  if (!input || state.codeBusy) return;
  const prompt = input.value.trim();
  if (!prompt) { setStatus("SAY WHAT TO CHANGE"); return; }
  try { await saveDirtyTabs(); } catch (e) { setStatus(String(e.message || e)); return; }
  input.value = "";
  state.codeBusy = true;
  const sendBtn = $("#ide-send");
  if (sendBtn) sendBtn.disabled = true;
  state.codeChat.push({ role: "user", text: prompt, tools: [] });
  const pipMsg = { role: "pip", text: "", tools: [] };
  state.codeChat.push(pipMsg);
  paintIdeChat(true);
  setStatus(selfUpgrade ? "UPGRADING PIP…" : "EDITING…");
  try {
    const resp = await fetch("/api/code/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        path: state.codeRoot || null,
        open_path: state.codeFile ? state.codeFile.path : null,
        self_upgrade: !!selfUpgrade,
      }),
    });
    if (!resp.ok) {
      let detail = resp.statusText;
      try { const j = await resp.json(); detail = j.detail || JSON.stringify(j); } catch (_) {}
      throw new Error(detail);
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop();
      for (const ev of events) {
        if (!ev.startsWith("data: ")) continue;
        const data = JSON.parse(ev.slice(6));
        if (data.type === "status" && data.model) {
          state.codeModel = data.model;
          paintIdeChrome();
        } else if (data.type === "delta") {
          pipMsg.text += data.text || "";
          paintIdeChat(true);
        } else if (data.type === "tool") {
          const label = `${CODE_TOOL[data.name] || data.name}${data.args && data.args.path ? " " + String(data.args.path).split(/[\\/]/).pop() : ""}`;
          pipMsg.tools.push(label);
          paintIdeChat(true);
        } else if (data.type === "written") {
          await refreshWritten(data.path);
        } else if (data.type === "error") {
          pipMsg.text = data.text || pipMsg.text;
          paintIdeChat(true);
        } else if (data.type === "done") {
          if (data.model) state.codeModel = data.model;
          paintIdeChrome();
          await loadCode();
          paintIdeTree();
          setStatus((data.written || []).length ? `WROTE ${data.written.length}` : "DONE");
        }
      }
    }
  } catch (e) {
    pipMsg.text = pipMsg.text || String(e.message || e);
    paintIdeChat(true);
    setStatus("CODE ERROR");
  }
  state.codeBusy = false;
  if (sendBtn) sendBtn.disabled = false;
  if (input) input.focus();
}

function bindIde() {
  const open = async () => {
    const el = $("#code-root");
    state.codeRoot = (el && el.value.trim()) || state.codeRoot;
    localStorage.setItem("pip.codeRoot", state.codeRoot);
    state.codeOpen = {};
    await loadCode();
    paintIdeChrome();
    paintIdeTree();
  };
  $("#code-open").onclick = () => open().catch((e) => setStatus(String(e.message || e)));
  $("#code-browse").onclick = async () => {
    try {
      const out = await api("/api/studio/browse", { method: "POST", body: JSON.stringify({ path: state.codeRoot || "" }) });
      if (out.cancelled || !out.path) return;
      state.codeRoot = out.path;
      localStorage.setItem("pip.codeRoot", out.path);
      state.codeOpen = {};
      await loadCode();
      paintIdeChrome();
      paintIdeTree();
    } catch (e) { setStatus(String(e.message || e)); }
  };
  $("#ide-save").onclick = () => saveIdeFile();
  $("#ide-upgrade").onclick = () => sendCodeChat(true);
  $("#ide-restart").onclick = async () => {
    setStatus("RESTARTING…");
    try { await api("/api/code/restart", { method: "POST", body: "{}" }); } catch (_) {}
  };
  $("#ide-reset").onclick = async () => {
    try { await api("/api/code/reset", { method: "POST", body: "{}" }); } catch (_) {}
    state.codeChat = [];
    paintIdeChat(true);
    setStatus("CODE CHAT CLEARED");
  };
  $("#ide-send").onclick = () => sendCodeChat(false);
  const ta = $("#ide-body");
  ta.addEventListener("input", () => {
    const tab = activeCodeTab();
    if (!tab) return;
    tab.body = ta.value;
    tab.dirty = tab.body !== tab.saved;
    paintIdeTabs();
    const name = $("#ide-file-name");
    if (name) name.textContent = tab.name + (tab.dirty ? " *" : "");
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = s + 2;
      ta.dispatchEvent(new Event("input"));
    }
  });
  const box = $("#ide-input");
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendCodeChat(false);
    }
  });
}

function renderCode(b) {
  if (state.codeBusy && b.querySelector(".ide")) {
    paintIdeChrome();
    return;
  }
  flushIdeEditor();
  b.innerHTML = `
    <div class="ide">
      <div class="ide-bar">
        <input id="code-root" class="grow" value="${esc(state.codeRoot || "")}" />
        <button id="code-open">OPEN</button>
        <button id="code-browse">FIND</button>
        <button id="ide-save">SAVE</button>
        <button id="ide-upgrade">UPGRADE PIP</button>
        <button id="ide-restart">RESTART</button>
        <span class="ide-chip-model" id="ide-model">${esc(state.codeModel || "local")}</span>
      </div>
      <div class="ide-tree">
        <div class="ide-pane-h">FILES</div>
        <div class="ide-tree-body" id="ide-tree-body"></div>
      </div>
      <div class="ide-edit">
        <div class="ide-pane-h"><span id="ide-file-name">BUFFER</span></div>
        <div class="ide-tabs" id="ide-tabs"></div>
        <textarea class="ide-buf" id="ide-body" spellcheck="false" disabled></textarea>
      </div>
      <div class="ide-chat">
        <div class="ide-pane-h">AGENT <button type="button" id="ide-reset" title="Clear agent chat">CLEAR</button></div>
        <div class="ide-log" id="ide-log"></div>
        <div class="ide-composer">
          <textarea id="ide-input" rows="3" placeholder="What should change. Local coder, so be specific."></textarea>
          <div class="ide-actions">
            <button class="primary" id="ide-send">SEND</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bindIde();
  paintIdeChrome();
  paintIdeTree();
  paintIdeTabs();
  paintIdeEditor(true);
  paintIdeChat(true);
}

function studioLevel() {
  return Math.max(1, Math.min(3, Number(state.studioLevel) || 1));
}

function parseStudioLayout(proj) {
  try {
    const data = JSON.parse((proj && proj.layout_json) || "");
    if (data && Array.isArray(data.pages) && data.pages[0]) return data;
  } catch (_) {}
  return null;
}

function studioPage(proj) {
  const layout = parseStudioLayout(proj);
  return (layout && layout.pages[0]) || { w: 1275, h: 1650, bg: "#f3efe4", blocks: [] };
}

function studioBar(level, projects, proj) {
  const opts = (projects || []).map((p) => `<option value="${p.id}" ${p.id === state.studioId ? "selected" : ""}>${esc(p.title)}</option>`).join("");
  return `<div class="studio-bar">
    <div class="studio-levels">
      <button type="button" class="pill ${level === 1 ? "on" : ""}" data-level="1">1</button>
      <button type="button" class="pill ${level === 2 ? "on" : ""}" data-level="2">2</button>
      <button type="button" class="pill ${level === 3 ? "on" : ""}" data-level="3">3</button>
    </div>
    <select id="studio-pick">${opts || `<option value="">—</option>`}</select>
    <button type="button" id="studio-find">OPEN</button>
    <button type="button" id="studio-blank">NEW</button>
    <span class="grow"></span>
    ${proj ? `<button type="button" class="primary" id="studio-make">MAKE</button>
    <div class="drop">
      <button type="button" id="studio-export">EXPORT</button>
      <div class="drop-menu" id="studio-export-menu" hidden>
        <button type="button" data-export="pdf">PDF</button>
        <button type="button" data-export="jpeg">JPEG</button>
        <button type="button" data-export="video">VIDEO</button>
        <button type="button" id="studio-board">BOARD</button>
        <button type="button" id="studio-open">FOLDER</button>
      </div>
    </div>` : ""}
  </div>`;
}

function studioThumbs(assets, edit, compact) {
  return assets.map((a) => `
              <div class="studio-card ${a.included ? "" : "off"} ${edit && a.id === edit.id ? "on" : ""} ${compact ? "mini" : ""}" data-edit="${a.id}">
                <img src="/api/studio/assets/${a.id}/thumb" alt="" />
                ${compact ? "" : `
                <label class="check"><input type="checkbox" data-inc="${a.id}" ${a.included ? "checked" : ""} /> ${a.kind === "video" ? "VID" : "IN"}</label>
                <input class="cap" data-cap="${a.id}" value="${esc(a.caption)}" />
                <div class="card-btns">
                  <button data-up="${a.id}">▲</button>
                  <button data-dn="${a.id}">▼</button>
                </div>`}
              </div>`).join("");
}

function studioPreviewCol(proj, _edit) {
  return `<img class="studio-preview" src="/api/studio/projects/${proj.id}/preview?t=${state.previewKey || 1}" alt="" />`;
}

function studioEditorHtml(proj) {
  const page = studioPage(proj);
  const blocks = (page.blocks || []).map((bl) => {
    const sel = String(state.studioBlockId) === String(bl.id) ? "on" : "";
    if (bl.kind === "image") {
      const src = bl.asset_id ? `/api/studio/assets/${bl.asset_id}/file` : "";
      return `<div class="doc-block ${sel}" data-block="${esc(String(bl.id))}" style="left:${bl.x}px;top:${bl.y}px;width:${bl.w}px;height:${bl.h}px">
        ${src ? `<img src="${src}" alt="" />` : `<span class="muted">missing</span>`}
        <i class="doc-handle"></i>
      </div>`;
    }
    const weight = bl.weight === "bold" ? "700" : "400";
    const size = bl.size || 22;
    return `<div class="doc-block text ${sel}" data-block="${esc(String(bl.id))}" style="left:${bl.x}px;top:${bl.y}px;width:${bl.w}px;height:${bl.h}px;font-size:${size}px;color:${esc(bl.color || "#161616")};font-weight:${weight}">
      <span>${esc(bl.text || "")}</span>
      <i class="doc-handle"></i>
    </div>`;
  }).join("");
  return `
        <div class="doc-tools">
          <button type="button" id="doc-text">TEXT</button>
          <button type="button" id="doc-img">IMAGE</button>
        </div>
        <div class="doc-stage" id="doc-stage">
          <div class="doc-page" id="doc-page" data-w="${page.w}" data-h="${page.h}" style="width:${page.w}px;height:${page.h}px;background:${esc(page.bg || "#f3efe4")}">${blocks}</div>
        </div>`;
}

let docDrag = null;
if (typeof window !== "undefined" && !window.__pipDocBound) {
  window.__pipDocBound = true;
  window.addEventListener("mousemove", (e) => {
    if (!docDrag) return;
    const dx = (e.clientX - docDrag.sx) / docDrag.scale;
    const dy = (e.clientY - docDrag.sy) / docDrag.scale;
    const b = docDrag.block;
    if (docDrag.resize) {
      b.w = Math.max(40, Math.round(docDrag.w + dx));
      b.h = Math.max(32, Math.round(docDrag.h + dy));
    } else {
      b.x = Math.max(0, Math.round(docDrag.x + dx));
      b.y = Math.max(0, Math.round(docDrag.y + dy));
    }
    const el = document.querySelector(`.doc-block[data-block="${b.id}"]`);
    if (!el) return;
    el.style.left = b.x + "px";
    el.style.top = b.y + "px";
    el.style.width = b.w + "px";
    el.style.height = b.h + "px";
  });
  window.addEventListener("mouseup", async () => {
    if (!docDrag) return;
    const { proj, page } = docDrag;
    docDrag = null;
    await saveStudioLayout(proj, page);
  });
}

async function saveStudioLayout(proj, page) {
  const layout = parseStudioLayout(proj) || { pages: [page] };
  layout.pages[0] = page;
  proj.layout_json = JSON.stringify(layout);
  await api(`/api/studio/projects/${proj.id}`, {
    method: "PATCH",
    body: JSON.stringify({ layout_json: proj.layout_json }),
  });
  state.previewKey = Date.now();
}

async function setStudioLevel(n) {
  n = Math.max(1, Math.min(3, Number(n) || 1));
  state.studioLevel = n;
  localStorage.setItem("pip.studioLevel", String(n));
  if (state.studioId) {
    await api(`/api/studio/projects/${state.studioId}`, {
      method: "PATCH",
      body: JSON.stringify({ studio_level: n }),
    });
    if (n === 3) {
      try { await api(`/api/studio/projects/${state.studioId}/ensure-layout`, { method: "POST" }); } catch (_) {}
    }
  }
  await refreshStudio();
}

async function makeStudioDoc(fromLevel) {
  const prompt = ($("#studio-prompt") && $("#studio-prompt").value.trim()) || state.studioPrompt || "";
  state.studioPrompt = prompt;
  localStorage.setItem("pip.studioPrompt", prompt);
  setStatus("MAKING DOCUMENT…");
  try {
    if (!state.studioId) {
      const blank = await api("/api/studio/blank", {
        method: "POST",
        body: JSON.stringify({ title: (prompt.slice(0, 48) || "Untitled"), notes: prompt }),
      });
      state.studioId = blank.id;
    }
    const proj = await api(`/api/studio/projects/${state.studioId}/make`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    state.studioId = proj.id;
    state.studioProject = proj;
    if (fromLevel === 3) {
      state.studioLevel = 3;
      localStorage.setItem("pip.studioLevel", "3");
    }
    state.previewKey = Date.now();
    await refreshStudio();
    setStatus("DOCUMENT READY");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function createBlankStudio() {
  setStatus("NEW DOCUMENT…");
  try {
    const proj = await api("/api/studio/blank", {
      method: "POST",
      body: JSON.stringify({ title: "Untitled", template: "one_pager" }),
    });
    state.studioId = proj.id;
    state.previewKey = Date.now();
    await refreshStudio();
    setStatus("BLANK PAGE");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

function bindStudioChrome(b, proj) {
  b.querySelectorAll("[data-level]").forEach((el) => {
    el.onclick = () => setStudioLevel(Number(el.dataset.level));
  });
  const pick = b.querySelector("#studio-pick");
  if (pick) {
    pick.onchange = async () => {
      const id = Number(pick.value);
      if (!id) return;
      state.studioId = id;
      const row = (state.studioProjects || []).find((p) => p.id === id);
      if (row && row.studio_level) state.studioLevel = Math.max(1, Math.min(3, Number(row.studio_level) || 1));
      await refreshStudio();
    };
  }
  const findBtn = b.querySelector("#studio-find");
  if (findBtn) findBtn.onclick = () => findStudioFolder();
  const blank = b.querySelector("#studio-blank");
  if (blank) blank.onclick = () => createBlankStudio();
  b.querySelectorAll("[data-tmpl]").forEach((el) => {
    el.onclick = () => patchStudio({ template: el.dataset.tmpl });
  });
  const promptEl = b.querySelector("#studio-prompt");
  if (promptEl) {
    promptEl.addEventListener("change", () => {
      state.studioPrompt = promptEl.value;
      localStorage.setItem("pip.studioPrompt", state.studioPrompt);
    });
  }
  const title = b.querySelector("#studio-title");
  if (title) {
    title.addEventListener("change", async () => {
      if (!proj) return;
      await api(`/api/studio/projects/${proj.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.value }),
      });
      setStatus("TITLE SAVED");
    });
  }
  const make = b.querySelector("#studio-make");
  if (make) make.onclick = () => makeStudioDoc(studioLevel());
  const exp = b.querySelector("#studio-export");
  const menu = b.querySelector("#studio-export-menu");
  if (exp && menu) {
    exp.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    };
  }
  b.querySelectorAll("[data-export]").forEach((el) => {
    el.onclick = () => {
      if (menu) menu.hidden = true;
      exportStudio(el.dataset.export);
    };
  });
  const toBoard = b.querySelector("#studio-board");
  if (toBoard) toBoard.onclick = () => sendStudioToBoard();
  const openEx = b.querySelector("#studio-open");
  if (openEx) openEx.onclick = async () => {
    await api("/api/studio/open-exports", { method: "POST", body: "{}" });
    setStatus("EXPORT FOLDER OPEN");
  };
}

function bindStudioSequence(b, edit) {
  b.querySelectorAll("[data-inc]").forEach((el) => {
    el.addEventListener("change", async () => {
      await api(`/api/studio/assets/${el.dataset.inc}`, {
        method: "PATCH",
        body: JSON.stringify({ included: el.checked }),
      });
      await refreshStudio();
    });
  });
  b.querySelectorAll("[data-cap]").forEach((el) => {
    el.addEventListener("change", async () => {
      await api(`/api/studio/assets/${el.dataset.cap}`, {
        method: "PATCH",
        body: JSON.stringify({ caption: el.value }),
      });
    });
  });
  b.querySelectorAll("[data-up]").forEach((el) => {
    el.onclick = async () => {
      await api(`/api/studio/assets/${el.dataset.up}/move`, { method: "POST", body: JSON.stringify({ direction: -1 }) });
      await refreshStudio();
    };
  });
  b.querySelectorAll("[data-dn]").forEach((el) => {
    el.onclick = async () => {
      await api(`/api/studio/assets/${el.dataset.dn}/move`, { method: "POST", body: JSON.stringify({ direction: 1 }) });
      await refreshStudio();
    };
  });
  b.querySelectorAll("[data-edit]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("input,button,label,.card-btns")) return;
      const id = Number(el.dataset.edit);
      if (id === state.studioEditId) return;
      state.studioEditId = id;
      renderView();
    });
  });
  if (edit) bindXformStage(edit);
}

function bindDocEditor(proj) {
  const pageEl = $("#doc-page");
  const stage = $("#doc-stage");
  if (!pageEl || !stage) return;
  const page = studioPage(proj);
  const fit = () => {
    const scale = Math.min(1, Math.max(0.18, (stage.clientWidth - 16) / page.w));
    pageEl.style.transform = `scale(${scale})`;
    stage.style.height = `${Math.round(page.h * scale + 12)}px`;
    pageEl.dataset.scale = String(scale);
  };
  fit();
  pageEl.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".doc-block");
    if (!el) return;
    e.preventDefault();
    const block = (page.blocks || []).find((b) => String(b.id) === el.dataset.block);
    if (!block) return;
    state.studioBlockId = String(block.id);
    pageEl.querySelectorAll(".doc-block").forEach((n) => n.classList.toggle("on", n === el));
    renderStudioInspect();
    docDrag = {
      resize: Boolean(e.target.closest(".doc-handle")),
      block,
      page,
      proj,
      sx: e.clientX,
      sy: e.clientY,
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      scale: Number(pageEl.dataset.scale || 1),
    };
  });
  const addText = $("#doc-text");
  if (addText) addText.onclick = async () => {
    page.blocks = page.blocks || [];
    page.blocks.push({
      id: Math.random().toString(16).slice(2, 10),
      kind: "text",
      x: 80,
      y: 80 + page.blocks.length * 12,
      w: page.w - 160,
      h: 80,
      text: "Text",
      size: 32,
      color: "#161616",
      weight: "bold",
    });
    await saveStudioLayout(proj, page);
    await refreshStudio();
  };
  const addImg = $("#doc-img");
  if (addImg) addImg.onclick = async () => {
    const assets = (proj.assets || []).filter((a) => a.included && a.kind === "image");
    const pick = studioEditAsset() || assets[0];
    if (!pick) {
      setStatus("INGEST IMAGES FIRST, OR PICK ONE IN LEVEL 2");
      return;
    }
    page.blocks = page.blocks || [];
    page.blocks.push({
      id: Math.random().toString(16).slice(2, 10),
      kind: "image",
      x: 80,
      y: 200,
      w: page.w - 160,
      h: Math.round(page.h * 0.4),
      asset_id: pick.id,
    });
    await saveStudioLayout(proj, page);
    await refreshStudio();
  };
}

function renderStudio(b) {
  const proj = state.studioProject;
  const projects = state.studioProjects || [];
  const templates = state.studioTemplates || [];
  const printT = templates.filter((t) => t.kind !== "video");
  const assets = (proj && proj.assets) || [];
  const edit = studioEditAsset();
  const level = studioLevel();
  let body = "";
  if (!proj) {
    body = `<p class="muted">OPEN a folder of art, or NEW a blank page.</p>`;
  } else if (level === 1) {
    body = `
      <div class="studio-prompt-row">
        <textarea id="studio-prompt" class="studio-prompt" rows="2" placeholder="Describe the page…">${esc(state.studioPrompt)}</textarea>
      </div>
      <div class="studio-stage">${studioPreviewCol(proj, edit)}</div>
      ${assets.length ? `<div class="studio-film">${studioThumbs(assets, edit, true)}</div>` : ""}`;
  } else if (level === 2) {
    body = `
      <div class="studio-pills">
        ${printT.map((t) => `<button class="pill ${proj.template === t.name ? "on" : ""}" data-tmpl="${esc(t.name)}">${esc(t.name)}</button>`).join("")}
        <button class="pill ${proj.template === "slideshow" ? "on" : ""}" data-tmpl="slideshow">slides</button>
      </div>
      <input id="studio-title" value="${esc(proj.title)}" />
      <div class="studio-layout">
        <div class="studio-assets">${studioThumbs(assets, edit, true)}</div>
        <div class="studio-stage">${studioPreviewCol(proj, edit)}</div>
      </div>`;
  } else {
    body = studioEditorHtml(proj);
  }
  b.innerHTML = `${studioBar(level, projects, proj)}${body}`;
  bindStudioChrome(b, proj);
  if (proj && level < 3) bindStudioSequence(b, edit);
  if (proj && level === 3) bindDocEditor(proj);
  renderStudioInspect();
}

function renderStudioInspect() {
  const proj = state.studioProject;
  const level = studioLevel();
  const edit = studioEditAsset();
  if (level === 3 && proj) {
    const page = studioPage(proj);
    const block = (page.blocks || []).find((b) => String(b.id) === String(state.studioBlockId));
    if (!block) {
      closeInspect();
      return;
    }
    state.studioBlockId = String(block.id);
    inspect("BLOCK", `
      ${block.kind === "text" ? `
        <div class="field"><span>TEXT</span><textarea id="blk-text" rows="3">${esc(block.text || "")}</textarea></div>
        <div class="field"><span>SIZE</span><input type="range" id="blk-size" min="12" max="72" value="${block.size || 22}" /></div>
      ` : `<p class="muted">Image ${esc(String(block.asset_id || ""))}</p>`}
      <div class="actions"><button id="blk-del">DELETE</button></div>
    `);
    const text = $("#blk-text");
    if (text) {
      text.addEventListener("change", async () => {
        block.text = text.value;
        await saveStudioLayout(proj, page);
        renderView();
      });
    }
    const size = $("#blk-size");
    if (size) {
      size.addEventListener("change", async () => {
        block.size = Number(size.value);
        await saveStudioLayout(proj, page);
        renderView();
      });
    }
    const del = $("#blk-del");
    if (del) {
      del.onclick = async () => {
        page.blocks = (page.blocks || []).filter((b) => String(b.id) !== String(block.id));
        state.studioBlockId = page.blocks[0] ? String(page.blocks[0].id) : null;
        await saveStudioLayout(proj, page);
        renderView();
      };
    }
    return;
  }
  if (!edit) {
    closeInspect();
    return;
  }
  const n = xformNums(edit);
  inspect("CLIP", `
    <div class="field"><span>CAPTION</span><input id="insp-cap" value="${esc(edit.caption || "")}" /></div>
    <label class="check"><input type="checkbox" id="insp-inc" ${edit.included ? "checked" : ""} /> INCLUDE</label>
    <div class="field"><span>SCALE ${n.scale.toFixed(2)}×</span>
      <input type="range" id="insp-scale" min="0.2" max="8" step="0.05" value="${n.scale}" />
    </div>
    <div class="field"><span>ROTATE ${n.rot.toFixed(0)}°</span>
      <input type="range" id="insp-rot" min="-180" max="180" step="1" value="${n.rot}" />
    </div>
    <div class="actions"><button id="insp-reset">RESET</button></div>
  `);
  const cap = $("#insp-cap");
  if (cap) {
    cap.addEventListener("change", async () => {
      await api(`/api/studio/assets/${edit.id}`, { method: "PATCH", body: JSON.stringify({ caption: cap.value }) });
    });
  }
  const inc = $("#insp-inc");
  if (inc) {
    inc.addEventListener("change", async () => {
      await api(`/api/studio/assets/${edit.id}`, { method: "PATCH", body: JSON.stringify({ included: inc.checked }) });
      await refreshStudio();
    });
  }
  const bindRange = (sel, key) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("input", () => {
      const a = studioAssetById(edit.id);
      if (!a) return;
      a[key] = Number(el.value);
      applyXformCss(a);
    });
    el.addEventListener("change", async () => {
      await patchAssetXform(edit.id, { [key]: Number(el.value) }, true);
    });
  };
  bindRange("#insp-scale", "scale");
  bindRange("#insp-rot", "rotate");
  const reset = $("#insp-reset");
  if (reset) {
    reset.onclick = async () => {
      await patchAssetXform(edit.id, { scale: 1, pan_x: 0.5, pan_y: 0.5, rotate: 0 }, true);
      renderView();
    };
  }
}

async function ingestStudio() {
  const path = ($("#studio-path") && $("#studio-path").value.trim()) || state.studioPath;
  if (!path) return;
  state.studioPath = path;
  localStorage.setItem("pip.studioPath", path);
  setStatus("INGESTING FOLDER…");
  try {
    const proj = await api("/api/studio/projects", {
      method: "POST",
      body: JSON.stringify({ path, template: "lookbook" }),
    });
    state.studioId = proj.id;
    state.previewKey = Date.now();
    await refreshStudio();
    setStatus(`INGESTED ${proj.assets.length} FILES`);
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function findStudioFolder() {
  setStatus("CHOOSE A FOLDER…");
  try {
    const start = ($("#studio-path") && $("#studio-path").value.trim()) || state.studioPath || "";
    const out = await api("/api/studio/browse", { method: "POST", body: JSON.stringify({ path: start }) });
    if (out.cancelled || !out.path) {
      setStatus("CANCELLED");
      return;
    }
    state.studioPath = out.path;
    localStorage.setItem("pip.studioPath", out.path);
    await ingestStudio();
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function patchStudio(fields) {
  if (!state.studioId) return;
  await api(`/api/studio/projects/${state.studioId}`, { method: "PATCH", body: JSON.stringify(fields) });
  await refreshStudio();
}

async function exportStudio(kind) {
  if (!state.studioId) return;
  setStatus(`EXPORTING ${kind.toUpperCase()}…`);
  try {
    const out = await api(`/api/studio/projects/${state.studioId}/export`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
    setStatus(`WROTE ${out.path}`);
    inspect("EXPORT", `<p>${esc(out.path)}</p><p><a href="${esc(out.url)}" target="_blank" rel="noopener">DOWNLOAD</a></p>`);
    if (out.url) window.open(out.url, "_blank");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function sendStudioToBoard() {
  if (!state.studioId) return;
  setStatus("PINNING STUDIO TO BOARD…");
  try {
    const out = await api("/api/board/pin-studio", { method: "POST", body: JSON.stringify({ project_id: state.studioId }) });
    state.board.clip = true;
    localStorage.setItem("pip.clip", "1");
    switchTab("board");
    await loadTabData();
    renderView();
    setStatus(`CLIP ${out.pinned} NEW // ${out.already || 0} ALREADY`);
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

async function loadBoard() {
  const [cards, resumes, jobs] = await Promise.all([
    api("/api/board/cards"),
    api("/api/hire/resumes"),
    api("/api/hire/jobs"),
  ]);
  state.board.cards = cards;
  state.board.resumes = resumes;
  state.board.jobs = jobs;
  try { await loadStudio(); } catch (_) {}
}

function kitBlocks() {
  const kit = state.oppKit || {};
  const keys = [
    ["artist_name", "ARTIST NAME"],
    ["one_liner", "ONE-LINER"],
    ["bio_short", "SHORT BIO"],
    ["bio_long", "ARTIST STATEMENT"],
    ["origin", "HOW THIS STARTED"],
    ["why_festivals", "WHY LIVE / FESTIVALS"],
    ["materials", "WHAT I MAKE"],
    ["links", "LINKS"],
    ["full_name", "FULL NAME"],
    ["email", "EMAIL"],
    ["phone", "PHONE"],
    ["city", "CITY"],
  ];
  return keys.filter(([k]) => (kit[k] || "").trim()).map(([k, label], i) => {
    const g5 = (kit[`${k}_g5`] || "").trim();
    return `
    <div class="copy-block">
      <div class="row"><span>${label}</span><button data-kit="${i}">COPY</button></div>
      <div class="mail-body short">${esc(kit[k])}</div>
      ${g5 ? `
        <div class="row g5-h"><span>GRADE 5</span><button type="button" data-kit5="${i}">COPY</button></div>
        <div class="mail-body short g5-body">${esc(g5)}</div>
      ` : ""}
    </div>
  `;
  }).join("") || "<p class='muted'>No kit yet. REBUILD KIT writes it from PROFILE once.</p>";
}

function withOppDue(o) {
  if (!o) return o;
  if (o.due_label) return o;
  const raw = String(o.deadline || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return o;
  const due = new Date(`${raw}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((due - today) / 86400000);
  const pretty = due.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  let due_label = `DUE ${pretty} · ${days} DAYS`;
  if (days < 0) due_label = `LATE · ${pretty}`;
  else if (days === 0) due_label = "DUE TODAY · TIGHT";
  else if (days === 1) due_label = "DUE TOMORROW · TIGHT";
  else if (days <= 7) due_label = `DUE ${pretty} · ${days} DAYS · TIGHT`;
  return { ...o, days_left: days, due_label, expired: days < 0, tight: days >= 0 && days <= 7 };
}

function renderOpp(b) {
  const rows = (state.opps || []).map(withOppDue).filter((o) => !o.expired);
  const rawSel = state.oppDetail && state.oppDetail.id === state.oppId ? state.oppDetail : (rows.find((o) => o.id === state.oppId) || rows[0] || null);
  const sel = (() => {
    const hit = withOppDue(rawSel);
    return hit && hit.expired ? (rows[0] || null) : hit;
  })();
  let answers = (sel && (sel.answers || [])) || [];
  if ((!answers.length) && sel && sel.questions && sel.questions.length) {
    answers = sel.questions.filter((q) => q.type !== "section").map((q) => ({
      q: q.prompt, a: "", type: q.type, section: q.section, required: q.required, hint: q.hint,
    }));
  }
  if (sel && sel.brief && sel.brief.questions) {
    answers = answers.map((a) => {
      if (a.intent) return a;
      const hit = sel.brief.questions.find((b) => (b.prompt || "") === (a.q || a.question || ""));
      return hit ? { ...a, intent: hit.intent || "", use: hit.use || "" } : a;
    });
  }
  const phone = isPhoneHud();
  const pane = state.oppPane || "list";
  const answerBlocks = answers.map((a, i) => `
        <div class="copy-block" data-ansblock="${i}">
          ${a.section ? `<p class="muted">${esc(a.section)}</p>` : ""}
          <p>${esc(a.q || a.question || "")}${a.required ? " *" : ""}${a.type && a.type !== "short" ? ` · ${esc(a.type)}` : ""}</p>
          <div class="actions">
            ${a.type === "file" ? "" : `<button type="button" data-rewrite="${i}">REFRESH</button>`}
            <button type="button" data-ans="${i}">COPY</button>
          </div>
          ${a.intent ? `<p class="muted">${esc(a.intent)}</p>` : ""}
          ${a.use ? `<p class="muted">${esc(a.use)}</p>` : ""}
          ${a.hint ? `<p class="muted">${esc(a.hint)}</p>` : ""}
          <textarea class="full short ans-edit" id="ans-${i}" data-ansedit="${i}" ${a.type === "file" ? "disabled" : ""}>${esc(a.a || a.answer || "")}</textarea>
          <div id="ans-read-${i}">${readingBlock(a.reading || readingLevel(a.a || a.answer || ""))}</div>
          ${a.type === "file" ? "" : `
          <details class="g5-wrap">
            <summary>GRADE 5</summary>
            <div class="g5-block">
              <div class="actions">
                <button type="button" data-plain="${i}">MAKE GRADE 5</button>
                <button type="button" data-ans5="${i}">COPY</button>
              </div>
              <textarea class="full short" id="ans5-${i}" readonly>${esc(a.a5 || "")}</textarea>
              <div id="ans-read5-${i}">${a.a5 ? readingBlock(a.reading5 || readingLevel(a.a5)) : `<p class="muted">Same facts, shorter words.</p>`}</div>
            </div>
          </details>`}
        </div>
      `).join("") || "<p class='muted'>DRAFT THIS fills the questions for this call.</p>";
  if (phone && pane === "kit") {
    b.innerHTML = `
      <h3>APPLICATION KIT</h3>
      <p class="muted">Copy. Don’t rewrite.</p>
      ${kitBlocks()}
      <div class="opp-dock">
        <button type="button" id="opp-back">BACK</button>
        <button class="primary" id="opp-kit">REBUILD KIT</button>
      </div>`;
  } else if (phone && (pane === "list" || !sel)) {
    const q = (state.oppQuery || "").trim().toLowerCase();
    const kind = state.oppKind || "all";
    const filtered = rows.filter((o) => {
      if (kind !== "all" && (o.call_type || o.kind || "other") !== kind) return false;
      if (!q) return true;
      const blob = `${o.title} ${o.note || ""} ${o.url || ""} ${o.call_label || ""}`.toLowerCase();
      return blob.includes(q);
    });
    b.innerHTML = `
      <h3>OPPORTUNITIES</h3>
      <p class="muted">Search real open calls. Pip scrapes forms and drafts from PROFILE.</p>
      <div class="field"><span>SEARCH</span><input id="opp-q" value="${esc(state.oppQuery || "")}" placeholder="festival VJ · public art RFP" /></div>
      <div class="opp-chips">
        ${["all", "festival_install", "festival_artist", "city_art", "vj_booking", "job"].map((id) => {
          const label = id === "all" ? "All" : (id.replace(/_/g, " "));
          return `<button type="button" class="opp-chip ${kind === id ? "on" : ""}" data-opp-kind="${esc(id)}">${esc(label)}</button>`;
        }).join("")}
      </div>
      <div class="field scrape-row"><span>SCRAPE URL</span>
        <div class="scrape-inline">
          <input id="opp-scrape-url" placeholder="https:// apply form" />
          <button type="button" id="opp-scrape-go">SCRAPE</button>
        </div>
      </div>
      ${filtered.map((o) => `
        <button type="button" class="opp-card ${sel && sel.id === o.id ? "on" : ""}" data-opp="${o.id}">
          <b>${esc(o.title)}</b>
          <span>${o.call_label ? esc(o.call_label) + " · " : ""}${esc(o.due_label || "")}${o.n_questions ? " · " + o.n_questions + " Q" : ""}</span>
        </button>
      `).join("") || "<p class='muted'>Empty. SEARCH or HUNT finds calls with time left.</p>"}
      <div class="opp-dock">
        <button class="primary" id="opp-hunt">SEARCH</button>
        <button type="button" id="opp-kit-pane">KIT</button>
      </div>`;
  } else if (phone) {
    b.innerHTML = `
      <h3>${esc(sel.title)}</h3>
      ${sel.call_label ? `<p class="call-type-line">${esc(sel.call_label).toUpperCase()}</p>` : ""}
      ${sel.due_label ? `<p class="due-note ${sel.tight ? "tight" : ""}">${esc(sel.due_label)}</p>` : ""}
      ${sel.url ? `<p class="muted">${esc(sel.url)}</p>` : ""}
      ${sel.brief && (sel.brief.summary || sel.brief.fit) ? `
        <div class="copy-block opp-brief">
          ${sel.brief.summary ? `<p>${esc(sel.brief.summary)}</p>` : ""}
          ${sel.brief.fit ? `<p>${esc(sel.brief.fit)}</p>` : ""}
        </div>
      ` : ""}
      ${answerBlocks}
      <div class="opp-dock">
        <button type="button" id="opp-back">BACK</button>
        <button class="primary" id="opp-draft">DRAFT THIS</button>
        <button id="opp-open">OPEN FORM</button>
        <button id="opp-done">DONE</button>
      </div>`;
  } else {
  b.innerHTML = `
    <h3>APPLICATION KIT</h3>
    <p class="muted">Same bio, origin, and links every time. Copy. Don’t rewrite. Make art. Each call is typed (install / mural / city / VJ / job / …) so DRAFT THIS answers that form.</p>
    ${kitBlocks()}
    <div class="actions">
      <button class="primary" id="opp-kit">REBUILD KIT</button>
    </div>
    <h3>OPEN CALLS</h3>
    <p class="muted">Search profile-fit opportunities — festivals, public art, VJ, creative jobs. Scrape forms. Draft answers. You paste.</p>
    <div class="field"><span>SEARCH / FOCUS</span><input id="opp-q" value="${esc(state.oppQuery || "")}" placeholder="bass festival visuals · mural open call" /></div>
    <div class="opp-chips">
      ${["all", "festival_install", "festival_artist", "city_art", "vj_booking", "job"].map((id) => {
        const label = id === "all" ? "All" : id.replace(/_/g, " ");
        return `<button type="button" class="opp-chip ${(state.oppKind || "all") === id ? "on" : ""}" data-opp-kind="${esc(id)}">${esc(label)}</button>`;
      }).join("")}
    </div>
    <div class="field scrape-row"><span>SCRAPE URL</span>
      <div class="scrape-inline">
        <input id="opp-scrape-url" value="${esc(state.oppScrapeUrl || "")}" placeholder="https://" />
        <button type="button" id="opp-scrape-go">SCRAPE</button>
      </div>
    </div>
    ${rows.filter((o) => {
      const q = (state.oppQuery || "").trim().toLowerCase();
      const kind = state.oppKind || "all";
      if (kind !== "all" && (o.call_type || o.kind || "other") !== kind) return false;
      if (!q) return true;
      return `${o.title} ${o.note || ""} ${o.url || ""}`.toLowerCase().includes(q);
    }).map((o) => `
      <div class="row ${sel && sel.id === o.id ? "on" : ""}" data-opp="${o.id}">
        <span>${esc(o.title)}</span>
        <span class="muted">${o.call_label ? `<span class="call-type">${esc(o.call_label)}</span> · ` : ""}${o.due_label ? `<span class="due ${o.tight ? "tight" : ""}">${esc(o.due_label)}</span>${o.n_questions ? " · " : ""}` : ""}${o.n_questions ? `${o.n_questions} Q` : ""}</span>
      </div>
    `).join("") || "<p class='muted'>Empty. HUNT finds calls that still have time.</p>"}
    ${sel ? `
      <h3>${esc(sel.title)}</h3>
      ${sel.call_label ? `<p class="call-type-line">${esc(sel.call_label).toUpperCase()} APPLICATION — drafts follow this type, not a generic festival install.</p>` : ""}
      ${sel.due_label ? `<p class="due-note ${sel.tight ? "tight" : ""}">${esc(sel.due_label)}${sel.tight ? " — short window. Skip this round if it would crush the week." : ""}</p>` : ""}
      ${sel.url ? `<p class="muted">${esc(sel.url)}</p>` : ""}
      ${sel.brief && (sel.brief.summary || sel.brief.fit) ? `
        <div class="copy-block opp-brief">
          <h3>THIS CALL</h3>
          ${sel.brief.summary ? `<p>${esc(sel.brief.summary)}</p>` : ""}
          ${sel.brief.fit ? `<p>${esc(sel.brief.fit)}</p>` : ""}
          ${(sel.brief.constraints || []).length ? `<p class="muted">${esc((sel.brief.constraints || []).join(" · "))}</p>` : ""}
        </div>
      ` : ""}
      ${answers.map((a, i) => `
        <div class="copy-block" data-ansblock="${i}">
          ${a.section ? `<p class="muted">${esc(a.section)}</p>` : ""}
          <div class="row">
            <span>${esc(a.q || a.question || "")}${a.required ? " *" : ""}${a.type && a.type !== "short" ? ` · ${esc(a.type)}` : ""}</span>
            <span>
              ${a.type === "file" ? "" : `<button type="button" data-rewrite="${i}">REFRESH</button>`}
              <button type="button" data-ans="${i}">COPY</button>
            </span>
          </div>
          ${a.intent ? `<p class="muted">${esc(a.intent)}</p>` : ""}
          ${a.use ? `<p class="muted">${esc(a.use)}</p>` : ""}
          ${a.hint ? `<p class="muted">${esc(a.hint)}</p>` : ""}
          <textarea class="full short ans-edit" id="ans-${i}" data-ansedit="${i}" ${a.type === "file" ? "disabled" : ""}>${esc(a.a || a.answer || "")}</textarea>
          <div id="ans-read-${i}">${readingBlock(a.reading || readingLevel(a.a || a.answer || ""))}</div>
          ${a.type === "file" ? "" : `
          <div class="g5-block">
            <div class="row g5-h">
              <span>GRADE 5 SUGGESTED</span>
              <span>
                <button type="button" data-plain="${i}">MAKE GRADE 5</button>
                <button type="button" data-ans5="${i}">COPY</button>
              </span>
            </div>
            <textarea class="full short" id="ans5-${i}" readonly>${esc(a.a5 || "")}</textarea>
            <div id="ans-read5-${i}">${a.a5 ? readingBlock(a.reading5 || readingLevel(a.a5)) : `<p class="muted">Same facts, shorter words. MAKE GRADE 5 writes it.</p>`}</div>
          </div>`}
        </div>
      `).join("") || "<p class='muted'>DRAFT THIS researches the call, then fills those exact questions from PROFILE.</p>"}
    ` : ""}
    <div class="actions">
      <button class="primary" id="opp-hunt">SEARCH</button>
      <button class="primary" id="opp-draft">DRAFT THIS</button>
      <button id="opp-open">OPEN FORM</button>
      <button id="opp-done">DONE</button>
    </div>
  `;
  }
  const kitKeys = [
    "artist_name","one_liner","bio_short","bio_long","origin","why_festivals","materials","links","full_name","email","phone","city"
  ].filter((k) => ((state.oppKit || {})[k] || "").trim());
  const kitVals = kitKeys.map((k) => ((state.oppKit || {})[k] || "").trim());
  const kitG5 = kitKeys.map((k) => ((state.oppKit || {})[`${k}_g5`] || "").trim());
  b.querySelectorAll("[data-kit]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const t = kitVals[Number(el.dataset.kit)];
      if (!t) return;
      try { await navigator.clipboard.writeText(t); setStatus("COPIED"); } catch (_) { setStatus("COPY FAILED"); }
    };
  });
  b.querySelectorAll("[data-kit5]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const t = kitG5[Number(el.dataset.kit5)];
      if (!t) return;
      try { await navigator.clipboard.writeText(t); setStatus("COPIED GRADE 5"); } catch (_) { setStatus("COPY FAILED"); }
    };
  });
  b.querySelectorAll("[data-ans]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const i = Number(el.dataset.ans);
      const ta = document.getElementById(`ans-${i}`);
      const t = ta ? ta.value : ((answers[i] && (answers[i].a || answers[i].answer)) || "");
      try { await navigator.clipboard.writeText(t); setStatus("COPIED"); } catch (_) { setStatus("COPY FAILED"); }
    };
  });
  b.querySelectorAll("[data-ans5]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const i = Number(el.dataset.ans5);
      const ta = document.getElementById(`ans5-${i}`);
      const t = ta ? ta.value : ((answers[i] && answers[i].a5) || "");
      if (!t) { setStatus("NO GRADE 5 YET"); return; }
      try { await navigator.clipboard.writeText(t); setStatus("COPIED GRADE 5"); } catch (_) { setStatus("COPY FAILED"); }
    };
  });
  b.querySelectorAll("[data-plain]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const i = Number(el.dataset.plain);
      const id = oppId();
      if (!id) { setStatus("PICK A CALL"); return; }
      el.disabled = true;
      setStatus("WRITING GRADE 5…");
      try {
        await flushAnswers(i);
        const out = await api(`/api/opp/${id}/answers/${i}/plain`, { method: "POST", body: "{}" });
        state.oppDetail = out;
        state.oppId = id;
        renderView();
        setStatus("GRADE 5 READY — COPY IF YOU WANT IT");
      } catch (e) {
        el.disabled = false;
        setStatus(String(e.message || e));
      }
    };
  });
  const ansTimers = {};
  const oppId = () => (sel && sel.id) || state.oppId;
  const putAnswer = (i, text) => api(`/api/opp/${oppId()}/answers/${i}`, { method: "PUT", body: JSON.stringify({ text }) });
  const flushAnswers = async (must) => {
    const id = oppId();
    if (!id) return;
    Object.keys(ansTimers).forEach((k) => { clearTimeout(ansTimers[k]); delete ansTimers[k]; });
    for (const el of [...b.querySelectorAll("[data-ansedit]")]) {
      const i = Number(el.dataset.ansedit);
      const prev = (answers[i] && (answers[i].a || answers[i].answer)) || "";
      if (i !== must && el.value === prev) continue;
      if (answers[i]) answers[i].a = el.value;
      try {
        const out = await putAnswer(i, el.value);
        if (out && out.answers) {
          state.oppDetail = out;
          answers = out.answers;
        }
      } catch (_) {}
    }
  };
  const saveAns = (i, text) => {
    if (!oppId()) return;
    if (answers[i]) answers[i].a = text;
    clearTimeout(ansTimers[i]);
    ansTimers[i] = setTimeout(async () => {
      try {
        const out = await putAnswer(i, text);
        if (out && out.answers) {
          state.oppDetail = out;
          const r = (out.answers[i] && out.answers[i].reading) || readingLevel(text);
          const box = document.getElementById(`ans-read-${i}`);
          if (box) box.innerHTML = readingBlock(r);
        }
      } catch (e) {
        setStatus(String(e.message || e));
      }
    }, 400);
  };
  b.querySelectorAll("[data-ansedit]").forEach((el) => {
    el.addEventListener("click", (ev) => ev.stopPropagation());
    el.addEventListener("input", () => {
      const i = Number(el.dataset.ansedit);
      const box = document.getElementById(`ans-read-${i}`);
      if (box) box.innerHTML = readingBlock(readingLevel(el.value));
      saveAns(i, el.value);
    });
  });
  b.querySelectorAll("[data-rewrite]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const i = Number(el.dataset.rewrite);
      const id = oppId();
      if (!id) { setStatus("PICK A CALL"); return; }
      el.disabled = true;
      setStatus("NEW TAKE…");
      try {
        await flushAnswers(i);
        const out = await api(`/api/opp/${id}/answers/${i}/rewrite`, { method: "POST", body: "{}" });
        state.oppDetail = out;
        state.oppId = id;
        renderView();
        setStatus("NEW SUGGESTION — EDIT OR COPY");
      } catch (e) {
        el.disabled = false;
        setStatus(String(e.message || e));
      }
    };
  });
  b.querySelectorAll("[data-opp]").forEach((el) => {
    el.onclick = async () => {
      state.oppId = Number(el.dataset.opp);
      state.oppPane = "call";
      try { state.oppDetail = await api(`/api/opp/${state.oppId}`); } catch (_) { state.oppDetail = rows.find((o) => o.id === state.oppId) || null; }
      renderView();
    };
  });
  const back = $("#opp-back");
  if (back) back.onclick = () => { state.oppPane = "list"; renderView(); };
  const kitPane = $("#opp-kit-pane");
  if (kitPane) kitPane.onclick = () => { state.oppPane = "kit"; renderView(); };
  const rebuild = $("#opp-kit");
  if (rebuild) rebuild.onclick = async () => {
    setStatus("WRITING KIT FROM PROFILE…");
    try {
      state.oppKit = await api("/api/opp/kit/rebuild", { method: "POST", body: "{}" });
      renderView();
      setStatus("KIT READY — COPY, DON’T REWRITE");
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
  const draft = $("#opp-draft");
  if (draft) draft.onclick = async () => {
    const id = (sel && sel.id) || state.oppId;
    if (!id) { setStatus("PICK A CALL"); return; }
    setStatus("RESEARCHING THE CALL…");
    try {
      const out = await api(`/api/opp/${id}/draft`, { method: "POST", body: "{}" });
      state.oppDetail = out.opportunity || await api(`/api/opp/${id}`);
      state.oppId = id;
      state.opps = await api("/api/opp");
      state.oppPane = "call";
      renderView();
      setStatus(`LIVE FORM — ${((out.answers || []).length)} QUESTIONS`);
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
  const open = $("#opp-open");
  if (open) open.onclick = () => {
    const url = sel && sel.url;
    if (!url) { setStatus("NO URL"); return; }
    window.open(url, "_blank", "noopener");
    setStatus("FORM OPEN — COPY FROM THE KIT");
  };
  const hunt = $("#opp-hunt");
  if (hunt) hunt.onclick = async () => {
    state.oppQuery = ($("#opp-q")?.value || state.oppQuery || "").trim();
    localStorage.setItem("pip.oppQuery", state.oppQuery);
    const loc = [state.profile?.city, state.profile?.state].filter(Boolean).join(", ");
    setStatus("HUNTING CALLS…");
    try {
      const out = await api("/api/opp/hunt", {
        method: "POST",
        body: JSON.stringify({
          focus: state.oppQuery || "festival visual artist VJ open call",
          apply: false,
          kind: state.oppKind !== "all" ? state.oppKind : "",
          location: loc,
        }),
      });
      state.opps = await api("/api/opp");
      renderView();
      setStatus((out.note || `LOGGED ${(out.logged || []).length}`).toUpperCase().slice(0, 80));
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
  b.querySelectorAll("[data-opp-kind]").forEach((el) => {
    el.onclick = () => {
      state.oppKind = el.dataset.oppKind;
      localStorage.setItem("pip.oppKind", state.oppKind);
      renderView();
    };
  });
  const qIn = $("#opp-q");
  if (qIn) qIn.onchange = () => {
    state.oppQuery = qIn.value.trim();
    localStorage.setItem("pip.oppQuery", state.oppQuery);
  };
  const scrapeGo = $("#opp-scrape-go");
  if (scrapeGo) scrapeGo.onclick = async () => {
    const url = ($("#opp-scrape-url")?.value || "").trim();
    if (!url) { setStatus("PASTE URL"); return; }
    setStatus("SCRAPING…");
    try {
      const out = await api("/api/opp/scrape-url", { method: "POST", body: JSON.stringify({ url, draft: false }) });
      state.opps = await api("/api/opp");
      state.oppId = out.opportunity?.id || state.oppId;
      if (state.oppId) {
        try { state.oppDetail = await api(`/api/opp/${state.oppId}`); } catch (_) { /* list ok */ }
      }
      state.oppPane = "call";
      renderView();
      setStatus(`SCRAPED ${(out.n || out.opportunity?.questions?.length || 0)} Q`);
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
  const done = $("#opp-done");
  if (done) done.onclick = async () => {
    if (!state.oppId) return;
    await api(`/api/opp/${state.oppId}/close`, { method: "POST", body: "{}" });
    state.oppId = null;
    state.oppDetail = null;
    state.oppPane = "list";
    state.opps = await api("/api/opp");
    renderView();
    setStatus("MARKED DONE");
  };
}

function renderBoard(b) {
  const bd = state.board;
  const { x, y, zoom } = bd;
  const clip = bd.clip !== false;
  const assets = ((state.studioProject && state.studioProject.assets) || []).filter((a) => a.kind === "image");
  b.innerHTML = `
    <div class="board-toolbar">
      <button id="board-clip" class="${clip ? "primary" : ""}">CLIPS</button>
      <button id="board-panel" class="${bd.panel ? "primary" : ""}">DETAIL</button>
      <button id="board-pin-studio">PIN</button>
      <button id="board-layout">AUTO</button>
      <button id="board-fit">FIT</button>
    </div>
    <div class="board-canvas" id="board-canvas">
      <div class="board-world" id="board-world" style="transform:translate(${x}px,${y}px) scale(${zoom})">
        ${(bd.cards || []).map((c) => boardCardHtml(c)).join("") || `<div class="board-empty">OPEN art in STUDIO, then PIN.</div>`}
      </div>
    </div>
    ${clip ? `<div class="clip-tray" id="clip-tray">${
      assets.map((a) => `
        <button type="button" class="clip-thumb" data-asset="${a.id}" title="${esc(a.caption || "")}" draggable="true">
          <img src="/api/studio/assets/${a.id}/thumb" alt="" draggable="false" />
        </button>`).join("") || `<span class="muted">OPEN a folder in STUDIO.</span>`
    }</div>` : ""}
  `;
  bindBoardCanvas();
  renderBoardInspect();
  const clipBtn = $("#board-clip");
  if (clipBtn) clipBtn.onclick = () => {
    state.board.clip = !clip;
    localStorage.setItem("pip.clip", state.board.clip ? "1" : "0");
    renderView();
  };
  const panelBtn = $("#board-panel");
  if (panelBtn) panelBtn.onclick = () => {
    state.board.panel = !state.board.panel;
    localStorage.setItem("pip.boardPanel", state.board.panel ? "1" : "0");
    renderView();
  };
  const pinSt = $("#board-pin-studio");
  if (pinSt) pinSt.onclick = () => sendStudioToBoard();
  b.querySelectorAll("[data-asset]").forEach((el) => {
    el.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("text/pip-asset", el.dataset.asset);
      ev.dataTransfer.effectAllowed = "copy";
    });
    el.onclick = async () => {
      try {
        await api("/api/board/pin-studio", { method: "POST", body: JSON.stringify({ asset_id: Number(el.dataset.asset) }) });
        await loadBoard();
        renderView();
        setStatus("CLIPPED");
      } catch (err) { setStatus(String(err.message || err)); }
    };
  });
}

function boardCardHtml(c) {
  const img = c.kind === "image" && c.image_path
    ? `<img src="/api/board/cards/${c.id}/image" alt="" draggable="false" />`
    : "";
  const body = c.kind === "image" ? "" : `<div class="board-card-body">${esc((c.body || "").slice(0, 420))}</div>`;
  return `<div class="board-card kind-${esc(c.kind)} ${bdSelected(c.id)}" data-card="${c.id}"
      style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;z-index:${c.z || 1};border-color:${esc(c.hue || "")}">
      <div class="board-card-h">${esc(c.title || c.kind)}</div>
      ${img}${body}
      <i class="board-resize" data-resize="${c.id}"></i>
    </div>`;
}

function bdSelected(id) {
  return state.board.selected === id ? "on" : "";
}

function applyWorldTransform() {
  const world = $("#board-world");
  if (!world) return;
  world.style.transform = `translate(${state.board.x}px,${state.board.y}px) scale(${state.board.zoom})`;
}

function boardScreenToWorld(clientX, clientY) {
  const canvas = $("#board-canvas");
  const rect = canvas.getBoundingClientRect();
  const z = state.board.zoom || 1;
  return {
    x: (clientX - rect.left - state.board.x) / z,
    y: (clientY - rect.top - state.board.y) / z,
  };
}

function fitBoard() {
  const cards = state.board.cards || [];
  const canvas = $("#board-canvas");
  if (!canvas) return;
  if (!cards.length) {
    state.board.x = 48;
    state.board.y = 48;
    state.board.zoom = 1;
    applyWorldTransform();
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  cards.forEach((c) => {
    minX = Math.min(minX, Number(c.x) || 0);
    minY = Math.min(minY, Number(c.y) || 0);
    maxX = Math.max(maxX, (Number(c.x) || 0) + (Number(c.w) || 180));
    maxY = Math.max(maxY, (Number(c.y) || 0) + (Number(c.h) || 140));
  });
  const pad = 56;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const z = Math.max(0.08, Math.min(2.4, Math.min(canvas.clientWidth / (bw + pad * 2), canvas.clientHeight / (bh + pad * 2))));
  state.board.zoom = z;
  state.board.x = (canvas.clientWidth - bw * z) / 2 - minX * z;
  state.board.y = (canvas.clientHeight - bh * z) / 2 - minY * z;
  applyWorldTransform();
}

function bindBoardCanvas() {
  const canvas = $("#board-canvas");
  const world = $("#board-world");
  if (!canvas || !world) return;
  let mode = null;
  let start = {};

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const selected = state.board.selected && (e.altKey || e.ctrlKey);
    if (selected) {
      const item = (state.board.cards || []).find((c) => c.id === state.board.selected);
      const card = canvas.querySelector(`[data-card="${state.board.selected}"]`);
      if (item && card) {
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        const nw = Math.max(48, Math.min(2400, (Number(item.w) || 180) * factor));
        const nh = Math.max(48, Math.min(2400, (Number(item.h) || 140) * factor));
        item.w = nw;
        item.h = nh;
        card.style.width = `${nw}px`;
        card.style.height = `${nh}px`;
        clearTimeout(state._boardScaleT);
        state._boardScaleT = setTimeout(() => {
          api(`/api/board/cards/${item.id}`, { method: "PATCH", body: JSON.stringify({ w: nw, h: nh }) }).catch(() => {});
        }, 160);
      }
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const prev = state.board.zoom || 1;
    const next = Math.max(0.08, Math.min(6, prev * (e.deltaY < 0 ? 1.1 : 0.9)));
    const wx = (mx - state.board.x) / prev;
    const wy = (my - state.board.y) / prev;
    state.board.zoom = next;
    state.board.x = mx - wx * next;
    state.board.y = my - wy * next;
    applyWorldTransform();
  }, { passive: false });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1 || e.button === 2 || state._boardSpace) {
      mode = "pan";
      start = { x: e.clientX, y: e.clientY, panX: state.board.x, panY: state.board.y };
      canvas.classList.add("grabbing");
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const handle = e.target.closest("[data-resize]");
    if (handle) {
      const id = Number(handle.dataset.resize);
      const card = canvas.querySelector(`[data-card="${id}"]`);
      const item = (state.board.cards || []).find((c) => c.id === id);
      if (!card || !item) return;
      mode = "resize";
      start = {
        x: e.clientX,
        y: e.clientY,
        id,
        w: Number(item.w) || 180,
        h: Number(item.h) || 140,
        ratio: (Number(item.w) || 180) / Math.max(1, Number(item.h) || 140),
      };
      state.board.selected = id;
      e.preventDefault();
      return;
    }
    const card = e.target.closest("[data-card]");
    if (card) {
      mode = "card";
      const id = Number(card.dataset.card);
      start = { x: e.clientX, y: e.clientY, cx: parseFloat(card.style.left), cy: parseFloat(card.style.top), id };
      state.board.selected = id;
      canvas.querySelectorAll(".board-card").forEach((n) => n.classList.toggle("on", n === card));
      const z = Math.max(...(state.board.cards || []).map((c) => Number(c.z) || 0), 0) + 1;
      card.style.zIndex = String(z);
      const item = (state.board.cards || []).find((c) => c.id === id);
      if (item) item.z = z;
      selectBoardCard(id);
      e.preventDefault();
      return;
    }
    mode = "pan";
    start = { x: e.clientX, y: e.clientY, panX: state.board.x, panY: state.board.y };
    state.board.selected = null;
    canvas.querySelectorAll(".board-card").forEach((n) => n.classList.remove("on"));
    canvas.classList.add("grabbing");
    renderBoardInspect();
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  canvas.addEventListener("drop", async (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/pip-asset");
    if (!id) return;
    const pt = boardScreenToWorld(e.clientX, e.clientY);
    try {
      await api("/api/board/pin-studio", {
        method: "POST",
        body: JSON.stringify({ asset_id: Number(id), x: pt.x - 140, y: pt.y - 105 }),
      });
      await loadBoard();
      renderView();
      setStatus("CLIPPED");
    } catch (err) { setStatus(String(err.message || err)); }
  });

  function onBoardMove(e) {
    if (!mode) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (mode === "pan") {
      state.board.x = start.panX + dx;
      state.board.y = start.panY + dy;
      applyWorldTransform();
    } else if (mode === "card") {
      const z = state.board.zoom || 1;
      const card = canvas.querySelector(`[data-card="${start.id}"]`);
      if (!card) return;
      card.style.left = `${start.cx + dx / z}px`;
      card.style.top = `${start.cy + dy / z}px`;
    } else if (mode === "resize") {
      const z = state.board.zoom || 1;
      const card = canvas.querySelector(`[data-card="${start.id}"]`);
      const item = (state.board.cards || []).find((c) => c.id === start.id);
      if (!card || !item) return;
      const nw = Math.max(48, start.w + dx / z);
      const nh = Math.max(48, nw / (start.ratio || 1));
      item.w = nw;
      item.h = nh;
      card.style.width = `${nw}px`;
      card.style.height = `${nh}px`;
    }
  }

  async function onBoardUp() {
    canvas.classList.remove("grabbing");
    if (mode === "card" && start.id) {
      const card = canvas.querySelector(`[data-card="${start.id}"]`);
      if (card) {
        const x = parseFloat(card.style.left);
        const y = parseFloat(card.style.top);
        try {
          await api(`/api/board/cards/${start.id}`, { method: "PATCH", body: JSON.stringify({ x, y, z: Number(card.style.zIndex) || 1 }) });
          const item = (state.board.cards || []).find((c) => c.id === start.id);
          if (item) { item.x = x; item.y = y; }
        } catch (_) {}
      }
    } else if (mode === "resize" && start.id) {
      const item = (state.board.cards || []).find((c) => c.id === start.id);
      if (item) {
        try { await api(`/api/board/cards/${start.id}`, { method: "PATCH", body: JSON.stringify({ w: item.w, h: item.h }) }); } catch (_) {}
      }
    }
    mode = null;
  }

  if (state._boardMove) {
    window.removeEventListener("mousemove", state._boardMove);
    window.removeEventListener("mouseup", state._boardUp);
    window.removeEventListener("keydown", state._boardKey);
    window.removeEventListener("keyup", state._boardKeyUp);
  }
  state._boardMove = onBoardMove;
  state._boardUp = onBoardUp;
  state._boardKey = (e) => {
    if (e.code === "Space" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      state._boardSpace = true;
      e.preventDefault();
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.tab === "board" && state.board.selected && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
      e.preventDefault();
      unpinBoardCard(state.board.selected);
    }
    if (e.key === "f" && state.tab === "board" && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
      fitBoard();
    }
  };
  state._boardKeyUp = (e) => {
    if (e.code === "Space") state._boardSpace = false;
  };
  window.addEventListener("mousemove", onBoardMove);
  window.addEventListener("mouseup", onBoardUp);
  window.addEventListener("keydown", state._boardKey);
  window.addEventListener("keyup", state._boardKeyUp);

  $("#board-layout").onclick = async () => {
    state.board.cards = await api("/api/board/layout", { method: "POST", body: "{}" });
    renderView();
    setStatus("BOARD LAID OUT");
  };
  $("#board-fit").onclick = () => fitBoard();
}

function renderBoardInspect() {
  if (!state.board.panel && state.board.selected == null) return;
  const resumes = state.board.resumes || [];
  const jobs = state.board.jobs || [];
  inspect("DESK", `
    <h3>RESUME</h3>
    <div class="field"><span>FILE PATH</span><input id="resume-path" placeholder="C:\\Users\\...\\resume.pdf" /></div>
    <div class="actions">
      <button class="primary" id="resume-ingest">DIGEST</button>
      <button id="resume-find">FIND</button>
    </div>
    ${(resumes).map((r) => `<div class="row"><span>${esc(r.title)}</span><span class="muted">${r.chars || ""}</span></div>`).join("") || "<p class='muted'>No resume yet.</p>"}
    <h3>JOB POST</h3>
    <div class="field"><span>PUBLIC URL</span><input id="job-url" placeholder="https://…" /></div>
    <div class="actions"><button id="job-fetch">FETCH PUBLIC</button></div>
    <div class="field"><span>OR PASTE</span><textarea class="full short" id="job-paste" placeholder="Paste the posting."></textarea></div>
    <div class="field"><span>TITLE</span><input id="job-title" placeholder="Role" /></div>
    <div class="actions"><button class="primary" id="job-save">PIN POSTING</button></div>
    ${(jobs).map((j) => `<div class="row"><span>${esc(j.title)}</span><span class="muted">${esc(j.company || j.source || "")}</span></div>`).join("") || ""}
    <h3>ANSWERS</h3>
    <div class="actions"><button class="primary" id="job-draft">DRAFT FROM RESUME</button></div>
    <h3>PIN REFS</h3>
    <div class="field"><span>IMAGE FOLDER</span><input id="pin-folder" value="${esc(state.studioPath)}" placeholder="Folder of images…" /></div>
    <div class="actions"><button id="pin-refs">PIN FOLDER</button></div>
    <div class="field"><span>NOTE</span><input id="pin-note" placeholder="A thought to pin" /></div>
    <div class="actions"><button id="pin-note-btn">PIN NOTE</button></div>
  `);
  $("#resume-ingest").onclick = () => ingestResume();
  $("#resume-find").onclick = () => findResumes();
  $("#job-fetch").onclick = () => fetchJob();
  $("#job-save").onclick = () => pasteJob();
  $("#job-draft").onclick = () => draftJob();
  $("#pin-refs").onclick = () => pinFolder();
  $("#pin-note-btn").onclick = () => pinNote();
}
async function ingestResume() {
  const path = $("#resume-path").value.trim();
  if (!path) { setStatus("NEED A RESUME PATH"); return; }
  setStatus("DIGESTING RESUME…");
  try {
    await api("/api/hire/resumes", { method: "POST", body: JSON.stringify({ path }) });
    await loadBoard();
    renderView();
    setStatus("RESUME ON THE BOARD");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function findResumes() {
  setStatus("SCANNING FOR RESUMES…");
  try {
    const hits = await api("/api/hire/find-resumes");
    inspect("RESUMES FOUND", hits.length
      ? hits.map((h) => `<div class="row" data-respath="${esc(h.path)}"><span>${esc(h.name)}</span></div>`).join("")
      : "<p class='muted'>No files named resume/cv nearby. Paste a path.</p>");
    document.querySelectorAll("[data-respath]").forEach((el) => {
      el.onclick = async () => {
        setStatus("DIGESTING RESUME…");
        try {
          await api("/api/hire/resumes", { method: "POST", body: JSON.stringify({ path: el.dataset.respath }) });
          await loadBoard();
          renderView();
          setStatus("RESUME ON THE BOARD");
        } catch (err) { setStatus(String(err.message || err)); }
      };
    });
    setStatus(hits.length ? `${hits.length} FILES` : "NONE NAMED RESUME/CV");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function fetchJob() {
  const url = $("#job-url").value.trim();
  if (!url) { setStatus("NEED A URL OR PASTE THE TEXT"); return; }
  setStatus("PUBLIC GET…");
  try {
    const job = await api("/api/hire/jobs/fetch", { method: "POST", body: JSON.stringify({ url }) });
    await loadBoard();
    renderView();
    setStatus(job.login_wall ? "LOGIN WALL — PASTE INSTEAD" : "POSTING PINNED");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function pasteJob() {
  const body = $("#job-paste").value.trim();
  if (!body) { setStatus("PASTE THE POSTING"); return; }
  try {
    await api("/api/hire/jobs/paste", { method: "POST", body: JSON.stringify({
      title: $("#job-title").value.trim() || "Job post",
      body,
      url: $("#job-url").value.trim(),
    }) });
    await loadBoard();
    renderView();
    setStatus("POSTING PINNED");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function draftJob() {
  setStatus("DRAFTING FROM RESUME…");
  try {
    const out = await api("/api/hire/draft", { method: "POST", body: JSON.stringify({}) });
    state.board.lastAnswers = out.answers || [];
    await loadBoard();
    renderView();
    inspect("ANSWERS", (state.board.lastAnswers).map((a, i) => `
      <h3>${esc(a.question)}</h3>
      <div class="mail-body">${esc(a.answer)}</div>
      <div class="actions"><button data-ans="${i}">COPY</button></div>
    `).join("") || "<p class='muted'>No answers.</p>");
    document.querySelectorAll("[data-ans]").forEach((el) => {
      el.onclick = async () => {
        const ans = state.board.lastAnswers[Number(el.dataset.ans)];
        if (!ans) return;
        try { await navigator.clipboard.writeText(ans.answer); } catch (_) {}
        setStatus("COPIED — YOU SUBMIT");
      };
    });
    setStatus("ANSWERS ON THE BOARD — COPY, DON'T AUTO-APPLY");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function pinFolder() {
  const path = $("#pin-folder").value.trim();
  if (!path) return;
  setStatus("PINNING REFS…");
  try {
    const out = await api("/api/board/pin-folder", { method: "POST", body: JSON.stringify({ path }) });
    await loadBoard();
    renderView();
    setStatus(`PINNED ${out.pinned} REFS`);
  } catch (e) { setStatus(String(e.message || e)); }
}

async function pinNote() {
  const title = $("#pin-note").value.trim();
  if (!title) return;
  await api("/api/board/cards", { method: "POST", body: JSON.stringify({ title, body: title }) });
  await loadBoard();
  renderView();
}

async function selectBoardCard(id) {
  const card = (state.board.cards || []).find((c) => c.id === id);
  if (!card) return;
  const snippet = esc((card.body || "").slice(0, 700));
  const more = (card.body || "").length > 700 ? "…" : "";
  if (card.kind === "answer") {
    inspect("ANSWER", `
      <h2>${esc(card.title)}</h2>
      <div class="mail-body">${snippet}${more}</div>
      <div class="actions"><button class="primary" id="copy-card">COPY</button><button class="warn" id="del-card">UNPIN</button></div>
    `);
    $("#copy-card").onclick = async () => {
      try { await navigator.clipboard.writeText(card.body); } catch (_) {}
      setStatus("COPIED");
    };
  } else if (card.kind === "image") {
    inspect("IMAGE", `
      <h2>${esc(card.title)}</h2>
      <p class="muted">${Math.round(card.w)} × ${Math.round(card.h)} // drag corner or alt-wheel to scale</p>
      <div class="actions"><button class="warn" id="del-card">UNPIN</button></div>
    `);
  } else {
    inspect(card.kind.toUpperCase(), `
      <h2>${esc(card.title)}</h2>
      <div class="doc-body">${snippet}${more}</div>
      <div class="actions"><button class="warn" id="del-card">UNPIN</button></div>
    `);
  }
  const del = $("#del-card");
  if (del) del.onclick = () => unpinBoardCard(id);
}

async function unpinBoardCard(id) {
  await api(`/api/board/cards/${id}`, { method: "DELETE" });
  state.board.selected = null;
  await loadBoard();
  renderView();
}

function renderHands(b) {
  const h = state.hands || {};
  const macros = h.macros || [];
  const rec = !!h.recording;
  const play = !!h.playing;
  b.innerHTML = `
    <p class="muted">This is the real mouse and keyboard on this PC — not a webpage trick. RECORD, do the task, ESC or STOP. PLAY runs it back. Slam the pointer into the top-left corner to abort.</p>
    <p id="hands-stat" class="${rec ? "wx" : "muted"}">${rec ? `RECORDING // ${h.events || 0} EVENTS // ESC TO STOP` : play ? "PLAYING TAKE" : (h.available === false ? "pynput missing — pip install pynput" : "STANDBY")}</p>
    <div class="field"><span>TAKE NAME</span><input id="hands-name" placeholder="export lookbook" /></div>
    <div class="actions">
      <button class="${rec ? "warn" : "primary"}" id="hands-rec">${rec ? "STOP" : "RECORD"}</button>
      <button id="hands-abort">ABORT PLAY</button>
    </div>
    <h3>TAKES</h3>
    ${macros.map((m) => `
      <div class="row">
        <span>${esc(m.name)} <span class="muted">${m.length} ev</span></span>
        <span>
          <button data-play="${m.id}">PLAY</button>
          <button class="warn" data-del="${m.id}">DEL</button>
        </span>
      </div>`).join("") || "<p class='muted'>No takes yet.</p>"}
  `;
  inspect("HANDS", `
    <p class="muted">Pip can start/stop/play these if you ask in CHAT. He will not click around unless you told him to.</p>
    <p>Recorded locally in pip.db. Never uploaded.</p>
  `);
  const recBtn = $("#hands-rec");
  if (recBtn) recBtn.onclick = async () => {
    try {
      if (rec) {
        const name = ($("#hands-name") && $("#hands-name").value.trim()) || "";
        state.hands = await api("/api/hands/record/stop", { method: "POST", body: JSON.stringify({ name }) });
        setStatus(state.hands.saved ? `SAVED ${state.hands.name}` : "STOPPED");
      } else {
        state.hands = await api("/api/hands/record/start", { method: "POST", body: "{}" });
        setStatus("RECORDING — ESC TO STOP");
        pollHands();
      }
      renderView();
    } catch (e) { setStatus(String(e.message || e)); }
  };
  const abort = $("#hands-abort");
  if (abort) abort.onclick = async () => {
    await api("/api/hands/abort", { method: "POST", body: "{}" });
    setStatus("ABORT");
  };
  b.querySelectorAll("[data-play]").forEach((el) => {
    el.onclick = async () => {
      try {
        await api(`/api/hands/${el.dataset.play}/play`, { method: "POST", body: "{}" });
        setStatus("PLAYING — TOP-LEFT ABORTS");
        pollHands();
      } catch (e) { setStatus(String(e.message || e)); }
    };
  });
  b.querySelectorAll("[data-del]").forEach((el) => {
    el.onclick = async () => {
      await api(`/api/hands/${el.dataset.del}`, { method: "DELETE" });
      state.hands = await api("/api/hands");
      renderView();
    };
  });
  if (rec || play) pollHands();
}

function pollHands() {
  if (state._handsPoll) return;
  state._handsPoll = setInterval(async () => {
    if (state.tab !== "hands") {
      clearInterval(state._handsPoll);
      state._handsPoll = null;
      return;
    }
    try {
      const next = await api("/api/hands");
      const was = state.hands || {};
      state.hands = next;
      if (!!was.recording !== !!next.recording || !!was.playing !== !!next.playing) {
        renderView();
      } else {
        const el = $("#hands-stat");
        if (el && next.recording) {
          el.className = "wx";
          el.textContent = `RECORDING // ${next.events || 0} EVENTS // ESC TO STOP`;
        }
      }
      if (!next.recording && !next.playing) {
        clearInterval(state._handsPoll);
        state._handsPoll = null;
        if (was.recording || was.playing) renderView();
      }
    } catch (_) {}
  }, 400);
}

const vibeRt = {
  gl: null,
  prog: null,
  buf: null,
  loc: {},
  raf: 0,
  poll: 0,
  clock: 0,
  lastTs: 0,
  canvas: null,
};

function isMorningHour() {
  const h = new Date().getHours();
  return h >= 5 && h < 12;
}

function morningNext() {
  const m = (state.today && state.today.morning) || {};
  return m.next || null;
}

function motivationNext() {
  const m = (state.today && state.today.motivation) || {};
  return m.next || null;
}

function vibeIsMotiv() {
  return state.vibe.mode === "motivation" || state.vibe.mode === "action";
}

const SEND_OFF = [
  "Chase your dreams.",
  "Change the world.",
  "Have fun.",
  "Do Good.",
  "Go be awesome.",
  "Go Smell the roses.",
  "Pip Pip Cheerio!",
  "Know your worth.",
  "Make a change.",
  "Do something special today!",
  "Be love.",
  "Be light.",
  "Shine on!",
  "Shine your light!",
  "Do what you do best!",
  "Show the world!",
  "Stay with it.",
];

function sendOffLine() {
  const day = (state.today && state.today.date) || new Date().toISOString().slice(0, 10);
  const key = "pip.sendOff." + day;
  let line = sessionStorage.getItem(key);
  if (!line) {
    line = SEND_OFF[Math.floor(Math.random() * SEND_OFF.length)];
    sessionStorage.setItem(key, line);
  }
  return line;
}

function shotShaderKind(nxt) {
  if (!nxt) return "sendoff";
  if (nxt.vibe) return nxt.vibe;
  if (nxt.kind === "inspire") return "sendoff";
  if (nxt.kind === "audit") return "breath";
  const t = `${nxt.slug || ""} ${nxt.shot || ""} ${nxt.title || ""} ${nxt.kind || ""}`.toLowerCase();
  if (/splash|face|wash/.test(t)) return "face";
  if (/teeth|breath|mint|freshen|patient|proceed/.test(t)) return "mint";
  if (/drink|water|glass|eat/.test(t)) return "water";
  if (/move|mobility|stretch|body|going|after/.test(t)) return "move";
  if (/shine|dream|world|love|light|awesome|cheerio|worth|roses|good/.test(t)) return "sendoff";
  return "sendoff";
}

async function loadKindShader(kind) {
  if (!state.vibe.files || !state.vibe.files.length) {
    try {
      const pack = await api("/api/vibe/shaders");
      state.vibe.files = pack.files || [];
    } catch (_) {
      return false;
    }
  }
  const stem = String(kind || "sendoff").replace(/\.glsl$/i, "").toLowerCase();
  const file = (state.vibe.files || []).find((f) => {
    const n = String(f.stem || f.name || "").replace(/\.[^.]+$/, "").toLowerCase();
    return n === stem;
  }) || (state.vibe.files || []).find((f) => String(f.name || "").toLowerCase().includes(stem));
  if (!file) return false;
  if (state.vibe.path === file.path && state.vibe.source) return true;
  const sh = await api(`/api/vibe/shader?path=${encodeURIComponent(file.path)}`);
  state.vibe.source = sh.source || "";
  state.vibe.path = sh.path || "";
  state.vibe.name = sh.name || "";
  const sel = $("#vibe-file");
  if (sel && state.vibe.path) sel.value = state.vibe.path;
  return true;
}

async function syncActionShader() {
  if (!vibeIsMotiv()) return;
  const kind = shotShaderKind(motivationNext() || morningNext());
  if (state.vibe.actionKind === kind && state.vibe.source) return;
  state.vibe._shaderToken = kind;
  const ok = await loadKindShader(kind);
  if (state.vibe._shaderToken !== kind) return;
  if (!ok) return;
  state.vibe.actionKind = kind;
  if ($("#vibe-gl")) vibeCompile(state.vibe.source || "");
}

let vibeRadioClock = 0;
let vibeRadioBusy = false;
let lastVibeShot = "";

function setVibeMode(mode) {
  const motiv = mode === "action" || mode === "motivation";
  state.vibe.mode = motiv ? "motivation" : "dance";
  localStorage.setItem("pip.vibeMode", state.vibe.mode);
  if (!vibeIsMotiv()) state.vibe.actionKind = "";
  if (!vibeIsMotiv() && vibeRadioClock) {
    clearInterval(vibeRadioClock);
    vibeRadioClock = 0;
  }
  const dance = $("#vibe-dance");
  const act = $("#vibe-action-tog");
  if (dance) dance.classList.toggle("on", state.vibe.mode === "dance");
  if (act) act.classList.toggle("on", vibeIsMotiv());
  const stage = $("#vibe-stage");
  if (stage) stage.classList.toggle("action", vibeIsMotiv());
  paintVibeAction();
}

function armVibeRadio() {
  if (vibeRadioClock) {
    clearInterval(vibeRadioClock);
    vibeRadioClock = 0;
  }
  if (!vibeIsMotiv()) return;
  const nxt = motivationNext();
  if (!nxt || nxt.kind !== "pip") return;
  vibeRadioClock = setInterval(() => {
    if (!vibeIsMotiv() || vibeRadioBusy || document.hidden) return;
    tapVibeAction({ radio: true });
  }, 12000);
}

function paintVibeAction() {
  const overlay = $("#vibe-action");
  if (!overlay) return;
  const on = vibeIsMotiv();
  overlay.hidden = !on;
  if (!on) {
    armVibeRadio();
    return;
  }
  const mot = (state.today && state.today.motivation) || {};
  const nxt = mot.next || motivationNext();
  const line = nxt ? (nxt.shot || nxt.title || "NOW") : sendOffLine();
  const shotEl = overlay.querySelector(".vibe-shot");
  const hintEl = overlay.querySelector(".vibe-hint");
  if (shotEl) {
    if (line !== lastVibeShot) {
      shotEl.classList.remove("swap");
      void shotEl.offsetWidth;
      shotEl.classList.add("swap");
      lastVibeShot = line;
    }
    shotEl.textContent = line;
    shotEl.classList.toggle("long", line.length > 18);
  }
  if (hintEl) hintEl.textContent = nxt ? (mot.hint || "TAP") : "PIP · STILL GOING";
  overlay.classList.toggle("sendoff", !nxt || nxt.kind === "inspire" || nxt.kind === "pip");
  syncActionShader();
  armVibeRadio();
}

async function tapVibeAction(opts) {
  if (!vibeIsMotiv()) return;
  const radio = !!(opts && opts.radio);
  const nxt = motivationNext() || morningNext();
  if (!nxt) {
    try {
      const out = await api("/api/motivation/tap", { method: "POST", body: "{}" });
      if (state.today) state.today.motivation = out;
      await refreshToday();
      paintVibeAction();
    } catch (_) {}
    return;
  }
  if (vibeRadioBusy) return;
  vibeRadioBusy = true;
  try {
    if (nxt.id && (nxt.kind === "wake" || nxt.slug)) {
      await api(`/api/routine/${nxt.id}/check`, {
        method: "POST",
        body: JSON.stringify({ done: true }),
      });
    } else if (nxt.kind === "pip" || nxt.radio || nxt.stance || nxt.kind === "inspire" || nxt.kind === "audit" || nxt.kind === "act") {
      const out = await api("/api/motivation/tap", { method: "POST", body: "{}" });
      if (state.today) state.today.motivation = out;
    } else {
      setVibeMode("dance");
      return;
    }
    await refreshToday();
    paintVibeAction();
    const now = motivationNext();
    if (!radio) setStatus((now && now.shot) || "PIP");
  } catch (e) {
    setStatus(String(e.message || e));
  } finally {
    vibeRadioBusy = false;
  }
}

async function openVibeAction() {
  state.vibe.picked = false;
  state.vibe.mode = "motivation";
  state.vibe.actionKind = "";
  localStorage.setItem("pip.vibeMode", "motivation");
  try {
    if (!state.today) await refreshToday();
  } catch (_) {}
  switchTab("vibe");
}

async function loadVibe() {
  try {
    const pack = await api("/api/vibe/shaders");
    state.vibe.files = pack.files || [];
    if (vibeIsMotiv()) {
      await syncActionShader();
    }
    if (!state.vibe.source) {
      const sh = await api("/api/vibe/shader");
      state.vibe.source = sh.source || "";
      state.vibe.path = sh.path || "";
      state.vibe.name = sh.name || "";
    }
    state.vibe.fft = { ...state.vibe.fft, ...(await api("/api/vibe/status")) };
    state.vibe.err = "";
  } catch (e) {
    state.vibe.err = String(e.message || e);
  }
}

function vibeWrap(src) {
  const header = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_clock;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_energy;
uniform float u_fft[64];
#ifndef iTime
#define iTime u_time
#define iResolution vec3(u_resolution, 1.0)
#endif
`;
  let body = String(src || "").replace(/^\s*#version[^\n]*\n/, "").replace(/precision\s+\w+\s+float\s*;/g, "");
  if (/void\s+mainImage\s*\(/.test(body) && !/void\s+main\s*\s*\(/.test(body)) {
    body += "\nvoid main(){ vec4 col; mainImage(col, gl_FragCoord.xy); gl_FragColor = col; }\n";
  }
  return header + body;
}

function vibeCompile(src) {
  const canvas = $("#vibe-gl");
  if (!canvas) return;
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) {
    state.vibe.err = "WebGL missing";
    paintVibeStatus();
    return;
  }
  if (vibeRt.canvas && vibeRt.canvas !== canvas) {
    vibeRt.prog = null;
    vibeRt.buf = null;
  }
  vibeRt.gl = gl;
  vibeRt.canvas = canvas;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, "attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }");
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, vibeWrap(src));
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    state.vibe.err = gl.getShaderInfoLog(fs) || "fragment compile failed";
    paintVibeStatus();
    return;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    state.vibe.err = gl.getProgramInfoLog(prog) || "link failed";
    paintVibeStatus();
    return;
  }
  if (vibeRt.prog) {
    try { gl.deleteProgram(vibeRt.prog); } catch (_) {}
  }
  vibeRt.prog = prog;
  vibeRt.buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vibeRt.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const u = (name) => gl.getUniformLocation(prog, name);
  vibeRt.loc = {
    res: u("u_resolution"),
    time: u("u_time"),
    clock: u("u_clock"),
    bass: u("u_bass"),
    mid: u("u_mid"),
    high: u("u_high"),
    energy: u("u_energy"),
    fft: u("u_fft"),
  };
  state.vibe.err = "";
  paintVibeStatus();
  ensureVibeLoop();
}

function pauseVibeGl() {
  if (vibeRt.raf) {
    cancelAnimationFrame(vibeRt.raf);
    vibeRt.raf = 0;
  }
  if (vibeRt.poll) {
    clearInterval(vibeRt.poll);
    vibeRt.poll = 0;
  }
}

function ensureVibeLoop() {
  if (state.tab !== "vibe") return;
  if (!vibeRt.poll) {
    vibeRt.poll = setInterval(async () => {
      if (state.tab !== "vibe") return;
      try {
        state.vibe.fft = { ...state.vibe.fft, ...(await api("/api/vibe/fft")) };
        paintVibeMeters();
      } catch (_) {}
    }, 40);
  }
  if (!vibeRt.raf) {
    vibeRt.lastTs = 0;
    vibeRt.raf = requestAnimationFrame(vibeFrame);
  }
}

function vibeFrame(ts) {
  vibeRt.raf = 0;
  if (state.tab !== "vibe") return;
  const gl = vibeRt.gl;
  const canvas = vibeRt.canvas || $("#vibe-gl");
  if (!gl || !canvas || !vibeRt.prog) {
    vibeRt.raf = requestAnimationFrame(vibeFrame);
    return;
  }
  const dt = vibeRt.lastTs ? Math.min(0.05, (ts - vibeRt.lastTs) / 1000) : 0.016;
  vibeRt.lastTs = ts;
  const fft = state.vibe.fft || {};
  const bass = Math.max(0, Math.min(1, Number(fft.bass) || 0));
  const gain = Number(state.vibe.bassGain) || 2;
  const speed = Number(state.vibe.speed) || 1;
  vibeRt.clock += dt * (0.18 + bass * gain * 3.4) * speed;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(vibeRt.prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, vibeRt.buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(vibeRt.loc.res, canvas.width, canvas.height);
  gl.uniform1f(vibeRt.loc.time, vibeRt.clock);
  gl.uniform1f(vibeRt.loc.clock, ts / 1000);
  gl.uniform1f(vibeRt.loc.bass, bass);
  gl.uniform1f(vibeRt.loc.mid, Math.max(0, Math.min(1, Number(fft.mid) || 0)));
  gl.uniform1f(vibeRt.loc.high, Math.max(0, Math.min(1, Number(fft.high) || 0)));
  gl.uniform1f(vibeRt.loc.energy, Math.max(0, Math.min(1, Number(fft.energy) || 0)));
  const bins = new Float32Array(64);
  const raw = fft.bins || [];
  for (let i = 0; i < 64; i++) bins[i] = Number(raw[i]) || 0;
  if (vibeRt.loc.fft) gl.uniform1fv(vibeRt.loc.fft, bins);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  vibeRt.raf = requestAnimationFrame(vibeFrame);
}

function paintVibeMeters() {
  const fft = state.vibe.fft || {};
  const bass = $("#vibe-bass");
  const mid = $("#vibe-mid");
  const high = $("#vibe-high");
  if (bass) bass.style.width = `${Math.round((fft.bass || 0) * 100)}%`;
  if (mid) mid.style.width = `${Math.round((fft.mid || 0) * 100)}%`;
  if (high) high.style.width = `${Math.round((fft.high || 0) * 100)}%`;
  const bars = $("#vibe-fft");
  if (bars) {
    const bins = fft.bins || [];
    if (!bars.childElementCount) {
      bars.innerHTML = Array.from({ length: 32 }, () => "<i></i>").join("");
    }
    [...bars.children].forEach((el, i) => {
      const v = Number(bins[i * 2] || bins[i] || 0);
      el.style.height = `${Math.max(4, Math.round(v * 100))}%`;
    });
  }
  paintVibeStatus();
}

function paintVibeStatus() {
  const el = $("#vibe-msg");
  if (!el) return;
  const fft = state.vibe.fft || {};
  if (state.vibe.err) {
    el.textContent = state.vibe.err;
    el.className = "vibe-msg bad";
    return;
  }
  if (fft.error && fft.listening === false) {
    el.textContent = fft.error;
    el.className = "vibe-msg bad";
    return;
  }
  const listen = fft.listening ? `LIVE // ${fft.device || fft.source || "loopback"}` : "IDLE // hit LISTEN for PC audio";
  el.textContent = listen;
  el.className = fft.listening ? "vibe-msg live" : "vibe-msg";
  const btn = $("#vibe-listen");
  if (btn) btn.classList.toggle("hot", !!fft.listening);
}

function bindVibe() {
  const dance = $("#vibe-dance");
  if (dance) dance.onclick = () => setVibeMode("dance");
  const act = $("#vibe-action-tog");
  if (act) act.onclick = async () => {
    state.vibe.picked = false;
    state.vibe.actionKind = "";
    setVibeMode("motivation");
    await syncActionShader();
  };
  const overlay = $("#vibe-action");
  if (overlay) overlay.onclick = () => tapVibeAction();
  const listen = $("#vibe-listen");
  if (listen) listen.onclick = async () => {
    const on = !(state.vibe.fft && state.vibe.fft.listening);
    try {
      state.vibe.fft = await api("/api/vibe/listen", { method: "POST", body: JSON.stringify({ on, source: "loopback" }) });
      setStatus(on ? "VIBE LISTENING // PC LOOPBACK" : "VIBE IDLE");
      paintVibeMeters();
    } catch (e) {
      state.vibe.err = String(e.message || e);
      paintVibeStatus();
    }
  };
  const mic = $("#vibe-mic");
  if (mic) mic.onclick = async () => {
    try {
      state.vibe.fft = await api("/api/vibe/listen", { method: "POST", body: JSON.stringify({ on: true, source: "mic" }) });
      setStatus("VIBE LISTENING // MIC");
      paintVibeMeters();
    } catch (e) {
      state.vibe.err = String(e.message || e);
      paintVibeStatus();
    }
  };
  const pick = $("#vibe-file");
  if (pick) pick.onchange = async () => {
    const path = pick.value;
    if (!path) return;
    state.vibe.picked = true;
    try {
      const sh = await api(`/api/vibe/shader?path=${encodeURIComponent(path)}`);
      state.vibe.source = sh.source || "";
      state.vibe.path = sh.path || "";
      state.vibe.name = sh.name || "";
      const ta = $("#vibe-src");
      if (ta) ta.value = state.vibe.source;
      vibeCompile(state.vibe.source);
      setStatus(`VIBE // ${state.vibe.name}`);
    } catch (e) {
      state.vibe.err = String(e.message || e);
      paintVibeStatus();
    }
  };
  const browse = $("#vibe-browse");
  if (browse) browse.onclick = async () => {
    try {
      const out = await api("/api/vibe/browse", { method: "POST", body: "{}" });
      if (!out || out.cancelled) return;
      state.vibe.source = out.source || "";
      state.vibe.path = out.path || "";
      state.vibe.name = out.name || "";
      const ta = $("#vibe-src");
      if (ta) ta.value = state.vibe.source;
      await loadVibe();
      const sel = $("#vibe-file");
      if (sel) {
        const hit = [...sel.options].find((o) => o.value === state.vibe.path);
        if (!hit) {
          const opt = document.createElement("option");
          opt.value = state.vibe.path;
          opt.textContent = state.vibe.name;
          sel.appendChild(opt);
        }
        sel.value = state.vibe.path;
      }
      vibeCompile(state.vibe.source);
      setStatus(`VIBE // ${state.vibe.name}`);
    } catch (e) {
      state.vibe.err = String(e.message || e);
      paintVibeStatus();
    }
  };
  const compile = $("#vibe-compile");
  if (compile) compile.onclick = () => {
    const ta = $("#vibe-src");
    if (ta) state.vibe.source = ta.value;
    vibeCompile(state.vibe.source);
    setStatus(state.vibe.err ? "SHADER FAULT" : "SHADER LIVE");
  };
  const save = $("#vibe-save");
  if (save) save.onclick = async () => {
    const ta = $("#vibe-src");
    if (ta) state.vibe.source = ta.value;
    try {
      const out = await api("/api/vibe/shader", {
        method: "PUT",
        body: JSON.stringify({ source: state.vibe.source, path: state.vibe.path, name: state.vibe.name || "custom" }),
      });
      state.vibe.path = out.path;
      state.vibe.name = out.name;
      setStatus(`SAVED // ${out.name}`);
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
  const srcTog = $("#vibe-src-tog");
  if (srcTog) srcTog.onclick = () => {
    state.vibe.srcOpen = !state.vibe.srcOpen;
    localStorage.setItem("pip.vibeSrc", state.vibe.srcOpen ? "1" : "0");
    const box = $("#vibe-editor");
    if (box) box.hidden = !state.vibe.srcOpen;
    srcTog.classList.toggle("on", state.vibe.srcOpen);
  };
  const speed = $("#vibe-speed");
  if (speed) speed.oninput = () => {
    state.vibe.speed = parseFloat(speed.value) || 1;
    localStorage.setItem("pip.vibeSpeed", String(state.vibe.speed));
    const read = $("#vibe-speed-read");
    if (read) read.textContent = state.vibe.speed.toFixed(1);
  };
  const bass = $("#vibe-gain");
  if (bass) bass.oninput = () => {
    state.vibe.bassGain = parseFloat(bass.value) || 2;
    localStorage.setItem("pip.vibeBass", String(state.vibe.bassGain));
    const read = $("#vibe-gain-read");
    if (read) read.textContent = state.vibe.bassGain.toFixed(1);
  };
}

function renderVibe(b) {
  if (b.querySelector("#vibe-gl")) {
    paintVibeMeters();
    paintVibeAction();
    ensureVibeLoop();
    return;
  }
  const files = state.vibe.files || [];
  const path = state.vibe.path || "";
  const mode = vibeIsMotiv() ? "motivation" : "dance";
  b.innerHTML = `
    <div class="vibe">
      <div class="vibe-bar">
        <button type="button" id="vibe-dance" class="${mode === "dance" ? "on" : ""}">DANCE</button>
        <button type="button" id="vibe-action-tog" class="${mode === "motivation" ? "on" : ""}">MOTIVATION</button>
        <button type="button" id="vibe-listen" class="${state.vibe.fft && state.vibe.fft.listening ? "hot" : ""}">LISTEN</button>
        <button type="button" id="vibe-mic">MIC</button>
        <select id="vibe-file">
          ${files.map((f) => `<option value="${esc(f.path)}" ${f.path === path ? "selected" : ""}>${esc(f.name)}</option>`).join("") || `<option value="">bass-pulse.glsl</option>`}
        </select>
        <button type="button" id="vibe-browse">OPEN TXT</button>
        <button type="button" id="vibe-compile">COMPILE</button>
        <button type="button" id="vibe-save">SAVE</button>
        <button type="button" id="vibe-src-tog" class="${state.vibe.srcOpen ? "on" : ""}">SRC</button>
        <label class="vibe-dial">SPEED <b id="vibe-speed-read">${Number(state.vibe.speed).toFixed(1)}</b>
          <input id="vibe-speed" type="range" min="0.1" max="4" step="0.1" value="${esc(state.vibe.speed)}" />
        </label>
        <label class="vibe-dial">BASS <b id="vibe-gain-read">${Number(state.vibe.bassGain).toFixed(1)}</b>
          <input id="vibe-gain" type="range" min="0.2" max="6" step="0.1" value="${esc(state.vibe.bassGain)}" />
        </label>
      </div>
      <div class="vibe-stage${mode === "motivation" ? " action" : ""}" id="vibe-stage">
        <canvas id="vibe-gl"></canvas>
        <div id="vibe-action" class="vibe-action" ${mode === "motivation" ? "" : "hidden"}>
          <div class="vibe-shot">NOW</div>
          <div class="vibe-hint">TAP WHEN DONE</div>
        </div>
        <div id="vibe-editor" class="vibe-editor" ${state.vibe.srcOpen ? "" : "hidden"}>
          <textarea id="vibe-src" spellcheck="false">${esc(state.vibe.source || "")}</textarea>
        </div>
      </div>
      <div class="vibe-foot">
        <div class="vibe-bands">
          <span>BASS</span><div class="vu-bar"><i id="vibe-bass"></i></div>
          <span>MID</span><div class="vu-bar"><i id="vibe-mid"></i></div>
          <span>HIGH</span><div class="vu-bar"><i id="vibe-high"></i></div>
        </div>
        <div id="vibe-fft" class="vibe-fft"></div>
        <div id="vibe-msg" class="vibe-msg">IDLE</div>
      </div>
    </div>
  `;
  bindVibe();
  paintVibeAction();
  requestAnimationFrame(() => vibeCompile(state.vibe.source || ""));
}

function renderData(b) {
  const h = state.health || {};
  const s = (h.settings || {});
  const o = h.ollama || {};
  const w = h.whisper || {};
  const p = h.piper || {};
  const prof = state.profile || {};
  const labels = prof.labels || [];
  const sources = prof.sources || [];
  b.innerHTML = `
    <h3>PROFILE // THIS INSTALL ONLY</h3>
    ${h.router && h.router.privacy
      ? `<p class="privacy-warn">SECURE // THIS PC. Custom pip + local Qwen. Pin ignored. Cloud APIs blocked. Key probe stays here.</p>`
      : ""}
    ${((h.router && h.router.warnings && h.router.warnings.length)
      ? (h.router.warnings.map((w) => `<p class="privacy-warn">${esc(w.label).toUpperCase()} // ${esc(w.text)}</p>`).join(""))
      : (h.router && h.router.privacy ? "" : `<p class="muted">This install only. Links and pastes stay on this PC.</p>`))}
    <p class="wx">${esc(prof.display_name || s.operator || "Operator")} ${prof.tagline ? "// " + esc(prof.tagline) : ""}</p>
    <p class="muted">${esc(prof.summary || "No profile yet.")}</p>
    <div>${labels.map((l) => `<span class="chip">${esc(l.category)}:${esc(l.name)}</span>`).join("") || ""}</div>
    <div class="field"><span>PUBLIC URL</span><input id="prof-url" value="${esc(state.profileUrl || "")}" placeholder="https://yoursite.com  or  Google Doc  or  Instagram" /></div>
    <p class="muted">Instagram: public bio and captions. No login. No photo grid. Then REBUILD RESUME.</p>
    <div class="actions">
      <button class="primary" id="prof-ingest">INGEST LINK</button>
      <button id="prof-rebuild">REBUILD RESUME</button>
    </div>
    <div class="field"><span>OR PASTE A DOC</span><textarea class="full" id="prof-paste" placeholder="Paste a resume or bio if the link is not public."></textarea></div>
    <div class="actions"><button id="prof-paste-btn">PIN PASTE</button></div>
    <h3>SOURCES</h3>
    ${sources.map((src) => `
      <div class="row">
        <span>${esc(src.kind)} // ${esc(src.title || src.url)}</span>
        <span class="muted">${esc(src.status)} ${src.chars || ""}</span>
      </div>`).join("") || "<p class='muted'>No sources yet.</p>"}
    ${prof.assembled_resume ? `<h3>ASSEMBLED RESUME</h3><div class="doc-body">${esc((prof.assembled_resume || "").slice(0, 2500))}${(prof.assembled_resume || "").length > 2500 ? "…" : ""}</div>` : ""}
    <h3>NODE</h3>
    <p>OLLAMA ${o.ok ? "ONLINE" : "OFFLINE"} // HUD ${esc(o.using || "")} // CODE ${esc(o.code || o.using || "")}</p>
    <p class="muted">${esc((o.models || []).join(", ") || o.error || "")}</p>
    <h3>POSTURE</h3>
    ${((h.router && h.router.modes) || [
      { id: "secure", label: "SECURE", text: "This PC only. pip + local Qwen." },
      { id: "local", label: "LOCAL", text: "Chat, mail, finances. Always this PC." },
      { id: "leaky", label: "LEAKY", text: "Opt-in cloud APIs for OPP/meals/CODE." },
      { id: "cloud", label: "CLOUD", text: "Groq / OpenRouter / Cerebras / Mistral. LEAKY only." },
      { id: "leak", label: "LEAK", text: "Gemini or Grok. LEAKY + pin." },
    ]).map((m) => `<div class="row"><span>${esc(m.label)}</span><span class="muted">${esc(m.text)}</span></div>`).join("")}
    <h3>BRAINS</h3>
    <p class="muted">${esc((h.router && h.router.why) || "SECURE is this PC. LEAKY is opt-in cloud for OPP/CODE. Chat and money stay local.")}</p>
    ${((h.router && h.router.providers) || []).map((p) => `
      <div class="row">
        <span>${esc(p.label)}${p.fishy ? " // LEAKY" : (p.warn ? " // NOT PRIVATE" : "")}</span>
        <span class="muted">${p.ready ? (p.env ? "KEY SET" : "ON") : "NO KEY"} ${p.env ? esc(p.env) : ""}</span>
      </div>`).join("")}
    <p>LIFE CHAIN // ${esc(((h.router && h.router.life_chain) || []).map((c) => c.id).join(" → ") || "ollama")}</p>
    <p>MEAL CHAIN // ${esc(((h.router && h.router.meal_chain) || []).map((c) => `${c.id}/${c.model}`).join(" → ") || "ollama")}</p>
    <p>CODE CHAIN // ${esc(((h.router && h.router.code_chain) || []).map((c) => `${c.id}/${c.model}`).join(" → ") || "ollama")}</p>
    ${(() => {
      const last = (h.router && h.router.last) || {};
      const tried = last.tried || [];
      const lastTok = (Number(last.prompt_tokens || 0) + Number(last.completion_tokens || 0)) || 0;
      const lastLine = last.provider
        ? `LAST TURN // ${esc(String(last.posture || last.provider).toUpperCase())} // ${String(last.provider).toUpperCase()} / ${esc(last.model || "")} // ${esc(last.lane || "")}${lastTok ? " // " + fmtTok(lastTok) + " TOK" : ""}${last.error ? " // " + esc(last.error) : ""}`
        : "LAST TURN // none yet";
      const tries = tried.length
        ? tried.map((t) => `<div class="row"><span>${esc(t.id)} // ${esc(t.model)}</span><span class="muted">${t.ok ? "HIT" : esc(t.error || "FAIL")}</span></div>`).join("")
        : "<p class='muted'>No routed turn yet this session. Ask in CHAT or CODE, then come back.</p>";
      return `<p>${lastLine}</p>${tries}`;
    })()}
    ${(() => {
      const main = (h.router && h.router.main) || {};
      const lanes = ["boost", "code", "life"].map((lane) => {
        const m = main[lane] || {};
        const act = m.acting || {};
        const best = m.best || {};
        return `<div class="row"><span>${lane.toUpperCase()} // ${esc(String(act.id || "ollama").toUpperCase())} / ${esc(act.model || "")}</span><span class="muted">${best.id && best.id !== act.id ? "BEST KEYED " + esc(String(best.id).toUpperCase()) : "ACTING"}</span></div>`;
      }).join("");
      const reason = (main.boost && main.boost.reason) || "";
      return `<h3>MAIN BRAIN</h3>${lanes}<p class="muted">${esc(reason)}</p>`;
    })()}
    ${(() => {
      const jobs = (h.router && h.router.jobs) || [];
      if (!jobs.length) return "";
      return `<h3>JOBS</h3>` + jobs.map((j) => `<div class="row"><span>${esc(String(j.lane || "").toUpperCase())} // ${esc(j.use || "")}</span><span class="muted">${esc(j.rule || "")}</span></div>`).join("");
    })()}
    ${(() => {
      const u = (h.router && h.router.usage) || {};
      const hosts = u.hosts || [];
      const head = `<h3>TOKENS // ${esc(u.month || "")}</h3><p>${fmtTok(u.tokens)} TOK // ${esc(String(u.calls || 0))} CALLS${u.errors ? " // " + esc(String(u.errors)) + " FAILS" : ""}</p>`;
      const rows = hosts.length
        ? hosts.map((x) => `<div class="row"><span>${esc(x.provider)} / ${esc(x.lane)}</span><span class="muted">${fmtTok(x.tokens)} // ${esc(String(x.calls || 0))} CALLS</span></div>`).join("")
        : "<p class='muted'>No counted turns this month yet. Chat or draft on OPP and this fills in.</p>";
      return head + rows + "<p class='muted'>Prompt + completion tokens as reported by the host. Local Ollama counts too. MONTH CAP below is money, not tokens.</p>";
    })()}
    ${(() => {
      const free = (h.router && h.router.free_hosts) || [];
      if (!free.length) return "";
      const rows = free.map((f) => {
        const tag = f.ready ? "KEY SET" : (f.wired ? "GET KEY" : "NOT WIRED");
        const href = f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.label)}</a>` : esc(f.label);
        return `<div class="row free-host"><span>${href} // ${esc(tag)}${f.fishy ? " // PIN-ONLY" : ""}</span><span class="muted">${esc(f.free || "")}</span></div>`;
      }).join("");
      return `<h3>FREE KEYS</h3><p class="muted">Free tiers as of Aug 2026. Limits move. Pip does not guess remaining quota. Paste a key below after you mint one.</p>${rows}`;
    })()}
    <div class="actions"><button id="brain-probe">${h.router && h.router.privacy ? "PROBE LOCAL" : "PROBE KEYS"}</button></div>
    <div id="brain-probe-out">${h.router && h.router.privacy ? "<p class='muted'>SECURE: probe will not contact cloud hosts.</p>" : "<p class='muted'>LEAKY: probe hits /models on keyed hosts. It does not send chat.</p>"}</div>
    <div class="field"><span>PIN</span>
      <select id="brain-pin">
        ${["auto", "local", "groq", "openrouter", "cerebras", "mistral", "gemini", "xai"].map((id) => {
          const on = ((h.router && h.router.pin) || s.brain_pin || "auto") === id;
          return `<option value="${id}" ${on ? "selected" : ""}>${id}</option>`;
        }).join("")}
      </select>
    </div>
    ${h.router && h.router.privacy ? `<p class="muted">PIN is stored but ignored while SECURE is on.</p>` : `<p class="muted">LEAKY is on. PIN unlocks Gemini/Grok for OPP and CODE only. Chat and finances stay LOCAL.</p>`}
    <p class="muted">Keys can live in the environment or in data/keys.env on this PC. Paste below. Empty fields keep the current key. Type CLEAR in a field to unset it.</p>
    ${(() => {
      const rows = (state.brainKeys && state.brainKeys.keys) || [
        { env: "OPENROUTER_API_KEY", set: false, hint: "" },
        { env: "GROQ_API_KEY", set: false, hint: "" },
        { env: "CEREBRAS_API_KEY", set: false, hint: "" },
        { env: "MISTRAL_API_KEY", set: false, hint: "" },
        { env: "GEMINI_API_KEY", set: false, hint: "" },
        { env: "XAI_API_KEY", set: false, hint: "" },
      ];
      return rows.map((k) => `
        <div class="field"><span>${esc(k.env)} ${k.set ? "// " + esc(k.hint) : "// NO KEY"}</span>
          <input id="key-${esc(k.env)}" type="password" autocomplete="off" placeholder="${k.set ? "leave blank to keep" : "paste key"}" />
        </div>`).join("");
    })()}
    <div class="actions"><button id="save-keys">SAVE KEYS</button></div>
    <p>WHISPER ${w.available ? "READY" : "MISSING"} ${w.loaded ? "// LOADED" : ""}</p>
    <p>PIPER ${p.available ? "READY" : "MISSING — drop piper.exe + .onnx in models/piper"}</p>
    <h3>COMMS</h3>
    <p>Mic picker and signal meter live in the CHAT pane (LISTEN + input dropdown).</p>
    <p class="muted">If the meter stays dead while you talk, switch the input source. Browser permission is required before device names appear.</p>
    <h3>PIP // CREW</h3>
    <p class="muted">TARS dials. 0 deadpan. 3 dry. 75+ TARS — has takes, answers small talk, never "I don't have preferences". Honesty stays high so Pip does not bluff work.</p>
    <div class="field"><span>HUMOR <b id="humor-read">${esc(s.humor || "3")}</b> <span class="muted" id="humor-band">${Number(s.humor || 3) >= 75 ? "TARS" : Number(s.humor || 3) <= 10 ? "DEADPAN" : Number(s.humor || 3) <= 40 ? "DRY" : "CREW"}</span></span>
      <input type="range" id="set-humor" min="0" max="100" step="1" value="${esc(s.humor || "3")}" />
    </div>
    <div class="field"><span>HONESTY <b id="honesty-read">${esc(s.honesty || "90")}</b></span>
      <input type="range" id="set-honesty" min="0" max="100" step="1" value="${esc(s.honesty || "90")}" />
    </div>
    <h3>OPERATOR</h3>
    <div class="field"><span>NAME</span><input id="set-op" value="${esc(s.operator || "")}" /></div>
    <div class="field"><span>CITY</span><input id="set-city" value="${esc(s.city || "")}" /></div>
    <div class="field"><span>MONTH CAP $</span><input id="set-cap" value="${esc(s.month_cap || "0")}" /></div>
    <p class="muted">Spend cap for CAPS. Token usage is TOK above, not this number.</p>
    <div class="actions"><button class="primary" id="save-data">SAVE</button></div>
    <h3>WEB UI + PHONE</h3>
    <p class="muted">This HUD <em>is</em> Pip's web UI (<code>http://127.0.0.1:7420</code> on this PC). Phone Pip pairs to the URLs below — same Wi‑Fi or VPN. No separate chat shell needed.</p>
    <h3>REMOTE ACCESS</h3>
    <p class="muted">Password gates every remote session. Same Wi‑Fi (LAN) or VPN (Tailscale / WireGuard). Loopback HUD stays open.</p>
    <div class="field"><span>PASSWORD</span><input id="phone-pw" type="password" autocomplete="new-password" placeholder="${(h.phone && h.phone.password_set) ? "leave blank to keep" : "pick a password"}" /></div>
    <div class="actions">
      <button class="primary" id="phone-on">${(h.phone && h.phone.on) ? "SAVE / KEEP LAN ON" : "TURN ON LAN"}</button>
      ${(h.phone && h.phone.on) ? `<button type="button" id="phone-off">TURN OFF LAN</button>` : ""}
      ${(h.phone && h.phone.urls && h.phone.urls[0]) ? `<button type="button" id="phone-copy">COPY URL</button>` : ""}
    </div>
    ${(h.phone && h.phone.urls && h.phone.urls.length)
      ? `<div class="phone-urls">${(h.phone.urls || []).map((u) => `<p class="phone-url">${esc(u)}</p>`).join("")}</div>
         <p class="muted">${h.phone.restart ? "Restart Pip once, then paste any URL into Phone Pip DATA → VPN URL or FIND + PAIR." : "Phone Pip DATA → VPN URL or FIND + PAIR. Allow Python on private networks if Windows asks."}</p>`
      : `<p class="muted">${(h.phone && h.phone.on) ? "Restart Pip, then URLs show up here." : "Set a password. Turn on LAN and/or VPN below."}</p>`}
    <h3>VPN</h3>
    <p class="muted">Reach this PC from anywhere. Tailscale is easiest. WireGuard is DIY tunnel + import on the phone.</p>
    <div class="field"><span>MODE</span>
      <select id="vpn-mode">
        <option value="off" ${!(h.phone && h.phone.vpn_on) ? "selected" : ""}>OFF</option>
        <option value="tailscale" ${(h.phone && h.phone.vpn_mode === "tailscale") ? "selected" : ""}>TAILSCALE</option>
        <option value="wireguard" ${(h.phone && h.phone.vpn_mode === "wireguard") ? "selected" : ""}>WIREGUARD</option>
        <option value="all" ${(h.phone && h.phone.vpn_mode === "all") ? "selected" : ""}>ALL</option>
      </select>
    </div>
    <div class="actions">
      <button type="button" class="primary" id="vpn-save">SAVE VPN</button>
      <button type="button" id="vpn-refresh">REFRESH</button>
      <button type="button" id="wg-client">COPY PHONE WG</button>
      <button type="button" id="wg-server">COPY PC WG</button>
    </div>
    <p class="muted" id="vpn-msg">${(() => {
      const ts = (h.phone && h.phone.tailscale) || {};
      const wg = (h.phone && h.phone.wireguard) || {};
      const bits = [];
      if (ts.installed) bits.push(`Tailscale ${ts.online ? "online" : "offline"}${ts.name ? " · " + ts.name : ""}${(ts.ips || []).length ? " · " + ts.ips.join(", ") : ""}`);
      else bits.push("Tailscale not installed");
      if (wg.ready) bits.push(`WireGuard ready · phone ${wg.client_ip || "10.8.0.2"} → PC ${wg.server_ip || "10.8.0.1"}`);
      else bits.push("WireGuard not generated yet");
      return esc(bits.join(" // "));
    })()}</p>
    <div class="field"><span>WG ENDPOINT (your public IP or DDNS)</span><input id="vpn-endpoint" value="${esc((h.phone && h.phone.wireguard && h.phone.wireguard.endpoint) || "")}" placeholder="optional — for WireGuard off Wi‑Fi" /></div>
    <p class="muted">Email is local drafts only. No inbox connector in v1.</p>
  `;
  $("#prof-ingest").onclick = async () => {
    const url = $("#prof-url").value.trim();
    if (!url) { setStatus("NEED A URL"); return; }
    state.profileUrl = url;
    try { localStorage.setItem("pip.profileUrl", url); } catch (_) {}
    setStatus("INGESTING PROFILE SOURCE…");
    try {
      const out = await api("/api/profile/ingest", { method: "POST", body: JSON.stringify({ url }) });
      await api("/api/profile/rebuild", { method: "POST", body: "{}" });
      state.profile = await api("/api/profile");
      renderView();
      setStatus(out.source && out.source.status === "wall" ? "WALL — HANDLE KEPT" : "SOURCE PINNED · URL STILL THERE");
    } catch (e) { setStatus(String(e.message || e)); }
  };
  $("#prof-rebuild").onclick = async () => {
    setStatus("REBUILDING PROFILE…");
    try {
      state.profile = await api("/api/profile/rebuild", { method: "POST", body: "{}" });
      renderView();
      setStatus("RESUME ASSEMBLED");
    } catch (e) { setStatus(String(e.message || e)); }
  };
  $("#prof-paste-btn").onclick = async () => {
    const body = $("#prof-paste").value.trim();
    if (!body) return;
    await api("/api/profile/paste", { method: "POST", body: JSON.stringify({ title: "Pasted bio", body }) });
    state.profile = await api("/api/profile/rebuild", { method: "POST", body: "{}" });
    renderView();
    setStatus("PASTE PINNED");
  };
  $("#save-data").onclick = async () => {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        operator: $("#set-op").value,
        city: $("#set-city").value,
        month_cap: $("#set-cap").value,
        humor: $("#set-humor") ? $("#set-humor").value : "3",
        honesty: $("#set-honesty") ? $("#set-honesty").value : "90",
        brain_pin: $("#brain-pin") ? $("#brain-pin").value : "auto",
      }),
    });
    state.health = await api("/api/health");
    await refreshToday();
    setStatus("SETTINGS STORED");
    renderPrivacy();
  };
  const phoneOn = $("#phone-on");
  if (phoneOn) phoneOn.onclick = async () => {
    const pw = ($("#phone-pw") && $("#phone-pw").value) || "";
    const body = { on: true };
    if (pw) body.password = pw;
    try {
      const out = await api("/api/phone", { method: "POST", body: JSON.stringify(body) });
      state.health = await api("/api/health");
      renderView();
      setStatus(out.restart ? "RESTART PIP — THEN OPEN THE URL ON YOUR PHONE" : "PHONE ON");
    } catch (e) { setStatus(String(e.message || e)); }
  };
  const phoneOff = $("#phone-off");
  if (phoneOff) phoneOff.onclick = async () => {
    try {
      await api("/api/phone", { method: "POST", body: JSON.stringify({ on: false }) });
      state.health = await api("/api/health");
      renderView();
      setStatus("PHONE OFF — PC ONLY");
    } catch (e) { setStatus(String(e.message || e)); }
  };
  const phoneCopy = $("#phone-copy");
  if (phoneCopy) phoneCopy.onclick = async () => {
    const url = (state.health && state.health.phone && state.health.phone.urls && state.health.phone.urls[0]) || "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("URL COPIED");
    } catch (_) {
      setStatus(url);
    }
  };
  const vpnSave = $("#vpn-save");
  if (vpnSave) vpnSave.onclick = async () => {
    const pw = ($("#phone-pw") && $("#phone-pw").value) || "";
    const body = { mode: ($("#vpn-mode") && $("#vpn-mode").value) || "off", endpoint: ($("#vpn-endpoint") && $("#vpn-endpoint").value) || "" };
    if (pw) {
      try { await api("/api/phone", { method: "POST", body: JSON.stringify({ password: pw }) }); } catch (e) { setStatus(String(e.message || e)); return; }
    }
    try {
      const out = await api("/api/vpn", { method: "POST", body: JSON.stringify(body) });
      state.health = await api("/api/health");
      renderView();
      setStatus(out.restart ? "RESTART PIP — VPN LIVE" : "VPN SAVED");
    } catch (e) { setStatus(String(e.message || e)); }
  };
  const vpnRefresh = $("#vpn-refresh");
  if (vpnRefresh) vpnRefresh.onclick = async () => {
    try {
      state.health = await api("/api/health");
      renderView();
      setStatus("VPN STATUS REFRESHED");
    } catch (e) { setStatus(String(e.message || e)); }
  };
  const copyWg = async (path, label) => {
    try {
      const res = await fetch(path);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setStatus(`${label} COPIED`);
    } catch (e) { setStatus(String(e.message || e)); }
  };
  const wgClient = $("#wg-client");
  if (wgClient) wgClient.onclick = () => copyWg("/api/vpn/wireguard/client", "PHONE WG");
  const wgServer = $("#wg-server");
  if (wgServer) wgServer.onclick = () => copyWg("/api/vpn/wireguard/server", "PC WG");
  const humor = $("#set-humor");
  const honesty = $("#set-honesty");
  if (humor) humor.oninput = () => {
    const el = $("#humor-read"); if (el) el.textContent = humor.value;
    const band = $("#humor-band");
    if (band) {
      const n = Number(humor.value);
      band.textContent = n >= 75 ? "TARS" : n <= 10 ? "DEADPAN" : n <= 40 ? "DRY" : "CREW";
    }
  };
  if (honesty) honesty.oninput = () => { const el = $("#honesty-read"); if (el) el.textContent = honesty.value; };
  const probe = $("#brain-probe");
  if (probe) probe.onclick = async () => {
    const box = $("#brain-probe-out");
    if (box) box.innerHTML = "<p class='muted'>PROBING HOSTS…</p>";
    setStatus("PROBING BRAINS…");
    try {
      const out = await api("/api/brains/probe");
      try {
        state.health = await api("/api/health");
        renderMeters();
      } catch (_) {}
      const rows = (out.hosts || []).map((h) => `<div class="row"><span>${esc(h.label)}</span><span class="muted">${h.ok ? "REACHABLE" : esc(h.detail || "FAIL")}</span></div>`).join("");
      if (box) box.innerHTML = `${rows}<p class="muted">${esc(out.note || "")}</p>`;
      setStatus("PROBE DONE");
    } catch (e) {
      if (box) box.innerHTML = `<p class="privacy-warn">${esc(e.message || e)}</p>`;
      setStatus("PROBE FAULT");
    }
  };
  const saveKeys = $("#save-keys");
  if (saveKeys) saveKeys.onclick = async () => {
    const body = {};
    const rows = (state.brainKeys && state.brainKeys.keys) || [];
    const names = rows.length ? rows.map((k) => k.env) : ["OPENROUTER_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"];
    names.forEach((env) => {
      const el = document.getElementById("key-" + env);
      const v = el && el.value.trim();
      if (v) body[env] = v;
    });
    if (!Object.keys(body).length) { setStatus("PASTE A KEY FIRST"); return; }
    try {
      state.brainKeys = await api("/api/brains/keys", { method: "PUT", body: JSON.stringify(body) });
      state.health = await api("/api/health");
      renderView();
      renderPrivacy();
      setStatus("KEYS STORED ON THIS PC");
    } catch (e) {
      setStatus(String(e.message || e));
    }
  };
}

async function sendChat(text) {
  const msg = (text || "").trim();
  if (!msg) return;
  $("#input").value = "";
  addLog("user", msg);
  setStatus("THINKING…");
  try {
    const out = await api("/api/chat", { method: "POST", body: JSON.stringify({ text: msg }) });
    addLog("pip", out.reply);
    if (out.theme) applyThemeVars(out.theme);
    setStatus(out.tools && out.tools.length ? `TOOLS ${out.tools.join(", ").toUpperCase()}` : (out.theme ? `THEME · ${(out.theme_name || "APPLIED").toUpperCase()}` : (out.model ? String(out.model).toUpperCase() : "READY")));
    focusPane(out.focus);
    const mealTools = (out.tools || []).some((t) => /meal|plan_meals|macro/.test(t));
    if (mealTools && state.tab !== "meals") switchTab("meals");
    await loadTabData();
    if (mealTools || state.tab === "meals") {
      try { state.meals = await api("/api/meals"); } catch (_) {}
    }
    renderView();
    try {
      state.health = await api("/api/health");
      renderPrivacy();
    } catch (_) {}
    renderMeters();
    if (state.tts) speak(out.reply);
  } catch (e) {
    addLog("pip", String(e.message || e), "err");
    setStatus("CHAT ERROR");
  }
}

async function speak(text) {
  if (!state.tts || !text) return;
  try {
    const blob = await api("/api/voice/speak", { method: "POST", body: JSON.stringify({ text: text.slice(0, 800) }) });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play();
  } catch (_) {
    /* piper optional */
  }
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const SIGNAL_FLOOR = 0.012;

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (buf.length || 1));
}

function currentGate() {
  if (state.calFloor > 0) return Math.max(state.calFloor * 2.3, state.calFloor + 0.01);
  if (state.rmsHist.length >= 10) {
    const s = [...state.rmsHist].sort((a, b) => a - b);
    const p = s[Math.floor(s.length * 0.2)] || 0;
    return p * 2.4 + 0.008;
  }
  return 0.03;
}

function setVu(level) {
  const fill = $("#vu-fill");
  const bar = fill.parentElement;
  const lab = $("#sig-label");
  const tick = $("#vu-gate");
  const gate = currentGate();
  const pct = Math.min(100, Math.round(level * 450));
  fill.style.width = pct + "%";
  if (tick) {
    tick.style.display = (state.listen || state.recording || state.calibrating) ? "block" : "none";
    tick.style.left = Math.min(96, Math.round(gate * 450)) + "%";
  }
  if (!(state.listen || state.recording || state.calibrating)) {
    lab.textContent = state.calFloor ? "MIC IDLE // FLOOR LOCKED" : "MIC IDLE";
    lab.classList.remove("live", "dead");
    bar.classList.remove("dead", "noise");
    fill.style.width = "0%";
    if (tick) tick.style.display = state.calFloor ? "block" : "none";
    return;
  }
  if (state.calibrating) {
    lab.textContent = "CALIBRATING — stay quiet";
    lab.classList.remove("live");
    lab.classList.add("dead");
    bar.classList.add("noise");
    bar.classList.remove("dead");
    return;
  }
  const speech = level >= gate;
  lab.classList.toggle("live", speech);
  lab.classList.toggle("dead", !speech);
  bar.classList.toggle("noise", !speech);
  bar.classList.toggle("dead", false);
  lab.textContent = speech ? "SPEECH" : "MIC NOISE — talk over the amber tick";
}

function audioConstraints() {
    const audio = {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
  if (state.micId) audio.deviceId = { exact: state.micId };
  return { audio };
}

async function listMics() {
  const sel = $("#mic-select");
  if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (_) {
    return;
  }
  const mics = devices.filter((d) => d.kind === "audioinput");
  const prev = sel.value;
  sel.innerHTML = `<option value="">Default input</option>` + mics.map((d, i) => {
    const label = d.label || `Input ${i + 1}`;
    return `<option value="${esc(d.deviceId)}">${esc(label)}</option>`;
  }).join("");
  const want = state.micId || prev;
  if (want && [...sel.options].some((o) => o.value === want)) sel.value = want;
  else sel.value = "";
}

async function openMic() {
  if (state.audio && state.audio.deviceId === (state.micId || "")) return state.audio;
  await closeMic({ transcribe: false });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(audioConstraints());
  } catch (err) {
    if (state.micId) {
      state.micId = "";
      localStorage.removeItem("pip.micId");
      $("#mic-select").value = "";
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } else {
      throw err;
    }
  }
  const usedId = stream.getAudioTracks()[0]?.getSettings?.().deviceId || state.micId || "";
  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === "suspended") await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 100;
  hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6500;
  lp.Q.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -28;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.12;
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    const level = rms(data);
    if (state.calibrating) state.calBuf.push(level);
    if (!state.calibrating) {
      state.rmsHist.push(level);
      if (state.rmsHist.length > 60) state.rmsHist.shift();
    }
    if (level > state.vuPeak) state.vuPeak = level;
    const gate = currentGate();
    if (level >= gate && level > state.speechPeak) state.speechPeak = level;
    setVu(level);
    if (state.recording && state.audio) {
      if (level >= gate) state.hang = 3;
      if (state.hang > 0) {
        state.hang -= 1;
        state.audio.chunks.push(new Float32Array(data));
      }
    }
  };
  src.connect(hp);
  hp.connect(lp);
  lp.connect(comp);
  comp.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  state.audio = { stream, ctx, proc, mute, src, hp, lp, comp, chunks: [], deviceId: usedId };
  state.vuPeak = 0;
  state.speechPeak = 0;
  await listMics();
  return state.audio;
}

async function closeMic({ transcribe }) {
  const rec = state.audio;
  const wasRecording = state.recording;
  const chunks = rec ? rec.chunks.slice() : [];
  const sampleRate = rec?.ctx?.sampleRate || 16000;
  state.recording = false;
  $("#mic").classList.remove("hot");
  if (!state.listen) {
    if (rec) {
      try { rec.proc.disconnect(); } catch (_) {}
      rec.stream.getTracks().forEach((t) => t.stop());
      try { await rec.ctx.close(); } catch (_) {}
    }
    state.audio = null;
    setVu(0);
  } else if (rec) {
    rec.chunks = [];
  }
  if (!transcribe || !wasRecording) return;
  const gate = currentGate();
  if (state.speechPeak < gate || !chunks.length) {
    setStatus("NO SPEECH above the noise tick — CAL while quiet, then talk");
    addLog("pip", "Heard mic noise, not speech. Hit CAL while silent, then hold MIC and talk over the amber tick.", "err");
    return;
  }
  let len = 0;
  chunks.forEach((c) => { len += c.length; });
  const samples = new Float32Array(len);
  let o = 0;
  chunks.forEach((c) => { samples.set(c, o); o += c.length; });
  const wav = encodeWav(samples, sampleRate);
  const fd = new FormData();
  fd.append("audio", wav, "clip.wav");
  fd.append("noise_floor", String(state.calFloor || gate / 2.3));
  setStatus("TRANSCRIBING…");
  try {
    const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    const out = await res.json();
    if (out.text) sendChat(out.text);
    else setStatus("NO SPEECH");
  } catch (e) {
    setStatus("STT OFFLINE");
    addLog("pip", "Whisper is not ready. Type instead. " + (e.message || ""), "err");
  }
}

async function startRec() {
  if (state.recording) return;
  await openMic();
  state.recording = true;
  state.vuPeak = 0;
  state.speechPeak = 0;
  state.hang = 0;
  if (state.audio) state.audio.chunks = [];
  $("#mic").classList.add("hot");
  setStatus("REC — green = speech, amber = noise");
}

async function stopRec() {
  if (!state.recording) return;
  await closeMic({ transcribe: true });
}

async function toggleListen() {
  if (state.listen) {
    state.listen = false;
    $("#mic-test").classList.remove("hot");
    if (!state.recording) await closeMic({ transcribe: false });
    setStatus("MIC CLOSED");
    return;
  }
  await openMic();
  state.listen = true;
  $("#mic-test").classList.add("hot");
  setStatus("LISTEN — CAL while quiet, then talk over the amber tick");
}

async function calibrate() {
  await openMic();
  state.calibrating = true;
  state.calBuf = [];
  $("#mic-cal").classList.add("hot");
  setStatus("CAL — stay quiet");
  await new Promise((r) => setTimeout(r, 1100));
  state.calibrating = false;
  $("#mic-cal").classList.remove("hot");
  const vals = state.calBuf.slice();
  state.calBuf = [];
  if (!vals.length) {
    setStatus("CAL FAILED — hit LISTEN first");
    return;
  }
  vals.sort((a, b) => a - b);
  const floor = vals[Math.floor(vals.length * 0.8)] || vals[vals.length - 1];
  state.calFloor = floor;
  localStorage.setItem("pip.noiseFloor", String(floor));
  setVu(vals[vals.length - 1] || 0);
  setStatus(`NOISE LOCKED ${(floor * 100).toFixed(1)} — talk over the amber tick`);
}

async function changeMic(id) {
  state.micId = id || "";
  if (state.micId) localStorage.setItem("pip.micId", state.micId);
  else localStorage.removeItem("pip.micId");
  const keepListen = state.listen;
  const keepRec = state.recording;
  state.listen = false;
  state.recording = false;
  await closeMic({ transcribe: false });
  if (keepListen || keepRec) {
    state.listen = keepListen;
    await openMic();
    if (keepListen) $("#mic-test").classList.add("hot");
    setStatus(keepRec ? "REC" : "LISTEN — new input");
  }
}

async function boot() {
  const log = $("#boot-log");
  const lines = [
    "PIP-OS 1.0",
    "LOCAL NODE // SECURE / LEAKY",
    "MOUNTING VAULT…",
  ];
  try {
    log.textContent = lines.join("\n");
    tickClock();
    setInterval(tickClock, 1000);
    document.body.classList.toggle("phone", isPhoneHud());
    try {
      await api("/api/ready", { timeout: 3000 });
      lines.push("HUD UP");
    } catch (e) {
      lines.push("BOOT FAULT " + e);
    }
    log.textContent = lines.join("\n");
  } finally {
    $("#boot")?.classList.add("gone");
  }
  try {
    const hist = await api("/api/chat/history", { timeout: 4000 });
    hist.forEach((m) => addLog(m.role === "user" ? "user" : "pip", m.content));
  } catch (_) {}
  try {
    await refreshToday();
  } catch (_) {}
  setInterval(async () => {
    try {
      const wx = await api("/api/weather", { timeout: 8000 });
      const sev = wx && wx.severity;
      if (!sev || !sev.crummy || !sev.line) return;
      const id = ((wx.alerts || [])[0] && (wx.alerts || [])[0].id) || sev.level;
      if (state._wxAlertId === id) return;
      state._wxAlertId = id;
      addLog("pip", sev.line + (wx.alerts && wx.alerts[0] ? ` ${wx.alerts[0].event}.` : ""));
      setStatus("WX ALERT");
    } catch (_) {}
  }, 8 * 60 * 1000);
  try {
    const th = await api("/api/theme", { timeout: 4000 });
    if (th.css) applyThemeCss(th.css);
    else if (th.theme) applyThemeVars(th.theme);
  } catch (_) {}
  if (!histHasAnything()) {
    addLog("pip", "Pip online. Local node. Tell me a city for weather, a goal, or what you want to eat. Mail is draft-copy-open — I do not send.");
  }
  if (!isPhoneHud()) {
    try { await listMics(); } catch (_) {}
  }
  api("/api/health", { timeout: 6000 }).then((h) => {
    state.health = h;
    renderPrivacy();
    renderMeters();
  }).catch(() => {});
  renderPrivacy();
  setStatus("READY");
}

function histHasAnything() {
  return $("#log").children.length > 0;
}

$("#tabs").addEventListener("click", async (e) => {
  if (e.target.closest("#tab-more") && !e.target.closest("[data-tab]")) {
    const menu = $("#tab-more-menu");
    if (menu) menu.hidden = !menu.hidden;
    return;
  }
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  const menu = $("#tab-more-menu");
  if (menu) menu.hidden = true;
  switchTab(btn.dataset.tab);
  document.body.classList.remove("phone-comm");
  const tog = $("#comm-tog");
  if (tog) tog.classList.remove("on");
  await loadTabData();
  renderView();
});

$("#send").onclick = () => sendChat($("#input").value);
const commTog = $("#comm-tog");
if (commTog) {
  commTog.onclick = () => {
    document.body.classList.toggle("phone-comm");
    commTog.classList.toggle("on", document.body.classList.contains("phone-comm"));
  };
}
const privacyTog = $("#privacy-tog");
if (privacyTog) {
  privacyTog.onclick = async () => {
    const on = privacyTog.classList.contains("on");
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ privacy_mode: on ? "0" : "1" }) });
    state.health = await api("/api/health");
    renderPrivacy();
    setStatus(on ? "LEAKY // CLOUD UNLOCKED" : "SECURE // THIS PC");
  };
}
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat($("#input").value);
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && state.tab === "code") {
    e.preventDefault();
    saveIdeFile();
  }
});

const mic = $("#mic");
mic.addEventListener("mousedown", () => startRec().catch((e) => setStatus(String(e))));
mic.addEventListener("mouseup", () => stopRec());
mic.addEventListener("mouseleave", () => { if (state.recording) stopRec(); });
mic.addEventListener("touchstart", (e) => { e.preventDefault(); startRec().catch(() => {}); });
mic.addEventListener("touchend", (e) => { e.preventDefault(); stopRec(); });

$("#mic-test").addEventListener("click", () => toggleListen().catch((e) => setStatus(String(e.message || e))));
$("#mic-cal").addEventListener("click", () => calibrate().catch((e) => setStatus(String(e.message || e))));
$("#mic-select").addEventListener("change", (e) => changeMic(e.target.value).catch((err) => setStatus(String(err.message || err))));
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => listMics());
}

$("#tts-tog").addEventListener("change", (e) => {
  state.tts = e.target.checked;
});

const inspectClose = $("#inspect-close");
if (inspectClose) inspectClose.onclick = () => closeInspect();

const audioMore = $("#audio-more");
if (audioMore) {
  audioMore.onclick = () => {
    const box = $("#comm-audio");
    if (!box) return;
    box.hidden = !box.hidden;
    audioMore.classList.toggle("on", !box.hidden);
  };
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".tab-more")) {
    const m = $("#tab-more-menu");
    if (m) m.hidden = true;
  }
  if (!e.target.closest(".drop")) {
    const em = $("#studio-export-menu");
    if (em) em.hidden = true;
  }
});

async function pingPresence() {
  if (document.visibilityState !== "visible") return;
  try {
    const out = await api("/api/presence", { method: "POST", body: "{}" });
    if (out && out.nudge) addLog("pip", out.nudge, "nudge");
  } catch (_) {}
}

boot();
setInterval(() => {
  if (state.tab === "today") refreshToday().catch(() => {});
}, 30000);
setInterval(pingPresence, 20000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pingPresence();
});
