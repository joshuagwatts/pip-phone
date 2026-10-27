/** Phone Pip chat reminders — desktop-style check-ins, on-device. No popups.
 *
 * Phase 2 (Briefing Engine, www/briefing.js): every on-device nudge now
 * carries its reason ("— why: …"), quiet hours come from settings
 * (default 22:00–07:00), and deliveries count against a 5/day cap.
 * Reasoned candidates from real state fire first; the LIFE pool is the
 * fallback and speaks in reasons too (session context, never invented
 * personal facts). The desktop presence path is untouched — a paired
 * desktop's own lines are its own voice. */

import { desktopConfigured, desktopToken } from "./desktop.js";
import { httpLanPostJson } from "./net.js";
import { snapshot as motivSnap } from "./motivation.js";
import { maybeLocalWakeLine } from "./morning.js";
import { mealSnapshot } from "./meals.js";
import {
  loadBriefState,
  inQuietHours,
  nudgeGate,
  noteNudgeDelivered,
  reasonedCandidates,
  getNudgeContext,
} from "./briefing.js";

const KEY = "pip.phone.nudge.v1";
const PRESENCE_TTL = 90 * 1000;
const SESSION_MIN = 8 * 60 * 1000;
const COOLDOWN = 25 * 60 * 1000;
const CHAT_GAP = 8 * 60 * 1000;

/** Life jazz — leap of faith, water, roses, the good stuff. */
const LIFE = [
  { kind: "water", line: "WATER · Drink a glass. The work will wait.", reason: "long sessions dull the edge; water is the cheapest fix there is" },
  { kind: "water", line: "WATER · Hydrate like you mean to finish the day.", reason: "you've been at it a while — hydration before depletion" },
  { kind: "roses", line: "ROSES · Go smell them. Seriously.", reason: "a minute outside resets more than another scroll does" },
  { kind: "roses", line: "ROSES · Step outside for one minute. Let the air hit.", reason: "screen time stacks up quietly; air breaks the stack" },
  { kind: "leap", line: "LEAP · Take a small leap of faith on the thing you've been circling.", reason: "circling costs more than a small attempt would" },
  { kind: "leap", line: "LEAP · Send the message. Apply. Ask. One brave inch.", reason: "one sent message beats ten drafted ones" },
  { kind: "body", line: "BODY · Stand up. Stretch. Then come back sharper.", reason: "stillness for this long taxes the work, not just the body" },
  { kind: "body", line: "BODY · Eyes off the screen for thirty seconds.", reason: "eye strain is silent until it isn't" },
  { kind: "gratitude", line: "GRATITUDE · Name one thing that's already working today.", reason: "noticing what works makes more of it" },
  { kind: "breath", line: "BREATH · In for four. Out for six. Then the next move.", reason: "a long exhale is the fastest honest reset there is" },
  { kind: "people", line: "PEOPLE · Text someone who matters — not for work.", reason: "the people in your corner shouldn't only hear from you at work" },
  { kind: "play", line: "PLAY · Five minutes of something that isn't grinding.", reason: "play is how the next idea gets in" },
];

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function markPresence() {
  const now = Date.now();
  const st = load();
  if (now - num(st.presence_at) > PRESENCE_TTL) st.presence_since = now;
  st.presence_at = now;
  save(st);
}

export function markChatUser() {
  const st = load();
  st.last_chat_at = Date.now();
  save(st);
}

