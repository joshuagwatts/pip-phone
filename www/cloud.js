import { orderFor } from "./command.js";
import { httpPostJson, httpGet } from "./net.js";

/** @type {Array<{id:string, label:string, field:string, base:string, life:string, boost:string, fishy?:boolean, headers?:Record<string,string>}>} */
export const PROVIDERS = [
  {
    id: "groq",
    label: "Groq",
    field: "groq",
    base: "https://api.groq.com/openai/v1",
    life: "llama-3.3-70b-versatile",
    boost: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
    tip: "No card. Fast Llama 3.3 70B.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    field: "openrouter",
    base: "https://openrouter.ai/api/v1",
    life: "meta-llama/llama-3.3-70b-instruct:free",
    boost: "qwen/qwen3-coder:free",
    headers: { "HTTP-Referer": "https://pip.phone", "X-Title": "Phone Pip" },
    keyUrl: "https://openrouter.ai/keys",
    tip: "One key · :free models · vision via Gemini routes.",
    vision: true,
  },
  {
    id: "cerebras",
    label: "Cerebras",
    field: "cerebras",
    base: "https://api.cerebras.ai/v1",
    life: "gpt-oss-120b",
    boost: "gpt-oss-120b",
    models: ["gpt-oss-120b", "llama3.1-8b", "llama-3.3-70b", "gemma-4-31b"],
    reasoning: true,
    keyUrl: "https://cloud.cerebras.ai",
    tip: "High speed · ~1M tok/day.",
  },
  {
    id: "mistral",
    label: "Mistral",
    field: "mistral",
    base: "https://api.mistral.ai/v1",
    life: "mistral-small-latest",
    boost: "mistral-small-latest",
    keyUrl: "https://console.mistral.ai/api-keys/",
    tip: "Paste API key from console.",
  },
  {
    id: "gemini",
    label: "Gemini",
    field: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    life: "gemini-2.5-flash",
    boost: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"],
    fishy: true,
    keyUrl: "https://aistudio.google.com/apikey",
    tip: "Google AI Studio key · vision OK for rocks/shingles.",
    vision: true,
  },
  {
    id: "xai",
    label: "Grok",
    field: "xai",
    base: "https://api.x.ai/v1",
    life: "grok-3-mini",
    boost: "grok-3-mini",
    fishy: true,
    keyUrl: "https://console.x.ai/",
    tip: "xAI console key.",
  },
];

export function keyTag(settings, prov, health = null) {
  const key = providerKey(settings, prov);
  if (!key) return { tag: "NO KEY", state: "off" };
  const h = health || liveHealth[prov.id];
  if (h?.ok === true) return { tag: "LIVE", state: "on" };
  if (h?.ok === false) return { tag: "KEY BAD", state: "bad" };
  return { tag: "KEY SET", state: "key" };
}

