/** WX map + storm dossier — runs on phone standalone (public APIs) or via paired desktop. */
import { httpGet, httpLanGet, httpLanPostJson } from "./net.js";
import { desktopConfigured } from "./desktop.js";

let map = null;
let pin = null;
let hailLayer = null;
let layers = {};
let activeLayer = "osm";

const WMO = {
  95: "Thunderstorm",
  82: "Violent rain",
  65: "Heavy rain",
  75: "Heavy snow",
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function hailSizeIn(raw) {
  const n = parseInt(String(raw || "").trim(), 10);
  if (!n || n >= 8000) return "UNK";
  return (n / 100).toFixed(2);
}

function zillowUrl(address) {
  return `https://www.zillow.com/homes/${encodeURIComponent(String(address || "").trim())}_rb/`;
}

async function api(path, opts = {}) {
  const settings = opts.settings;
  if (desktopConfigured(settings)) {
    const tok = String(settings.desktop_token || "").trim();
    const base = String(settings.desktop_url || "").replace(/\/+$/, "");
    const headers = tok ? { Cookie: `pip_gate=${tok}` } : {};
    if (opts.method === "POST") {
      return httpLanPostJson(`${base}${path}`, headers, opts.body || {}, opts.timeout || 120000);
    }
    return httpLanGet(`${base}${path}`, opts.timeout || 20000, headers);
  }
  return null;
}

async function reverseGeocode(lat, lon) {
  const { body } = await httpGet(
    `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en`,
  );
  const data = JSON.parse(body || "{}");
  const hit = (data.results || [])[0];
  if (!hit) return { ok: false, error: "no address" };
  const address = [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
  return { ok: true, address, city: hit.name || "", lat, lon };
}

async function historicalStorms(lat, lon, days = 540) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.min(days, 730));
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    daily: "weather_code,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max",
    timezone: "auto",
    wind_speed_unit: "mph",
    precipitation_unit: "mm",
  });
  const { body } = await httpGet(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  const data = JSON.parse(body || "{}");
  const daily = data.daily || {};
  const times = daily.time || [];
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const code = parseInt((daily.weather_code || [])[i] || 0, 10);
    const precip = parseFloat((daily.precipitation_sum || [])[i] || 0);
    const wind = parseFloat((daily.wind_speed_10m_max || [])[i] || 0);
    const gust = parseFloat((daily.wind_gusts_10m_max || [])[i] || 0);
    let score = 0;
    const reasons = [];
    if ([95, 96, 99, 82, 65, 75].includes(code)) {
      score += 3;
      reasons.push(WMO[code] || "storm");
    }
    if (Math.max(wind, gust) >= 38) {
      score += 2;
      reasons.push(`wind ${Math.max(wind, gust).toFixed(0)} mph`);
    }
    if (precip >= 25) {
      score += 2;
      reasons.push(`precip ${precip.toFixed(0)} mm`);
    }
    if (score >= 2) {
      out.push({ date: times[i], score, label: WMO[code] || "Weather", reasons, source: "open-meteo-archive" });
    }
  }
  return out.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 80);
}

function parseSpcHailCsv(text, reportDay) {
  const rows = [];
  let inHail = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("Time,Size,")) {
      inHail = true;
      continue;
    }
    if (line.startsWith("Time,")) {
      inHail = false;
      continue;
    }
    if (!inHail || !line.trim()) continue;
    const parts = line.split(",", 8);
    if (parts.length < 7) continue;
    const rlat = parseFloat(parts[5]);
    const rlon = parseFloat(parts[6]);
    if (Number.isNaN(rlat) || Number.isNaN(rlon)) continue;
    const sizeIn = hailSizeIn(parts[1]);
    rows.push({
      date: reportDay,
      time: parts[0].trim(),
      size_in: sizeIn,
      location: parts[2].trim(),
      county: parts[3].trim(),
      state: parts[4].trim(),
      lat: rlat,
      lon: rlon,
      comments: (parts[7] || "").trim(),
      source: "noaa-spc",
    });
  }
  return rows;
}