function shortTitle(t, n = 42) {
  const s = String(t || "").trim();
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function slotFilled(plan, slot) {
  for (const row of plan || []) {
    if ((row.slot || "") !== slot) continue;
    if (String(row.meal_name || row.name || row.title || "").trim()) return true;
  }
  return false;
}

function pickLocal(db, hour, lastKind) {
  const candidates = [];

  const mot = motivSnap();
  const shot = mot?.next?.shot;
  if (shot && mot?.next?.kind !== "wake") {
    candidates.push({
      kind: "motiv",
      line: `MOTIVATION · ${shot} Open VIBE MOTIVATION and tap when it lands.`,
      reason: "a motivation shot is queued and unfinished",
    });
  }

  try {
    const meals = mealSnapshot(db);
    const plan = meals?.plan || meals?.slots || [];
    if (7 <= hour && hour < 11 && !slotFilled(plan, "breakfast")) {
      candidates.push({ kind: "eat", line: "MEALS · Breakfast is empty. Feed yourself like you matter.", reason: "the breakfast slot is still blank for today" });
    } else if (11 <= hour && hour < 15 && !slotFilled(plan, "lunch")) {
      candidates.push({ kind: "eat", line: "MEALS · Lunch is blank. Sit down. Eat. Then return.", reason: "the lunch slot is still blank for today" });
    } else if (17 <= hour && hour < 21 && !slotFilled(plan, "dinner")) {
      candidates.push({ kind: "eat", line: "MEALS · Dinner still open. Don't skip the simple things.", reason: "the dinner slot is still blank for today" });
    }
  } catch {
    /* meals optional */
  }

  const opps = (db.opps || []).filter((o) => o.status !== "done");
  const tight = opps.filter((o) => o.tight || /today|tomorrow|due|closes/i.test(String(o.due_label || "")));
  if (tight.length) {
    candidates.push({
      kind: "opps",
      line: `OPP · ${shortTitle(tight[0].title || "a call")} is ${tight[0].due_label || "TIGHT"}. Draft when you're ready.`,
      reason: "this opportunity's deadline is the closest one open",
    });
  } else if (opps.length) {
    candidates.push({
      kind: "opps",
      line: `OPP · ${shortTitle(opps[0].title || "a call")} is still open. One question filled is progress.`,
      reason: "it's the oldest open opportunity still waiting",
    });
  }

  // Life jazz — water, roses, leap of faith — always in the mix.
  const tick = hour + Math.floor(Date.now() / COOLDOWN);
  candidates.push(LIFE[tick % LIFE.length]);
  candidates.push(LIFE[(tick * 3 + 5) % LIFE.length]);

  const fresh = candidates.filter((c) => c.kind && c.kind !== lastKind);
  const pool = fresh.length ? fresh : candidates.filter((c) => c.line);
  if (!pool.length) return { kind: "", line: "" };
  return pool[tick % pool.length];
}

/** Which meal slot is blank right now (mirrors pickLocal's windows). */
function missingMealSlot(db, hour) {
  try {
    const meals = mealSnapshot(db);
    const plan = meals?.plan || meals?.slots || [];
    if (7 <= hour && hour < 11 && !slotFilled(plan, "breakfast")) return "breakfast";
    if (11 <= hour && hour < 15 && !slotFilled(plan, "lunch")) return "lunch";
    if (17 <= hour && hour < 21 && !slotFilled(plan, "dinner")) return "dinner";
  } catch {
    /* meals optional */
  }
  return "";
}

/** Local check-in line when HUD is present and focused. */
export function maybeNudge(db) {
  const now = Date.now();
  markPresence();
  const st = load();
  if (now - num(st.presence_at) > PRESENCE_TTL) return "";
  const settings = (db && db.settings) || {};
  const at = new Date(now);
  const hour = at.getHours();
  // Quiet hours (settings, default 22:00–07:00) replace the old fixed
  // 01:00–06:00 hush — nothing interrupts inside the window.
  if (inQuietHours(at, settings)) return "";

  if (now - num(st.last_chat_at) >= 120 * 1000) {
    const wake = maybeLocalWakeLine();
    if (wake) {
      st.last_nudge_at = now;
      st.last_nudge_kind = "wake";
      save(st);
      return wake;
    }
  }

  if (now - num(st.presence_since || now) < SESSION_MIN) return "";
  if (now - num(st.last_nudge_at) < COOLDOWN) return "";
  if (now - num(st.last_chat_at) < CHAT_GAP) return "";

  // Phase 2 gate: nudges on, outside quiet hours, under the 5/day cap.
  const bst = loadBriefState();
  if (!nudgeGate(bst, settings, at).allowed) return "";

  // Reasoned candidates from real state first…
  const ctx = getNudgeContext() || {};
  const opps = (db.opps || []).filter((o) => o.status !== "done");
  const tight = opps.find((o) => o.tight || /today|tomorrow|due|closes/i.test(String(o.due_label || "")));
  const signals = {
    suggestions: Number(ctx.suggestions || 0),
    eveningDue: Boolean(ctx.eveningDue),
    oppTight: tight ? { title: shortTitle(tight.title || "a call"), due: tight.due_label || "TIGHT" } : null,
    mealMissing: missingMealSlot(db, hour),
    sessionMinutes: (now - num(st.presence_since || now)) / 60000,
  };
  let hit = reasonedCandidates(signals).find((c) => c.kind !== st.last_nudge_kind) || reasonedCandidates(signals)[0];

  // …then the local pool (motiv / meals / opps / life) — also reasoned now.
  if (!hit) hit = pickLocal(db, hour, st.last_nudge_kind || "");
  if (!hit?.line) return "";
  st.last_nudge_at = now;
  st.last_nudge_kind = hit.kind;
  save(st);
  noteNudgeDelivered(bst, at);
  return hit.reason ? `${hit.line} — why: ${hit.reason}` : hit.line;
}

/**
 * Prefer desktop presence nudge when paired; always fall back to on-device jazz.
 */
export async function pingNudge(settings, db) {
  markPresence();
  if (desktopConfigured(settings)) {
    try {
      const tok = desktopToken();
      const base = String(settings.desktop_url || "").replace(/\/+$/, "");
      const out = await httpLanPostJson(
        `${base}/api/presence`,
        tok ? { Cookie: `pip_gate=${tok}` } : {},
        {},
        8000,
      );
      const line = String(out?.nudge || "").trim();
      if (line) {
        const st = load();
        st.last_nudge_at = Date.now();
        st.last_nudge_kind = "desktop";
        save(st);
        return line;
      }
    } catch {
      /* local */
    }
  }
  return maybeNudge(db);
}
