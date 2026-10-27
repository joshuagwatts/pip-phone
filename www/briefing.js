/** Briefing Engine — Phase 2 of the reimagined PIP (PIP_REIMAGINED.md §3/§6).
 *
 * Morning Brief, Evening Review, reasoned nudges, "while you were out" card.
 * Deliberately DEPENDENCY-FREE: this module imports nothing. Every input is
 * plain data gathered by the app.js adapter (memory tiers, calendar, meals,
 * mute map), which keeps two blueprint rules structural rather than promised:
 *
 *   1. LOCAL ONLY — there is no fetch, no provider, no cloud path in here.
 *      The brief is assembled from data templates; app.js may optionally ask
 *      brain.js localOnlyComplete() to polish the wording, and that function
 *      cannot reach cloud by construction (see brain.js).
 *   2. Honest data — sections with no real data are omitted, never filled
 *      with fabricated urgency.
 *
 * State lives under one localStorage key, mirroring morning.js/nudge.js.
 * Settings live in db.settings: briefings_on, nudges_on, quiet_start,
 * quiet_end (seeded in store.js blank()).
 */

export const BRIEF_STATE_KEY = "pip.phone.briefing.v1";
export const NUDGE_DAILY_CAP = 5;
export const MORNING_FROM = 6; // first open at/after 06:00
export const EVENING_FROM = 19; // evening offer at/after 19:00

// ------------------------------------------------------------ date helpers --

export function dayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shiftDay(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayStr(d);
}

/** "22:00" -> 1320. Garbage falls back. */
export function parseHHMM(s, fallbackMin) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallbackMin;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallbackMin;
  return h * 60 + min;
}

// ------------------------------------------------------------- quiet hours --

export function quietWindow(settings = {}) {
  return {
    start: parseHHMM(settings.quiet_start, 22 * 60),
    end: parseHHMM(settings.quiet_end, 7 * 60),
  };
}