export function keyHint(settings, prov) {
  const key = providerKey(settings, prov);
  if (!key) return "";
  if (key.length < 10) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
export function privacyOn(settings) {
  return String(settings.privacy_mode || "secure").toLowerCase() !== "leaky";
}

export function brainPin(settings) {
  return String(settings.brain_pin || "auto").toLowerCase();
}

function providerKey(settings, prov) {
  return String(settings[prov.field] || "").trim();
}

export function keyedProviders(settings) {
  return PROVIDERS.filter((p) => providerKey(settings, p));
}

const liveHealth = {};

export function providerHealth() {
  return { ...liveHealth };
}

export function markHealth(id, ok, error = "") {
  liveHealth[id] = { ok: Boolean(ok), error: String(error || "").slice(0, 120), at: Date.now() };
  return liveHealth[id];
}

/** Restore probe results saved on the phone. */
export function hydrateHealth(saved) {
  if (!saved || typeof saved !== "object") return providerHealth();
  for (const [id, row] of Object.entries(saved)) {
    if (!row || typeof row !== "object") continue;
    // Drop stale "KEY BAD" from the short-lived chat-ping probe (v0.1.51).
    const err = String(row.error || "");
    if (row.ok === false && /empty reply|PIP OK|chat ping|timeout|failed/i.test(err) && !/http 40[13]|invalid.?api|unauthorized|no key/i.test(err)) {
      continue;
    }
    liveHealth[id] = {
      ok: Boolean(row.ok),
      error: err.slice(0, 120),
      at: Number(row.at) || Date.now(),
    };
  }
  return providerHealth();
}

export async function probeModels(settings, prov) {
  const key = providerKey(settings, prov);
  if (!key) {
    markHealth(prov.id, false, "no key");
    return { ok: false, id: prov.id, error: "no key" };
  }
  try {
    const { body, status } = await httpGet(`${prov.base.replace(/\/$/, "")}/models`, 10000, {
      Authorization: `Bearer ${key}`,
      ...(prov.headers || {}),
    });
    if (status === 401 || status === 403) throw new Error(`http ${status} unauthorized`);
    if (status >= 400) throw new Error(`http ${status}`);
    const data = JSON.parse(body || "{}");
    const n = Array.isArray(data.data) ? data.data.length : Array.isArray(data.models) ? data.models.length : 1;
    if (!n) throw new Error("empty models");
    // /models accepted the key → LIVE. Do not require a chat ping (that poisoned good keys).
    markHealth(prov.id, true);
    return { ok: true, id: prov.id, models: n };
  } catch (e) {
    markHealth(prov.id, false, e.message || e);
    return { ok: false, id: prov.id, error: String(e.message || e).slice(0, 160) };
  }
}

export async function probeKeyed(settings) {
  const keyed = keyedProviders(settings);
  const out = [];
  for (const prov of keyed) {
    out.push(await probeModels(settings, prov));
  }
  return out;
}

export function cloudStatus(settings) {
  const leaky = !privacyOn(settings);
  const pin = brainPin(settings);
  const keyed = keyedProviders(settings);
  return {
    leaky,
    pin,
    keyed: keyed.map((p) => p.id),
    grok: Boolean(providerKey(settings, PROVIDERS.find((x) => x.id === "xai"))),
    health: providerHealth(),
  };
}

function modelFor(prov, lane) {
  return lane === "boost" ? prov.boost : prov.life;
}

function modelsFor(prov, lane) {
  const primary = modelFor(prov, lane);
  const extras = Array.isArray(prov.models) ? prov.models : [];
  return [...new Set([primary, ...extras].filter(Boolean))];
}

function messageText(msg) {
  if (!msg || typeof msg !== "object") return "";
  const c = msg.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (typeof p === "string") return p;
        if (!p || typeof p !== "object") return "";
        return p.text || p.content || p.output_text || "";
      })
      .join("")
      .trim();
  }
  return String(msg.reasoning || msg.reasoning_content || msg.refusal || "").trim();
}

/** LIVE cloud ids (probe ok) — chat should prefer these. */
export function liveProviderIds(settings) {
  const health = providerHealth();
  return keyedProviders(settings)
    .map((p) => p.id)
    .filter((id) => health[id]?.ok === true);
}

async function openaiOnce(prov, key, model, messages, temperature, maxTokens, tools) {
  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  // gpt-oss and other reasoning models often leave content empty unless effort is low.
  if (prov.reasoning) payload.reasoning_effort = "low";
  if (tools && tools.length) payload.tools = tools;
  let data;
  try {
    data = await httpPostJson(
      `${prov.base.replace(/\/$/, "")}/chat/completions`,
      {
        Authorization: `Bearer ${key}`,
        ...(prov.headers || {}),
      },
      payload,
      45000,
    );
  } catch (e) {
    throw new Error(`${prov.id}: ${String(e.message || e).slice(0, 140)}`);
  }
  if (data?.error) {
    const err = data.error;
    const msg = typeof err === "string" ? err : err.message || JSON.stringify(err);
    throw new Error(`${prov.id}: ${String(msg).slice(0, 140)}`);
  }
  const choice = (data.choices || [])[0] || {};
  const msg = choice.message || {};
  let text = messageText(msg);
  if (!text) text = messageText(choice);
  if (!text && !(msg.tool_calls || []).length) throw new Error(`${prov.id} empty reply`);
  const usage = data.usage || {};
  const tokens =
    (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0) ||
    Number(usage.total_tokens) ||
    0;
  return {
    text,
    message: msg,
    tool_calls: msg.tool_calls || [],
    provider: prov.id,
    model,
    tokens,
    usage,
  };
}

async function openaiWithFallback(prov, key, lane, messages, temperature, maxTokens, tools) {
  const errors = [];
  for (const model of modelsFor(prov, lane)) {
    try {
      return await openaiOnce(prov, key, model, messages, temperature, maxTokens, tools);
    } catch (e) {
      errors.push(String(e.message || e).slice(0, 120));
    }
  }
  throw new Error(errors.join(" · ") || `${prov.id} failed`);
}

/** CHAT — fastest reliable brains first (orderFor / JOBS.life owns the cascade). */
export function chatCloudEnabled(settings) {
  return keyedProviders(settings).length > 0;
}

export function chatChain(settings, job = "life") {
  const pin = brainPin(settings);
  if (pin === "local" || pin === "lite" || pin === "qwen") return [];
  // compare uses auto hierarchy order, then fans out
  const effectivePin = pin === "compare" || pin === "all" ? "auto" : pin;
  const keyedIds = keyedProviders(settings).map((p) => p.id);
  const ids = orderFor(job, keyedIds, liveHealth, effectivePin);
  return ids.map((id) => PROVIDERS.find((p) => p.id === id)).filter(Boolean);
}

