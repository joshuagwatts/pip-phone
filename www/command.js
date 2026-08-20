/** Chain of command — best brain for the job, then the next, then Pip's own voice. */

export const JOBS = {
  life: {
    label: "CHAT",
    brains: ["gemini", "groq", "openrouter", "xai", "cerebras", "mistral"],
  },
  boost: {
    label: "DRAFT",
    brains: ["groq", "openrouter", "cerebras", "mistral", "gemini"],
  },
  code: {
    label: "CODE",
    brains: ["openrouter", "groq", "cerebras", "mistral"],
  },
  wx: {
    label: "WX",
    brains: [],
  },
  theme: {
    label: "THEME",
    brains: [],
  },
  meal: {
    label: "MEALS",
    brains: ["gemini", "groq", "openrouter", "cerebras", "mistral"],
  },
};

const CODE_HINT =
  /\b(code|coding|refactor|function|bug|traceback|python|javascript|typescript|repo|debug|implement|glsl|shader|webgl)\b/i;
const WX_HINT = /\b(hail|storm|radar|weather|nws|wind report|dossier|roof)\b/i;
const DRAFT_HINT = /\b(apply|application|draft|resume|cover letter|bio|opp|open call)\b/i;
const MEAL_HINT = /\b(meals?|breakfast|lunch|dinner|snack|grocery|macros?|kcal|vegan|vegetarian|what to eat|meal plan)\b/i;
const NOT_CHAT_JOB = /\b(apply|application|hail|storm|zillow|deadline|cover letter)\b/i;

export function pickJob(text) {
  const t = String(text || "");
  if (MEAL_HINT.test(t) && !DRAFT_HINT.test(t)) return "meal";
  if (WX_HINT.test(t) && !DRAFT_HINT.test(t)) return "wx";
  if (CODE_HINT.test(t)) return "code";
  if (DRAFT_HINT.test(t)) return "boost";
  return "life";
}

/** Coding work now lives in main CHAT (Cursor-style), not a CODE tab. */
export function looksLikeCodeRequest(text) {
  const t = String(text || "");
  if (/\b(upgrade\s+(on\s+)?pc|phone\s+www|edit\s+(the\s+)?(app|ui|css|js)|reload\s+overlay)\b/i.test(t)) {
    return true;
  }
  return CODE_HINT.test(t) && !DRAFT_HINT.test(t) && !MEAL_HINT.test(t);
}

export function wantsDesktopCodeUpgrade(text) {
  return /\b(upgrade\s+(on\s+)?pc|desktop\s+upgrade|phone\s+www\s+on\s+(pc|desktop))\b/i.test(String(text || ""));
}

export function orderFor(job, keyedIds, health = {}, pin = "auto") {
  const spec = JOBS[job] || JOBS.life;
  if (pin && pin !== "auto" && pin !== "local") {
    if (keyedIds.includes(pin)) return [pin];
    return [];
  }
  if (pin === "local") return [];
  const keyed = spec.brains.filter((id) => keyedIds.includes(id));
  const live = keyed.filter((id) => health[id]?.ok !== false);
  const down = keyed.filter((id) => health[id]?.ok === false);
  return [...live, ...down];
}

export function describeChain(keyedIds, health = {}, desktop = false, pin = "auto") {
  const rows = [];
  if (desktop) rows.push({ id: "desktop", label: "DESKTOP", state: "on" });
  for (const id of ["gemini", "groq", "openrouter", "xai", "cerebras", "mistral"]) {
    const keyed = keyedIds.includes(id);
    const ok = health[id]?.ok;
    let state = "off";
    if (keyed && ok === true) state = "on";
    else if (keyed && ok === false) state = "bad";
    else if (keyed) state = "key";
    rows.push({
      id,
      label: id === "xai" ? "GROK" : id.toUpperCase(),
      state,
    });
  }
  rows.push({ id: "local", label: "QWEN", state: pin === "local" ? "on" : "skip" });
  return rows;
}

export function skipLocalModel(settings) {
  const pin = String(settings?.brain_pin || "auto").toLowerCase();
  return pin !== "local";
}

export { NOT_CHAT_JOB };