async function fetchHailReports(lat, lon, radiusKm = 80, daysBack = 180) {
  const hits = [];
  const today = new Date();
  for (let d = 0; d < daysBack; d++) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    const stamp = day.toISOString().slice(0, 10).replace(/-/g, "").slice(2);
    const iso = day.toISOString().slice(0, 10);
    try {
      const { body, status } = await httpGet(`https://www.spc.noaa.gov/climo/reports/${stamp}_rpts_filtered.csv`, 10000);
      if (status === 404) continue;
      const dayRows = parseSpcHailCsv(body, iso);
      for (const row of dayRows) {
        const dist = haversineKm(lat, lon, row.lat, row.lon);
        if (dist <= radiusKm) {
          const sz = parseFloat(row.size_in);
          hits.push({
            ...row,
            distance_km: Math.round(dist * 10) / 10,
            score: !Number.isNaN(sz) && sz >= 1 ? 5 : 3,
          });
        }
      }
    } catch {
      /* skip day */
    }
  }
  return hits.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120);
}

async function searchNews(query, limit = 6) {
  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `q=${encodeURIComponent(query)}`,
    });
    const html = await res.text();
    const hits = [];
    const re = /uddg=([^&"]+)[^>]*>([^<]{8,200})<\/a/g;
    let m;
    while ((m = re.exec(html)) && hits.length < limit) {
      hits.push({ title: m[2].replace(/\s+/g, " ").trim(), url: decodeURIComponent(m[1]), source: "duckduckgo" });
    }
    return hits;
  } catch {
    return [];
  }
}

async function localMapConfig(settings) {
  let lat = 39.7392;
  let lon = -104.9903;
  let city = settings?.city || "Denver";
  if (settings?.lat && settings?.lon) {
    lat = parseFloat(settings.lat);
    lon = parseFloat(settings.lon);
  }
  let radar = "";
  try {
    const { body } = await httpGet("https://api.rainviewer.com/public/weather-maps.json", 8000);
    const rv = JSON.parse(body || "{}");
    const ts = ((rv.radar || {}).past || []).slice(-1)[0]?.time;
    if (ts) radar = `https://tilecache.rainviewer.com/v2/radar/${ts}/256/{z}/{x}/{y}/6/1_1.png`;
  } catch {
    /* optional */
  }
  const layerList = [
    { id: "osm", label: "Street", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OSM" },
    { id: "sat", label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri" },
  ];
  if (radar) layerList.unshift({ id: "radar", label: "Radar", url: radar, attribution: "© RainViewer", opacity: 0.55 });
  return { center: { lat, lon, city }, layers: layerList };
}

async function localResearch(lat, lon, address = "") {
  const geo = address ? { ok: true, address, city: address.split(",")[0] } : await reverseGeocode(lat, lon);
  const addr = address || geo.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const city = geo.city || addr.split(",")[0];
  const storms = await historicalStorms(lat, lon);
  const hail = await fetchHailReports(lat, lon);
  for (const h of hail.slice(0, 40)) {
    storms.unshift({
      date: h.date,
      score: h.score || 5,
      label: `Hail ${h.size_in} in`,
      reasons: [`hail ${h.size_in} in`, `${h.distance_km} km`, h.location],
      source: "noaa-spc",
    });
  }
  const news = [];
  for (const q of [`hail damage "${city}"`, `hail storm "${city}"`, `severe weather "${addr}"`]) {
    for (const hit of await searchNews(q, 4)) {
      if (!news.some((n) => n.url === hit.url)) news.push(hit);
    }
  }
  const zurl = zillowUrl(addr);
  return {
    ok: true,
    address: addr,
    lat,
    lon,
    storms,
    hail,
    news,
    zillow_url: zurl,
    owner_name: "",
    owner_phone: "",
    owner_email: "",
  };
}

export async function loadMapConfig(settings) {
  const remote = await api("/api/storm/map", { settings }).catch(() => null);
  return remote || localMapConfig(settings);
}

export async function researchPin(settings, lat, lon, address = "") {
  const remote = await api("/api/storm/research", {
    settings,
    method: "POST",
    body: { lat, lon, address, deep: true },
    timeout: 180000,
  }).catch(() => null);
  return remote || localResearch(lat, lon, address);
}

export async function quickPin(settings, lat, lon) {
  const remote = await api("/api/storm/pin", {
    settings,
    method: "POST",
    body: { lat, lon },
  }).catch(() => null);
  if (remote) return remote;
  const geo = await reverseGeocode(lat, lon);
  const hail = await fetchHailReports(lat, lon, 80, 90);
  return { ok: true, geo, hail, recent_storms: hail.slice(0, 5) };
}

export function drawHailMarkers(hailRows) {
  if (!map || !window.L) return;
  if (hailLayer) hailLayer.remove();
  hailLayer = window.L.layerGroup();
  for (const h of (hailRows || []).slice(0, 40)) {
    const sz = parseFloat(h.size_in);
    const r = Number.isNaN(sz) ? 6 : Math.min(18, 4 + sz * 4);
    window.L.circleMarker([h.lat, h.lon], {
      radius: r,
      color: "#7dff5a",
      fillColor: "#0d4f3c",
      fillOpacity: 0.75,
      weight: 1,
    })
      .bindPopup(`${h.date} · ${h.size_in} in hail<br>${h.location}, ${h.state}<br>${h.distance_km} km from pin`)
      .addTo(hailLayer);
  }
  hailLayer.addTo(map);
}

export function mountMap(container, config, { onTap }) {
  if (!window.L) throw new Error("Leaflet not loaded");
  if (map) {
    map.remove();
    map = null;
    pin = null;
    hailLayer = null;
    layers = {};
  }
  const c = config.center || { lat: 39.74, lon: -104.99 };
  map = window.L.map(container, { zoomControl: true }).setView([c.lat, c.lon], 11);
  for (const layer of config.layers || []) {
    layers[layer.id] = window.L.tileLayer(layer.url, {
      attribution: layer.attribution || "",
      opacity: layer.opacity ?? 1,
      maxZoom: 19,
    });
  }
  (layers[activeLayer] || layers.osm || Object.values(layers)[0])?.addTo(map);
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    if (pin) pin.setLatLng(e.latlng);
    else pin = window.L.marker(e.latlng).addTo(map);
    if (onTap) onTap(lat, lng);
  });
  return map;
}

