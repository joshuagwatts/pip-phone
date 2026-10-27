/** Conductor data-scope tables — Phase 3 (PIP_REIMAGINED §3/§4).
 *
 * Every job type declares exactly which slices of memory it may include in
 * a prompt: which tiers, and which kinds within them. Enforcement lives at
 * the assembly points (memory-engine's assembleMemoryContext, the agent's
 * memory_search tool) — items outside a job's scope never enter the prompt
 * by construction, not by convention.
 *
 * A "kind" is a category of memory (technical, personal, health, …),
 * derived from an entry's tags first, then keyword heuristics over its
 * title/content. Categories are labels only — scope decisions never look
 * at anything beyond tier + kind.
 *
 * Default posture (blueprint): the NARROWEST scope that keeps the feature
 * working. Chat is the operator talking to Pip directly, so it keeps all
 * tiers; a code task gets code context, never the bio; a prose task gets
 * voice and story, never health or finance. Unknown jobs fall back to a
 * narrow durable-only scope rather than the widest one.
 */

const TAG_KINDS = [
  [/^(person|people|contact)$/i, "person"],
  [/code|tech|dev|shader|plugin|repo|build|software|webgl/i, "technical"],
  [/art|music|creative|design|track|song|render|visual/i, "creative"],
  [/health|meal|food|sleep|fitness|workout|diet/i, "health"],
  [/money|finance|budget|invoice|claim|billing|payment/i, "finance"],
  [/work|job|business|client|roofing|opp|career/i, "work"],
  [/story|bio|personal|family|dream|goal|life/i, "personal"],
];

const TEXT_KINDS = [
  [/\b(code|coding|function|bug|shader|plugin|repo|javascript|python|typescript|api|compile|deploy|refactor)\b/i, "technical"],
  [/\b(meal|meals|sleep|workout|health|energy|macros|doctor|vet)\b/i, "health"],
  [/\b(money|budget|invoice|claim|price|paid|cost|revenue|rent|bill)\b/i, "finance"],
  [/\b(song|track|album|art|gallery|render|design|music|painting|release)\b/i, "creative"],
  [/\b(roof|roofing|client|job site|estimate|contractor|business|adjuster)\b/i, "work"],
  [/\b(family|childhood|dream|goal|i feel|my life|grew up|mom|dad|brother|sister)\b/i, "personal"],
];

/** Category label for one memory entry: {tier, tags, title, content} → kind. */
export function kindOf(entry) {
  if (!entry || typeof entry !== "object") return "general";
  if (entry.tier === "people") return "person";
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map(String)
    : String(entry.tags || "").split(/[,\s]+/).filter(Boolean);
  for (const t of tags) {
    for (const [re, kind] of TAG_KINDS) if (re.test(t)) return kind;
  }
  const text = `${entry.title || ""}\n${entry.content || ""}`;
  for (const [re, kind] of TEXT_KINDS) if (re.test(text)) return kind;
  // Daily notes are the day's personal log by nature.
  if (entry.tier === "daily") return "personal";
  return "general";
}

const ALL_TIERS = ["working", "daily", "durable", "people"];

/**
 * The scope table. kinds = allowlist (when present); denyKinds = denylist.
 * Jobs: command.js JOBS (life/boost/code/wx/vision/meal/theme), brain's
 * opp drafting (boost lane → "opp" alias), superchat classifyTask outputs
 * (general/quick/reasoning/creative), the debate/compare seats, and the
 * /agent tool loop.
 */
export const SCOPES = {
  // Chat with Pip directly — the operator's own conversation gets everything.
  life: { tiers: ALL_TIERS },
  general: { tiers: ALL_TIERS },
  reasoning: { tiers: ALL_TIERS },
  // /agent is explicitly invoked by the operator — full recall, its choice.
  agent: { tiers: ALL_TIERS },
  // Quick factual — durable facts + this session only, no diary, no people.
  quick: { tiers: ["durable", "working"] },
  // Code gets code context — never the bio, never people, never the diary.
  code: { tiers: ["durable", "working"], kinds: ["technical", "general"] },
  // Opportunity drafts: track record + people (who it's for), no daily-personal, no health.
  boost: { tiers: ["durable", "people"], denyKinds: ["personal", "health"] },
  opp: { tiers: ["durable", "people"], denyKinds: ["personal", "health"] },
  // Meals: health memory + daily patterns; no people pages.
  meal: { tiers: ["durable", "daily", "working"], kinds: ["health", "general"] },
  // Weather/roofing: business + technical context only.
  wx: { tiers: ["durable", "working"], kinds: ["work", "technical", "finance", "general"] },
  // Vision: what a photo might be about — work/technical durable facts only.
  vision: { tiers: ["durable"], kinds: ["work", "technical", "general"] },
  // Prose/creative: voice, story, people for characters — never health/finance.
  creative: { tiers: ["durable", "daily", "people"], denyKinds: ["health", "finance"] },
  // Debate + compare seats argue from durable facts and people, not the diary.
  discuss: { tiers: ["durable", "people"] },
  compare: { tiers: ["durable", "people"] },
  // Theme generation is pure style — no memory at all.
  theme: { tiers: [] },
};

/** Narrow fallback for unregistered jobs — never the widest scope. */
const DEFAULT_SCOPE = { tiers: ["durable"], kinds: ["technical", "general"] };

/** scopeFor(job) → { tiers: [...], kinds?: [...], denyKinds?: [...] } */
export function scopeFor(job) {
  const j = String(job || "life").toLowerCase();
  return SCOPES[j] || DEFAULT_SCOPE;
}

/** Keep only the recall items a job is allowed to see. Pure. */
export function filterByScope(items, job) {
  const s = scopeFor(job);
  const tiers = Array.isArray(s.tiers) ? s.tiers : [];
  return (Array.isArray(items) ? items : []).filter((e) => {
    if (!e || typeof e !== "object" || !tiers.includes(e.tier)) return false;
    const k = kindOf(e);
    if (Array.isArray(s.kinds) && !s.kinds.includes(k)) return false;
    if (Array.isArray(s.denyKinds) && s.denyKinds.includes(k)) return false;
    return true;
  });
}

/** Category labels for a set of items — "durable:technical", "people:person". */
export function categoriesOf(items) {
  const set = new Set();
  for (const e of Array.isArray(items) ? items : []) {
    if (e && typeof e === "object" && e.tier) set.add(`${e.tier}:${kindOf(e)}`);
  }
  return [...set].sort();
}
