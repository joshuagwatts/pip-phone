/** Goal Tracker — Phase 4 pillar (PIP_REIMAGINED.md §3 "Goals", §6 Phase 4).
 *
 * Deliberately DEPENDENCY-FREE like briefing.js: imports nothing, no fetch,
 * no cloud path. Goals are local data; every state is DERIVED from touch /
 * milestone timestamps, never hand-set, so the tracker can't drift into
 * flattering lies.
 *
 * States (quiet = days since the goal was last touched or a milestone was
 * checked):
 *   on-track        quiet < 14 days
 *   needs-attention 14–30 days quiet
 *   stalled         30+ days quiet
 *
 * A stalled goal earns exactly ONE nudge per stall, then silence — the flag
 * is keyed to the touch timestamp that started the stall, so re-touching a
 * goal re-arms it for a future stall and only for that stall.
 *
 * State lives under one localStorage key, mirroring briefing.js.
 */

export const GOALS_KEY = "pip.phone.goals.v1";
export const ON_TRACK_DAYS = 14;
export const STALLED_DAYS = 30;
export const WEEKLY_BRIEF_DAY = 0; // Sunday
export const WEEKLY_BRIEF_FROM = 17; // at/after 17:00

const DAY_MS = 24 * 60 * 60 * 1000;

function gid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function dayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ------------------------------------------------------------------ state --

function emptyGoalsState() {
  return { goals: [], lastWeeklyDate: "" };
}

export function loadGoalsState() {
  try {
    const raw = JSON.parse(localStorage.getItem(GOALS_KEY) || "null");
    if (!raw || typeof raw !== "object") return emptyGoalsState();
    return {
      goals: Array.isArray(raw.goals) ? raw.goals : [],
      lastWeeklyDate: String(raw.lastWeeklyDate || ""),
    };
  } catch {
    return emptyGoalsState();
  }
}

export function saveGoalsState(st) {
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(st || emptyGoalsState()));
  } catch {
    /* storage full/blocked — goals are best-effort, never fatal */
  }
  return st;
}

export function loadGoals() {
  return loadGoalsState().goals;
}

// ------------------------------------------------------------------ goals --

export function newGoal(title, now = Date.now()) {
  return {
    id: gid(),
    title: String(title || "").trim().slice(0, 120),
    createdAt: now,
    milestones: [], // [{ text, done, doneAt }]
    lastTouchedAt: now,
    stallNudgedTouch: 0, // lastTouchedAt value a stall nudge already fired for
  };
}

export function addGoal(st, title, now = Date.now()) {
  const g = newGoal(title, now);
  if (!g.title) return null;
  st.goals.unshift(g);
  saveGoalsState(st);
  return g;
}

export function findGoal(st, id) {
  return (st.goals || []).find((g) => g.id === id) || null;
}

/** A touch = any real interaction: opening the goal, adding/checking a
 *  milestone. It is the ONLY thing that resets the quiet clock. */
export function touchGoal(st, id, now = Date.now()) {
  const g = findGoal(st, id);
  if (!g) return null;
  g.lastTouchedAt = now;
  saveGoalsState(st);
  return g;
}

export function addMilestone(st, id, text, now = Date.now()) {
  const g = findGoal(st, id);
  const t = String(text || "").trim().slice(0, 160);
  if (!g || !t) return null;
  g.milestones.push({ text: t, done: false, doneAt: 0 });
  g.lastTouchedAt = now;
  saveGoalsState(st);
  return g;
}

export function toggleMilestone(st, id, index, now = Date.now()) {
  const g = findGoal(st, id);
  if (!g || !g.milestones[index]) return null;
  const m = g.milestones[index];
  m.done = !m.done;
  m.doneAt = m.done ? now : 0;
  g.lastTouchedAt = now;
  saveGoalsState(st);
  return g;
}

// ------------------------------------------------------------ derived state --

/** Last real activity: creation, a touch, or the newest milestone check. */
export function goalLastActivity(goal) {
  let t = Number(goal.lastTouchedAt || goal.createdAt || 0);
  for (const m of goal.milestones || []) {
    if (m.done && Number(m.doneAt || 0) > t) t = Number(m.doneAt);
  }
  return t;
}

