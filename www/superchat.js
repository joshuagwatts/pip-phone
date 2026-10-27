/** PIP Super Chat — five chat modes on the provider layer.
 *
 *  Modes: single · compare · auto · frugal · discuss.
 *  The UI calls these runners; this file owns routing, cost math, and the
 *  debate thread. Provider I/O goes through cloud.js completeProvider().
 *
 *  Consent (non-negotiable): every cloud call — keyless AND keyed — only
 *  fires when cloudAllowed: LEAKY mode, or explicit per-turn consent
 *  (the UI passes perTurnConsent:true when the user launched the mode).
 *  NEVER silently in SECURE. The discuss mode especially never auto-fires.
 *
 *  Uniform provider interface: complete(settings, providerId, messages, opts)
 *  → { text, usage:{in,out}|null, cost, provider, model, tokens }.
 */
import {
  PROVIDERS,
  completeProvider,
  isDeadModelFail,
  isQuotaFail,
  providerReady,
  privacyOn,
} from "./cloud.js";

/* ---------------------------------------------------------- price table ---
 * Static USD per 1M tokens {in, out}. Keyless = 0.
 * Keyed prices are approximate public list prices (2026) for the wired
 * life/boost models — update as providers change them. This is the ONE place
 * prices live.
 */
export const PRICES = {
  pollinations: { in: 0, out: 0, note: "keyless gpt-oss-20b" },
  groq: { in: 0.15, out: 0.75, note: "gpt-oss-120b approx" },
  cerebras: { in: 0.6, out: 0.6, note: "gpt-oss-120b approx" },
  openai: { in: 0.15, out: 0.6, note: "gpt-4o-mini" },
  anthropic: { in: 1.0, out: 5.0, note: "claude-haiku-4-5 approx" },
  gemini: { in: 0.1, out: 0.4, note: "gemini-3.6-flash approx" },
  deepseek: { in: 0.27, out: 1.1, note: "deepseek-chat approx" },
  mistral: { in: 0.1, out: 0.3, note: "mistral-small approx" },
  openrouter: { in: 0, out: 0, note: ":free routes wired" },
  xai: { in: 0.3, out: 0.5, note: "grok-3-mini approx" },
  nvidia: { in: 0, out: 0, note: "NIM free tier" },
  cloudflare: { in: 0, out: 0, note: "Workers AI free neurons" },
  zai: { in: 0, out: 0, note: "GLM Flash models $0" },
  ollama: { in: 0, out: 0, note: "Ollama Cloud free plan" },
};

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

/** Estimated USD for in/out token counts on a provider. */
export function estimateCost(providerId, inTokens, outTokens) {
  const pr = PRICES[String(providerId || "").toLowerCase()] || { in: 0, out: 0 };
  return ((Number(inTokens) || 0) * pr.in + (Number(outTokens) || 0) * pr.out) / 1e6;
}

/* ------------------------------------------------------- session spend --- */
let sessionSpend = 0;
export function getSessionSpend() {
  return sessionSpend;
}
export function resetSessionSpend() {
  sessionSpend = 0;
}
function addSpend(cost) {
  sessionSpend += Number(cost) || 0;
  return sessionSpend;
}

/* -------------------------------------------------------------- consent --- */
export function cloudAllowed(settings, perTurnConsent = false) {
  if (!privacyOn(settings)) return true; // LEAKY — cloud consented
  return Boolean(perTurnConsent); // SECURE — only an explicit per-turn launch
}

function assertCloudAllowed(settings, perTurnConsent, what = "Super Chat") {
  if (!cloudAllowed(settings, perTurnConsent)) {
    throw new Error(`SECURE blocks ${what} cloud calls — flip LEAKY or launch it per-turn`);
  }
}

/* ------------------------------------------------- pacing (rate limits) --- */
// Per-provider minimum gap between calls. Pollinations' anonymous tier allows
// ~1 reply / 30s per IP — proactive pacing beats tripping 429s mid-debate.
const PACE_MS = { pollinations: 32000 };
const lastCallAt = new Map();
async function pace(providerId) {
  const id = String(providerId || "").toLowerCase();
  const gap = PACE_MS[id] || 0;
  if (!gap) return;
  const last = lastCallAt.get(id) || 0;
  const wait = gap - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt.set(id, Date.now());
}

