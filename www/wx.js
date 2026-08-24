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

export const DEFAULT_FILTERS = { km: 25, hailIn: 0, windMph: 38, days: 180, year: "all", sort: "date" };
let wxFilters = { ...DEFAULT_FILTERS };
let overlays = {};
/** Exclusive weather product on the map: precip | cloud | vis | wind | hail */
let activeWxProduct = "precip";
let activeOverlays = new Set(["precip"]);
let windLayer = null;
let windFieldLayer = null;
let lastHailRows = [];
let lastWindRows = [];
/** ISO date (YYYY-MM-DD) selected on storm graph — map heat shows that day only. */
let selectedStormDate = null;
let radarFrames = [];
let radarFrameIdx = 0;
let radarPlayTimer = null;
let hourPlayTimer = null;
let radarHost = "https://tilecache.rainviewer.com";
let radarColor = "2/1_1";
const WX_PRODUCTS = ["precip", "cloud", "vis", "wind", "hail"];

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
  const maxChunks = days > 120 ? 14 : 10;
  while (cursor > startLimit && chunks.length < maxChunks) {
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
          time: ztime.slice(11, 16) || "",
          lat: pt.lat,
          lon: pt.lon,
          size_in: Number.isNaN(sz) ? "UNK" : sz.toFixed(2),
          location: item.WSR_ID || "Radar hail",
          county: "",
          state: "",
          comments: `PROB ${item.PROB || "?"}`,
          source: "noaa-swdi-radar",
          distance_km: Math.round(dist * 10) / 10,
          score: !Number.isNaN(sz) && sz >= 1 ? 5 : 3,
        };
        const key = `${day}|${pt.lat.toFixed(3)}|${pt.lon.toFixed(3)}|${row.size_in}`;
        const prev = hits.get(key);
        if (!prev || (parseFloat(row.size_in) || 0) > (parseFloat(prev.size_in) || 0)) hits.set(key, row);
      }
    }
  }
  return [...hits.values()];
}

/** Live Local Storm Reports (IEM) — CORS-friendly spotter hail near pin. */
async function fetchIemLsrHail(lat, lon, radiusKm = 40, hours = 72) {
  const km = Math.min(Math.max(radiusKm, 5), 80);
  const hrs = Math.min(Math.max(hours, 6), 168);
  const urls = [
    `https://mesonet.agron.iastate.edu/geojson/lsr.py?hours=${hrs}&lat0=${lat}&lon0=${lon}`,
    `https://mesonet.agron.iastate.edu/geojson/lsr.py?hours=${hrs}`,
  ];
  let features = [];
  for (const url of urls) {
    try {
      const { body } = await httpGet(url, 12000);
      const data = JSON.parse(body || "{}");
      features = data.features || [];
      if (features.length) break;
    } catch {
      /* try next */
    }
  }
  const out = [];
  for (const f of features) {
    const p = f.properties || {};
    const typ = String(p.type || p.typetext || "").toUpperCase();
    if (!(typ === "H" || /HAIL/.test(typ) || /HAIL/.test(String(p.typetext || "")))) continue;
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const rlon = Number(coords[0]);
    const rlat = Number(coords[1]);
    if (!Number.isFinite(rlat) || !Number.isFinite(rlon)) continue;
    const dist = haversineKm(lat, lon, rlat, rlon);
    if (dist > km) continue;
    const mag = Number(p.magf != null ? p.magf : p.magnitude) || 0;
    const valid = String(p.valid || p.utcvalid || "");
    const day = valid.slice(0, 10) || new Date().toISOString().slice(0, 10);
    out.push({
      kind: "hail",
      date: day,
      time: valid.slice(11, 16) || "",
      lat: rlat,
      lon: rlon,
      size_in: mag > 0 ? mag.toFixed(2) : "UNK",
      location: p.city || p.county || "LSR hail",
      county: p.county || "",
      state: p.state || "",
      comments: String(p.remark || p.source || "IEM LSR").slice(0, 120),
      source: "iem-lsr",
      distance_km: Math.round(dist * 10) / 10,
      score: mag >= 1 ? 5 : 3,
    });
  }
  return out;
}

function hailZoneColor(sizeIn) {
  const sz = parseFloat(sizeIn);
  if (Number.isNaN(sz)) return { stroke: "#7dff5a", fill: "#7dff5a", core: "#b8ff9a" };
  if (sz >= 2.5) return { stroke: "#f8bbd0", fill: "#ce93d8", core: "#ffffff" };
  if (sz >= 2) return { stroke: "#e040fb", fill: "#ab47bc", core: "#f8bbd0" };
  if (sz >= 1.5) return { stroke: "#ff1744", fill: "#e53935", core: "#ff8a80" };
  if (sz >= 1) return { stroke: "#ff6d00", fill: "#ef6c00", core: "#ffab40" };
  if (sz >= 0.75) return { stroke: "#ffb300", fill: "#f9a825", core: "#ffe082" };
  return { stroke: "#c0ca33", fill: "#d4e157", core: "#f0f4c3" };
}

function mergeHailRows(...groups) {
  const merged = groups.flat();
  merged.sort((a, b) => {
    const ds = b.date.localeCompare(a.date);
    if (ds) return ds;
    return parseFloat(b.size_in) - parseFloat(a.size_in);
  });
  return merged.slice(0, 200);
}

/**
 * HailTrace-style: one extremeness tag per calendar day near the pin.
 * Keeps the max size that day; folds radar/spotter hits into one zone.
 */
