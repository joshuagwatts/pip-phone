/** Hitchhiker's Guide — live Wikipedia lookups + on-device cache of what you've read. */

import { httpGet } from "./net.js";

const CACHE_KEY = "pip.guide.cache.v1";
const CACHE_MAX = 120;

const GUIDE_QUERY =
  /^(?:what(?:'s| is| are)|who(?:'s| is| are)|tell me about|define|explain|lookup|look up|wiki(?:pedia)?(?: on| about)?|guide(?: me on| entry on)?)\s+(.+?)[.?!]*$/i;
const GUIDE_INLINE = /\b(?:what is|who is|tell me about)\s+([a-z0-9][a-z0-9\s,'-]{2,80})/i;

function loadCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveCache(rows) {
  localStorage.setItem(CACHE_KEY, JSON.stringify((rows || []).slice(0, CACHE_MAX)));
}

export function guideEntries() {
  return loadCache();
}

function remember(entry) {
  if (!entry?.title) return entry;
  const rows = loadCache().filter((r) => r.title !== entry.title);
  rows.unshift({ ...entry, at: new Date().toISOString() });
  saveCache(rows);
  return entry;
}

export function extractGuideQuery(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const m1 = t.match(GUIDE_QUERY);
  if (m1) return m1[1].trim().replace(/^the\s+/i, "");
  const m2 = t.match(GUIDE_INLINE);
  if (m2) return m2[1].trim().replace(/^the\s+/i, "");
  if (/^guide[:\s]/i.test(t)) return t.replace(/^guide[:\s]+/i, "").trim();
  return "";
}

export function looksLikeGuideQuery(text) {
  return Boolean(extractGuideQuery(text)) || /^guide[:\s]/i.test(String(text || "").trim());
}

export async function searchWiki(query, limit = 8) {
  const q = String(query || "").trim();
  if (!q) return [];
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: q,
    srlimit: String(limit),
    format: "json",
    origin: "*",
  })}`;
  const { body } = await httpGet(url, 12000);
  const data = JSON.parse(body || "{}");
  return (data.query?.search || []).map((r) => ({
    title: r.title,
    snippet: String(r.snippet || "").replace(/<[^>]+>/g, ""),
  }));
}

export async function fetchWikiSummary(title) {
  const slug = encodeURIComponent(String(title || "").trim().replace(/ /g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
  const { body, status } = await httpGet(url, 12000);
  if (status === 404) return null;
  const data = JSON.parse(body || "{}");
  if (data.type === "disambiguation") {
    const picks = await searchWiki(title, 5);
    return {
      title: data.title || title,
      extract: `Disambiguation — pick one: ${picks.map((p) => p.title).join(", ")}`,
      url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`,
      disambiguation: true,
      picks,
    };
  }
  return remember({
    title: data.title || title,
    extract: String(data.extract || data.description || "").trim(),
    url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`,
    thumb: data.thumbnail?.source || "",
    source: "wikipedia",
  });
}

export async function lookupGuide(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const cached = loadCache().find((r) => r.title.toLowerCase() === q.toLowerCase());
  if (cached?.extract) return cached;
  let hit = await fetchWikiSummary(q);
  if (hit?.extract) return hit;
  const picks = await searchWiki(q, 1);
  if (picks[0]?.title) hit = await fetchWikiSummary(picks[0].title);
  return hit;
}

export function formatGuideReply(entry) {
  if (!entry?.extract) return "Don't Panic — Wikipedia didn't have that one. Try another spelling.";
  const lead = entry.extract.length > 520 ? `${entry.extract.slice(0, 517)}…` : entry.extract;
  return `Don't Panic. The Guide says:\n\n${lead}\n\n— Wikipedia · ${entry.title}`;
}

export function guideBrief(entry) {
  if (!entry?.extract) return "";
  return `Guide entry (${entry.title}): ${entry.extract.slice(0, 900)}`;
}

export async function tryGuideCommand(text) {
  const q = extractGuideQuery(text);
  if (!q) return null;
  try {
    const entry = await lookupGuide(q);
    if (!entry?.extract) {
      return { ok: false, reply: `No Guide entry for "${q}". Try GUIDE tab search.` };
    }
    return {
      ok: true,
      reply: formatGuideReply(entry),
      entry,
      switchTab: "guide",
    };
  } catch (e) {
    return { ok: false, reply: `Guide lookup failed — ${String(e.message || e).slice(0, 80)}` };
  }
}

export function guideContextLine(entry) {
  if (!entry?.extract) return "";
  return `Wikipedia (${entry.title}): ${entry.extract.slice(0, 1200)}`;
}