/* ----------------------------------------------------- uniform complete --- */
/**
 * complete(settings, providerId, messages, opts)
 * → { text, usage:{in,out}|null, cost, provider, model, tokens }
 * opts: { perTurnConsent, temperature, maxTokens, lane, skipSpend,
 *         job, why, scope } — job/why/scope feed the consent ledger.
 */
export async function complete(settings, providerId, messages, opts = {}) {
  const {
    perTurnConsent = false,
    temperature = 0.7,
    maxTokens = 1024,
    lane = "life",
    skipSpend = false,
    job = "",
    why = "",
    scope = null,
  } = opts;
  assertCloudAllowed(settings, perTurnConsent, `complete(${providerId})`);
  await pace(providerId);
  const out = await completeProvider(providerId, settings, messages, { temperature, maxTokens, lane, job, why, scope });
  let usage = out.usage;
  if (!usage) {
    usage = {
      in: estimateTokens(JSON.stringify(messages || [])),
      out: estimateTokens(out.text),
    };
  }
  const cost = estimateCost(out.provider, usage.in, usage.out);
  if (!skipSpend) addSpend(cost);
  return {
    text: out.text,
    usage,
    cost,
    provider: out.provider,
    model: out.model,
    tokens: out.tokens || 0,
  };
}

/* ------------------------------------------------------------ 1 · single --- */
export async function runSingle(settings, providerId, messages, opts = {}) {
  return complete(settings, providerId, messages, opts);
}

/* ----------------------------------------------------------- 2 · compare --- */
/**
 * N providers answer the same prompt in parallel; results side-by-side.
 * opts.completeFn(settings, providerId, messages, opts) may be injected
 * (tests / UI overrides). Never throws wholesale — per-seat ok/error rows.
 */
export async function runCompare(settings, providerIds, messages, opts = {}) {
  const { perTurnConsent = false, completeFn = null } = opts;
  assertCloudAllowed(settings, perTurnConsent, "compare");
  const ids = [...new Set((providerIds || []).map((x) => String(x).toLowerCase()))].slice(0, 6);
  if (!ids.length) throw new Error("compare needs at least one provider");
  const run = completeFn || ((s, id, m, o) => complete(s, id, m, o));
  const results = await Promise.all(
    ids.map(async (id) => {
      const prov = PROVIDERS.find((p) => p.id === id);
      try {
        const r = await run(settings, id, messages, { ...opts, perTurnConsent, job: "compare", why: "compare" });
        return {
          provider: id,
          label: prov?.label || id,
          model: r.model,
          text: r.text,
          usage: r.usage,
          cost: r.cost || 0,
          ok: true,
        };
      } catch (e) {
        return {
          provider: id,
          label: prov?.label || id,
          text: "",
          usage: null,
          cost: 0,
          ok: false,
          error: String(e.message || e).slice(0, 160),
        };
      }
    }),
  );
  const usage = results.reduce(
    (a, r) => ({ in: a.in + (r.usage?.in || 0), out: a.out + (r.usage?.out || 0) }),
    { in: 0, out: 0 },
  );
  return { results, usage, cost: results.reduce((a, r) => a + (r.cost || 0), 0) };
}

/* -------------------------------------------------------------- 3 · auto --- */
const CODE_RE = /\b(code|coding|function|bug|debug|script|python|javascript|typescript|regex|sql|api|compile|refactor|stack trace|stacktrace|error|exception|algorithm)\b/i;
const CREATIVE_RE = /\b(write|story|poem|lyric|caption|hook|verse|novel|screenplay|ad copy|tagline|song|rap)\b/i;
const REASON_RE = /\b(prove|proof|analyze deeply|step by step|compare and contrast|weigh|trade-?offs?|strategy|should i|decide|framework)\b/i;
const QUICK_RE = /^(who|what|when|where|which|how many|how much|is|are|do|does|can|define)\b/i;

/** Rules-based task classification for the auto router. Exported for tests. */
export function classifyTask(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const hasImage = list.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p && typeof p === "object" && p.type === "image_url"),
  );
  if (hasImage) return "vision";
  const text = list
    .filter((m) => m && m.role !== "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  if (CODE_RE.test(text)) return "code";
  if (REASON_RE.test(text)) return "reasoning";
  if (CREATIVE_RE.test(text)) return "creative";
  if (text.trim().length < 120 && QUICK_RE.test(text.trim())) return "quick";
  return "general";
}