export function collapseHailByDate(rows) {
  const byDate = new Map();
  for (const h of rows || []) {
    const day = String(h.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const sz = parseFloat(h.size_in);
    const size = Number.isNaN(sz) ? 0 : sz;
    const dist = Number(h.distance_km);
    const distN = Number.isFinite(dist) ? dist : 999;
    const prev = byDate.get(day);
    const pt = Number.isFinite(h.lat) && Number.isFinite(h.lon) ? { lat: h.lat, lon: h.lon } : null;
    if (!prev) {
      byDate.set(day, {
        ...h,
        date: day,
        size_in: Number.isNaN(sz) ? "UNK" : size.toFixed(2),
        hits: 1,
        zone_pts: pt ? [pt] : [],
        sources: new Set([h.source || "hail"]),
        max_size: size,
        min_dist: distN,
      });
      continue;
    }
    prev.hits += 1;
    if (pt) prev.zone_pts.push(pt);
    if (h.source) prev.sources.add(h.source);
    const better =
      size > prev.max_size ||
      (size === prev.max_size && distN < prev.min_dist) ||
      (Number.isNaN(parseFloat(prev.size_in)) && !Number.isNaN(sz));
    if (better) {
      prev.max_size = Math.max(prev.max_size, size);
      prev.min_dist = Math.min(prev.min_dist, distN);
      prev.size_in = Number.isNaN(sz) ? prev.size_in : size.toFixed(2);
      prev.lat = h.lat ?? prev.lat;
      prev.lon = h.lon ?? prev.lon;
      prev.time = h.time || prev.time;
      prev.location = h.location || prev.location;
      prev.state = h.state || prev.state;
      prev.distance_km = distN < 900 ? Math.round(distN * 10) / 10 : prev.distance_km;
      prev.score = Math.max(prev.score || 0, h.score || 0);
      prev.comments = h.comments || prev.comments;
    } else {
      prev.min_dist = Math.min(prev.min_dist, distN);
      if (distN < (Number(prev.distance_km) || 999)) prev.distance_km = Math.round(distN * 10) / 10;
    }
  }
  return [...byDate.values()].map((row) => {
    const srcs = [...(row.sources || [])];
    const hasRadar = srcs.some((s) => /radar|swdi/i.test(s));
    const hasSpot = srcs.some((s) => /spc|spot/i.test(s) || s === "hail");
    let source = "hail";
    if (hasRadar && hasSpot) source = "mixed";
    else if (hasRadar) source = "noaa-swdi-radar";
    else if (hasSpot) source = "noaa-spc";
    const pts = row.zone_pts || [];
    let zone_lat = row.lat;
    let zone_lon = row.lon;
    let zone_r_km = Math.max(1.2, Math.min(8, (parseFloat(row.size_in) || 0.5) * 2.2));
    if (pts.length) {
      zone_lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
      zone_lon = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
      let maxSpread = 0;
      for (const p of pts) maxSpread = Math.max(maxSpread, haversineKm(zone_lat, zone_lon, p.lat, p.lon));
      zone_r_km = Math.max(zone_r_km, maxSpread + 0.6);
    }
    return {
      kind: "hail",
      date: row.date,
      time: row.time || "",
      lat: zone_lat,
      lon: zone_lon,
      size_in: row.size_in,
      location: row.location || "Hail zone",
      county: row.county || "",
      state: row.state || "",
      comments: row.comments || `${row.hits} signature${row.hits === 1 ? "" : "s"}`,
      source,
      distance_km: row.distance_km,
      score: row.score || (parseFloat(row.size_in) >= 1 ? 5 : 3),
      hits: row.hits,
      zone_r_km: Math.round(zone_r_km * 10) / 10,
      severity: hailSeverityLabel(row.size_in),
      stars: hailStars(row.size_in),
    };
  });
}

function enrichStormDates(storms, hail, wind) {
  const byDate = new Map();
  for (const s of storms || []) {
    if (s.date) byDate.set(s.date, { ...s, reasons: [...(s.reasons || [])] });
  }
  // Already 1 hail tag/day when collapsed; still guard against duplicates.
  const hailDays = collapseHailByDate(hail);
  for (const h of hailDays) {
    if (!h.date) continue;
    const tag = `${h.severity || "HAIL"} ${h.size_in}"`;
    const cur = byDate.get(h.date);
    if (cur) {
      cur.reasons = (cur.reasons || []).filter((r) => !/hail|radar hail/i.test(r));
      cur.reasons.push(tag);
      cur.score = Math.max(cur.score || 0, h.score || 4);
      cur.hail_in = h.size_in;
      cur.severity = h.severity;
    } else {
      byDate.set(h.date, {
        date: h.date,
        score: h.score || 4,
        label: "Hail",
        reasons: [tag],
        wind_mph: 0,
        hail_in: h.size_in,
        severity: h.severity,
        source: h.source || "hail",
      });
    }
  }
  const windByDate = new Map();
  for (const w of wind || []) {
    if (!w.date) continue;
    const mph = Number(w.wind_mph) || 0;
    const prev = windByDate.get(w.date);
    if (!prev || mph > prev.mph) windByDate.set(w.date, { mph, row: w });
  }
  for (const [day, { mph }] of windByDate) {
    const tag = `wind ${mph.toFixed(0)} mph`;
    const cur = byDate.get(day);
    if (cur) {
      cur.reasons = (cur.reasons || []).filter((r) => !/^wind /i.test(r));
      cur.reasons.push(tag);
      cur.score = Math.max(cur.score || 0, mph >= 58 ? 4 : 3);
      cur.wind_mph = Math.max(cur.wind_mph || 0, mph);
    } else {
      byDate.set(day, {
        date: day,
        score: mph >= 58 ? 4 : 3,
        label: "Wind",
        reasons: [tag],
        wind_mph: mph,
        source: "noaa-spc",
      });
    }
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
}

async function fetchSpcReports(lat, lon, radiusKm = 25, daysBack = 30) {
  const today = new Date();
  const days = Math.min(Math.max(daysBack, 7), 90);
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
const MAP_MAX_ZOOM = 18;
const RADAR_NATIVE_ZOOM = 7;
const RADAR_TILE_SIZE = 512;

function rainTileUrl(host, path, color = "2/1_1") {
  const base = String(host || "https://tilecache.rainviewer.com").replace(/\/+$/, "");
  return `${base}${path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/${color}.png`;
}

export function hailStars(sizeIn) {
  const sz = parseFloat(sizeIn);
  if (Number.isNaN(sz)) return "☆";
  if (sz >= 3) return "★★★★★";
  if (sz >= 2) return "★★★★";
  if (sz >= 1.75) return "★★★☆";
  if (sz >= 1.25) return "★★★";
  if (sz >= 1) return "★★";
  if (sz >= 0.75) return "★";
  return "☆";
}

export function hailSeverityLabel(sizeIn) {
  const sz = parseFloat(sizeIn);
  if (Number.isNaN(sz)) return "UNK";
  if (sz >= 2) return "EXTREME";
  if (sz >= 1.5) return "SEVERE";
  if (sz >= 1) return "STRONG";
  if (sz >= 0.75) return "MOD";
  return "LIGHT";
}

function setRadarTilePath(path) {
  if (!map || !window.L || !path) return;
  const url = rainTileUrl(radarHost, path, radarColor);
  const wasOn = activeWxProduct === "precip" || activeOverlays.has("precip") || activeOverlays.has("radar");
  if (overlays.precip) {
    try {
      map.removeLayer(overlays.precip);
    } catch {
      /* ignore */
    }
  }
  overlays.precip = window.L.tileLayer(url, {
    attribution: "© RainViewer",
    opacity: 0.72,
    maxZoom: MAP_MAX_ZOOM,
    maxNativeZoom: RADAR_NATIVE_ZOOM,
    tileSize: 256,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 1,
  });
  overlays.radar = overlays.precip;
  if (wasOn && activeWxProduct === "precip") overlays.precip.addTo(map);
}

export function setRadarFrame(idx) {
  if (!radarFrames.length) return;
  const i = Math.max(0, Math.min(radarFrames.length - 1, Number(idx) || 0));
  radarFrameIdx = i;
  const frame = radarFrames[i];
  if (frame?.path) setRadarTilePath(frame.path);
  const label = document.getElementById("wx-radar-label");
  if (label && frame?.time) {
    const d = new Date(frame.time * 1000);
    label.textContent = d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const range = document.getElementById("wx-radar-range");
  if (range && String(range.value) !== String(i)) range.value = String(i);
}

export function stopRadarPlay() {
  if (radarPlayTimer) {
    clearInterval(radarPlayTimer);
    radarPlayTimer = null;
  }
  const btn = document.getElementById("wx-radar-play");
  if (btn) {
    btn.textContent = "PLAY";
    btn.classList.remove("on");
  }
}

export function stopHourPlay() {
  if (hourPlayTimer) {
    clearInterval(hourPlayTimer);
    hourPlayTimer = null;
  }
}

export function radarScrubberHtml() {
  if (radarFrames.length < 2 || activeWxProduct !== "precip") return "";
  const max = radarFrames.length - 1;
  return `<div class="wx-radar-scrub" id="wx-radar-scrub">
    <button type="button" id="wx-radar-play" class="wx-play-btn${radarPlayTimer ? " on" : ""}">${radarPlayTimer ? "PAUSE" : "PLAY"}</button>
    <span class="wx-radar-tag">PRECIP</span>
    <input type="range" id="wx-radar-range" min="0" max="${max}" value="${radarFrameIdx}" step="1" />
    <span id="wx-radar-label" class="wx-radar-label">…</span>
  </div>`;
}

export function bindRadarScrubber(root = document) {
  const range = root.querySelector?.("#wx-radar-range") || document.getElementById("wx-radar-range");
  const play = root.querySelector?.("#wx-radar-play") || document.getElementById("wx-radar-play");
  if (!range) return;
  setRadarFrame(radarFrameIdx);
  range.oninput = () => {
    stopRadarPlay();
    setRadarFrame(range.value);
  };
  if (play) {
    play.onclick = () => {
      if (radarPlayTimer) {
        stopRadarPlay();
        return;
      }
      if (radarFrames.length < 2) return;
      play.textContent = "PAUSE";
      play.classList.add("on");
      radarPlayTimer = setInterval(() => {
        const next = (radarFrameIdx + 1) % radarFrames.length;
        setRadarFrame(next);
      }, 420);
    };
  }
}

const BASE_LAYERS = [
  { id: "osm", label: "Street", kind: "base", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OSM" },
  { id: "dark", label: "Night", kind: "base", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: "© CARTO" },
  { id: "sat", label: "Sat", kind: "base", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri" },
];

export async function resolveMapCenter(settings) {
  return locateDevice(settings, httpGet);
}

async function currentWeather(lat, lon) {
  const bundle = await fetchWeatherBundle(lat, lon);
  return bundle.current;
}

/** Current + hourly past/next for timeline scrub. */
export async function fetchWeatherBundle(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,relative_humidity_2m",
    hourly: "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_gusts_10m_max",
    past_days: "1",
    forecast_days: "3",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  });
  try {
    const { body } = await httpGet(`https://api.open-meteo.com/v1/forecast?${params}`, 10000);
    const data = JSON.parse(body || "{}");
    const cur = data.current || {};
    const code = parseInt(cur.weather_code || 0, 10);
    const current = {
      ok: true,
      temp_f: cur.temperature_2m,
      feels_f: cur.apparent_temperature,
      wind_mph: cur.wind_speed_10m,
      gust_mph: cur.wind_gusts_10m,
      precip_in: cur.precipitation,
      humidity: cur.relative_humidity_2m,
      code,
      label: WMO[code] || "Weather",
    };
    const h = data.hourly || {};
    const times = h.time || [];
    const now = Date.now();
    const hours = times.map((t, i) => {
      const ts = new Date(t).getTime();
      const c = parseInt((h.weather_code || [])[i] || 0, 10);
      const precipIn = Number((h.precipitation || [])[i]);
      return {
        time: t,
        ts,
        temp_f: (h.temperature_2m || [])[i],
        feels_f: (h.apparent_temperature || [])[i],
        precip_in: Number.isFinite(precipIn) ? precipIn : 0,
        precip_mm: Number.isFinite(precipIn) ? precipIn * 25.4 : 0,
        precip_prob: (h.precipitation_probability || [])[i],
        wind_mph: (h.wind_speed_10m || [])[i],
        gust_mph: (h.wind_gusts_10m || [])[i],
        humidity: (h.relative_humidity_2m || [])[i],
        code: c,
        label: WMO[c] || "Weather",
        offsetHr: Math.round((ts - now) / 3600000),
      };
    });
    const windowed = hours.filter((row) => row.offsetHr >= -12 && row.offsetHr <= 36);
    const nearestIdx = windowed.reduce((best, row, i) => {
      if (best < 0) return i;
      return Math.abs(row.offsetHr) < Math.abs(windowed[best].offsetHr) ? i : best;
    }, -1);
    const daily = data.daily || {};
    const days = (daily.time || []).map((t, i) => ({
      date: t,
      high_f: (daily.temperature_2m_max || [])[i],
      low_f: (daily.temperature_2m_min || [])[i],
      precip_in: (daily.precipitation_sum || [])[i],
      precip_prob: (daily.precipitation_probability_max || [])[i],
      gust_mph: (daily.wind_gusts_10m_max || [])[i],
      code: parseInt((daily.weather_code || [])[i] || 0, 10),
      label: WMO[parseInt((daily.weather_code || [])[i] || 0, 10)] || "Weather",
    }));
    return {
      current,
      hours: windowed.length ? windowed : hours.slice(0, 48),
      nowIdx: Math.max(0, nearestIdx),
      days,
    };
  } catch {
    return {
      current: { ok: false },
      hours: [],
      nowIdx: 0,
      days: [],
    };
  }
}

function hourMetric(row, mode) {
  if (!row) return 0;
  if (mode === "precip") return Math.max(Number(row.precip_prob) || 0, (Number(row.precip_in) || 0) * 100);
  if (mode === "wind") return Number(row.gust_mph || row.wind_mph) || 0;
  return Number(row.temp_f) || 0;
}

function renderHourBars(hours, mode, activeIdx) {
  const vals = hours.map((h) => hourMetric(h, mode));
  const max = Math.max(...vals, mode === "temp" ? 1 : mode === "wind" ? 10 : 1);
  const min = mode === "temp" ? Math.min(...vals.filter((v) => v), max - 1) : 0;
  const span = Math.max(1, max - min);
  const w = Math.max(240, hours.length * 8);
  const h = 56;
  const gap = 1;
  const barW = Math.max(2, (w - gap * hours.length) / hours.length);
  const bars = hours
    .map((row, i) => {
      const v = vals[i];
      const norm = mode === "temp" ? (v - min) / span : v / max;
      const bh = Math.max(2, Math.round(norm * (h - 8)));
      const x = i * (barW + gap);
      const y = h - bh;
      const on = i === activeIdx;
      let fill = on ? "var(--phos)" : "rgba(125,255,90,0.35)";
      if (mode === "precip") fill = on ? "#4fc3f7" : "rgba(79,195,247,0.4)";
      if (mode === "wind") fill = on ? "#90caf9" : "rgba(144,202,249,0.35)";
      if (mode === "hail" || [95, 96, 99].includes(row.code)) {
        if ([96, 99].includes(row.code)) fill = on ? "#e040fb" : "rgba(224,64,251,0.55)";
        else if (row.code === 95) fill = on ? "#ff7043" : "rgba(255,112,67,0.45)";
      }
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${barW.toFixed(1)}" height="${bh}" fill="${fill}" data-hi="${i}" />`;
    })
    .join("");
  return `<svg class="wx-hour-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">${bars}</svg>`;
}

/** HailTrace-style storm-date bars — tap a day to paint topo zones on the map. */
export function renderStormGraph(hailDays, esc, selectedDate = selectedStormDate) {
  const rows = [...(hailDays || [])]
    .filter((h) => parseFloat(h.size_in) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-24);
  if (!rows.length) {
    return `<div class="wx-storm-graph empty"><p class="muted">No hail days in range — widen NEAR / WINDOW or run DEEP RESEARCH.</p></div>`;
  }
  const maxSz = Math.max(...rows.map((h) => parseFloat(h.size_in) || 0), 1);
  const w = Math.max(280, rows.length * 18);
  const h = 110;
  const pad = 18;
  const barArea = h - pad - 22;
  const barW = Math.max(6, (w - 8) / rows.length - 3);
  const bars = rows
    .map((row, i) => {
      const sz = parseFloat(row.size_in) || 0;
      const bh = Math.max(4, Math.round((sz / maxSz) * barArea));
      const x = 4 + i * ((w - 8) / rows.length);
      const y = pad + (barArea - bh);
      const col = hailZoneColor(sz);
      const label = String(row.date || "").slice(5);
      const on = selectedDate && selectedDate === row.date;
      return `<g class="wx-sg-bar${on ? " on" : ""}" data-storm-date="${esc(row.date)}" role="button" tabindex="0">
        <rect x="${x.toFixed(1)}" y="${y}" width="${barW.toFixed(1)}" height="${bh}" fill="${col.fill}" stroke="${on ? "var(--phos)" : col.stroke}" stroke-width="${on ? 1.8 : 0.6}" opacity="${on ? 1 : 0.88}" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" class="wx-sg-x">${esc(label)}</text>
        <text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(10, y - 3)}" text-anchor="middle" class="wx-sg-v">${esc(String(sz))}"</text>
      </g>`;
    })
    .join("");
  const biggest = [...rows].sort((a, b) => (parseFloat(b.size_in) || 0) - (parseFloat(a.size_in) || 0))[0];
  const selLabel = selectedDate || biggest.date;
  return `<div class="wx-storm-graph">
    <div class="wx-storm-graph-head">
      <span>HAIL ZONES · TAP A STORM DATE</span>
      <span class="wx-storm-graph-peak">${esc(selLabel)} · map shows that day</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Hail size by storm date">${bars}</svg>
    <div class="wx-storm-graph-legend muted">Tap a bar → storm zones on map · yellow light → purple/white extreme · height = max inches</div>
  </div>`;
}

export function bindStormGraph(root, onPick) {
  if (!root || typeof onPick !== "function") return;
  root.querySelectorAll("[data-storm-date]").forEach((el) => {
    const pick = () => onPick(el.getAttribute("data-storm-date"));
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      pick();
    };
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    };
  });
}

export function selectStormDate(date, { fit = true } = {}) {
  selectedStormDate = date ? String(date).slice(0, 10) : null;
  if (lastHailRows.length || lastWindRows.length) {
    drawHailMarkers(lastHailRows, lastWindRows, { fit });
  }
  if (selectedStormDate && activeWxProduct !== "hail" && activeWxProduct !== "precip") {
    setMapLayer("hail");
  }
}

export function weatherSummaryHtml(bundle, hailDays, esc) {
  const cur = bundle?.current;
  if (!cur?.ok) return `<div class="wx-summary muted">Weather summary offline.</div>`;
  const hours = bundle.hours || [];
  const next12 = hours.filter((h) => h.offsetHr >= 0 && h.offsetHr <= 12);
  const maxProb = Math.max(0, ...next12.map((h) => Number(h.precip_prob) || 0));
  const maxGust = Math.max(0, ...next12.map((h) => Number(h.gust_mph || h.wind_mph) || 0), Number(cur.gust_mph) || 0);
  const stormHr = next12.find((h) => [95, 96, 99].includes(h.code));
  const recentHail = [...(hailDays || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const day0 = (bundle.days || [])[0];
  const bits = [];
  bits.push(`<div class="wx-summary-hero">${Math.round(cur.temp_f)}°F · ${esc(cur.label)}</div>`);
  const sub = [];
  if (cur.feels_f != null) sub.push(`feels ${Math.round(cur.feels_f)}°`);
  if (cur.humidity != null) sub.push(`${Math.round(cur.humidity)}% RH`);
  if (cur.wind_mph != null) sub.push(`wind ${Math.round(cur.wind_mph)} mph`);
  if (cur.gust_mph != null && cur.gust_mph > cur.wind_mph) sub.push(`gust ${Math.round(cur.gust_mph)}`);
  bits.push(`<div class="wx-summary-sub">${esc(sub.join(" · "))}</div>`);
  const outlook = [];
  if (day0) {
    outlook.push(`Today ${Math.round(day0.high_f)}°/${Math.round(day0.low_f)}°`);
    if (day0.precip_prob != null) outlook.push(`${Math.round(day0.precip_prob)}% precip`);
  }
  if (maxProb >= 40) outlook.push(`Next 12h rain risk ${maxProb}%`);
  if (maxGust >= 35) outlook.push(`Gusts to ${Math.round(maxGust)} mph`);
  if (stormHr) outlook.push(`Thunder possible ~${new Date(stormHr.ts).toLocaleTimeString(undefined, { hour: "numeric" })}`);
  if (recentHail) outlook.push(`Last hail day ${recentHail.date} · ${recentHail.size_in}"`);
  else outlook.push("No recent hail near pin");
  bits.push(`<div class="wx-summary-outlook">${esc(outlook.join(" · "))}</div>`);
  return `<div class="wx-summary">${bits.join("")}</div>`;
}

export function renderHourlyTimeline(root, bundle, esc) {
  if (!root) return;
  const hours = bundle?.hours || [];
  if (!hours.length) {
    root.innerHTML = `<p class="muted">Hourly timeline offline.</p>`;
    return;
  }
  let mode = root.dataset.wxMode || "precip";
  const idx = Math.min(hours.length - 1, Math.max(0, Number(root.dataset.wxHour ?? bundle.nowIdx) || 0));
  const paint = (i) => {
    const row = hours[i];
    if (!row) return;
    root.dataset.wxHour = String(i);
    const when =
      row.offsetHr === 0
        ? "NOW"
        : row.offsetHr < 0
          ? `${Math.abs(row.offsetHr)}h ago`
          : `+${row.offsetHr}h`;
    const tLabel = new Date(row.ts).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    let focus = "";
    if (mode === "precip") {
      focus = `${row.precip_prob != null ? `${Math.round(row.precip_prob)}% chance` : "precip"} · ${(Number(row.precip_in) || 0).toFixed(2)} in · ${esc(row.label)}`;
    } else if (mode === "wind") {
      focus = `${row.wind_mph != null ? `${Math.round(row.wind_mph)} mph` : "wind"}${row.gust_mph != null ? ` · gust ${Math.round(row.gust_mph)}` : ""} · ${esc(row.label)}`;
    } else {
      focus = `${Math.round(row.temp_f)}°F${row.feels_f != null ? ` (feels ${Math.round(row.feels_f)}°)` : ""} · ${esc(row.label)}`;
    }
    root.dataset.wxMode = mode;
    root.innerHTML = `
      <div class="wx-timeline">
        <div class="wx-timeline-modes">
          <button type="button" data-wx-mode="temp" class="${mode === "temp" ? "on" : ""}">TEMP</button>
          <button type="button" data-wx-mode="precip" class="${mode === "precip" ? "on" : ""}">PRECIP</button>
          <button type="button" data-wx-mode="wind" class="${mode === "wind" ? "on" : ""}">WIND</button>
        </div>
        <div class="wx-timeline-head">
          <span class="wx-timeline-when">${esc(when)}</span>
          <span class="wx-timeline-clock">${esc(tLabel)}</span>
        </div>
        <div class="wx-now">${focus}</div>
        <div class="wx-hour-chart-wrap">${renderHourBars(hours, mode, i)}</div>
        <div class="wx-timeline-meta muted">${esc(
          `${hours.length} hrs · −12h → +36h · tap a bar to scrub`,
        )}</div>
      </div>`;
    root.querySelectorAll("[data-wx-mode]").forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.wxMode;
        paint(Number(root.dataset.wxHour || i));
      };
    });
    root.querySelectorAll(".wx-hour-chart rect").forEach((r) => {
      r.onclick = () => paint(Number(r.getAttribute("data-hi")));
    });
  };
  paint(idx);
}

export function renderWeatherBoot(root, geo, wx, hail, esc) {
  const addr = (geo && (geo.address || geo.city)) || "Your area";
  const hailRows = collapseHailByDate(hail || []);
  if (!selectedStormDate && hailRows.length) {
    selectedStormDate = [...hailRows].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.date || null;
  }
  const bundleStub = {
    current: wx && wx.ok ? wx : { ok: false },
    hours: [],
    days: [],
  };
  const hourly = root.querySelector("#wx-hourly");
  root.innerHTML = `
    <div class="wx-boot">
      <div class="wx-addr">${esc(addr)}</div>
      ${weatherSummaryHtml(bundleStub, hailRows, esc)}
      <div id="wx-hourly-slot"></div>
      ${renderStormGraph(hailRows, esc, selectedStormDate)}
      <p class="muted wx-boot-hint">Scroll past the map for the full dossier · tap a storm-date bar for topo zones · search or tap map to pin</p>
    </div>`;
  const slot = root.querySelector("#wx-hourly-slot");
  if (hourly && slot) slot.replaceWith(hourly);
  const onPick = (date) => {
    selectStormDate(date, { fit: true });
    const old = root.querySelector(".wx-storm-graph");
    if (!old) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = renderStormGraph(hailRows, esc, selectedStormDate);
    if (wrap.firstElementChild) old.replaceWith(wrap.firstElementChild);
    bindStormGraph(root, onPick);
  };
  bindStormGraph(root, onPick);
  if (hail?.length) drawHailMarkers(hail, [], { fit: !!selectedStormDate });
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
  radarFrames = [];
  radarFrameIdx = 0;
  try {
    const { body } = await httpGet("https://api.rainviewer.com/public/weather-maps.json", 2500);
    const rv = JSON.parse(body || "{}");
    radarHost = rv.host || "https://tilecache.rainviewer.com";
    const past = ((rv.radar || {}).past || []).slice(-12);
    const nowcast = ((rv.radar || {}).nowcast || []).slice(0, 3);
    radarFrames = [...past, ...nowcast].filter((f) => f && f.path);
    radarFrameIdx = Math.max(0, past.length - 1);
    const frame = radarFrames[radarFrameIdx] || past.slice(-1)[0];
    const ir = ((rv.satellite || {}).infrared || []).slice(-1)[0];
    const vis = ((rv.satellite || {}).visible || []).slice(-1)[0];
    if (frame?.path) {
      layerList.push({
        id: "precip",
        label: "Precip",
        kind: "wx",
        url: rainTileUrl(radarHost, frame.path),
        attribution: "© RainViewer",
        opacity: 0.72,
        maxNativeZoom: RADAR_NATIVE_ZOOM,
      });
    }
    if (ir?.path) {
      layerList.push({
        id: "cloud",
        label: "Cloud",
        kind: "wx",
        url: rainTileUrl(radarHost, ir.path, "0/0_0"),
        attribution: "© RainViewer",
        opacity: 0.55,
        maxNativeZoom: RADAR_NATIVE_ZOOM,
      });
    }
    if (vis?.path) {
      layerList.push({
        id: "vis",
        label: "Vis",
        kind: "wx",
        url: rainTileUrl(radarHost, vis.path, "0/0_0"),
        attribution: "© RainViewer",
        opacity: 0.45,
        maxNativeZoom: RADAR_NATIVE_ZOOM,
      });
    }
    layerList.push({
      id: "wind",
      label: "Wind",
      kind: "wx",
      synthetic: true,
    });
    layerList.push({
      id: "hail",
      label: "Hail",
      kind: "wx",
      synthetic: true,
    });
  } catch {
    /* overlays optional */
  }
  if (!layerList.some((l) => l.id === "wind")) {
    layerList.push({ id: "wind", label: "Wind", kind: "wx", synthetic: true });
  }
  if (!layerList.some((l) => l.id === "hail")) {
    layerList.push({ id: "hail", label: "Hail", kind: "wx", synthetic: true });
  }
  return { center: { lat: c.lat, lon: c.lon, city: c.city || settings?.city || "" }, layers: layerList, radarFrames };
}

async function localResearch(lat, lon, address = "", { deep = true, filters = wxFilters } = {}) {
  const geoP = address ? Promise.resolve({ ok: true, address, city: address.split(",")[0] }) : reverseGeocode(lat, lon);
  const filterDays = Number(filters.days) || 180;
  const archiveDays = Math.min(filterDays, 730);
  const swdiDays = Math.min(filterDays, 180);
  const km = Number(filters.km) || 25;
  const spcDays = Math.min(filterDays, deep ? 90 : 30);
  const [geo, wxNow, archiveStorms, spc, swdi, lsr] = await Promise.all([
    geoP,
    currentWeather(lat, lon).catch(() => ({ ok: false })),
    historicalStorms(lat, lon, archiveDays),
    fetchSpcReports(lat, lon, km, spcDays),
    fetchSwdiHail(lat, lon, km, swdiDays),
    fetchIemLsrHail(lat, lon, km, deep ? 120 : 72).catch(() => []),
  ]);
  const addr = address || geo.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const city = geo.city || addr.split(",")[0];
  const hail = mergeHailRows(spc.hail || [], swdi || [], lsr || []);
  const wind = spc.wind || [];
  const storms = enrichStormDates(archiveStorms, hail, wind);
  const news = [];
  if (deep) {
    for (const q of [`hail damage "${city}"`, `hail storm "${city}"`, `severe weather "${addr}"`, `wind damage "${city}"`]) {
      for (const hit of await searchNews(q, 3)) {
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
    _meta: { fetchedDays: Math.max(archiveDays, swdiDays, spcDays), fetchedKm: km, deep: Boolean(deep), lat, lon },
  };
}

export async function quickDossier(settings, lat, lon, { onPartial } = {}) {
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
    wind: [],
    news: [],
    owner_name: "",
    owner_phone: "",
    owner_email: "",
  };
  if (onPartial) onPartial(partial);
  const km = Number(wxFilters.km) || 25;
  const [wxNow, spc, swdi, lsr] = await Promise.all([
    currentWeather(lat, lon).catch(() => ({ ok: false })),
    fetchSpcReports(lat, lon, km, 30),
    fetchSwdiHail(lat, lon, km, 60),
    fetchIemLsrHail(lat, lon, km, 72).catch(() => []),
  ]);
  const hail = mergeHailRows(spc.hail || [], swdi || [], lsr || []);
  const wind = spc.wind || [];
  return {
    ...partial,
    weather: wxNow,
    hail,
    wind,
    storms: enrichStormDates([], hail, wind),
    _meta: { fetchedDays: 60, fetchedKm: km, deep: false },
  };
}

export async function refetchDossier(settings, lat, lon, address, filters = wxFilters) {
  const f = { ...wxFilters, ...filters };
  return localResearch(lat, lon, address, { deep: true, filters: f });
}

export async function loadMapConfig(settings) {
  if (mapConfigCache) {
    const layers = mapConfigCache.layers || [];
    if (!layers.some((l) => l.id === "hail")) {
      layers.push({ id: "hail", label: "Hail", kind: "wx", synthetic: true });
    }
    if (!layers.some((l) => l.id === "wind")) {
      layers.push({ id: "wind", label: "Wind", kind: "wx", synthetic: true });
    }
    mapConfigCache.layers = layers;
    return mapConfigCache;
  }
  const center = await resolveMapCenter(settings);
  const remote = await api("/api/storm/map", { settings, timeout: 8000 }).catch(() => null);
  mapConfigCache = remote ? { ...remote, center: { ...remote.center, ...center } } : await localMapConfig(settings, center);
  return mapConfigCache;
}

export async function researchPin(settings, lat, lon, address = "", deep = true) {
  let remote = null;
  try {
    remote = await api("/api/storm/research", {
      settings,
      method: "POST",
      body: { lat, lon, address, deep },
      timeout: deep ? 180000 : 60000,
    });
  } catch {
    /* local fallback */
  }
  const local = await localResearch(lat, lon, address, { deep, filters: wxFilters });
  if (usableRemote(remote)) {
    const norm = normalizeDossier(remote) || local;
    if ((local.hail?.length || 0) > (norm.hail?.length || 0)) {
      norm.hail = local.hail;
      norm.wind = local.wind || [];
      norm.storms = local.storms || [];
    }
    norm._meta = local._meta || norm._meta;
    return norm;
  }
  return local;
}

export async function pinDossier(settings, lat, lon, { onPartial, deep = false } = {}) {
  if (!deep) {
    return normalizeDossier(await quickDossier(settings, lat, lon, { onPartial })) || null;
  }
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

function ringPolygon(lat, lon, radiusM, sides = 6) {
  const ring = [];
  const cos = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const dLat = (radiusM * Math.sin(ang)) / 111320;
    const dLon = (radiusM * Math.cos(ang)) / (111320 * Math.max(0.2, cos));
    ring.push([lat + dLat, lon + dLon]);
  }
  return ring;
}

function convexHullLatLon(points) {
  const pts = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 3) return null;
  const sorted = [...pts].sort((a, b) => (a.lat === b.lat ? a.lon - b.lon : a.lat - b.lat));
  const cross = (o, a, b) => (a.lat - o.lat) * (b.lon - o.lon) - (a.lon - o.lon) * (b.lat - o.lat);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  if (hull.length < 3) return null;
  return hull.map((p) => [p.lat, p.lon]);
}

function padPolygon(ring, padM) {
  if (!ring || ring.length < 3 || !padM) return ring;
  let lat = 0;
  let lon = 0;
  for (const [a, b] of ring) {
    lat += a;
    lon += b;
  }
  lat /= ring.length;
  lon /= ring.length;
  const cos = Math.cos((lat * Math.PI) / 180);
  return ring.map(([a, b]) => {
    const dLat = a - lat;
    const dLon = (b - lon) * cos;
    const len = Math.hypot(dLat, dLon) || 1;
    const scale = padM / 111320 / len;
    return [a + dLat * scale, b + (dLon * scale) / cos];
  });
}

function topoZoneRing(zone, rawPts) {
  const lat = zone.lat;
  const lon = zone.lon;
  const sz = parseFloat(zone.size_in);
  const baseM = Math.max(900, Math.min(11000, (zone.zone_r_km || 2) * 1000));
  const dayPts = (rawPts || []).filter((p) => String(p.date || "").slice(0, 10) === zone.date);
  const hull = convexHullLatLon(dayPts);
  if (hull) return padPolygon(hull, Math.max(400, baseM * 0.15));
  return ringPolygon(lat, lon, baseM, sz >= 1.5 ? 8 : 6);
}

function hailPopupHtml(h, day) {
  const stars = h.stars || hailStars(h.size_in);
  const sev = h.severity || hailSeverityLabel(h.size_in);
  const src =
    h.source === "mixed"
      ? "radar+spot"
      : h.source === "noaa-swdi-radar"
        ? "radar"
        : h.source === "iem-lsr"
          ? "LSR"
          : "spotter";
  return `<b>${stars} ${sev}</b><br>${h.date || day || ""}${h.time ? ` ${h.time}` : ""} · <b>${h.size_in}"</b> (${src})<br>${h.hits || 1} signature${(h.hits || 1) === 1 ? "" : "s"} · zone ~${h.zone_r_km || "?"} km<br>${h.location || ""}${h.state ? `, ${h.state}` : ""}${h.distance_km != null ? `<br>${h.distance_km} km from pin` : ""}`;
}

export function drawHailMarkers(hailRows, windRows, opts = {}) {
  if (!map || !window.L) return;
  lastHailRows = hailRows || [];
  lastWindRows = windRows || [];
  if (hailLayer) {
    try {
      hailLayer.remove();
    } catch {
      /* ignore */
    }
  }
  if (windLayer) {
    try {
      windLayer.remove();
    } catch {
      /* ignore */
    }
  }
  hailLayer = window.L.layerGroup();
  windLayer = window.L.layerGroup();

  const collapsed = collapseHailByDate(hailRows || []);
  if (!selectedStormDate && collapsed.length) {
    selectedStormDate = [...collapsed].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.date || null;
  }
  const day = selectedStormDate;
  const zones = collapsed
    .filter((h) => !day || h.date === day)
    .sort((a, b) => (parseFloat(b.size_in) || 0) - (parseFloat(a.size_in) || 0))
    .slice(0, 36);

  const fitPts = [];
  for (const h of zones) {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
    const sz = parseFloat(h.size_in);
    const col = hailZoneColor(h.size_in);
    const ring = topoZoneRing(h, hailRows);
    fitPts.push(...ring);
    window.L.polygon(ring, {
      color: col.stroke,
      fillColor: col.fill,
      fillOpacity: sz >= 2 ? 0.2 : sz >= 1 ? 0.14 : 0.1,
      weight: sz >= 2 ? 2.4 : sz >= 1 ? 1.8 : 1.2,
      opacity: 0.92,
      dashArray: sz >= 1 ? null : "6 5",
      className: "wx-hail-topo",
    })
      .bindPopup(hailPopupHtml(h, day))
      .addTo(hailLayer);
    if (sz >= 0.75) {
      const coreR = Math.max(350, ((h.zone_r_km || 1.5) * 1000) * (sz >= 2 ? 0.28 : 0.38));
      window.L.polygon(ringPolygon(h.lat, h.lon, coreR, 6), {
        color: col.core,
        fillColor: col.core,
        fillOpacity: 0.28,
        weight: 1.2,
        opacity: 0.85,
        dashArray: "3 4",
        className: "wx-hail-topo-core",
      }).addTo(hailLayer);
    }
  }

  const windDays = new Map();
  for (const w of windRows || []) {
    const wday = String(w.date || "").slice(0, 10);
    if (!wday) continue;
    if (day && wday !== day) continue;
    const mph = Number(w.wind_mph) || 0;
    const prev = windDays.get(wday);
    if (!prev || mph > (Number(prev.wind_mph) || 0)) windDays.set(wday, w);
  }
  for (const w of [...windDays.values()].slice(0, 24)) {
    if (!Number.isFinite(w.lat) || !Number.isFinite(w.lon)) continue;
    const mph = Number(w.wind_mph) || 0;
    window.L.polygon(ringPolygon(w.lat, w.lon, Math.max(1200, Math.min(9000, mph * 75)), 6), {
      color: "#4a9eff",
      fillColor: "#4a9eff",
      fillOpacity: 0.1,
      weight: 1.4,
      opacity: 0.65,
      dashArray: "5 6",
      className: "wx-wind-topo",
    })
      .bindPopup(`${w.date} · ${mph} mph wind<br>${w.location || ""}, ${w.state || ""}<br>${w.distance_km != null ? `${w.distance_km} km from pin` : ""}`)
      .addTo(windLayer);
  }
  syncHazardLayers();
  if (opts.fit && fitPts.length && map) {
    try {
      const bounds = window.L.latLngBounds(fitPts);
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.3), { maxZoom: 12, animate: true });
    } catch {
      /* ignore */
    }
  }
}

