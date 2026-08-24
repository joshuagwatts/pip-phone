/** Morning wake + briefing — mirrors desktop Pip; syncs when paired. */
import { desktopConfigured } from "./desktop.js";
import { httpLanGet, httpLanPostJson } from "./net.js";

export const MORNING_STEPS = [
  { slug: "face", title: "Splash water on your face", shot: "SPLASH YOUR FACE", vibe: "face" },
  { slug: "teeth", title: "Freshen teeth and breath", shot: "FRESHEN YOUR TEETH", vibe: "mint" },
  { slug: "water", title: "Drink a glass of water", shot: "DRINK WATER", vibe: "water" },
  { slug: "mobility", title: "Begin mobility", shot: "MOVE", vibe: "move" },
];

export const MORNING_LINES = {
  face: "WAKE · one shot: splash your face. Open VIBE MOTIVATION and tap when it's done.",
  teeth: "WAKE · one shot: freshen your teeth. VIBE MOTIVATION. Tap when it's done.",
  water: "WAKE · one shot: drink water. VIBE MOTIVATION. Tap when it's done.",
  mobility: "WAKE · one shot: move. VIBE MOTIVATION. Tap when the body's awake.",
};

const STATE_KEY = "pip.phone.morning.v1";
const BRIEF_KEY = "pip.phone.brief.v1";
const GUIDE_KEY = "pip.phone.morning.guide.v1";
const GUIDE_COOLDOWN = 8 * 60 * 1000;
const MORNING_LO = 5;
const MORNING_HI = 12;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function lan(settings) {
  return String(settings.desktop_url || "").replace(/\/+$/, "");
}

function headers(settings) {
  const tok = String(settings.desktop_token || "").trim();
  return tok ? { Cookie: `pip_gate=${tok}` } : {};
}

function emptyLocal() {
  return {
    date: todayIso(),
    source: "local",
    checks: {},
    remote: null,
  };
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (!raw || raw.date !== todayIso()) return emptyLocal();
    return {
      date: raw.date,
      source: raw.source || "local",
      checks: raw.checks || {},
      remote: raw.remote || null,
    };
  } catch {
    return emptyLocal();
  }
}

function saveState(st) {
  localStorage.setItem(STATE_KEY, JSON.stringify(st));
}

function markCheckedLocal(itemId, slug) {
  const st = loadState();
  st.date = todayIso();
  const keys = [String(itemId), String(slug || "")].filter(Boolean);
  st.checks = { ...st.checks };
  for (const k of keys) st.checks[k] = true;

  if (st.remote?.morning) {
    const morn = st.remote.morning;
    const items = (Array.isArray(morn.items) ? morn.items : []).map((r) => {
      const hit =
        keys.includes(String(r.id)) ||
        keys.includes(String(r.slug)) ||
        (slug && r.slug === slug);
      return hit ? { ...r, checked: true } : r;
    });
    const next = items.find((r) => !r.checked) || null;
    const done = items.filter((r) => r.checked).length;
    st.remote = {
      ...st.remote,
      morning: {
        ...morn,
        items,
        next: next
          ? {
              ...next,
              shot: next.shot || MORNING_STEPS.find((s) => s.slug === next.slug)?.shot || next.title,
              vibe: next.vibe || MORNING_STEPS.find((s) => s.slug === next.slug)?.vibe || "water",
            }
          : null,
        done,
        total: items.length || MORNING_STEPS.length,
        complete: items.length > 0 && done === items.length,
      },
    };
  } else {
    st.source = "local";
  }
  saveState(st);
  return morningStatus();
}

function itemChecked(st, item) {
  if (item?.checked) return true;
  const id = String(item?.id ?? "");
  const slug = String(item?.slug ?? "");
  return Boolean((id && st.checks[id]) || (slug && st.checks[slug]));
}

export function inWindow(hour) {
  const h = hour == null ? new Date().getHours() : hour;
  return MORNING_LO <= h && h < MORNING_HI;
}

