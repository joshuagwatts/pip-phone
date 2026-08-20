/** WX map + storm dossier — runs on phone standalone (public APIs) or via paired desktop. */
import { httpGet, httpLanGet, httpLanPostJson } from "./net.js";
import { desktopConfigured } from "./desktop.js";
import { locateDevice } from "./geo.js";

let map = null;
let pin = null;
let hailLayer = null;
let layers = {};
let activeLayer = "dark";

const WMO = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  75: "Heavy snow",
  82: "Violent rain",
  95: "Thunderstorm",
  96: "Thunder + hail",
  99: "Severe thunder + hail",
};

export const DEFAULT_FILTERS = { km: 25, hailIn: 0, windMph: 38, days: 180 };
let wxFilters = { ...DEFAULT_FILTERS };
let overlays = {};
let activeOverlays = new Set(["radar"]);
let windLayer = null;

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
      if (score >= 3) {
        out.push({
          date: times[i],
          score,
          label: WMO[code] || "Weather",
          reasons,
          wind_mph: Math.round(Math.max(wind, gust) * 10) / 10,
          precip_mm: Math.round(precip * 10) / 10,
          source: "open-meteo-archive",
        });
      }
    }
    return out.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 80);
  } catch {
    return [];
  }
}

function parseSpcSection(text, reportDay, header, kind, measureKey) {
  const rows = [];
  let inSec = false;
  for (const line of text.split("\n")) {
    if (line.startsWith(header)) {
      inSec = true;
      continue;
    }
    if (line.startsWith("Time,")) {
      inSec = false;
      continue;
    }
    if (!inSec || !line.trim()) continue;
    const parts = line.split(",", 8);
    if (parts.length < 7) continue;
    const rlat = parseFloat(parts[5]);
    const rlon = parseFloat(parts[6]);
    if (Number.isNaN(rlat) || Number.isNaN(rlon)) continue;
    const row = {
      kind,
      date: reportDay,
      time: parts[0].trim(),
      location: parts[2].trim(),
      county: parts[3].trim(),
      state: parts[4].trim(),
      lat: rlat,
      lon: rlon,
      comments: (parts[7] || "").trim(),
      source: "noaa-spc",
    };
    if (kind === "hail") {
      row.size_in = hailSizeIn(parts[1]);
    } else {
      const n = parseFloat(parts[1]);
      row[measureKey] = Number.isNaN(n) ? 0 : n;
    }
    rows.push(row);
  }
  return rows;
}

function parseSpcHailCsv(text, reportDay) {
  return parseSpcSection(text, reportDay, "Time,Size,", "hail", "size_in");
}

function bboxForKm(lat, lon, radiusKm) {
  const pad = Math.max(radiusKm * 1.15, 5);
  const dLat = pad / 111;
  const dLon = pad / (111 * Math.max(0.25, Math.cos((lat * Math.PI) / 180)));
  return `${(lon - dLon).toFixed(4)},${(lat - dLat).toFixed(4)},${(lon + dLon).toFixed(4)},${(lat + dLat).toFixed(4)}`;
}

function parseSwdiShape(shape) {
  const m = String(shape || "").match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);
  if (!m) return null;
  const lon = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  return Number.isNaN(lon) || Number.isNaN(lat) ? null : { lon, lat };
}