/** Preferred provider order per task class (strongest first). */
const TASK_PREFS = {
  vision: ["gemini", "openai", "openrouter", "anthropic"],
  code: ["deepseek", "nvidia", "openai", "cloudflare", "openrouter", "zai", "groq", "pollinations", "ollama"],
  reasoning: ["anthropic", "deepseek", "nvidia", "openai", "cloudflare", "zai", "groq", "pollinations", "ollama"],
  creative: ["anthropic", "openai", "gemini", "nvidia", "cloudflare", "zai", "pollinations", "ollama"],
  quick: ["pollinations", "groq", "cloudflare", "nvidia", "gemini", "zai", "openai", "ollama"],
  general: ["pollinations", "groq", "nvidia", "cloudflare", "openai", "zai", "gemini", "anthropic", "ollama"],
};

/** Frugal money-mode: settings.superchat_frugal ∈ free-only | frugal | best-regardless (default frugal). */
export function frugalMode(settings) {
  const m = String(settings?.superchat_frugal || "frugal").toLowerCase();
  return m === "free-only" || m === "best-regardless" ? m : "frugal";
}

function isFree(id) {
  const pr = PRICES[id] || { in: 0, out: 0 };
  return pr.in === 0 && pr.out === 0;
}

/**
 * Pure pick (no network) — exported for tests and the UI's "why this model".
 * → { provider, task, reason }
 */
export function pickAutoProvider(settings, messages, opts = {}) {
  const mode = String(opts.frugal || frugalMode(settings)).toLowerCase();
  const task = classifyTask(messages);
  const prefs = TASK_PREFS[task] || TASK_PREFS.general;
  const avail = prefs.filter((id) => providerReady(settings, id));
  const anyReady = () =>
    PROVIDERS.filter((p) => providerReady(settings, p.id)).map((p) => p.id);
  if (!avail.length) {
    const any = anyReady();
    if (!any.length) throw new Error("no providers available — paste a key in DATA");
    return { provider: any[0], task, reason: "fallback: first available provider" };
  }
  if (mode === "free-only") {
    const free = avail.filter(isFree);
    if (free.length) return { provider: free[0], task, reason: "free-only: first free capable provider" };
    return { provider: avail[0], task, reason: "free-only: no free provider ready, first capable" };
  }
  if (mode === "best-regardless") {
    return { provider: avail[0], task, reason: "best-regardless: strongest capable provider" };
  }
  // frugal (default): cheapest capable — price-sorted, capability order breaks ties.
  const priced = avail.map((id) => {
    const pr = PRICES[id] || { in: 0, out: 0 };
    return { id, score: pr.in + pr.out * 2, pref: prefs.indexOf(id) };
  });
  priced.sort((a, b) => a.score - b.score || a.pref - b.pref);
  const pr = PRICES[priced[0].id] || { in: 0, out: 0 };
  return {
    provider: priced[0].id,
    task,
    reason: `frugal: cheapest capable (~$${(pr.in + pr.out).toFixed(2)}/1M blended)`,
  };
}

/** classifyTask output → scope-table job name (scopes.js). */
const JOB_FOR_TASK = {
  code: "code",
  creative: "creative",
  vision: "vision",
  quick: "quick",
  reasoning: "reasoning",
  general: "life",
};

export async function runAuto(settings, messages, opts = {}) {
  const pick = pickAutoProvider(settings, messages, opts);
  const res = await complete(settings, pick.provider, messages, {
    ...opts,
    job: JOB_FOR_TASK[pick.task] || "life",
    why: `auto · ${pick.reason}`,
  });
  return { ...res, task: pick.task, pickReason: pick.reason };
}

/* ------------------------------------------------------------ 4 · frugal --- */
/**
 * Cost-aware routing: estimates before the call, cheapest capable model,
 * returns usage + estimated cost with every response. Honors free-only when
 * the user set it (never escalates to best-regardless on its own).
 */
export async function runFrugal(settings, messages, opts = {}) {
  const userMode = frugalMode(settings);
  const mode = userMode === "best-regardless" ? "frugal" : userMode;
  const pick = pickAutoProvider(settings, messages, { ...opts, frugal: mode });
  const inEst = estimateTokens(JSON.stringify(messages || []));
  const outEst = Number(opts.maxTokens) || 1024;
  const estimate = estimateCost(pick.provider, inEst, outEst);
  const res = await complete(settings, pick.provider, messages, {
    ...opts,
    job: JOB_FOR_TASK[pick.task] || "life",
    why: `frugal · ${pick.reason}`,
  });
  return {
    ...res,
    task: pick.task,
    pickReason: pick.reason,
    estimate,
    estimateNote: `pre-call estimate $${estimate.toFixed(6)} · actual $${res.cost.toFixed(6)}`,
  };
}

