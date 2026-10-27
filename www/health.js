/** Health loop — Phase 4 pillar (PIP_REIMAGINED.md §3 "meals.js → the
 * Health loop", §6 Phase 4).
 *
 * The required piece is a 10-second daily check-in: energy 1–5, one tap.
 * Sleep hours and movement minutes ride along as optional steppers. No
 * forms, no coaching engine — the brief lines below are honest template
 * logic over the numbers the user actually tapped, nothing inferred
 * beyond them.
 *
 * DEPENDENCY-FREE like briefing.js/goals.js: imports nothing, no fetch.
 * State lives under one localStorage key, keyed by local date.
 */

export const HEALTH_KEY = "pip.phone.health.v1";

function dayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftDay(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayStr(d);
}

// ------------------------------------------------------------------ state --

export function loadHealth() {
  try {
    const raw = JSON.parse(localStorage.getItem(HEALTH_KEY) || "null");
    if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") return { days: {} };
    return { days: raw.days };
  } catch {
    return { days: {} };
  }
}

export function saveHealth(st) {
  try {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(st || { days: {} }));
  } catch {
    /* best-effort, never fatal */
  }
  return st;
}

export function checkinFor(st, dateStr) {
  const row = (st.days || {})[dateStr];
  return row && typeof row === "object" ? row : null;
}

export function todayCheckin(st, now = new Date()) {
  return checkinFor(st, dayStr(now));
}

export function yesterdayCheckin(st, now = new Date()) {
  return checkinFor(st, shiftDay(dayStr(now), -1));
}

/** Record a check-in. Only the fields present are touched; energy is
 *  clamped to 1–5, sleep to 0–16h, movement to 0–1440min. */
export function recordCheckin(st, patch = {}, now = new Date()) {
  const key = dayStr(now);
  const row = { ...(checkinFor(st, key) || {}), at: Date.now() };
  if (patch.energy != null) {
    const e = Math.round(Number(patch.energy));
    if (Number.isFinite(e)) row.energy = Math.max(1, Math.min(5, e));
  }
  if (patch.sleep != null) {
    const s = Number(patch.sleep);
    if (Number.isFinite(s)) row.sleep = Math.max(0, Math.min(16, s));
  }
  if (patch.move != null) {
    const m = Math.round(Number(patch.move));
    if (Number.isFinite(m)) row.move = Math.max(0, Math.min(1440, m));
  }
  st.days[key] = row;
  saveHealth(st);
  return row;
}

// ------------------------------------------------------------- brief lines --

export function isLowCheckin(row) {
  if (!row) return false;
  if (row.energy != null && Number(row.energy) <= 2) return true;
  if (row.sleep != null && Number(row.sleep) < 6) return true;
  return false;
}

function factsOf(row) {
  const bits = [];
  if (row.energy != null) bits.push(`energy ${row.energy}/5`);
  if (row.sleep != null) bits.push(`${row.sleep}h sleep`);
  if (row.move != null) bits.push(`${row.move}min moving`);
  return bits.join(", ");
}

/** The Morning Brief's energy PLAN line, from YESTERDAY's check-in (the
 *  plan is for today, the evidence is yesterday). Empty string when there
 *  is no check-in to stand on — the brief then falls back to its meals
 *  line instead of inventing an energy read. */
export function energyPlanLine(yesterday) {
  if (!yesterday || (yesterday.energy == null && yesterday.sleep == null)) return "";
  const facts = factsOf(yesterday);
  if (isLowCheckin(yesterday)) {
    return `Light day on purpose — yesterday ran low (${facts}). Front-load the one move, protect the evening, no heroics.`;
  }
  return `Steady — yesterday: ${facts}. The full plan stands; spend it on the one move.`;
}

/** Evening Review line: today's tapped energy against the morning call.
 *  The morning call was "light" exactly when yesterday's check-in was low. */
export function eveningEnergyLine(today, yesterday) {
  if (!today || today.energy == null) return "";
  const base = `Energy today: ${today.energy}/5${today.sleep != null ? ` · ${today.sleep}h sleep` : ""}${today.move != null ? ` · ${today.move}min moving` : ""}.`;
  if (isLowCheckin(yesterday)) {
    return `${base} Morning called for a light day — ${today.energy >= 3 ? "you beat the call." : "the call was right; rest is the work."}`;
  }
  return base;
}