export function setMapLayer(id) {
  if (!map || !layers[id]) return;
  Object.values(layers).forEach((l) => map.removeLayer(l));
  layers[id].addTo(map);
  activeLayer = id;
}

export function renderDossier(root, data, esc, onResearch) {
  const storms = data.storms || [];
  const hail = data.hail || [];
  const news = data.news || [];
  const addr = data.address || "";
  root.innerHTML = `
    <div class="wx-dossier">
      <div class="wx-addr">${esc(addr)}</div>
      <div class="wx-links">
        ${data.zillow_url ? `<a href="${esc(data.zillow_url)}" target="_blank" rel="noopener">ZILLOW</a>` : ""}
        ${onResearch ? `<button type="button" id="wx-deep" class="primary">DEEP RESEARCH</button>` : ""}
      </div>
      <div class="wx-contacts">
        ${data.owner_name ? `<div>Owner: ${esc(data.owner_name)}</div>` : ""}
        ${data.owner_phone ? `<div>Phone: ${esc(data.owner_phone)}</div>` : ""}
        ${data.owner_email ? `<div>Email: ${esc(data.owner_email)}</div>` : ""}
      </div>
      <h4>HAIL REPORTS (NOAA SPC)</h4>
      <div class="wx-hail">${hail.length ? hail.slice(0, 14).map((h) => `
        <div class="wx-hail-row"><span class="date">${esc(h.date)}</span>
        <span class="size">${esc(h.size_in)} in</span>
        <span class="dist">${esc(String(h.distance_km))} km</span>
        ${esc(h.location)}, ${esc(h.state)}</div>`).join("") : `<p class="muted">No SPC hail reports within 80 km in the last ~6 months. Try DEEP RESEARCH or widen search area.</p>`}</div>
      <h4>STORM DATES</h4>
      <div class="wx-storms">${storms.length ? storms.slice(0, 12).map((s) => `
        <div class="wx-storm"><span class="date">${esc(s.date)}</span> <span class="score">${esc(String(s.score))}</span> ${esc((s.reasons || []).join(" · ") || s.label)}</div>`).join("") : `<p class="muted">No scored storm days yet.</p>`}</div>
      <h4>NEWS</h4>
      <div class="wx-news">${news.length ? news.slice(0, 8).map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>`).join("") : `<p class="muted">News pulls on deep research.</p>`}</div>
    </div>`;
  const btn = root.querySelector("#wx-deep");
  if (btn && onResearch) btn.onclick = onResearch;
}

export function layerButtons(config, esc) {
  return (config.layers || [])
    .map((l) => `<button type="button" data-layer="${esc(l.id)}" class="${l.id === activeLayer ? "on" : ""}">${esc(l.label)}</button>`)
    .join("");
}