/** OPP/CODE cloud chain — same LIVE upscale/downscale as CHAT when LEAKY. */
export function chain(settings, lane = "life") {
  if (privacyOn(settings)) return [];
  const pin = brainPin(settings);
  const keyedIds = keyedProviders(settings).map((p) => p.id);
  const job = lane === "boost" ? "boost" : lane === "code" ? "code" : "life";
  const ids = orderFor(job, keyedIds, liveHealth, pin);
  return ids.map((id) => PROVIDERS.find((p) => p.id === id)).filter(Boolean);
}

export async function cloudCompleteTools(settings, messages, tools, lane = "boost", temperature = 0.2, maxTokens = 8000) {
  const errors = [];
  for (const prov of chain(settings, lane)) {
    const key = providerKey(settings, prov);
    if (!key) continue;
    try {
      const out = await openaiWithFallback(prov, key, lane, messages, temperature, maxTokens, tools);
      markHealth(prov.id, true);
      return out;
    } catch (e) {
      markHealth(prov.id, false, String(e.message || e).slice(0, 120));
      errors.push(`${prov.id}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  throw new Error(errors.join(" · ") || "CODE needs LEAKY + a cloud key, or pair desktop for GPU code edits");
}

export async function chatComplete(settings, messages, temperature = 0.7, maxTokens = 1024, job = "life") {
  const errors = [];
  const chainList = chatChain(settings, job);
  if (!chainList.length) throw new Error("no keyed chat brains — paste keys in DATA or unpin");
  for (const prov of chainList) {
    const key = providerKey(settings, prov);
    if (!key) continue;
    try {
      const out = await openaiWithFallback(prov, key, "life", messages, temperature, maxTokens);
      markHealth(prov.id, true);
      return out;
    } catch (e) {
      // Soft miss — keep prior LIVE so hierarchy isn't poisoned by one timeout.
      errors.push(`${prov.id}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  throw new Error(errors.join(" · ") || "no cloud brain keyed");
}

/**
 * Opt-in parallel compare — all keyed chat brains at once (pin=compare or "compare …").
 * Does not run on every message.
 */
export async function compareComplete(settings, messages, temperature = 0.7, maxTokens = 1024, job = "life") {
  const chainList = chatChain(
    { ...settings, brain_pin: "auto" },
    job,
  );
  if (!chainList.length) throw new Error("no keyed chat brains — paste keys in DATA");
  const jobs = chainList.map(async (prov) => {
    const key = providerKey(settings, prov);
    if (!key) return null;
    try {
      const out = await openaiWithFallback(prov, key, "life", messages, temperature, maxTokens);
      markHealth(prov.id, true);
      return {
        provider: out.provider,
        label: prov.label || prov.id,
        model: out.model,
        text: out.text,
        tokens: Number(out.tokens) || 0,
        ok: true,
      };
    } catch (e) {
      return {
        provider: prov.id,
        label: prov.label || prov.id,
        text: "",
        error: String(e.message || e).slice(0, 160),
        ok: false,
      };
    }
  });
  const settled = (await Promise.all(jobs)).filter(Boolean);
  const ok = settled.filter((r) => r.ok && r.text);
  if (!ok.length) {
    throw new Error(settled.map((r) => r.error || r.provider).join(" · ") || "compare failed");
  }
  return {
    text: ok[0].text,
    provider: ok[0].provider,
    model: ok[0].model,
    tokens: ok[0].tokens,
    compare: settled,
  };
}

export async function cloudComplete(settings, messages, lane = "life", temperature = 0.7, maxTokens = 400) {
  const errors = [];
  for (const prov of chain(settings, lane)) {
    const key = providerKey(settings, prov);
    if (!key) continue;
    try {
      const out = await openaiWithFallback(prov, key, lane, messages, temperature, maxTokens);
      markHealth(prov.id, true);
      return out;
    } catch (e) {
      errors.push(`${prov.id}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  throw new Error(errors.join(" · ") || "no cloud brain keyed");
}

export async function probeProvider(settings, providerId) {
  const prov = PROVIDERS.find((p) => p.id === providerId);
  if (!prov) return { ok: false, error: "unknown provider" };
  const key = providerKey(settings, prov);
  if (!key) return { ok: false, error: "no key" };
  try {
    const out = await openaiOnce(
      prov,
      key,
      prov.life,
      [
        { role: "system", content: "Reply with exactly: PIP OK" },
        { role: "user", content: "ping" },
      ],
      0,
      8,
    );
    return { ok: /pip ok/i.test(out.text), provider: prov.id, sample: out.text.slice(0, 40) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 160) };
  }
}
