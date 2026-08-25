/** Opportunity desk — search, fit scoring, desktop sync, chat commands. */
import { desktopConfigured } from "./desktop.js";
import { httpLanGet, httpLanPostJson } from "./net.js";
import { classify, labelOf } from "./kind.js";
import { hunt as localHunt, scrapeUrl, newOpp, suggestAnswers } from "./opp.js";
import {
  parseHuntIntent,
  huntPlaceRings,
  resolveHuntHub,
  tagHuntHits,
  sortOpps,
  RADIUS_OPTS,
  SORT_OPTS,
} from "./opploc.js";

export { RADIUS_OPTS, SORT_OPTS, parseHuntIntent, sortOpps };

export const APP_STAGES = [
  { id: "new", label: "New" },
  { id: "scraped", label: "Scraped" },
  { id: "drafted", label: "Drafted" },
  { id: "submitted", label: "Submitted" },
  { id: "interview", label: "Interview" },
  { id: "rejected", label: "Rejected" },
];

export function stageLabel(id) {
  return APP_STAGES.find((s) => s.id === id)?.label || id || "New";
}

export const OPP_TYPES = [
  { id: "all", label: "All" },
  { id: "festival_install", label: "Install" },
  { id: "festival_artist", label: "Mural" },
  { id: "city_art", label: "Public art" },
  { id: "vj_booking", label: "VJ" },
  { id: "music", label: "Music" },
  { id: "job", label: "Job" },
  { id: "other", label: "Other" },
];

const HUNT_CMD =
  /^(?:search|hunt|find)\s+(?:for\s+)?(.+?)(?:\s+(?:opportunit(?:y|ies)|open\s+calls?|gigs?|jobs?|applications?))?[.!?]*$/i;
const HUNT_BARE = /^(?:hunt|search)\s+(?:open\s+)?calls?[.!?]*$/i;
const HUNT_NATURAL =
  /\b(festival|open\s+call|rfp|rfq|vj|mural|install|public\s+art|residency|grant).{0,40}\b(near|around|within|in)\b/i;
const SCRAPE_CMD = /\b(?:scrape|read|add|open)\b/i;
const DRAFT_CMD = /\b(?:draft|fill|complete)\s+(?:this|my|the)?\s*(?:application|form|opp)?/i;

function lanHeaders(settings) {
  const tok = String(settings.desktop_token || "").trim();
  return tok ? { Cookie: `pip_gate=${tok}` } : {};
}

function lanBase(settings) {
  return String(settings.desktop_url || "").replace(/\/+$/, "");
}

