/** Phone Pip chat reminders — desktop-style check-ins, on-device. No popups. */

import { desktopConfigured } from "./desktop.js";
import { httpLanPostJson } from "./net.js";
import { snapshot as motivSnap } from "./motivation.js";
import { maybeLocalWakeLine } from "./morning.js";
import { mealSnapshot } from "./meals.js";

const KEY = "pip.phone.nudge.v1";
const PRESENCE_TTL = 90 * 1000;
const SESSION_MIN = 8 * 60 * 1000;
const COOLDOWN = 25 * 60 * 1000;
const CHAT_GAP = 8 * 60 * 1000;
const NIGHT_LO = 1;
const NIGHT_HI = 6;

/** Life jazz — leap of faith, water, roses, the good stuff. */
const LIFE = [
  { kind: "water", line: "WATER · Drink a glass. The work will wait." },
  { kind: "water", line: "WATER · Hydrate like you mean to finish the day." },
  { kind: "roses", line: "ROSES · Go smell them. Seriously." },
  { kind: "roses", line: "ROSES · Step outside for one minute. Let the air hit." },
  { kind: "leap", line: "LEAP · Take a small leap of faith on the thing you've been circling." },
  { kind: "leap", line: "LEAP · Send the message. Apply. Ask. One brave inch." },
  { kind: "body", line: "BODY · Stand up. Stretch. Then come back sharper." },
  { kind: "body", line: "BODY · Eyes off the screen for thirty seconds." },
  { kind: "gratitude", line: "GRATITUDE · Name one thing that's already working today." },
  { kind: "breath", line: "BREATH · In for four. Out for six. Then the next move." },
  { kind: "people", line: "PEOPLE · Text someone who matters — not for work." },
  { kind: "play", line: "PLAY · Five minutes of something that isn't grinding." },
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
    });
  }

  try {
    const meals = mealSnapshot(db);
    const plan = meals?.plan || meals?.slots || [];
    if (7 <= hour && hour < 11 && !slotFilled(plan, "breakfast")) {
      candidates.push({ kind: "eat", line: "MEALS · Breakfast is empty. Feed yourself like you matter." });
    } else if (11 <= hour && hour < 15 && !slotFilled(plan, "lunch")) {
      candidates.push({ kind: "eat", line: "MEALS · Lunch is blank. Sit down. Eat. Then return." });
    } else if (17 <= hour && hour < 21 && !slotFilled(plan, "dinner")) {
      candidates.push({ kind: "eat", line: "MEALS · Dinner still open. Don't skip the simple things." });
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
    });
  } else if (opps.length) {
    candidates.push({
      kind: "opps",
      line: `OPP · ${shortTitle(opps[0].title || "a call")} is still open. One question filled is progress.`,
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

/** Local check-in line when HUD is present and focused. */
export function maybeNudge(db) {
  const now = Date.now();
  markPresence();
  const st = load();
  if (now - num(st.presence_at) > PRESENCE_TTL) return "";
  const hour = new Date().getHours();
  if (NIGHT_LO <= hour && hour < NIGHT_HI) return "";

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

  const hit = pickLocal(db, hour, st.last_nudge_kind || "");
  if (!hit?.line) return "";
  st.last_nudge_at = now;
  st.last_nudge_kind = hit.kind;
  save(st);
  return hit.line;
}

/**
 * Prefer desktop presence nudge when paired; always fall back to on-device jazz.
 */
export async function pingNudge(settings, db) {
  markPresence();
  if (desktopConfigured(settings)) {
    try {
      const tok = String(settings.desktop_token || "").trim();
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