/** Local or last-synced morning status — same shape as desktop morning_status. */
export function morningStatus() {
  const st = loadState();
  if (st.source === "desktop" && st.remote && st.remote.date === todayIso()) {
    const morn = st.remote.morning || {};
    const items = (Array.isArray(morn.items) ? morn.items : []).map((r) => ({
      ...r,
      checked: itemChecked(st, r),
    }));
    const nxt = items.find((r) => !r.checked) || null;
    const done = items.filter((r) => r.checked).length;
    return {
      items,
      next: nxt
        ? {
            ...nxt,
            shot: nxt.shot || MORNING_STEPS.find((s) => s.slug === nxt.slug)?.shot || nxt.title,
            vibe: nxt.vibe || MORNING_STEPS.find((s) => s.slug === nxt.slug)?.vibe || "water",
          }
        : null,
      done,
      total: items.length || MORNING_STEPS.length,
      complete: items.length > 0 && done === items.length,
      source: "desktop",
      motivation: st.remote.motivation || null,
      weather: st.remote.weather || null,
      date: st.remote.date || todayIso(),
    };
  }
  const items = MORNING_STEPS.map((s, i) => ({
    id: s.slug,
    slug: s.slug,
    title: s.title,
    shot: s.shot,
    vibe: s.vibe,
    sort_order: i,
    checked: Boolean(st.checks[s.slug]),
  }));
  const nxtRaw = items.find((r) => !r.checked) || null;
  const nxt = nxtRaw
    ? {
        id: nxtRaw.slug,
        slug: nxtRaw.slug,
        title: nxtRaw.title,
        shot: nxtRaw.shot,
        vibe: nxtRaw.vibe,
      }
    : null;
  return {
    items,
    next: nxt,
    done: items.filter((r) => r.checked).length,
    total: items.length,
    complete: items.length > 0 && items.every((r) => r.checked),
    source: "local",
    motivation: null,
    weather: null,
    date: todayIso(),
  };
}

export function wakeOpen(hour) {
  const h = hour == null ? new Date().getHours() : hour;
  const st = morningStatus();
  if (!st.next || st.complete) return false;
  return inWindow(h) || h < 14;
}

export function wakeNext() {
  if (!wakeOpen()) return null;
  const nxt = morningStatus().next;
  if (!nxt) return null;
  return {
    ...nxt,
    kind: "wake",
    phase: "wake",
    shot: nxt.shot || nxt.title || "NOW",
    vibe: nxt.vibe || "water",
  };
}

/** Check off a wake shot. Advances locally first so VIBE never sticks; desktop sync is best-effort. */
export async function checkWake(settings, itemId, slug) {
  const id = itemId;
  if (id == null || id === "") throw new Error("no wake item");
  const status = markCheckedLocal(id, slug || id);

  if (desktopConfigured(settings)) {
    const base = lan(settings);
    try {
      await Promise.race([
        httpLanPostJson(
          `${base}/api/routine/${encodeURIComponent(id)}/check`,
          headers(settings),
          { done: true },
          8000,
        ),
        new Promise((_, rej) => setTimeout(() => rej(new Error("wake sync timeout")), 8000)),
      ]);
      await syncMorning(settings).catch(() => {});
    } catch {
      /* local advance already applied */
    }
  }
  return morningStatus() || status;
}

