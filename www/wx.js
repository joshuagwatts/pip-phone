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

async function reverseNominatim(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=18`;
  try {
    const { body } = await httpGet(url, 9000, { "Accept-Language": "en" });
    const data = JSON.parse(body || "{}");
    const a = data.address || {};
    let house = "";
    if (a.house_number && a.road) house = `${a.house_number} ${a.road}`;
    else if (a.road) house = a.road;
    else if (data.name) house = data.name;
    const city = a.city || a.town || a.village || a.hamlet || "";
    const state = a.state || a.region || "";
    const zip = a.postcode || "";
    const parts = [house, city, state, zip].filter(Boolean);
    const line = parts.join(", ") || String(data.display_name || "").split(",").slice(0, 3).join(", ");
    if (!line.trim()) return { ok: false };
    return { ok: true, address: line, city: city || line.split(",")[0], lat, lon, source: "nominatim" };
  } catch {
    return { ok: false };
  }
}

async function reverseGeocode(lat, lon) {
  const nom = await reverseNominatim(lat, lon);
  if (nom.ok) return nom;
  try {
    const { body } = await httpGet(
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en`,
    );
    const data = JSON.parse(body || "{}");
    const hit = (data.results || [])[0];
    if (!hit) return { ok: false, address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
    const address = [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
    return { ok: true, address, city: hit.name || "", lat, lon, source: "open-meteo" };
  } catch {
    return { ok: false, address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
  }
}

async function historicalStorms(lat, lon, days = 540) {
  try {
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
    const { body } = await httpGet(`https://archive-api.open-meteo.com/v1/archive?${params}`, 25000);
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
  } catch {
    return [];
  }
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

async function fetchHailReports(lat, lon, radiusKm = 80, daysBack = 45) {
  const today = new Date();
  const days = Math.min(Math.max(daysBack, 7), 180);
  const stamps = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    stamps.push({
      stamp: day.toISOString().slice(0, 10).replace(/-/g, "").slice(2),
      iso: day.toISOString().slice(0, 10),
    });
  }
  const hits = [];
  const batch = 12;
  for (let i = 0; i < stamps.length; i += batch) {
    const chunk = stamps.slice(i, i + batch);
    const parts = await Promise.all(
      chunk.map(async ({ stamp, iso }) => {
        try {
          const { body, status } = await httpGet(`https://www.spc.noaa.gov/climo/reports/${stamp}_rpts_filtered.csv`, 5500);
          if (status === 404) return [];
          return parseSpcHailCsv(body, iso);
        } catch {
          return [];
        }
      }),
    );
    for (const dayRows of parts) {
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
    }
  }
  return hits.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120);
}

let mapConfigCache = null;
let geoCenterCache = null;

const BASE_LAYERS = [
  { id: "osm", label: "Street", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OSM" },
  { id: "sat", label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri" },
];

export function resolveMapCenter(settings) {
  if (settings?.lat && settings?.lon) {
    return Promise.resolve({
      lat: parseFloat(settings.lat),
      lon: parseFloat(settings.lon),
      city: settings.city || "",
    });
  }
  if (geoCenterCache) return Promise.resolve(geoCenterCache);
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ lat: 39.7392, lon: -104.9903, city: settings?.city || "" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        geoCenterCache = { lat: p.coords.latitude, lon: p.coords.longitude, city: "" };
        settings.lat = String(geoCenterCache.lat);
        settings.lon = String(geoCenterCache.lon);
        resolve(geoCenterCache);
      },
      () => resolve({ lat: 39.7392, lon: -104.9903, city: settings?.city || "" }),
      { timeout: 7000, maximumAge: 600000, enableHighAccuracy: false },
    );
  });
}

async function currentWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,weather_code,wind_speed_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
  });
  try {
    const { body } = await httpGet(`https://api.open-meteo.com/v1/forecast?${params}`, 5000);
    const data = JSON.parse(body || "{}");
    const cur = data.current || {};
    const code = parseInt(cur.weather_code || 0, 10);
    return {
      ok: true,
      temp_f: cur.temperature_2m,
      wind_mph: cur.wind_speed_10m,
      label: WMO[code] || "Weather",
    };
  } catch {
    return { ok: false };
  }
}