async function fetchSwdiHail(lat, lon, radiusKm = 25, daysBack = 90) {
  const today = new Date();
  const days = Math.min(Math.max(daysBack, 7), 180);
  const km = Math.min(Math.max(radiusKm, 3), 50);
  const bbox = bboxForKm(lat, lon, km);
  const startLimit = new Date(today);
  startLimit.setDate(startLimit.getDate() - days);
  const chunks = [];
  let cursor = new Date(today);
  while (cursor > startLimit && chunks.length < 10) {
    const chunkEnd = new Date(cursor);
    const chunkStart = new Date(cursor);
    chunkStart.setDate(chunkStart.getDate() - 13);
    if (chunkStart < startLimit) chunkStart.setTime(startLimit.getTime());
    chunks.push({ start: chunkStart, end: chunkEnd });
    cursor = new Date(chunkStart);
    cursor.setDate(cursor.getDate() - 1);
  }
  const hits = new Map();
  const batch = 4;
  for (let i = 0; i < chunks.length; i += batch) {
    const part = await Promise.all(
      chunks.slice(i, i + batch).map(async ({ start, end }) => {
        const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
        const url = `https://www.ncdc.noaa.gov/swdiws/json/nx3hail/${fmt(start)}:${fmt(end)}?bbox=${bbox}`;
        try {
          const { body } = await httpGet(url, 22000);
          const data = JSON.parse(body || "{}");
          return data.result || [];
        } catch {
          return [];
        }
      }),
    );
    for (const rows of part) {
      for (const item of rows) {
        const pt = parseSwdiShape(item.SHAPE);
        if (!pt) continue;
        const dist = haversineKm(lat, lon, pt.lat, pt.lon);
        if (dist > km) continue;
        const ztime = String(item.ZTIME || "");
        const day = ztime.slice(0, 10) || "";
        if (!day) continue;
        const sz = parseFloat(item.MAXSIZE);
        const row = {
          kind: "hail",
          date: day,
          time: ztime.slice(11, 19),
          lat: pt.lat,
          lon: pt.lon,
          size_in: Number.isNaN(sz) ? "UNK" : sz.toFixed(2),
          location: "Radar signature",
          county: "",
          state: "",
          comments: `NEXRAD ${item.WSR_ID || ""}`.trim(),
          source: "noaa-swdi-radar",
          distance_km: Math.round(dist * 10) / 10,
          score: !Number.isNaN(sz) && sz >= 1 ? 5 : 3,
        };
        const key = `${row.date}|${row.lat.toFixed(2)}|${row.lon.toFixed(2)}`;
        const prev = hits.get(key);
        if (!prev || parseFloat(row.size_in) > parseFloat(prev.size_in)) hits.set(key, row);
      }
    }
  }
  return [...hits.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120);
}

function mergeHailRows(...groups) {
  const merged = groups.flat();
  merged.sort((a, b) => {
    const ds = b.date.localeCompare(a.date);
    if (ds) return ds;
    return parseFloat(b.size_in) - parseFloat(a.size_in);
  });
  return merged.slice(0, 120);
}

function enrichStormDates(storms, hail, wind) {
  const byDate = new Map();
  for (const s of storms || []) {
    if (s.date) byDate.set(s.date, { ...s, reasons: [...(s.reasons || [])] });
  }
  for (const h of hail || []) {
    if (!h.date) continue;
    const tag = h.source === "noaa-swdi-radar" ? `radar hail ${h.size_in} in` : `hail ${h.size_in} in`;
    const cur = byDate.get(h.date);
    if (cur) {
      if (!cur.reasons.includes(tag)) cur.reasons.push(tag);
      cur.score = Math.max(cur.score || 0, h.score || 4);
    } else {
      byDate.set(h.date, {
        date: h.date,
        score: h.score || 4,
        label: h.source === "noaa-swdi-radar" ? "Radar hail" : "Hail",
        reasons: [tag],
        wind_mph: 0,
        source: h.source || "hail",
      });
    }
  }
  for (const w of wind || []) {
    if (!w.date) continue;
    const mph = Number(w.wind_mph) || 0;
    const tag = `wind ${mph.toFixed(0)} mph`;
    const cur = byDate.get(w.date);
    if (cur) {
      if (!cur.reasons.includes(tag)) cur.reasons.push(tag);
      cur.score = Math.max(cur.score || 0, mph >= 58 ? 4 : 3);
      cur.wind_mph = Math.max(cur.wind_mph || 0, mph);
    } else {
      byDate.set(w.date, {
        date: w.date,
        score: mph >= 58 ? 4 : 3,
        label: "Wind",
        reasons: [tag],
        wind_mph: mph,
        source: w.source || "noaa-spc",
      });
    }
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
}

async function fetchSpcReports(lat, lon, radiusKm = 25, daysBack = 21) {
  const today = new Date();
  const days = Math.min(Math.max(daysBack, 7), 45);
  const km = Math.min(Math.max(radiusKm, 3), 50);
  const stamps = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    stamps.push({
      stamp: day.toISOString().slice(0, 10).replace(/-/g, "").slice(2),
      iso: day.toISOString().slice(0, 10),
    });
  }
  const hailHits = [];
  const windHits = [];
  const batch = 12;
  for (let i = 0; i < stamps.length; i += batch) {
    const chunk = stamps.slice(i, i + batch);
    const parts = await Promise.all(
      chunk.map(async ({ stamp, iso }) => {
        try {
          const { body, status } = await httpGet(`https://www.spc.noaa.gov/climo/reports/${stamp}_rpts_filtered.csv`, 5500);
          if (status === 404) return { hail: [], wind: [] };
          return {
            hail: parseSpcHailCsv(body, iso),
            wind: parseSpcSection(body, iso, "Time,Speed,", "wind", "wind_mph"),
          };
        } catch {
          return { hail: [], wind: [] };
        }
      }),
    );
    for (const dayRows of parts) {
      for (const row of dayRows.hail) {
        const dist = haversineKm(lat, lon, row.lat, row.lon);
        if (dist <= km) {
          const sz = parseFloat(row.size_in);
          hailHits.push({ ...row, distance_km: Math.round(dist * 10) / 10, score: !Number.isNaN(sz) && sz >= 1 ? 5 : 3 });
        }
      }
      for (const row of dayRows.wind) {
        const dist = haversineKm(lat, lon, row.lat, row.lon);
        if (dist <= km) {
          windHits.push({ ...row, distance_km: Math.round(dist * 10) / 10, score: (row.wind_mph || 0) >= 58 ? 4 : 2 });
        }
      }
    }
  }
  hailHits.sort((a, b) => b.date.localeCompare(a.date));
  windHits.sort((a, b) => b.date.localeCompare(a.date));
  return { hail: hailHits.slice(0, 80), wind: windHits.slice(0, 80) };
}

