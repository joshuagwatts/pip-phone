/** Works registry — Phase 4 pillar (PIP_REIMAGINED.md §3 "kit.js /
 * digest.js → the Creativity Engine", §6 Phase 4).
 *
 * Capture → develop → ship. A work is a piece in progress until the user
 * taps SHIPPED — and shipped is a first-class event: the app glue writes
 * it to durable memory and the next Morning Brief carries it. This module
 * is the pure registry logic (imports nothing); the list itself persists
 * in the store blob (db.works) next to the kit it feeds.
 */

export const WORK_KINDS = ["art", "music", "video", "plugin", "writing", "other"];

function wid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function dayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftDay(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayStr(d);
}

export function newWork(title, kind = "art", now = Date.now()) {
  return {
    id: wid(),
    title: String(title || "").trim().slice(0, 140),
    kind: WORK_KINDS.includes(kind) ? kind : "art",
    status: "in-progress",
    createdAt: now,
    shippedAt: 0,
  };
}

export function addWork(works, title, kind, now = Date.now()) {
  const w = newWork(title, kind, now);
  if (!w.title) return null;
  works.unshift(w);
  return w;
}

/** The ship tap. Returns the work, or null when missing/already shipped. */
export function shipWork(works, id, now = Date.now()) {
  const w = (works || []).find((x) => x.id === id);
  if (!w || w.status === "shipped") return null;
  w.status = "shipped";
  w.shippedAt = now;
  return w;
}

export function worksSummary(works, cadence = 1, now = new Date()) {
  const list = works || [];
  const monthKey = dayStr(now).slice(0, 7);
  const shipped = list.filter((w) => w.status === "shipped");
  return {
    inProgress: list.filter((w) => w.status !== "shipped").length,
    shippedTotal: shipped.length,
    shippedThisMonth: shipped.filter((w) => w.shippedAt && dayStr(new Date(w.shippedAt)).slice(0, 7) === monthKey).length,
    cadence: Math.max(0, Math.round(Number(cadence) || 0)),
  };
}

/** One quiet line for the KIT panel — the number, no nagging. */
export function cadenceLine(summary) {
  if (!summary) return "";
  return `SHIPPED ${summary.shippedThisMonth}/${summary.cadence} THIS MONTH · ${summary.shippedTotal} TOTAL · ${summary.inProgress} IN PROGRESS`;
}

/** Works shipped yesterday or today — the Morning Brief's "shipped"
 *  material for its overnight section. */
export function recentlyShipped(works, now = new Date()) {
  const today = dayStr(now);
  const yesterday = shiftDay(today, -1);
  return (works || []).filter((w) => {
    if (w.status !== "shipped" || !w.shippedAt) return false;
    const d = dayStr(new Date(w.shippedAt));
    return d === today || d === yesterday;
  });
}
