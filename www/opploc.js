/** OPP location + radius — Indeed-style near→far hunt for phone Pip. */

import { geocodeAddress } from "./wx.js";
import { classify } from "./kind.js";

export const RADIUS_OPTS = [
  { id: 40, label: "25 mi" },
  { id: 80, label: "50 mi" },
  { id: 160, label: "100 mi" },
  { id: 400, label: "250 mi" },
  { id: 0, label: "STATE" },
  { id: -1, label: "ANY" },
];

export const SORT_OPTS = [
  { id: "near", label: "NEAR → FAR" },
  { id: "fit", label: "BEST FIT" },
  { id: "new", label: "NEWEST" },
];

const PLACE_ALIASES = {
  okc: "Oklahoma City, Oklahoma, United States",
  "oklahoma city": "Oklahoma City, Oklahoma, United States",
  tulsa: "Tulsa, Oklahoma, United States",
  edmond: "Edmond, Oklahoma, United States",
  norman: "Norman, Oklahoma, United States",
  stillwater: "Stillwater, Oklahoma, United States",
  lawton: "Lawton, Oklahoma, United States",
  dfw: "Dallas, Texas, United States",
  dallas: "Dallas, Texas, United States",
  austin: "Austin, Texas, United States",
  houston: "Houston, Texas, United States",
  denver: "Denver, Colorado, United States",
  "kansas city": "Kansas City, Missouri, United States",
  kc: "Kansas City, Missouri, United States",
};

const TYPE_HINTS = [
  [/festival\s+install|art\s+install|installation/i, "festival_install"],
  [/mural|live\s*paint|festival\s+artist/i, "festival_artist"],
  [/\bvj\b|live\s+visual|visualist/i, "vj_booking"],
  [/public\s+art|rfp|rfq|percent\s+for\s+art/i, "city_art"],
  [/\bdj\b|musician|band\s+app|epk/i, "music"],
  [/\bjob\b|hiring|career|resume\b/i, "job"],
  [/festival/i, "festival_install"],
];

function milesToKm(mi) {
  return Math.round(Number(mi) * 1.60934);
}