async function fetchHailReports(lat, lon, radiusKm = 25, daysBack = 60) {
  const spc = await fetchSpcReports(lat, lon, radiusKm, daysBack);
  const swdi = await fetchSwdiHail(lat, lon, radiusKm, daysBack);
  return mergeHailRows(spc.hail, swdi);
}

let mapConfigCache = null;

const BASE_LAYERS = [
  { id: "osm", label: "Street", kind: "base", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OSM" },
  { id: "dark", label: "Night", kind: "base", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: "© CARTO" },
  { id: "sat", label: "Sat", kind: "base", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri" },
];

export async function resolveMapCenter(settings) {
  return locateDevice(settings, httpGet);
}

async function currentWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m",
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
      gust_mph: cur.wind_gusts_10m,
      code,
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
  d.wind = d.wind || [];
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
  try {
    const { body } = await httpGet("https://api.rainviewer.com/public/weather-maps.json", 2500);
    const rv = JSON.parse(body || "{}");
    const past = ((rv.radar || {}).past || []).slice(-1)[0];
    const ir = ((rv.satellite || {}).infrared || []).slice(-1)[0];
    const vis = ((rv.satellite || {}).visible || []).slice(-1)[0];
    if (past?.path) {
      layerList.push({
        id: "radar",
        label: "Radar",
        kind: "overlay",
        url: `https://tilecache.rainviewer.com${past.path}/256/{z}/{x}/{y}/6/1_1.png`,
        attribution: "© RainViewer",
        opacity: 0.65,
      });
    }
    if (ir?.path) {
      layerList.push({
        id: "clouds",
        label: "Clouds",
        kind: "overlay",
        url: `https://tilecache.rainviewer.com${ir.path}/256/{z}/{x}/{y}/0/0_0.png`,
        attribution: "© RainViewer",
        opacity: 0.55,
      });
    }
    if (vis?.path) {
      layerList.push({
        id: "vis",
        label: "Vis",
        kind: "overlay",
        url: `https://tilecache.rainviewer.com${vis.path}/256/{z}/{x}/{y}/0/0_0.png`,
        attribution: "© RainViewer",
        opacity: 0.45,
      });
    }
  } catch {
    /* overlays optional */
  }
  return { center: { lat: c.lat, lon: c.lon, city: c.city || settings?.city || "" }, layers: layerList };
}

async function localResearch(lat, lon, address = "", { deep = true, filters = wxFilters } = {}) {
  const geoP = address ? Promise.resolve({ ok: true, address, city: address.split(",")[0] }) : reverseGeocode(lat, lon);
  const days = deep ? Math.min(Number(filters.days) || 90, 90) : 45;
  const km = Number(filters.km) || 25;
  const spcDays = Math.min(days, 21);
  const [geo, wxNow, archiveStorms, spc, swdi] = await Promise.all([
    geoP,
    currentWeather(lat, lon).catch(() => ({ ok: false })),
    historicalStorms(lat, lon, days),
    fetchSpcReports(lat, lon, km, spcDays),
    fetchSwdiHail(lat, lon, km, days),
  ]);
  const addr = address || geo.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const city = geo.city || addr.split(",")[0];
  const hail = mergeHailRows(spc.hail || [], swdi || []);
  const wind = spc.wind || [];
  const storms = enrichStormDates(archiveStorms, hail, wind);
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
    wind,
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
  const [geo, wx] = await Promise.all([
    reverseGeocode(lat, lon),
    currentWeather(lat, lon),
  ]);
  return { ok: true, geo, weather: wx, hail: [], recent_storms: [] };
}

export function drawHailMarkers(hailRows, windRows) {
  if (!map || !window.L) return;
  if (hailLayer) hailLayer.remove();
  if (windLayer) windLayer.remove();
  hailLayer = window.L.layerGroup();
  windLayer = window.L.layerGroup();
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
      .bindPopup(`${h.date} · ${h.size_in} in hail${h.source === "noaa-swdi-radar" ? " (radar)" : ""}<br>${h.location}${h.state ? `, ${h.state}` : ""}<br>${h.distance_km} km from pin`)
      .addTo(hailLayer);
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
      .addTo(windLayer);
  }
  hailLayer.addTo(map);
  windLayer.addTo(map);
}