/** Wrap-midnight aware: 22:00–07:00 contains 23:30 and 03:00, not 12:00. */
export function inQuietHours(at = new Date(), settings = {}) {
  const { start, end } = quietWindow(settings);
  if (start === end) return false;
  const mins = at.getHours() * 60 + at.getMinutes();
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

// ------------------------------------------------------------------ state --

function emptyState() {
  return {
    lastBriefDate: "",
    lastBriefText: "",
    lastBriefPolished: "",
    lastEveningOfferDate: "",
    lastEveningDate: "",
    lastReview: null, // { date, score, note }
    tomorrowFocus: null, // { date, text } — set by the evening review
    nudges: { date: "", count: 0 },
    nudgeCtx: null, // { suggestions, eveningDue, at } — refreshed by app glue
    outSnapshot: null, // diff baseline for "while you were out"
    lastOutAt: 0,
    lastTickAt: 0,
  };
}

export function loadBriefState() {
  try {
    const raw = JSON.parse(localStorage.getItem(BRIEF_STATE_KEY) || "null");
    if (!raw || typeof raw !== "object") return emptyState();
    return { ...emptyState(), ...raw };
  } catch {
    return emptyState();
  }
}

export function saveBriefState(st) {
  try {
    localStorage.setItem(BRIEF_STATE_KEY, JSON.stringify(st || emptyState()));
  } catch {
    /* storage full/blocked — briefs are best-effort, never fatal */
  }
}

/** Called by the 5-min keepalive tick (background.js). Bookkeeping only —
 *  delivery happens on open, the only moment a card can actually be seen. */
export function noteTick(now = Date.now()) {
  const st = loadBriefState();
  st.lastTickAt = now;
  saveBriefState(st);
  return st;
}

// ------------------------------------------------------------ due calculus --

export function briefSettings(settings = {}) {
  return {
    briefings: settings.briefings_on !== false,
    nudges: settings.nudges_on !== false,
  };
}

/** What is due right now. Morning posts on first open at/after 06:00 — the
 *  user opening the app is the action, so quiet hours don't gate it. The
 *  evening offer IS an interruption, so quiet hours suppress it. */
export function dueToday(st, settings = {}, now = new Date()) {
  const on = briefSettings(settings).briefings;
  const today = dayStr(now);
  const quiet = inQuietHours(now, settings);
  return {
    today,
    quiet,
    morningDue: Boolean(on && now.getHours() >= MORNING_FROM && st.lastBriefDate !== today),
    eveningDue: Boolean(
      on && now.getHours() >= EVENING_FROM && !quiet && st.lastEveningOfferDate !== today && st.lastEveningDate !== today,
    ),
    reviewDone: st.lastEveningDate === today,
  };
}

export function markBriefDelivered(st, text, polished = "", today = dayStr()) {
  st.lastBriefDate = today;
  st.lastBriefText = String(text || "");
  st.lastBriefPolished = String(polished || "");
  saveBriefState(st);
  return st;
}

export function markEveningOffered(st, today = dayStr()) {
  st.lastEveningOfferDate = today;
  saveBriefState(st);
  return st;
}

// ---------------------------------------------------------- evening review --

/** Persist a completed review: score + "what mattered" + tomorrow's focus.
 *  The app glue also writes the note to the Memory Engine daily tier. */
export function recordEveningReview(st, { score = 0, note = "", focus = "" } = {}, today = dayStr()) {
  const s = Math.max(0, Math.min(5, Math.round(Number(score) || 0)));
  st.lastEveningDate = today;
  st.lastEveningOfferDate = today;
  st.lastReview = { date: today, score: s, note: String(note || "").trim() };
  const f = String(focus || "").trim();
  st.tomorrowFocus = f ? { date: shiftDay(today, 1), text: f } : null;
  saveBriefState(st);
  return st.lastReview;
}

/** Tomorrow's focus, as seeded by a review, only counts on its own day. */
export function focusForToday(st, today = dayStr()) {
  if (st.tomorrowFocus && st.tomorrowFocus.date === today && st.tomorrowFocus.text) {
    return st.tomorrowFocus.text;
  }
  return "";
}

// --------------------------------------------------------- morning brief ----

/** Exactly ONE recommended move, picked from real signals in priority order.
 *  No signal -> a calm default, never fabricated urgency. */
export function pickRecommendedMove(signals = {}) {
  const n = Number(signals.suggestions || 0);
  if (n > 0) return `Approve or dismiss the ${n} memory suggestion${n > 1 ? "s" : ""} waiting in MEMORY — they compound only once you rule on them.`;
  if (signals.oppTight && signals.oppTight.title) {
    return `Touch "${signals.oppTight.title}" — ${signals.oppTight.due || "its deadline is close"}. One question filled is progress.`;
  }
  if (signals.mealsMissingSlot) {
    return `Fill the ${signals.mealsMissingSlot} slot in MEALS before it fills itself.`;
  }
  if (Number(signals.oppOpen || 0) > 0) {
    return `Move one open opportunity a single stage — draft one answer, then stop.`;
  }
  if (signals.wakeIncomplete) return `Finish the wake checklist — the last shot is the one that counts.`;
  return `Pick one thing that matters and give it the first honest hour. Nothing else is owed.`;
}

/** Assemble the brief from plain inputs. Missing data omits its section.
 *  input: { overnight: {title, content} | null, distillPending: bool,
 *           yesterdayScore: number|null, events: [{title, event_time}],
 *           focus: string, energy: string, move: string } */
export function assembleMorningBrief(input = {}) {
  const lines = ["MORNING BRIEF"];
  const over = [];
  if (input.yesterdayScore) over.push(`Yesterday scored ${input.yesterdayScore}/5.`);
  if (input.overnight && (input.overnight.title || input.overnight.content)) {
    const note = [input.overnight.title, input.overnight.content]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join(" — ");
    if (note) over.push(`Overnight: ${note.length > 220 ? note.slice(0, 219) + "…" : note}`);
  } else if (input.distillPending) {
    over.push("Overnight memory distillation is queued — waiting for a local model.");
  }
  if (over.length) lines.push(over.join(" "));
  const events = Array.isArray(input.events) ? input.events.filter((e) => e && e.title) : [];
  if (events.length) {
    lines.push(
      "TODAY · " +
        events
          .map((e) => (e.event_time ? `${e.event_time} ${e.title}` : String(e.title)))
          .join(" · "),
    );
  }
  if (input.focus) lines.push(`FOCUS · ${input.focus}`);
  if (input.energy) lines.push(`ENERGY · ${input.energy}`);
  lines.push(`ONE MOVE · ${input.move || pickRecommendedMove({})}`);
  return { text: lines.join("\n"), move: String(input.move || "") };
}

// ------------------------------------------------------- while you were out --

/** Diff the saved snapshot against current unattended-work signals.
 *  First call only establishes the baseline (no card on first install). */
export function diffWhileOut(st, current) {
  const snap = st.outSnapshot;
  const items = [];
  if (snap) {
    if (current.distillLast && current.distillLast !== snap.distillLast) {
      items.push({ kind: "distill", text: `Memory distilled for ${current.distillLast} — a daily note plus any suggestions are waiting in MEMORY.` });
    }
    const known = new Set(snap.suggestionIds || []);
    const fresh = (current.suggestionIds || []).filter((id) => !known.has(id));
    if (fresh.length) {
      items.push({ kind: "suggestions", text: `${fresh.length} memory suggestion${fresh.length > 1 ? "s" : ""} drafted from your chats.`, ids: fresh });
    }
    const knownMuted = new Set(snap.mutedIds || []);
    const newMuted = (current.muted || []).filter((m) => !knownMuted.has(m.id));
    for (const m of newMuted) {
      items.push({ kind: "muted", text: `${String(m.id).toUpperCase()} muted (${m.reason || "benched"}) — dead/spent voices stay quiet until you unmute in DATA.` });
    }
    if (current.keysSyncedAt && current.keysSyncedAt !== snap.keysSyncedAt) {
      items.push({ kind: "keys", text: "API keys synced from your desktop into the vault." });
    }
  }
  return items;
}

export function snapshotWhileOut(st, current) {
  st.outSnapshot = {
    distillLast: current.distillLast || "",
    suggestionIds: [...(current.suggestionIds || [])],
    mutedIds: (current.muted || []).map((m) => m.id),
    keysSyncedAt: current.keysSyncedAt || "",
  };
  st.lastOutAt = Date.now();
  saveBriefState(st);
  return st;
}

// ---------------------------------------------------------- reasoned nudges --

/** App glue refreshes this (memory suggestion count etc.) whenever it runs
 *  a briefing check, so nudge.js can stay free of memory-engine imports. */
export function setNudgeContext(ctx) {
  const st = loadBriefState();
  st.nudgeCtx = { ...(ctx || {}), at: Date.now() };
  saveBriefState(st);
  return st;
}

export function getNudgeContext() {
  return loadBriefState().nudgeCtx || null;
}

/** Every candidate carries its reason — the "why am I seeing this" line.
 *  Signals are plain data; nothing here invents personal facts. */
export function reasonedCandidates(signals = {}) {
  const out = [];
  const n = Number(signals.suggestions || 0);
  if (n > 0) {
    out.push({
      kind: "memory",
      line: `MEMORY · ${n} suggestion${n > 1 ? "s" : ""} waiting on your ruling.`,
      reason: "distillation drafted them; nothing enters durable memory without your tap",
    });
  }
  if (signals.eveningDue) {
    out.push({
      kind: "review",
      line: "EVENING REVIEW · Score the day 1–5 and seed tomorrow before it blurs.",
      reason: "it's past 19:00 and today's review isn't done yet",
    });
  }
  if (signals.oppTight && signals.oppTight.title) {
    out.push({
      kind: "opps",
      line: `OPP · ${signals.oppTight.title} is ${signals.oppTight.due || "TIGHT"}. Draft when you're ready.`,
      reason: "this opportunity's deadline is the closest one open",
    });
  }
  if (signals.mealMissing) {
    out.push({
      kind: "eat",
      line: `MEALS · ${String(signals.mealMissing).replace(/^\w/, (c) => c.toUpperCase())} is empty. Feed yourself like you matter.`,
      reason: "that meal slot is still blank for today",
    });
  }
  const mins = Number(signals.sessionMinutes || 0);
  if (mins >= 20) {
    out.push({
      kind: "body",
      line: "BODY · Stand up. Stretch. Then come back sharper.",
      reason: `you've been in a session about ${Math.round(mins)} minutes — a reset keeps the edge`,
    });
    out.push({
      kind: "water",
      line: "WATER · Drink a glass. The work will wait.",
      reason: "long sessions dull the edge; water is the cheapest fix there is",
    });
  }
  return out;
}

/** Gate: nudges enabled, outside quiet hours, under the daily cap. */
export function nudgeGate(st, settings = {}, now = new Date()) {
  if (!briefSettings(settings).nudges) return { allowed: false, why: "nudges off" };
  if (inQuietHours(now, settings)) return { allowed: false, why: "quiet hours" };
  const today = dayStr(now);
  const count = st.nudges && st.nudges.date === today ? st.nudges.count : 0;
  if (count >= NUDGE_DAILY_CAP) return { allowed: false, why: "daily cap" };
  return { allowed: true, count };
}

export function noteNudgeDelivered(st, now = new Date()) {
  const today = dayStr(now);
  if (!st.nudges || st.nudges.date !== today) st.nudges = { date: today, count: 0 };
  st.nudges.count += 1;
  saveBriefState(st);
  return st;
}