export function goalQuietDays(goal, now = Date.now()) {
  return Math.max(0, Math.floor((now - goalLastActivity(goal)) / DAY_MS));
}

export function goalState(goal, now = Date.now()) {
  const q = goalQuietDays(goal, now);
  if (q >= STALLED_DAYS) return "stalled";
  if (q >= ON_TRACK_DAYS) return "needs-attention";
  return "on-track";
}

export const GOAL_STATE_LABEL = {
  "on-track": "ON TRACK",
  "needs-attention": "NEEDS ATTENTION",
  stalled: "STALLED",
};

/** The Morning Brief's single focus: the goal hurting most (stalled, then
 *  needs-attention; quietest first), else the first goal with an open
 *  milestone. Returns { goal, text } or null when there are no goals. */
export function pickFocusGoal(goals, now = Date.now()) {
  const list = (goals || []).filter((g) => g && g.title);
  if (!list.length) return null;
  const rank = { stalled: 0, "needs-attention": 1, "on-track": 2 };
  const sorted = list.slice().sort((a, b) => {
    const ra = rank[goalState(a, now)];
    const rb = rank[goalState(b, now)];
    if (ra !== rb) return ra - rb;
    return goalQuietDays(b, now) - goalQuietDays(a, now); // quietest first
  });
  const top = sorted[0];
  if (goalState(top, now) !== "on-track") {
    return { goal: top, text: focusText(top, now) };
  }
  const withOpen = list.find((g) => (g.milestones || []).some((m) => !m.done));
  const pick = withOpen || top;
  return { goal: pick, text: focusText(pick, now) };
}

function focusText(goal, now = Date.now()) {
  const open = (goal.milestones || []).find((m) => !m.done);
  const state = goalState(goal, now);
  const tail = open
    ? `next: ${open.text}`
    : state === "on-track"
      ? "no open milestone — add one or call it done"
      : `${goalQuietDays(goal, now)}d quiet — one small touch restarts it`;
  return `${goal.title} — ${tail}`;
}

// --------------------------------------------------------- weekly briefing --

/** Sunday-evening goal briefing. Quiet-hours gating is the caller's job
 *  (briefing.js's inQuietHours, same as the Evening Review offer). */
export function weeklyGoalBriefDue(st, now = new Date()) {
  return Boolean(
    now.getDay() === WEEKLY_BRIEF_DAY &&
      now.getHours() >= WEEKLY_BRIEF_FROM &&
      st.lastWeeklyDate !== dayStr(now) &&
      (st.goals || []).length,
  );
}

export function markWeeklyBriefDelivered(st, now = new Date()) {
  st.lastWeeklyDate = dayStr(now);
  saveGoalsState(st);
  return st;
}

/** One honest line per goal: title, state, progress, quiet time. */
export function weeklyBriefLines(goals, now = Date.now()) {
  return (goals || []).map((g) => {
    const ms = g.milestones || [];
    const done = ms.filter((m) => m.done).length;
    const q = goalQuietDays(g, now);
    const prog = ms.length ? `${done}/${ms.length} milestones` : "no milestones yet";
    return `${g.title} · ${GOAL_STATE_LABEL[goalState(g, now)]} · ${prog}${q >= ON_TRACK_DAYS ? ` · ${q}d quiet` : ""}`;
  });
}

// ------------------------------------------------------------ stall nudge --

/** Stalled goals that have NOT yet had their one nudge for this stall. */
export function stalledNudgeCandidates(goals, now = Date.now()) {
  return (goals || []).filter(
    (g) => goalState(g, now) === "stalled" && Number(g.stallNudgedTouch || 0) !== Number(g.lastTouchedAt || 0),
  );
}

/** Burn the one nudge for the goal's current stall. */
export function markStallNudged(st, id) {
  const g = findGoal(st, id);
  if (!g) return null;
  g.stallNudgedTouch = Number(g.lastTouchedAt || 0);
  saveGoalsState(st);
  return g;
}