function applyOverlays() {
  if (!map) return;
  Object.keys(overlays).forEach((id) => {
    if (activeOverlays.has(id)) overlays[id].addTo(map);
    else map.removeLayer(overlays[id]);
  });
}

export function mountMap(container, config, { onTap, center }) {
  if (!window.L) throw new Error("Leaflet not loaded");
  if (map) {
    map.remove();
    map = null;
    pin = null;
    hailLayer = null;
    windLayer = null;
    layers = {};
    overlays = {};
  }
  const c = center || config.center || { lat: 0, lon: 0 };
  const zoom = Math.abs(c.lat) < 1 && Math.abs(c.lon) < 1 ? 3 : 12;
  map = window.L.map(container, { zoomControl: true, preferCanvas: true }).setView([c.lat, c.lon], zoom);
  const all = config.layers || [];
  for (const layer of all) {
    const tile = window.L.tileLayer(layer.url, {
      attribution: layer.attribution || "",
      opacity: layer.opacity ?? 1,
      maxZoom: 19,
    });
    if (layer.kind === "overlay") overlays[layer.id] = tile;
    else layers[layer.id] = tile;
  }
  (layers.dark || layers[activeLayer] || layers.osm || Object.values(layers)[0])?.addTo(map);
  if (layers.dark) activeLayer = "dark";
  applyOverlays();
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    if (pin) pin.setLatLng(e.latlng);
    else pin = window.L.marker(e.latlng).addTo(map);
    if (onTap) onTap(lat, lng);
  });
  return map;
}

export function setMapLayer(id) {
  if (!map) return;
  if (overlays[id]) {
    if (activeOverlays.has(id)) activeOverlays.delete(id);
    else activeOverlays.add(id);
    applyOverlays();
    return;
  }
  if (!layers[id]) return;
  Object.values(layers).forEach((l) => map.removeLayer(l));
  layers[id].addTo(map);
  applyOverlays();
  activeLayer = id;
}

function cutoffDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - Number(days || 180));
  return d.toISOString().slice(0, 10);
}

export function filterDossier(data, filters = wxFilters) {
  const since = cutoffDate(filters.days);
  const km = Number(filters.km) || 25;
  const hailMin = Number(filters.hailIn) || 0;
  const windMin = Number(filters.windMph) || 0;
  const hail = (data.hail || []).filter((h) => {
    if (h.date && h.date < since) return false;
    if (h.distance_km != null && h.distance_km > km) return false;
    const sz = parseFloat(h.size_in);
    return Number.isNaN(sz) || sz >= hailMin;
  });
  const wind = (data.wind || []).filter((w) => {
    if (w.date && w.date < since) return false;
    if (w.distance_km != null && w.distance_km > km) return false;
    return (Number(w.wind_mph) || 0) >= windMin;
  });
  const archiveStorms = (data.storms || []).filter(
    (s) =>
      (s.source || "").includes("open-meteo") ||
      (s.reasons || []).some((r) => /precip|thunder|storm|Weather/i.test(r)),
  );
  let storms = enrichStormDates(archiveStorms, hail, wind);
  storms = storms.filter((s) => {
    if (s.date && s.date < since) return false;
    if ((Number(s.wind_mph) || 0) < windMin && !(s.reasons || []).some((r) => /hail|thunder/i.test(r))) {
      return (Number(s.wind_mph) || 0) >= windMin || (Number(s.precip_mm) || 0) >= 25;
    }
    return true;
  });
  return { hail, wind, storms };
}