/* ------------------------------------------------------------ 5 · discuss --- */
const DEFAULT_PERSONAS = [
  "You are a frugal pragmatist on a debate panel. You care about ROI and hate waste. Short, direct sentences. No fluff.",
  "You are a bold growth hacker on a debate panel. You believe in swinging big and measuring everything. Energetic and contrarian.",
  "You are an artist-first purist on a debate panel. You distrust anything that smells like selling out. Principled and blunt.",
];

function seatLabel(seats, i) {
  const s = seats[i];
  const prov = PROVIDERS.find((p) => p.id === s.id);
  return s.tag || prov?.label || s.id;
}

/**
 * One short, human reason for a failed seat — NEVER the raw fallback chain.
 * A provider's openaiWithFallback error can be a 9-segment wall of every
 * model it tried; a debate only ever surfaces the classified gist.
 */
export function shortFailReason(msg) {
  const m = String(msg?.message || msg || "");
  if (isDeadModelFail(m)) return "model gone — muted";
  if (/muted/i.test(m)) return "muted";
  if (isQuotaFail(m)) return "quota spent";
  if (/needs a key|no key|not keyed/i.test(m)) return "no key";
  const first = (m.split(/(?<=[.!?])\s+/)[0] || m).trim();
  return (first || "failed").slice(0, 100);
}

/** The whole debate died — one line: "DISCUSS failed — id: reason · id: reason". */
function discussFailLine(failReasons) {
  const pairs = [...failReasons.entries()].map(([id, r]) => `${id}: ${r}`);
  return `DISCUSS failed — ${pairs.join(" · ") || "no answers"}`.slice(0, 240);
}

/** Pre-call cost estimate for a discuss run (worst case: full maxTokens each turn). */
export function estimateDiscussCost(seatIds, rounds, topic, maxTokens, includeSynthesis = true) {
  const turnsPerSeat = 1 + rounds;
  const topicTokens = estimateTokens(topic);
  let total = 0;
  for (const id of seatIds) {
    const inEst = topicTokens + turnsPerSeat * 1500; // topic + others' replies context
    total += estimateCost(id, inEst, turnsPerSeat * maxTokens);
  }
  if (includeSynthesis) {
    const synthId = seatIds[0];
    total += estimateCost(synthId, topicTokens + seatIds.length * turnsPerSeat * 400, 600);
  }
  return total;
}

/**
 * Round-table debate.
 * seats: provider ids (default: router's pick of 3 — distinct ready providers,
 *   repeating when fewer are ready; personas differentiate the voices).
 * Rebuttal rounds are turn-taking: sequential in fixed speaking order, each
 * seat's prompt carrying the full transcript so far (all prior rounds + every
 * rebuttal already given in the current round).
 * A final synthesis closes the thread.
 * Cost-capped: estimate > maxCost without confirmed:true → { needsConfirm:true }
 * (the UI shows the estimate and re-calls with confirmed:true).
 * Seat failures are survivable: a failed seat sits out with a short reason
 * (result.failures); only an all-seats failure throws, as one short line.
 * opts.completeFn injectable for tests.
 */