/** Pull /api/today — morning + motivation — whether briefing exists or not. */
export async function syncMorning(settings) {
  if (!desktopConfigured(settings)) {
    const local = morningStatus();
    return { ok: true, paired: false, morning: local };
  }
  const base = lan(settings);
  const today = await httpLanGet(`${base}/api/today`, 15000, headers(settings));
  const morn = today.morning || {};
  const slugSet = new Set(MORNING_STEPS.map((s) => s.slug));
  const statusItems = (Array.isArray(today.routine) ? today.routine : [])
    .filter((r) => slugSet.has(r.slug))
    .map((r) => {
      const meta = MORNING_STEPS.find((s) => s.slug === r.slug) || {};
      return {
        ...r,
        shot: r.shot || meta.shot || r.title,
        vibe: r.vibe || meta.vibe || "water",
      };
    });
  const nextRaw = morn.next || statusItems.find((r) => !r.checked) || null;
  const next = nextRaw
    ? {
        ...nextRaw,
        shot:
          nextRaw.shot ||
          MORNING_STEPS.find((s) => s.slug === nextRaw.slug)?.shot ||
          nextRaw.title,
        vibe:
          nextRaw.vibe ||
          MORNING_STEPS.find((s) => s.slug === nextRaw.slug)?.vibe ||
          "water",
      }
    : null;
  const done = statusItems.filter((r) => r.checked).length;
  const packed = {
    date: today.date || todayIso(),
    morning: {
      items: statusItems,
      next,
      done,
      total: statusItems.length || MORNING_STEPS.length,
      complete: Boolean(morn.complete) || (statusItems.length > 0 && done === statusItems.length),
    },
    motivation: today.motivation || null,
    weather: today.weather || null,
  };
  const prev = loadState();
  const checks = { ...(prev.date === todayIso() ? prev.checks : {}) };
  /* Drop local marks that desktop already has checked — keep optimistic phone taps. */
  for (const r of statusItems) {
    if (r.checked) {
      if (r.id != null) delete checks[String(r.id)];
      if (r.slug) delete checks[String(r.slug)];
    }
  }
  saveState({
    date: todayIso(),
    source: "desktop",
    checks,
    remote: packed,
  });
  return { ok: true, paired: true, morning: morningStatus(), today: packed };
}

export function getBriefing() {
  try {
    const raw = JSON.parse(localStorage.getItem(BRIEF_KEY) || "null");
    if (!raw || raw.date !== todayIso()) return null;
    return raw;
  } catch {
    return null;
  }
}

export function setBriefing(text) {
  const row = { date: todayIso(), text: String(text || "").trim(), at: Date.now() };
  localStorage.setItem(BRIEF_KEY, JSON.stringify(row));
  return row;
}

/** Morning briefing — independent of whether wake shots are done. */
export async function fetchBriefing(settings, { force = false } = {}) {
  const cached = getBriefing();
  if (!force && cached?.text) return cached;
  if (!desktopConfigured(settings)) {
    const local = localBriefingFallback();
    return setBriefing(local);
  }
  const base = lan(settings);
  const out = await httpLanPostJson(
    `${base}/api/briefing`,
    headers(settings),
    { days: 7, save: false },
    90000,
  );
  return setBriefing(out.text || "");
}

function localBriefingFallback() {
  const st = morningStatus();
  const nxt = st.next;
  const shot = nxt ? `One shot: ${(nxt.shot || nxt.title || "wake").toLowerCase()}. Open VIBE MOTIVATION.` : "Wake checklist clear.";
  return `Good morning. ${shot} Then take the day one honest move at a time.`;
}

/** Desktop presence nudge when paired; local wake line otherwise.
 *  Phone chat reminders (meals / life jazz / motiv) live in nudge.js → pingNudge.
 */
export async function pingPresence(settings) {
  if (desktopConfigured(settings)) {
    try {
      const base = lan(settings);
      const out = await httpLanPostJson(`${base}/api/presence`, headers(settings), {}, 8000);
      return String(out?.nudge || "").trim();
    } catch {
      return maybeLocalWakeLine();
    }
  }
  return maybeLocalWakeLine();
}

export function maybeLocalWakeLine() {
  if (!inWindow()) return "";
  const st = morningStatus();
  const nxt = st.next;
  if (!nxt) return "";
  const slug = nxt.slug || "";
  let guide = {};
  try {
    guide = JSON.parse(localStorage.getItem(GUIDE_KEY) || "{}") || {};
  } catch {
    guide = {};
  }
  const now = Date.now();
  if (guide.date === todayIso()) {
    if (now - Number(guide.at || 0) < GUIDE_COOLDOWN) return "";
    if (guide.slug === slug) return "";
  }
  const line = MORNING_LINES[slug] || `WAKE · ${nxt.title || "the next check"}.`;
  localStorage.setItem(GUIDE_KEY, JSON.stringify({ date: todayIso(), at: now, slug }));
  return line;
}

export function fullMorningSync(settings) {
  return syncMorning(settings).then(async (out) => {
    let brief = getBriefing();
    try {
      brief = await fetchBriefing(settings, { force: false });
    } catch {
      /* briefing optional if PC brain down */
    }
    return { ...out, briefing: brief };
  });
}