function syncHazardLayers() {
  if (!map) return;
  const showHail = activeWxProduct === "hail" || activeWxProduct === "precip";
  const showWind = activeWxProduct === "wind" || activeWxProduct === "hail";
  try {
    if (hailLayer) {
      if (showHail) hailLayer.addTo(map);
      else map.removeLayer(hailLayer);
    }
    if (windLayer) {
      if (showWind && activeWxProduct === "wind") windLayer.addTo(map);
      else if (activeWxProduct === "hail") map.removeLayer(windLayer);
      else if (activeWxProduct === "precip") map.removeLayer(windLayer);
      else map.removeLayer(windLayer);
    }
  } catch {
    /* ignore */
  }
}

function applyOverlays() {
  if (!map) return;
  for (const id of Object.keys(overlays)) {
    if (id === "radar") continue;
    const on = activeWxProduct === id || (id === "precip" && activeWxProduct === "precip");
    try {
      if (on) overlays[id].addTo(map);
      else map.removeLayer(overlays[id]);
    } catch {
      /* ignore */
    }
  }
  if (activeWxProduct === "wind") refreshWindField();
  else if (windFieldLayer) {
    try {
      map.removeLayer(windFieldLayer);
    } catch {
      /* ignore */
    }
  }
  syncHazardLayers();
}