export async function runDiscuss(settings, topic, opts = {}) {
  const {
    seats = null,
    rounds = 2,
    personas = null,
    synthesizer = null,
    maxCost = 0.05,
    confirmed = false,
    perTurnConsent = false,
    temperature = 0.75,
    maxTokens = 300,
    completeFn = null,
  } = opts;
  assertCloudAllowed(settings, perTurnConsent, "discuss");
  const cleanTopic = String(topic || "").trim();
  if (!cleanTopic) throw new Error("discuss needs a topic");
  const safeRounds = Math.min(4, Math.max(1, Number(rounds) || 2));

  // Resolve seats: distinct ready providers first, repeat if short.
  let seatIds = (seats || []).map((s) => String(s).toLowerCase());
  if (!seatIds.length) {
    const ready = PROVIDERS.filter((p) => providerReady(settings, p.id)).map((p) => p.id);
    if (!ready.length) throw new Error("no providers available — paste a key in DATA");
    seatIds = [];
    for (let i = 0; i < 3 && ready.length; i++) seatIds.push(ready[i % ready.length]);
  }
  seatIds.forEach((id) => {
    if (!providerReady(settings, id)) throw new Error(`${id} not available (no key or maxed)`);
  });

  const seatObjs = seatIds.map((id, i) => ({
    id,
    tag: `${seatLabel([{ id }], 0)} ${i + 1}`,
    persona: (personas && personas[i]) || DEFAULT_PERSONAS[i % DEFAULT_PERSONAS.length],
  }));

  const estimate = estimateDiscussCost(seatIds, safeRounds, cleanTopic, maxTokens, true);
  if (estimate > maxCost && !confirmed) {
    return {
      needsConfirm: true,
      estimate,
      seats: seatObjs.map((s) => ({ id: s.id, tag: s.tag })),
      rounds: safeRounds,
      maxCost,
      note: `Estimated $${estimate.toFixed(4)} exceeds the $${Number(maxCost).toFixed(4)} cap — confirm to run.`,
    };
  }

  const run = completeFn || ((s, id, m, o) => complete(s, id, m, o));
  const thread = []; // [{ round, turns: [{ seat, provider, tag, text, usage, cost }] }]

  // A seat that fails does NOT kill the debate: its turn is recorded with a
  // SHORT classified reason and the panel goes on without it. Only when
  // every seat fails does the run throw — and then it's one short line.
  const failReasons = new Map(); // providerId -> first short reason
  let okTurns = 0;
  const tryTurn = async (i, messages, o) => {
    const s = seatObjs[i];
    try {
      const r = await run(settings, s.id, messages, o);
      okTurns++;
      return { seat: i, provider: s.id, tag: s.tag, text: r.text, usage: r.usage, cost: r.cost || 0 };
    } catch (e) {
      const reason = shortFailReason(e);
      if (!failReasons.has(s.id)) failReasons.set(s.id, reason);
      return { seat: i, provider: s.id, tag: s.tag, text: "", usage: null, cost: 0, failed: true, error: reason };
    }
  };
  const turnText = (t) => t.text || `(sat out — ${t.error || "failed"})`;

  // Full transcript so far: every completed round + the current round's turns
  // already spoken. Rebuttals run sequentially in fixed speaking order, so
  // each seat's prompt includes the rebuttals that landed before its turn —
  // turn-taking, not parallel essays.
  const transcriptSoFar = (roundNo, thisRoundTurns) => {
    const parts = [];
    for (const rd of thread) {
      parts.push(
        `--- Round ${rd.round} (${rd.kind}) ---\n` +
          rd.turns.map((t) => `${t.tag}: ${turnText(t)}`).join("\n\n"),
      );
    }
    if (thisRoundTurns.length) {
      parts.push(
        `--- Round ${roundNo} (rebuttal, in progress) ---\n` +
          thisRoundTurns.map((t) => `${t.tag}: ${turnText(t)}`).join("\n\n"),
      );
    }
    return parts.join("\n\n");
  };

  // Round 0 — opening takes. Sequential (not parallel): keyless tiers like
  // Pollinations allow ~1 reply / 30s per IP, so parallel openers collide.
  // Pacing in complete() spaces them; rebuttal rounds are sequential anyway.
  {
    const turns = [];
    for (let i = 0; i < seatObjs.length; i++) {
      const s = seatObjs[i];
      turns.push(
        await tryTurn(
          i,
          [
            { role: "system", content: s.persona },
            {
              role: "user",
              content:
                `DEBATE TOPIC: ${cleanTopic}\n\nGive your opening take in under ${maxTokens} tokens. ` +
                `Be direct and opinionated — this is a debate, not an essay. Take a clear stance.`,
            },
          ],
          { perTurnConsent, temperature, maxTokens, job: "discuss", why: "discuss · seat" },
        ),
      );
    }
    thread.push({ round: 0, kind: "openers", turns });
  }

  // Rounds 1..K — rebut / refine in fixed speaking order (turn-taking).
  // Each seat gets the FULL transcript so far: all prior rounds plus every
  // rebuttal already given in the current round. Seat 3's rebuttal answers
  // seats 1+2's rebuttals, not just their openers.
  const SPEAK_ORDER = seatObjs.map((s) => s.tag).join(" → ");
  for (let r = 1; r <= safeRounds; r++) {
    const turns = [];
    for (let i = 0; i < seatObjs.length; i++) {
      const s = seatObjs[i];
      const soFar = transcriptSoFar(r, turns);
      const justSpoke = turns.map((t) => t.tag).join(", ");
      turns.push(
        await tryTurn(
          i,
          [
            { role: "system", content: s.persona },
            {
              role: "user",
              content:
                `DEBATE TOPIC: ${cleanTopic}\n\n` +
                `Speaking order this round: ${SPEAK_ORDER}. You are ${s.tag}, ` +
                (i === 0
                  ? `speaking first — engage the transcript below head-on.\n\n`
                  : `speaking after ${justSpoke} — their rebuttals are the freshest part of the transcript.\n\n`) +
                `FULL DEBATE TRANSCRIPT SO FAR:\n\n${soFar}\n\n` +
                `Now give YOUR rebuttal. Respond DIRECTLY to the other panelists' points` +
                (turns.length
                  ? ` — especially what ${justSpoke} just argued this round: agree where they're right, ` +
                    `push back where they're wrong, quote them by name when you do.`
                  : `: agree where they're right, push back where they're wrong, quote them by name when you do.`) +
                ` Don't repeat your opener; move the discussion forward. Under ${maxTokens} tokens.`,
            },
          ],
          { perTurnConsent, temperature, maxTokens, job: "discuss", why: "discuss · seat" },
        ),
      );
    }
    thread.push({ round: r, kind: "rebuttal", turns });
  }

  // Synthesis — strongest ready provider (or explicit pick) reads the thread.
  // Prefer a seat that actually answered; a dead seat can't moderate.
  const answeredIds = new Set();
  for (const rd of thread) for (const t of rd.turns) if (!t.failed) answeredIds.add(t.provider);
  const synthId =
    synthesizer && providerReady(settings, synthesizer)
      ? String(synthesizer).toLowerCase()
      : answeredIds.has(seatIds[0])
        ? seatIds[0]
        : seatIds.find((id) => answeredIds.has(id)) || seatIds[0];
  const fullThread = thread
    .map((rd) =>
      `## Round ${rd.round} (${rd.kind})\n` +
      rd.turns.map((t) => `### ${t.tag}\n${turnText(t)}`).join("\n\n"),
    )
    .join("\n\n");
  let synthesis = { provider: synthId, text: "", usage: null, cost: 0 };
  try {
    const synthRes = await run(
      settings,
      synthId,
      [
        {
          role: "system",
          content:
            "You are the moderator synthesizing a panel debate. Read the full thread. " +
            "Write a tight synthesis: where the panel agreed, where they split, and your " +
            "bottom-line recommendation. Quote the strongest point from each side. No fluff.",
        },
        { role: "user", content: `DEBATE TOPIC: ${cleanTopic}\n\nFULL THREAD:\n\n${fullThread}` },
      ],
      { perTurnConsent, temperature: 0.5, maxTokens: 500, job: "discuss", why: "discuss · synthesis" },
    );
    synthesis = {
      provider: synthId,
      text: synthRes.text,
      usage: synthRes.usage,
      cost: synthRes.cost || 0,
    };
  } catch (e) {
    const reason = shortFailReason(e);
    if (!failReasons.has(synthId)) failReasons.set(synthId, reason);
    synthesis = { provider: synthId, text: "", usage: null, cost: 0, error: reason };
  }

  // Every seat sat out — the debate never happened. One short line, never
  // the concatenated raw error chains.
  if (!okTurns) throw new Error(discussFailLine(failReasons));

  const usage = { in: 0, out: 0 };
  let cost = 0;
  for (const rd of thread)
    for (const t of rd.turns) {
      usage.in += t.usage?.in || 0;
      usage.out += t.usage?.out || 0;
      cost += t.cost || 0;
    }
  usage.in += synthesis.usage?.in || 0;
  usage.out += synthesis.usage?.out || 0;
  cost += synthesis.cost || 0;

  return {
    topic: cleanTopic,
    seats: seatObjs.map((s) => ({ id: s.id, tag: s.tag, persona: s.persona })),
    rounds: safeRounds,
    thread,
    synthesis,
    failures: [...failReasons.entries()].map(([provider, reason]) => ({ provider, reason })),
    usage,
    cost,
    estimate,
  };
}