export function renderWeatherBoot(root, geo, wx, hail, esc) {
  const addr = (geo && (geo.address || geo.city)) || "Your area";
  const line = wx && wx.ok
    ? `${Math.round(wx.temp_f)}°F · ${esc(wx.label || "Weather")}${wx.wind_mph ? ` · wind ${Math.round(wx.wind_mph)} mph` : ""}`
    : "";
  const hailRows = (hail || []).slice(0, 4);
  root.innerHTML = `
    <div class="wx-boot">
      <div class="wx-addr">${esc(addr)}</div>
      ${line ? `<div class="wx-now">${line}</div>` : ""}
      ${hailRows.length
        ? `<div class="wx-hail">${hailRows.map((h) => `<div class="wx-hail-row"><span class="date">${esc(h.date)}</span><span class="size">${esc(h.size_in)} in</span> ${esc(h.location || "")}</div>`).join("")}</div>`
        : `<p class="muted">Tap the map on a roof for storm dossier.</p>`}
    </div>`;
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

function normalizeDossier(raw) {
  if (!raw || raw.ok === false) return null;
  const d = raw.dossier && typeof raw.dossier === "object" ? { ...raw.dossier, ...raw } : { ...raw };
  if (!d.address && !d.storms && !d.hail && !d.zillow_url) return null;
  if (!d.zillow_url && d.address) d.zillow_url = zillowUrl(d.address);
  d.storms = d.storms || d.recent_storms || [];
  d.hail = d.hail || [];
  d.news = d.news || [];
  return d;
}

function usableRemote(d) {
  const n = normalizeDossier(d);
  return n && (n.address || n.storms?.length || n.hail?.length || n.zillow_url);
}

async function localMapConfig(settings, center) {
  const c = center || (await resolveMapCenter(settings));
  const layerList = [...BASE_LAYERS];
  httpGet("https://api.rainviewer.com/public/weather-maps.json", 1800)
    .then(({ body }) => {
      const rv = JSON.parse(body || "{}");
      const ts = ((rv.radar || {}).past || []).slice(-1)[0]?.time;
      if (!ts || !map) return;
      const url = `https://tilecache.rainviewer.com/v2/radar/${ts}/256/{z}/{x}/{y}/6/1_1.png`;
      layers.radar = window.L.tileLayer(url, { attribution: "© RainViewer", opacity: 0.55, maxZoom: 19 });
    })
    .catch(() => {});
  return { center: { lat: c.lat, lon: c.lon, city: c.city || settings?.city || "" }, layers: layerList };
}

async function localResearch(lat, lon, address = "", { deep = true } = {}) {
  const geoP = address ? Promise.resolve({ ok: true, address, city: address.split(",")[0] }) : reverseGeocode(lat, lon);
  const [geo, wxNow, storms, hail] = await Promise.all([
    geoP,
    currentWeather(lat, lon).catch(() => ({ ok: false })),
    historicalStorms(lat, lon, deep ? 540 : 180),
    fetchHailReports(lat, lon, 80, deep ? 90 : 45),
  ]);
  const addr = address || geo.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const city = geo.city || addr.split(",")[0];
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
  if (deep) {
    for (const q of [`hail damage "${city}"`, `hail storm "${city}"`, `severe weather "${addr}"`, `wind damage "${city}"`]) {
      for (const hit of await searchNews(q, 4)) {
        if (!news.some((n) => n.url === hit.url)) news.push(hit);
      }
    }
  }
  return {
    ok: true,
    address: addr,
    lat,
    lon,
    weather: wxNow,
    storms,
    hail,
    news,
    zillow_url: zillowUrl(addr),
    owner_name: "",
    owner_phone: "",
    owner_email: "",
  };
}

export async function loadMapConfig(settings) {
  if (mapConfigCache) return mapConfigCache;
  const center = await resolveMapCenter(settings);
  const remote = await api("/api/storm/map", { settings, timeout: 8000 }).catch(() => null);
  mapConfigCache = remote ? { ...remote, center: { ...remote.center, ...center } } : await localMapConfig(settings, center);
  return mapConfigCache;
}

export async function researchPin(settings, lat, lon, address = "", deep = true) {
  try {
    const remote = await api("/api/storm/research", {
      settings,
      method: "POST",
      body: { lat, lon, address, deep },
      timeout: deep ? 180000 : 60000,
    });
    if (usableRemote(remote)) return normalizeDossier(remote);
  } catch {
    /* local fallback */
  }
  return localResearch(lat, lon, address, { deep });
}

export async function pinDossier(settings, lat, lon, { onPartial } = {}) {
  const geo = await reverseGeocode(lat, lon);
  const addr = geo.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const partial = {
    ok: true,
    address: addr,
    lat,
    lon,
    zillow_url: zillowUrl(addr),
    storms: [],
    hail: [],
    news: [],
    owner_name: "",
    owner_phone: "",
    owner_email: "",
  };
  if (onPartial) onPartial(partial);
  const full = await researchPin(settings, lat, lon, addr, true);
  return normalizeDossier(full) || partial;
}

export async function quickPin(settings, lat, lon) {
  const remote = await api("/api/storm/pin", {
    settings,
    method: "POST",
    body: { lat, lon },
    timeout: 20000,
  }).catch(() => null);
  if (remote) return remote;
  const [geo, wx, hail] = await Promise.all([
    reverseGeocode(lat, lon),
    currentWeather(lat, lon),
    fetchHailReports(lat, lon, 80, 21),
  ]);
  return { ok: true, geo, weather: wx, hail, recent_storms: hail.slice(0, 5) };
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

export function mountMap(container, config, { onTap, center }) {
  if (!window.L) throw new Error("Leaflet not loaded");
  if (map) {
    map.remove();
    map = null;
    pin = null;
    hailLayer = null;
    layers = {};
  }
  const c = center || config.center || { lat: 39.74, lon: -104.99 };
  map = window.L.map(container, { zoomControl: true, preferCanvas: true }).setView([c.lat, c.lon], 10);
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
  const zurl = data.zillow_url || (addr ? zillowUrl(addr) : "");
  const wxLine =
    data.weather && data.weather.ok
      ? `${Math.round(data.weather.temp_f)}°F · ${esc(data.weather.label || "Weather")}`
      : "";
  root.innerHTML = `
    <div class="wx-dossier">
      <div class="wx-addr">${esc(addr)}</div>
      ${wxLine ? `<div class="wx-now">${wxLine}</div>` : ""}
      <div class="wx-links">
        ${zurl ? `<a href="${esc(zurl)}" target="_blank" rel="noopener">ZILLOW SEARCH</a>` : ""}
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