async function refreshWindField() {
  if (!map || !window.L || activeWxProduct !== "wind") return;
  const c = map.getCenter();
  if (!c) return;
  try {
    const params = new URLSearchParams({
      latitude: c.lat,
      longitude: c.lng,
      current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      hourly: "wind_speed_10m,wind_direction_10m",
      forecast_days: "1",
      wind_speed_unit: "mph",
      timezone: "auto",
    });
    const { body } = await httpGet(`https://api.open-meteo.com/v1/forecast?${params}`, 8000);
    const data = JSON.parse(body || "{}");
    const cur = data.current || {};
    const spd = Number(cur.wind_speed_10m) || 0;
    const gust = Number(cur.wind_gusts_10m) || spd;
    const dir = Number(cur.wind_direction_10m) || 0;
    if (windFieldLayer) {
      try {
        map.removeLayer(windFieldLayer);
      } catch {
        /* ignore */
      }
    }
    windFieldLayer = window.L.layerGroup();
    const color = gust >= 50 ? "#ff3a3a" : gust >= 35 ? "#d4a84b" : "#4a9eff";
    window.L.circle([c.lat, c.lng], {
      radius: Math.max(2500, Math.min(18000, gust * 220)),
      color,
      fillColor: color,
      fillOpacity: 0.15,
      weight: 2,
    })
      .bindPopup(`Wind ${Math.round(spd)} mph · gust ${Math.round(gust)} · from ${Math.round(dir)}°`)
      .addTo(windFieldLayer);
    window.L.circleMarker([c.lat, c.lng], {
      radius: Math.min(18, 5 + spd / 4),
      color,
      fillColor: color,
      fillOpacity: 0.75,
      weight: 1,
    }).addTo(windFieldLayer);
    if (activeWxProduct === "wind") windFieldLayer.addTo(map);
  } catch {
    /* wind field optional */
  }
}