export function scoreFit(opp, kit = {}) {
  const kind = opp.kind || classify(opp.title, opp.url, opp.questions).id;
  const titleBlob = `${opp.title || ""} ${opp.note || ""}`.toLowerCase();
  const profileBlob = [
    kit.one_liner,
    kit.materials,
    kit.bio_short,
    kit.why_festivals,
    kit.resume,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 35;
  const reasons = [];
  const qn = (opp.questions || []).length;
  if (qn) {
    score += Math.min(20, 8 + qn);
    reasons.push(`${qn} Q scraped`);
  } else if (opp.url) {
    score += 4;
    reasons.push("needs scrape");
  }
  const tokens = profileBlob
    .split(/\W+/)
    .filter((w) => w.length > 4)
    .slice(0, 24);
  let hits = 0;
  for (const tok of tokens) {
    if (titleBlob.includes(tok)) {
      hits += 1;
      if (reasons.length < 3) reasons.push(tok);
    }
  }
  score += Math.min(25, hits * 4);
  const city = String(kit.city || "").trim().toLowerCase();
  const state = String(kit.state || "").trim().toLowerCase();
  if (city && titleBlob.includes(city)) {
    score += 12;
    reasons.push("near you");
  } else if (state && titleBlob.includes(state)) {
    score += 8;
    reasons.push(state);
  }
  if (kind === "job" && /festival|mural|installation/i.test(profileBlob) && !/job|hiring|studio/i.test(profileBlob)) {
    score -= 8;
  }
  if (/wakaan|festival|install|vj|visual/i.test(titleBlob) && /visual|vj|install|festival|projection/i.test(profileBlob)) {
    score += 10;
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, kind };
}

export function fitLabel(score) {
  if (score >= 75) return { text: "STRONG FIT", cls: "fit-high" };
  if (score >= 55) return { text: "GOOD FIT", cls: "fit-mid" };
  if (score >= 40) return { text: "MAYBE", cls: "fit-low" };
  return { text: "CHECK", cls: "fit-low" };
}

export function filterOpps(rows, { query = "", type = "all", sort = "near" } = {}, kit = {}) {
  const q = String(query || "").trim().toLowerCase();
  // Strip location noise from list filter so "festivals near OKC" still matches festival titles.
  const intent = parseHuntIntent(query, kit);
  const filterQ = String(intent.focus || q)
    .toLowerCase()
    .replace(/\b(near|around|within|mi|miles|km)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const mapped = (rows || [])
    .map((o) => {
      const fit = scoreFit(o, kit);
      return {
        ...o,
        fitScore: o.fitScore ?? fit.score,
        fitReasons: fit.reasons,
        kind: o.kind || fit.kind,
        ring: o.ring,
        distance_km: o.distance_km,
        distance_label: o.distance_label,
      };
    })
    .filter((o) => {
      if (type !== "all" && (o.kind || "other") !== type) return false;
      if (!filterQ) return true;
      const blob = `${o.title} ${o.note || ""} ${o.url || ""} ${labelOf(o.kind)}`.toLowerCase();
      return filterQ.split(/\s+/).filter((w) => w.length > 2).every((w) => blob.includes(w)) || blob.includes(filterQ);
    });
  return sortOpps(mapped, sort, kit);
}

export function looksLikeOppRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/https?:\/\//i.test(t) && SCRAPE_CMD.test(t)) return true;
  if (HUNT_BARE.test(t) || HUNT_CMD.test(t) || HUNT_NATURAL.test(t)) return true;
  if (DRAFT_CMD.test(t) && /\b(opp|application|form|call)\b/i.test(t)) return true;
  if (/\b(search|hunt|find)\b.+?\b(opportunit|open call|gig|rfp|residency|grant|job|festival)\b/i.test(t)) return true;
  if (/\bfestivals?\b.+\b(near|around|okc|tulsa|oklahoma)\b/i.test(t)) return true;
  return false;
}

function mapDesktopOpp(row) {
  return {
    id: String(row.phone_id || row.id),
    remote_id: row.id,
    phone_id: String(row.phone_id || row.id),
    title: row.title || "Untitled",
    url: row.url || "",
    note: row.note || "",
    status: row.status || "open",
    kind: row.call_type || row.kind || classify(row.title, row.url, row.questions).id,
    app_stage: row.app_stage || "new",
    fit_score: row.fit_score || 0,
    submitted_at: row.submitted_at || "",
    questions: row.questions || [],
    answers: (row.answers || []).map((a) => ({
      q: a.q || a.question || "",
      a: a.a || a.answer || "",
      a5: a.a5 || "",
      type: a.type,
    })),
    brief: row.brief,
    deadline: row.deadline,
    due_label: row.due_label,
    created_at: Date.parse(row.updated_at || row.created_at || "") || Date.now(),
    updated_at: row.updated_at || "",
    _remote: true,
    _remoteId: row.id,
  };
}

export function phoneOppPayload(db) {
  return (db.opps || [])
    .filter((o) => o.status !== "done" || o.app_stage === "submitted" || o.app_stage === "interview")
    .map((o) => {
      const fit = scoreFit(o, db.kit);
      return {
        phone_id: String(o.id),
        id: String(o.id),
        title: o.title,
        url: o.url,
        note: o.note,
        status: o.status,
        kind: o.kind,
        app_stage: o.app_stage || (o.questions?.length ? "scraped" : "new"),
        fit_score: o.fitScore || fit.score,
        questions: o.questions || [],
        answers: o.answers || [],
        updated_at: o.updated_at ? new Date(o.updated_at).toISOString() : new Date(o.created_at || Date.now()).toISOString(),
      };
    });
}

export async function pushOppsToDesktop(settings, db) {
  if (!desktopConfigured(settings)) return { pushed: 0 };
  const out = await httpLanPostJson(
    `${lanBase(settings)}/api/opp/sync`,
    lanHeaders(settings),
    { opps: phoneOppPayload(db) },
    120000,
  );
  return { pushed: out.pushed || 0, digest: out.digest };
}

export async function pullOppsFromDesktop(settings, db, since = "") {
  if (!desktopConfigured(settings)) return { pulled: 0 };
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  const rows = await httpLanGet(`${lanBase(settings)}/api/opp/sync${q}`, 20000, lanHeaders(settings));
  const list = rows.opportunities || rows || [];
  if (!Array.isArray(list)) return { pulled: 0 };
  let n = 0;
  const byPhone = new Map((db.opps || []).map((o) => [String(o.id), o]));
  const byUrl = new Map((db.opps || []).filter((o) => o.url).map((o) => [o.url, o]));
  for (const row of list) {
    const mapped = mapDesktopOpp(row);
    const prev = byPhone.get(mapped.phone_id) || (mapped.url && byUrl.get(mapped.url));
    if (prev) {
      Object.assign(prev, mapped, { id: prev.id });
      prev.fitScore = mapped.fit_score || prev.fitScore;
      n += 1;
    } else if (mapped.url || mapped.title) {
      db.opps.unshift(mapped);
      n += 1;
    }
  }
  db.opp_sync_at = new Date().toISOString();
  return { pulled: n };
}

export async function fullOppSync(settings, db) {
  const push = await pushOppsToDesktop(settings, db);
  const pull = await pullOppsFromDesktop(settings, db, db.opp_sync_at || "");
  return { pushed: push.pushed || 0, pulled: pull.pulled || 0, digest: push.digest };
}

export async function fetchOppDigest(settings, db) {
  if (!desktopConfigured(settings)) {
    db.opp_digest = buildLocalDigest(db);
    return db.opp_digest;
  }
  try {
    const d = await httpLanGet(`${lanBase(settings)}/api/opp/digest`, 12000, lanHeaders(settings));
    db.opp_digest = d;
    return d;
  } catch {
    db.opp_digest = buildLocalDigest(db);
    return db.opp_digest;
  }
}

function buildLocalDigest(db) {
  const rows = filterOpps((db.opps || []).filter((o) => o.status !== "done"), {}, db.kit);
  return {
    generated_at: new Date().toISOString().slice(0, 10),
    summary: `${rows.length} on phone`,
    top: rows.slice(0, 5).map((o) => ({
      id: o.id,
      title: o.title,
      fit_score: o.fitScore,
      app_stage: o.app_stage || "new",
    })),
  };
}

export async function setOppStage(settings, db, opp, stage) {
  opp.app_stage = stage;
  if (stage === "submitted") opp.submitted_at = new Date().toISOString().slice(0, 10);
  if (stage === "rejected") opp.status = "done";
  opp.updated_at = Date.now();
  if (desktopConfigured(settings) && opp._remoteId) {
    try {
      await httpLanPostJson(
        `${lanBase(settings)}/api/opp/${opp._remoteId}/stage`,
        lanHeaders(settings),
        { stage },
        15000,
      );
    } catch {
      /* local stage still set */
    }
  }
  await pushOppsToDesktop(settings, db);
}

export async function syncOppsFromDesktop(settings, db) {
  const out = await fullOppSync(settings, db);
  return { ok: true, synced: out.pulled + out.pushed };
}

export async function huntOpportunities(
  settings,
  kit,
  { focus = "", type = "all", radiusKm = 80, city, state, country, onProgress } = {},
) {
  const intent = parseHuntIntent(focus, kit);
  let focusLine = String(intent.focus || focus || "").trim();
  let huntType = type !== "all" ? type : intent.type || "all";
  if (huntType !== "all") {
    const label = labelOf(huntType).toLowerCase();
    if (!focusLine.toLowerCase().includes(label.split("/")[0])) {
      focusLine = `${focusLine} ${label}`.trim();
    }
  }
  const place = {
    city: city || intent.city || kit.city,
    state: state || intent.state || kit.state,
    country: country || intent.country || kit.country || "United States",
    near: intent.near,
  };
  const rKm = radiusKm != null ? radiusKm : intent.radiusKm;
  const rings = huntPlaceRings({ ...place, radiusKm: rKm });
  let hub = null;
  if (onProgress) onProgress(`LOCATE ${place.city || place.near || "…"}`);
  hub = await resolveHuntHub(place);

  if (desktopConfigured(settings)) {
    if (onProgress) onProgress("DESKTOP HUNT…");
    try {
      const loc = [place.city, place.state, place.country].filter(Boolean).join(", ");
      const out = await httpLanPostJson(
        `${lanBase(settings)}/api/opp/hunt`,
        lanHeaders(settings),
        {
          focus: focusLine,
          apply: false,
          kind: huntType !== "all" ? huntType : "",
          location: loc,
          radius_km: rKm > 0 ? rKm : null,
        },
        120000,
      );
      const rows = [];
      for (const item of out.logged || []) {
        try {
          const detail = await httpLanGet(`${lanBase(settings)}/api/opp/${item.id}`, 15000, lanHeaders(settings));
          rows.push(mapDesktopOpp(detail));
        } catch {
          rows.push(
            mapDesktopOpp({
              id: item.id,
              title: item.title,
              url: item.url,
              note: "hunted on desktop",
              questions: [],
            }),
          );
        }
      }
      const tagged = tagHuntHits(rows, hub, place);
      return { source: "desktop", out, rows: sortOpps(tagged, "near"), hub, place, radiusKm: rKm };
    } catch {
      /* fall through local */
    }
  }
  if (onProgress) onProgress("HUNTING…");
  const found = await localHunt(focusLine, {
    city: place.city,
    state: place.state,
    country: place.country,
    radiusKm: rKm,
    rings,
    onProgress,
  });
  const filtered =
    huntType === "all" ? found : found.filter((h) => classify(h.title, h.url, h.questions).id === huntType);
  const tagged = tagHuntHits(filtered, hub, place);
  return { source: "local", rows: sortOpps(tagged, "near"), out: { logged: tagged }, hub, place, radiusKm: rKm };
}

export async function scrapeOpportunityUrl(url, kit, { title = "", settings = null, draft = false } = {}) {
  const href = String(url || "").trim();
  if (!/^https?:\/\//i.test(href)) throw new Error("Need a real https URL");
  if (desktopConfigured(settings)) {
    try {
      const row = await httpLanPostJson(
        `${lanBase(settings)}/api/opp/scrape-url`,
        lanHeaders(settings),
        { url: href, title, draft },
        draft ? 180000 : 90000,
      );
      return mapDesktopOpp(row.opportunity || row);
    } catch {
      /* local scrape */
    }
  }
  const page = await scrapeUrl(href);
  const row = newOpp({
    title: title || page.title || href,
    url: page.url || href,
    note: page.questions?.length ? `Scraped ${page.questions.length} questions (${page.source || "page"}).` : "Scraped — paste questions if the wall won.",
    questions: page.questions || [],
    kind: classify(title || page.title, href, page.questions).id,
  });
  if (row.questions.length) {
    row.answers = suggestAnswers(row.questions, kit, row.title, row.kind);
  }
  return row;
}

export async function tryOppCommand(text, db, ctx = {}) {
  const t = String(text || "").trim();
  if (!looksLikeOppRequest(t)) return null;

  const urlMatch = t.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch && SCRAPE_CMD.test(t)) {
    const url = urlMatch[0].replace(/[.,;]+$/, "");
    return {
      ok: true,
      reply: `Scraping ${url.slice(0, 60)}… I'll pull the form questions onto OPP.`,
      switchTab: "opp",
      async run() {
        ctx.setStatus?.("SCRAPING…");
        const row = await scrapeOpportunityUrl(url, db.kit, { settings: db.settings, draft: /\bdraft\b/i.test(t) });
        const exists = db.opps.find((o) => o.url === row.url);
        if (exists) Object.assign(exists, row, { id: exists.id });
        else db.opps.unshift(row);
        ctx.persist?.();
        ctx.setOppId?.(row.id);
        ctx.setPane?.("call");
        ctx.render?.();
        ctx.setStatus?.(row.questions?.length ? `${row.questions.length} QUESTIONS · OPP` : "SCRAPED · CHECK OPP");
      },
    };
  }

  if (HUNT_BARE.test(t) || HUNT_CMD.test(t) || HUNT_NATURAL.test(t) || /\bfestivals?\b.+\b(near|around|okc)\b/i.test(t)) {
    const m = HUNT_CMD.exec(t);
    const rawFocus = (m && m[1] ? m[1] : t).trim();
    const intent = parseHuntIntent(rawFocus, db.kit);
    const where = intent.near || [intent.city, intent.state].filter(Boolean).join(", ");
    const rad =
      intent.radiusKm > 0
        ? ` · ~${Math.round(intent.radiusKm / 1.609)} mi`
        : intent.radiusKm === 0
          ? " · statewide"
          : "";
    return {
      ok: true,
      reply: intent.focus
        ? `Hunting ${intent.focus}${where ? ` near ${where}` : ""}${rad}. Near → far. Real open calls — I'll scrape forms that match your KIT.`
        : `Hunting profile-fit open calls${where ? ` near ${where}` : ""}${rad}.`,
      switchTab: "opp",
      async run() {
        ctx.setStatus?.("HUNTING…");
        if (intent.city) db.kit.city = intent.city;
        if (intent.state) db.kit.state = intent.state;
        if (intent.country) db.kit.country = intent.country;
        ctx.persist?.();
        const { rows } = await huntOpportunities(db.settings, db.kit, {
          focus: intent.focus || rawFocus,
          type: intent.type || "all",
          radiusKm: intent.radiusKm,
          city: intent.city,
          state: intent.state,
          country: intent.country,
          onProgress: ctx.setStatus,
        });
        let added = 0;
        for (const hit of rows) {
          if (db.opps.some((o) => o.url && hit.url && o.url === hit.url)) continue;
          const row = hit.id ? hit : newOpp(hit);
          row.ring = hit.ring;
          row.distance_km = hit.distance_km;
          row.distance_label = hit.distance_label;
          if (hit.questions?.length && !row.answers?.length) {
            row.answers = suggestAnswers(hit.questions, db.kit, row.title, row.kind);
          }
          db.opps.unshift(row);
          added += 1;
        }
        ctx.persist?.();
        ctx.setOppFilter?.({ q: intent.focus || rawFocus, type: intent.type || "all", sort: "near", radiusKm: intent.radiusKm });
        ctx.render?.();
        ctx.setStatus?.(added ? `FOUND ${added} · NEAR→FAR · OPP` : "HUNT DONE · OPP");
      },
    };
  }

  if (DRAFT_CMD.test(t)) {
    const sel = ctx.selected?.();
    if (!sel) {
      return {
        ok: true,
        reply: "Open an opportunity on OPP first — tap a call, then say draft this application.",
        switchTab: "opp",
      };
    }
    return {
      ok: true,
      reply: `Drafting answers for ${sel.title}. Switching to OPP.`,
      switchTab: "opp",
      async run() {
        await ctx.draftThis?.();
      },
    };
  }

  return null;
}