export function renderDossier(root, data, esc, onResearch) {
  const news = data.news || [];
  const addr = data.address || "";
  const zurl = data.zillow_url || (addr ? zillowUrl(addr) : "");
  const { hail, wind, storms } = filterDossier(data, wxFilters);
  const wxLine =
    data.weather && data.weather.ok
      ? `${Math.round(data.weather.temp_f)}°F · ${esc(data.weather.label || "Weather")}${data.weather.wind_mph ? ` · ${Math.round(data.weather.wind_mph)} mph` : ""}`
      : "";
  const alert = data.weather && data.weather.severity && data.weather.severity.line
    ? `<div class="wx-alert ${esc(data.weather.severity.level || "")}">${esc(data.weather.severity.line)}</div>`
    : "";
  root.innerHTML = `
    <div class="wx-dossier">
      <div class="wx-addr">${esc(addr)}</div>
      ${wxLine ? `<div class="wx-now">${wxLine}</div>` : ""}
      ${alert}
      <div class="wx-links">
        ${zurl ? `<a href="${esc(zurl)}" target="_blank" rel="noopener">ZILLOW SEARCH</a>` : ""}
        ${onResearch ? `<button type="button" id="wx-deep" class="primary">DEEP RESEARCH</button>` : ""}
      </div>
      <div class="wx-filters">
        <label>NEAR <select id="wx-f-km">
          <option value="8"${wxFilters.km == 8 ? " selected" : ""}>8 km</option>
          <option value="15"${wxFilters.km == 15 ? " selected" : ""}>15 km</option>
          <option value="25"${wxFilters.km == 25 ? " selected" : ""}>25 km</option>
          <option value="40"${wxFilters.km == 40 ? " selected" : ""}>40 km</option>
          <option value="50"${wxFilters.km == 50 ? " selected" : ""}>50 km</option>
        </select></label>
        <label>HAIL ≥ <select id="wx-f-hail">
          <option value="0"${wxFilters.hailIn == 0 ? " selected" : ""}>any</option>
          <option value="0.75"${wxFilters.hailIn == 0.75 ? " selected" : ""}>0.75"</option>
          <option value="1"${wxFilters.hailIn == 1 ? " selected" : ""}>1"</option>
          <option value="2"${wxFilters.hailIn == 2 ? " selected" : ""}>2"</option>
        </select></label>
        <label>WIND ≥ <select id="wx-f-wind">
          <option value="0"${wxFilters.windMph == 0 ? " selected" : ""}>any</option>
          <option value="38"${wxFilters.windMph == 38 ? " selected" : ""}>38 mph</option>
          <option value="50"${wxFilters.windMph == 50 ? " selected" : ""}>50 mph</option>
          <option value="58"${wxFilters.windMph == 58 ? " selected" : ""}>58 mph</option>
        </select></label>
        <label>DATES <select id="wx-f-days">
          <option value="30"${wxFilters.days == 30 ? " selected" : ""}>30d</option>
          <option value="90"${wxFilters.days == 90 ? " selected" : ""}>90d</option>
          <option value="180"${wxFilters.days == 180 ? " selected" : ""}>180d</option>
          <option value="365"${wxFilters.days == 365 ? " selected" : ""}>1y</option>
        </select></label>
      </div>
      <div class="wx-contacts">
        ${data.owner_name ? `<div>Owner: ${esc(data.owner_name)}</div>` : ""}
        ${data.owner_phone ? `<div>Phone: ${esc(data.owner_phone)}</div>` : ""}
        ${data.owner_email ? `<div>Email: ${esc(data.owner_email)}</div>` : ""}
      </div>
      <h4>HAIL NEAR PIN</h4>
      <div class="wx-hail">${hail.length ? hail.slice(0, 16).map((h) => `
        <div class="wx-hail-row"><span class="date">${esc(h.date)}</span>
        <span class="size">${esc(h.size_in)} in</span>
        <span class="dist">${esc(String(h.distance_km))} km</span>
        ${esc(h.location || (h.source === "noaa-swdi-radar" ? "Radar" : ""))}${h.state ? `, ${esc(h.state)}` : ""}</div>`).join("") : `<p class="muted">No hail this close after filters. Widen NEAR or drop HAIL ≥.</p>`}</div>
      <h4>WIND NEAR PIN</h4>
      <div class="wx-wind">${wind.length ? wind.slice(0, 12).map((w) => `
        <div class="wx-hail-row"><span class="date">${esc(w.date)}</span>
        <span class="size">${esc(String(w.wind_mph))} mph</span>
        <span class="dist">${esc(String(w.distance_km))} km</span>
        ${esc(w.location)}, ${esc(w.state)}</div>`).join("") : `<p class="muted">No wind reports this close after filters.</p>`}</div>
      <h4>STORM DATES (THIS PIN)</h4>
      <div class="wx-storms">${storms.length ? storms.slice(0, 16).map((s) => `
        <div class="wx-storm"><span class="date">${esc(s.date)}</span> <span class="score">${esc(String(s.wind_mph || s.score))}${s.wind_mph ? " mph" : ""}</span> ${esc((s.reasons || []).join(" · ") || s.label)}</div>`).join("") : `<p class="muted">No storm days at this pin after filters.</p>`}</div>
      <h4>NEWS</h4>
      <div class="wx-news">${news.length ? news.slice(0, 8).map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>`).join("") : `<p class="muted">News pulls on deep research.</p>`}</div>
    </div>`;
  const btn = root.querySelector("#wx-deep");
  if (btn && onResearch) btn.onclick = onResearch;
  const bind = (id, key, cast) => {
    const el = root.querySelector(id);
    if (!el) return;
    el.onchange = () => {
      wxFilters[key] = cast(el.value);
      renderDossier(root, data, esc, onResearch);
      const f = filterDossier(data, wxFilters);
      drawHailMarkers(f.hail, f.wind);
    };
  };
  bind("#wx-f-km", "km", Number);
  bind("#wx-f-hail", "hailIn", Number);
  bind("#wx-f-wind", "windMph", Number);
  bind("#wx-f-days", "days", Number);
}

export function layerButtons(config, esc) {
  const bases = (config.layers || []).filter((l) => l.kind !== "overlay");
  const over = (config.layers || []).filter((l) => l.kind === "overlay");
  const baseBtns = (bases.length ? bases : config.layers || [])
    .map((l) => `<button type="button" data-layer="${esc(l.id)}" class="${l.id === activeLayer || (!bases.length && l.id === activeLayer) ? "on" : ""}">${esc(l.label)}</button>`)
    .join("");
  const overBtns = over
    .map((l) => `<button type="button" data-layer="${esc(l.id)}" class="overlay ${activeOverlays.has(l.id) ? "on" : ""}">${esc(l.label)}</button>`)
    .join("");
  return overBtns ? `${baseBtns}<span class="wx-split"></span>${overBtns}` : baseBtns;
}

export async function fetchLiveWeather(lat, lon) {
  const wx = await currentWeather(lat, lon);
  let alerts = [];
  try {
    const { body } = await httpGet(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, 6000, {
      "User-Agent": "PipWeather/1.0 (joshuagwatts)",
      Accept: "application/geo+json",
    });
    const data = JSON.parse(body || "{}");
    alerts = (data.features || []).slice(0, 8).map((f) => {
      const p = f.properties || {};
      return { id: p.id || f.id || p.event, event: p.event || "", severity: p.severity || "", headline: String(p.headline || p.event || "").slice(0, 220) };
    });
  } catch {
    alerts = [];
  }
  const code = wx.code || 0;
  const gust = wx.gust_mph || wx.wind_mph || 0;
  const warning = alerts.some((a) => /warning/i.test(a.event) || /extreme|severe/i.test(a.severity));
  const crummy = warning || [82, 95, 96, 99, 65].includes(code) || gust >= 50;
  let level = "ok";
  let line = "";
  if (warning || code === 96 || code === 99) {
    level = "severe";
    line = "Weather is getting seriously crummy. Stay in or get cover.";
  } else if (alerts.some((a) => /watch/i.test(a.event)) || code === 95 || gust >= 45) {
    level = "watch";
    line = "Storms nearby. Keep an eye on it.";
  } else if (crummy) {
    level = "rough";
    line = "It's turning ugly out. Plan around it.";
  }
  return { ...wx, alerts, severity: { level, crummy, line, warning } };
}

export function startWeatherWatch(getCenter, onAlert, everyMs = 8 * 60 * 1000) {
  let lastId = "";
  const tick = async () => {
    try {
      const c = await getCenter();
      if (!c?.lat) return;
      const live = await fetchLiveWeather(c.lat, c.lon);
      if (!live.severity?.crummy) return;
      const id = (live.alerts[0] && live.alerts[0].id) || `${live.severity.level}:${live.label}`;
      if (id === lastId) return;
      lastId = id;
      onAlert(live);
    } catch {
      /* keep watching */
    }
  };
  tick();
  return setInterval(tick, everyMs);
}