export function destroyMap() {
  stopRadarPlay();
  stopHourPlay();
  if (map) {
    try {
      map.off();
      map.remove();
    } catch {
      /* ignore */
    }
    map = null;
  }
  pin = null;
  hailLayer = null;
  windLayer = null;
  windFieldLayer = null;
  lastHailRows = [];
  lastWindRows = [];
  selectedStormDate = null;
  layers = {};
  overlays = {};
  activeOverlays = new Set(["precip"]);
  activeWxProduct = "precip";
}

export function mountMap(container, config, { onTap, center }) {
  if (!window.L) throw new Error("Leaflet not loaded");
  destroyMap();
  const c = center || config.center || { lat: 0, lon: 0 };
  const zoom = Math.abs(c.lat) < 1 && Math.abs(c.lon) < 1 ? 3 : 12;
  map = window.L.map(container, {
    zoomControl: true,
    preferCanvas: true,
    scrollWheelZoom: true,
    touchZoom: true,
    doubleClickZoom: true,
    maxZoom: MAP_MAX_ZOOM,
  }).setView([c.lat, c.lon], zoom);
  const all = config.layers || [];
  for (const layer of all) {
    if (layer.synthetic || !layer.url) continue;
    const isWx = layer.kind === "wx" || layer.kind === "overlay";
    const tile = window.L.tileLayer(layer.url, {
      attribution: layer.attribution || "",
      opacity: layer.opacity ?? 1,
      maxZoom: MAP_MAX_ZOOM,
      maxNativeZoom: isWx ? layer.maxNativeZoom ?? RADAR_NATIVE_ZOOM : 19,
      tileSize: 256,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 1,
    });
    if (isWx) {
      overlays[layer.id] = tile;
      if (layer.id === "precip") overlays.radar = tile;
    } else layers[layer.id] = tile;
  }
  (layers.dark || layers[activeLayer] || layers.osm || Object.values(layers)[0])?.addTo(map);
  if (layers.dark) activeLayer = "dark";
  activeWxProduct = overlays.precip ? "precip" : WX_PRODUCTS.find((id) => overlays[id]) || "precip";
  activeOverlays = new Set([activeWxProduct]);
  applyOverlays();
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    if (pin) pin.setLatLng(e.latlng);
    else pin = window.L.marker(e.latlng).addTo(map);
    if (onTap) onTap(lat, lng);
  });
  map.on("moveend", () => {
    if (activeWxProduct === "wind") refreshWindField();
  });
  setTimeout(() => {
    try {
      map?.invalidateSize?.(true);
    } catch {
      /* ignore */
    }
  }, 80);
  return map;
}