/** Pull focus / near / radius / type from free text or OPP search box. */
export function parseHuntIntent(text, kit = {}) {
  let raw = String(text || "").trim();
  let radiusKm = null;
  let near = "";
  let type = "all";

  for (const [re, id] of TYPE_HINTS) {
    if (re.test(raw)) {
      type = id;
      break;
    }
  }

  let m = raw.match(/\bwithin\s+(\d+)\s*(km|kilometers?|mi|miles?)\b/i);
  if (m) {
    radiusKm = /mi/i.test(m[2]) ? milesToKm(m[1]) : Number(m[1]);
    raw = raw.replace(m[0], " ").replace(/\s+/g, " ").trim();
  }
  m = raw.match(/\b(\d+)\s*(km|kilometers?|mi|miles?)\s+(?:of|from|around)\b/i);
  if (m && radiusKm == null) {
    radiusKm = /mi/i.test(m[2]) ? milesToKm(m[1]) : Number(m[1]);
    raw = raw.replace(m[0], " ").replace(/\s+/g, " ").trim();
  }

  m = raw.match(/\b(?:near|around|by|in|outside)\s+([A-Za-z][A-Za-z .'-]{1,40})(?:\s*,\s*([A-Za-z]{2,}))?\b/i);
  if (m) {
    near = [m[1], m[2]].filter(Boolean).join(", ").trim();
    raw = raw.replace(m[0], " ").replace(/\s+/g, " ").trim();
  }

  // "OKC festivals" / leading place token
  if (!near) {
    m = raw.match(/^\s*([A-Za-z]{2,12})\s+(festival|open call|rfp|vj|mural|art|gig)/i);
    if (m && PLACE_ALIASES[m[1].toLowerCase()]) {
      near = m[1];
      raw = raw.replace(m[1], "").replace(/\s+/g, " ").trim();
    }
  }

  const aliasKey = near.toLowerCase().replace(/\./g, "").trim();
  if (PLACE_ALIASES[aliasKey]) near = PLACE_ALIASES[aliasKey];

  const kitCity = String(kit.city || "").trim();
  const kitState = String(kit.state || "").trim();
  const kitCountry = String(kit.country || "").trim() || "United States";

  let city = kitCity;
  let state = kitState;
  let country = kitCountry;
  if (near) {
    const parts = near.split(",").map((p) => p.trim()).filter(Boolean);
    city = parts[0] || city;
    if (parts[1]) state = parts[1];
    if (parts[2]) country = parts[2];
  }

  const focus = raw
    .replace(/\b(search|hunt|find|look)\s+(for\s+)?/gi, " ")
    .replace(/\b(opportunit(y|ies)|open calls?|gigs?|applications?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    focus: focus || (type !== "all" ? classify("", "", []).label : "open call apply"),
    near: near || [city, state].filter(Boolean).join(", "),
    city,
    state,
    country,
    radiusKm: radiusKm == null ? 80 : radiusKm,
    type,
  };
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Resolve hunt hub to lat/lon. */
export async function resolveHuntHub({ city, state, country, near } = {}) {
  const q = [near || [city, state, country].filter(Boolean).join(", ")].filter(Boolean)[0];
  if (!q) return null;
  try {
    const hits = await geocodeAddress(q);
    const hit = Array.isArray(hits) ? hits[0] : hits;
    if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lon)) return null;
    return {
      lat: hit.lat,
      lon: hit.lon,
      label: hit.address || hit.city || q,
      city: hit.city || city || "",
    };
  } catch {
    return null;
  }
}

/** Place rings ordered near → far for query generation. */
export function huntPlaceRings({ city, state, country, radiusKm = 80 } = {}) {
  const c = String(city || "").trim();
  const s = String(state || "").trim();
  const nat = String(country || "").trim() || "United States";
  const rings = [];
  if (c && s) rings.push({ place: `${c}, ${s}`, ring: 0, label: "CITY" });
  else if (c) rings.push({ place: c, ring: 0, label: "CITY" });
  if (radiusKm > 0 && radiusKm <= 100 && s) {
    rings.push({ place: `${s} near ${c || s}`, ring: 1, label: "METRO" });
  }
  if (radiusKm === 0 || radiusKm >= 80 || radiusKm === -1) {
    if (s && !rings.some((r) => r.place.toLowerCase() === s.toLowerCase())) {
      rings.push({ place: s, ring: 2, label: "STATE" });
    }
  }
  if (radiusKm === -1 || radiusKm >= 250) {
    if (nat) rings.push({ place: nat, ring: 3, label: "COUNTRY" });
  }
  if (!rings.length) {
    rings.push({ place: "Oklahoma", ring: 2, label: "STATE" });
    rings.push({ place: "United States", ring: 3, label: "COUNTRY" });
  }
  return rings;
}

/** Guess distance band from title/note using hub city/state tokens. */
export function estimateRing(hit, { city, state } = {}) {
  const blob = `${hit.title || ""} ${hit.note || ""} ${hit.url || ""}`.toLowerCase();
  const c = String(city || "").toLowerCase();
  const s = String(state || "").toLowerCase();
  if (c && blob.includes(c.split(",")[0])) return 0;
  if (s && (blob.includes(s) || blob.includes(s.slice(0, 4)))) return 2;
  if (hit.ring != null) return Number(hit.ring);
  return 4;
}

export function formatDist(km) {
  if (!Number.isFinite(km)) return "";
  const mi = km / 1.60934;
  if (mi < 1) return "<1 mi";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

export function sortOpps(rows, sort = "near", kit = {}) {
  const list = [...(rows || [])];
  if (sort === "new") {
    return list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }
  if (sort === "fit") {
    return list.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0) || (b.created_at || 0) - (a.created_at || 0));
  }
  // near → far
  return list.sort((a, b) => {
    const da = Number.isFinite(a.distance_km) ? a.distance_km : (a.ring ?? 9) * 100;
    const db = Number.isFinite(b.distance_km) ? b.distance_km : (b.ring ?? 9) * 100;
    if (da !== db) return da - db;
    return (b.fitScore || 0) - (a.fitScore || 0);
  });
}

/** Tag hunt hits with ring / distance for sorting. */
export function tagHuntHits(hits, hub, placeCtx) {
  return (hits || []).map((h) => {
    const ring = h.ring != null ? h.ring : estimateRing(h, placeCtx);
    let distance_km = h.distance_km;
    if (!Number.isFinite(distance_km) && hub && Number.isFinite(h.lat) && Number.isFinite(h.lon)) {
      distance_km = haversineKm(hub.lat, hub.lon, h.lat, h.lon);
    }
    // Soft distance from ring when no coords
    if (!Number.isFinite(distance_km)) {
      distance_km = [15, 60, 200, 800, 2000][Math.min(ring, 4)];
    }
    return {
      ...h,
      ring,
      distance_km,
      distance_label: formatDist(distance_km),
      near_label: placeCtx.city || placeCtx.near || "",
    };
  });
}