export function setMapLayer(id) {
  if (!map) return;
  if (id === "radar") id = "precip";
  if (id === "clouds") id = "cloud";
  if (WX_PRODUCTS.includes(id) || overlays[id] || id === "hail") {
    activeWxProduct = id;
    activeOverlays = new Set([id]);
    applyOverlays();
    // Hail product focuses the map on zones; redraw if we already have rows.
    if (id === "hail" && (lastHailRows.length || lastWindRows.length)) {
      drawHailMarkers(lastHailRows, lastWindRows);
    }
    return;
  }
  if (!layers[id]) return;
  Object.values(layers).forEach((l) => map.removeLayer(l));
  layers[id].addTo(map);
  applyOverlays();
  activeLayer = id;
}

export function flyToPin(lat, lon, zoom = 13) {
  if (!map || !window.L || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  map.setView([lat, lon], zoom);
  if (pin) pin.setLatLng([lat, lon]);
  else pin = window.L.marker([lat, lon]).addTo(map);
}

/** Forward geocode an address/place for WX search. */
export async function geocodeAddress(query) {
  const q = String(query || "").trim();
  if (q.length < 3) throw new Error("type a longer address");
  const looksStreet = /\d/.test(q) || /,/.test(q);
  const fromNominatim = async () => {
    const { body: nb } = await httpGet(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
      9000,
      { "User-Agent": "PipWeather/1.0 (joshuagwatts)" },
    );
    const hits = JSON.parse(nb || "[]");
    return hits.map((h) => ({
      lat: Number(h.lat),
      lon: Number(h.lon),
      address: h.display_name || q,
      city: String((h.address && (h.address.city || h.address.town || h.address.village)) || "").trim() || String(h.display_name || "").split(",")[0],
      source: "nominatim",
    }));
  };
  const fromMeteo = async () => {
    const { body } = await httpGet(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`,
      9000,
    );
    const results = JSON.parse(body || "{}").results || [];
    return results.map((h) => ({
      lat: Number(h.latitude),
      lon: Number(h.longitude),
      address: [h.name, h.admin1, h.country].filter(Boolean).join(", "),
      city: h.name || q,
      source: "open-meteo",
    }));
  };
  let hits = [];
  try {
    hits = looksStreet ? await fromNominatim() : await fromMeteo();
  } catch {
    hits = [];
  }
  if (!hits.length) {
    try {
      hits = looksStreet ? await fromMeteo() : await fromNominatim();
    } catch {
      hits = [];
    }
  }
  hits = hits.filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
  if (!hits.length) throw new Error("address not found");
  return hits;
}

function cutoffDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - Number(days || 180));
  return d.toISOString().slice(0, 10);
}

export function filterHailRaw(data, filters = wxFilters) {
  const since = cutoffDate(filters.days);
  const km = Number(filters.km) || 25;
  const hailMin = Number(filters.hailIn) || 0;
  const year = String(filters.year || "all");
  return (data.hail || []).filter((h) => {
    if (year !== "all") {
      if (!h.date || !String(h.date).startsWith(year)) return false;
    } else if (h.date && h.date < since) {
      return false;
    }
    if (h.distance_km != null && h.distance_km > km) return false;
    const sz = parseFloat(h.size_in);
    return Number.isNaN(sz) || sz >= hailMin;
  });
}

export function filterDossier(data, filters = wxFilters) {
  const since = cutoffDate(filters.days);
  const km = Number(filters.km) || 25;
  const windMin = Number(filters.windMph) || 0;
  const year = String(filters.year || "all");
  const sort = String(filters.sort || "date");
  let hailRaw = filterHailRaw(data, filters);
  // One extremeness tag per date (HailTrace-style).
  let hail = collapseHailByDate(hailRaw);
  if (sort === "size") {
    hail = [...hail].sort(
      (a, b) => (parseFloat(b.size_in) || 0) - (parseFloat(a.size_in) || 0) || String(b.date).localeCompare(String(a.date)),
    );
  } else {
    hail = [...hail].sort(
      (a, b) => String(b.date).localeCompare(String(a.date)) || (parseFloat(b.size_in) || 0) - (parseFloat(a.size_in) || 0),
    );
  }
  const windRaw = (data.wind || []).filter((w) => {
    if (year !== "all") {
      if (!w.date || !String(w.date).startsWith(year)) return false;
    } else if (w.date && w.date < since) {
      return false;
    }
    if (w.distance_km != null && w.distance_km > km) return false;
    return (Number(w.wind_mph) || 0) >= windMin;
  });
  // One wind max per date.
  const windByDay = new Map();
  for (const w of windRaw) {
    const day = String(w.date || "").slice(0, 10);
    const prev = windByDay.get(day);
    if (!prev || (Number(w.wind_mph) || 0) > (Number(prev.wind_mph) || 0)) windByDay.set(day, { ...w, date: day });
  }
  const wind = [...windByDay.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const archiveStorms = (data.storms || []).filter(
    (s) =>
      (s.source || "").includes("open-meteo") ||
      (s.reasons || []).some((r) => /precip|thunder|storm|Weather/i.test(r)),
  );
  let storms = enrichStormDates(archiveStorms, hailRaw, windRaw);
  storms = storms.filter((s) => {
    if (year !== "all") {
      if (!s.date || !String(s.date).startsWith(year)) return false;
    } else if (s.date && s.date < since) {
      return false;
    }
    if ((Number(s.wind_mph) || 0) < windMin && !(s.reasons || []).some((r) => /hail|thunder|EXTREME|SEVERE|STRONG|MOD/i.test(r))) {
      return (Number(s.wind_mph) || 0) >= windMin || (Number(s.precip_mm) || 0) >= 25;
    }
    return true;
  });
  if (sort === "size") {
    storms = [...storms].sort((a, b) => {
      const as = parseFloat(a.hail_in) || Number(a.wind_mph) || a.score || 0;
      const bs = parseFloat(b.hail_in) || Number(b.wind_mph) || b.score || 0;
      return bs - as || String(b.date).localeCompare(String(a.date));
    });
  }
  return { hail, wind, storms };
}

export function renderDossier(root, data, esc, onResearch, onRefetch) {
  const news = data.news || [];
  const addr = data.address || "";
  const zurl = data.zillow_url || (addr ? zillowUrl(addr) : "");
  const meta = data._meta || {};
  const { hail, wind, storms } = filterDossier(data, wxFilters);
  const hailRaw = filterHailRaw(data, wxFilters);
  if (!selectedStormDate && hail.length) {
    selectedStormDate = hail[0]?.date || null;
  }
  const years = [
    ...new Set((data.hail || []).map((h) => String(h.date || "").slice(0, 4)).filter((y) => /^\d{4}$/.test(y))),
  ].sort((a, b) => b.localeCompare(a));
  const alert =
    data.weather && data.weather.severity && data.weather.severity.line
      ? `<div class="wx-alert ${esc(data.weather.severity.level || "")}">${esc(data.weather.severity.line)}</div>`
      : "";
  root.innerHTML = `
    <div class="wx-dossier">
      <div class="wx-addr">${esc(addr)}</div>
      <div id="wx-summary" class="wx-summary-host"></div>
      <div id="wx-hourly" class="wx-hourly"></div>
      ${alert}
      ${renderStormGraph(hail, esc, selectedStormDate)}
      <div class="wx-links">
        ${zurl ? `<a href="${esc(zurl)}" target="_blank" rel="noopener">ZILLOW SEARCH</a>` : ""}
        ${onResearch ? `<button type="button" id="wx-deep" class="primary">DEEP RESEARCH</button>` : ""}
      </div>
      <p class="muted wx-meta">${meta.deep ? `Deep scan · ${meta.fetchedDays || "?"}d · ${meta.fetchedKm || "?"} km` : "Quick scan · DEEP RESEARCH for hail zones + news · Rock/shingle ID lives under CHAT → LENS"}</p>
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
          <option value="1.5"${wxFilters.hailIn == 1.5 ? " selected" : ""}>1.5"</option>
          <option value="2"${wxFilters.hailIn == 2 ? " selected" : ""}>2"</option>
        </select></label>
        <label>WIND ≥ <select id="wx-f-wind">
          <option value="0"${wxFilters.windMph == 0 ? " selected" : ""}>any</option>
          <option value="38"${wxFilters.windMph == 38 ? " selected" : ""}>38 mph</option>
          <option value="50"${wxFilters.windMph == 50 ? " selected" : ""}>50 mph</option>
          <option value="58"${wxFilters.windMph == 58 ? " selected" : ""}>58 mph</option>
        </select></label>
        <label>WINDOW <select id="wx-f-days">
          <option value="30"${wxFilters.days == 30 ? " selected" : ""}>30d</option>
          <option value="90"${wxFilters.days == 90 ? " selected" : ""}>90d</option>
          <option value="180"${wxFilters.days == 180 ? " selected" : ""}>180d</option>
          <option value="365"${wxFilters.days == 365 ? " selected" : ""}>1y</option>
        </select></label>
        <label>YEAR <select id="wx-f-year">
          <option value="all"${wxFilters.year === "all" || !wxFilters.year ? " selected" : ""}>all</option>
          ${years.map((y) => `<option value="${esc(y)}"${String(wxFilters.year) === y ? " selected" : ""}>${esc(y)}</option>`).join("")}
        </select></label>
        <label>SORT <select id="wx-f-sort">
          <option value="date"${wxFilters.sort !== "size" ? " selected" : ""}>chrono</option>
          <option value="size"${wxFilters.sort === "size" ? " selected" : ""}>extreme ★</option>
        </select></label>
      </div>
      <div class="wx-contacts">
        ${data.owner_name ? `<div>Owner: ${esc(data.owner_name)}</div>` : ""}
        ${data.owner_phone ? `<div>Phone: ${esc(data.owner_phone)}</div>` : ""}
        ${data.owner_email ? `<div>Email: ${esc(data.owner_email)}</div>` : ""}
      </div>
      <h4>HAIL TRACE · ${hail.length} DAYS${selectedStormDate ? ` · MAP ${esc(selectedStormDate)}` : ""}</h4>
      <div class="wx-hail-legend muted">Tap a storm-date bar (or row) → topo zones on map · ☆ light → ★★★★★ 3"+</div>
      <div class="wx-hail">${
        hail.length
          ? hail
              .slice(0, 36)
              .map((h) => {
                const stars = h.stars || hailStars(h.size_in);
                const sev = h.severity || hailSeverityLabel(h.size_in);
                const src =
                  h.source === "mixed"
                    ? "ZONE"
                    : h.source === "noaa-swdi-radar"
                      ? "RADAR"
                      : h.source === "iem-lsr"
                        ? "LSR"
                        : "SPOT";
                const on = selectedStormDate === h.date ? " on" : "";
                return `<div class="wx-hail-row sev-${esc(String(sev).toLowerCase())}${on}" data-storm-date="${esc(h.date)}">
          <span class="stars">${esc(stars)}</span>
          <span class="date">${esc(h.date)}</span>
          <span class="size">${esc(h.size_in)}"</span>
          <span class="sev">${esc(sev)}</span>
          <span class="src">${esc(src)}</span>
          <span class="dist">${esc(String(h.distance_km ?? "—"))} km</span>
          <span class="loc">${esc(h.hits || 1)} hit${(h.hits || 1) === 1 ? "" : "s"}${h.zone_r_km ? ` · ~${esc(String(h.zone_r_km))}km zone` : ""}</span>
        </div>`;
              })
              .join("")
          : `<p class="muted">No hail days this close after filters. Widen NEAR, drop HAIL ≥, or change YEAR.</p>`
      }</div>
      <h4>WIND NEAR PIN</h4>
      <div class="wx-wind">${
        wind.length
          ? wind
              .slice(0, 12)
              .map(
                (w) => `
        <div class="wx-hail-row"><span class="date">${esc(w.date)}</span>
        <span class="size">${esc(String(w.wind_mph))} mph</span>
        <span class="dist">${esc(String(w.distance_km))} km</span>
        ${esc(w.location)}, ${esc(w.state)}</div>`,
              )
              .join("")
          : `<p class="muted">No wind reports this close after filters.</p>`
      }</div>
      <h4>STORM DATES (THIS PIN)</h4>
      <div class="wx-storms">${
        storms.length
          ? storms
              .slice(0, 16)
              .map(
                (s) => `
        <div class="wx-storm"><span class="date">${esc(s.date)}</span> <span class="score">${esc(String(s.hail_in ? `${s.hail_in}"` : s.wind_mph || s.score))}${s.hail_in ? "" : s.wind_mph ? " mph" : ""}</span> ${esc((s.reasons || []).join(" · ") || s.label)}</div>`,
              )
              .join("")
          : `<p class="muted">No storm days at this pin after filters.</p>`
      }</div>
      <h4>NEWS</h4>
      <div class="wx-news">${
        news.length
          ? news
              .slice(0, 8)
              .map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>`)
              .join("")
          : `<p class="muted">News pulls on deep research.</p>`
      }</div>
    </div>`;
  const btn = root.querySelector("#wx-deep");
  if (btn && onResearch) btn.onclick = onResearch;
  const onStormPick = (date) => {
    selectStormDate(date, { fit: true });
    drawHailMarkers(hailRaw, wind, { fit: true });
    renderDossier(root, data, esc, onResearch, onRefetch);
  };
  bindStormGraph(root, onStormPick);
  root.querySelectorAll(".wx-hail-row[data-storm-date]").forEach((row) => {
    row.onclick = () => onStormPick(row.getAttribute("data-storm-date"));
  });
  const bind = (id, key, cast) => {
    const el = root.querySelector(id);
    if (!el) return;
    el.onchange = async () => {
      wxFilters[key] = cast(el.value);
      const needRefetch =
        onRefetch &&
        ((key === "days" && Number(wxFilters.days) > (meta.fetchedDays || 0)) ||
          (key === "km" && Number(wxFilters.km) > (meta.fetchedKm || 0)));
      if (needRefetch) {
        root.querySelector(".wx-meta").textContent = "Refetching storm data…";
        try {
          const fresh = await onRefetch({ ...wxFilters });
          if (fresh) {
            renderDossier(root, fresh, esc, onResearch, onRefetch);
            const f = filterDossier(fresh, wxFilters);
            drawHailMarkers(filterHailRaw(fresh, wxFilters), f.wind, { fit: true });
            return;
          }
        } catch {
          /* fall through to re-filter */
        }
      }
      renderDossier(root, data, esc, onResearch, onRefetch);
      const f = filterDossier(data, wxFilters);
      drawHailMarkers(filterHailRaw(data, wxFilters), f.wind, { fit: true });
    };
  };
  bind("#wx-f-km", "km", Number);
  bind("#wx-f-hail", "hailIn", Number);
  bind("#wx-f-wind", "windMph", Number);
  bind("#wx-f-days", "days", Number);
  bind("#wx-f-year", "year", String);
  bind("#wx-f-sort", "sort", String);
  const lat = Number(data.lat || meta.lat);
  const lon = Number(data.lon || meta.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    fetchWeatherBundle(lat, lon)
      .then((bundle) => {
        const sum = root.querySelector("#wx-summary");
        if (sum) sum.innerHTML = weatherSummaryHtml(bundle, hail, esc);
        if (bundle?.hours?.length) renderHourlyTimeline(root.querySelector("#wx-hourly"), bundle, esc);
      })
      .catch(() => {});
  }
}

export function layerButtons(config, esc) {
  const bases = (config.layers || []).filter((l) => l.kind !== "overlay" && l.kind !== "wx");
  const wx = (config.layers || []).filter((l) => l.kind === "wx" || l.kind === "overlay");
  const baseBtns = (bases.length ? bases : [])
    .map((l) => `<button type="button" data-layer="${esc(l.id)}" class="${l.id === activeLayer ? "on" : ""}">${esc(l.label)}</button>`)
    .join("");
  const wxBtns = wx
    .map((l) => {
      const id = l.id === "radar" ? "precip" : l.id === "clouds" ? "cloud" : l.id;
      const on = activeWxProduct === id;
      return `<button type="button" data-layer="${esc(id)}" class="wx-product ${on ? "on" : ""}">${esc(l.label)}</button>`;
    })
    .join("");
  const scrub = radarScrubberHtml();
  const row = wxBtns ? `${baseBtns}<span class="wx-split"></span>${wxBtns}` : baseBtns;
  return scrub ? `${row}${scrub}` : row;
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
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const c = await getCenter();
      if (stopped || !c?.lat) return;
      const live = await fetchLiveWeather(c.lat, c.lon);
      if (stopped || !live.severity?.crummy) return;
      const id = (live.alerts[0] && live.alerts[0].id) || `${live.severity.level}:${live.label}`;
      if (id === lastId) return;
      lastId = id;
      onAlert(live);
    } catch {
      /* keep watching while WX tab is open */
    }
  };
  // Defer first tick so map paint isn't competing with weather fetches.
  const kick = setTimeout(tick, 2500);
  const iv = setInterval(tick, everyMs);
  return {
    stop() {
      stopped = true;
      clearTimeout(kick);
      clearInterval(iv);
    },
  };
}
