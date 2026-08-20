import { orderFor } from "./command.js";
import { httpPostJson, httpGet } from "./net.js";

const FISHY = new Set(["gemini", "xai"]);

/** @type {Array<{id:string, label:string, field:string, base:string, life:string, boost:string, fishy?:boolean, headers?:Record<string,string>}>} */
export const PROVIDERS = [
  {
    id: "groq",
    label: "Groq",
    field: "groq",
    base: "https://api.groq.com/openai/v1",
    life: "llama-3.3-70b-versatile",
    boost: "llama-3.3-70b-versatile",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    field: "openrouter",
    base: "https://openrouter.ai/api/v1",
    life: "meta-llama/llama-3.3-70b-instruct:free",
    boost: "qwen/qwen3-coder:free",
    headers: { "HTTP-Referer": "https://pip.phone", "X-Title": "Phone Pip" },
  },
  {
    id: "cerebras",
    label: "Cerebras",
    field: "cerebras",
    base: "https://api.cerebras.ai/v1",
    life: "gpt-oss-120b",
    boost: "gpt-oss-120b",
  },
  {
    id: "mistral",
    label: "Mistral",
    field: "mistral",
    base: "https://api.mistral.ai/v1",
    life: "mistral-small-latest",
    boost: "mistral-small-latest",
  },
  {
    id: "gemini",
    label: "Gemini",
    field: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    life: "gemini-2.5-flash",
    boost: "gemini-2.5-flash",
    fishy: true,
  },
  {
    id: "xai",
    label: "Grok",
    field: "xai",
    base: "https://api.x.ai/v1",
    life: "grok-3-mini",
    boost: "grok-3-mini",
    fishy: true,
  },
];

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
    liveHealth[id] = {
      ok: Boolean(row.ok),
      error: String(row.error || "").slice(0, 120),
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
    const { body, status } = await httpGet(`${prov.base.replace(/\/$/, "")}/models`, 8000, {
      Authorization: `Bearer ${key}`,
      ...(prov.headers || {}),
    });
    if (status >= 400) throw new Error(`http ${status}`);
    const data = JSON.parse(body || "{}");
    const n = Array.isArray(data.data) ? data.data.length : Array.isArray(data.models) ? data.models.length : 1;
    if (!n) throw new Error("empty models");
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

/** CHAT uses every keyed provider — including Gemini/Grok — best model first. */
const CHAT_ORDER = ["gemini", "groq", "openrouter", "xai", "cerebras", "mistral"];

export function chatCloudEnabled(settings) {
  return keyedProviders(settings).length > 0;
}

export function chatChain(settings, job = "life") {
  const pin = brainPin(settings);
  const keyedIds = keyedProviders(settings).map((p) => p.id);
  const ids = orderFor(job, keyedIds, liveHealth, pin);
  return ids.map((id) => PROVIDERS.find((p) => p.id === id)).filter(Boolean);
}

/** Phone CHAT can use cloud whenever keys exist — OPP/CODE still respect LEAKY via chain(). */
export function chain(settings, lane = "life") {
  if (privacyOn(settings)) return [];
  const pin = brainPin(settings);
  const out = [];

  if (pin !== "auto" && pin !== "local") {
    const picked = PROVIDERS.find((p) => p.id === pin);
    if (picked && providerKey(settings, picked)) out.push(picked);
    return out;
  }

  const order =
    lane === "boost"
      ? ["groq", "openrouter", "cerebras", "mistral"]
      : ["groq", "openrouter", "xai", "cerebras", "mistral"];

  for (const id of order) {
    const prov = PROVIDERS.find((p) => p.id === id);
    if (!prov || !providerKey(settings, prov)) continue;
    if (prov.fishy && FISHY.has(prov.id)) continue;
    out.push(prov);
  }
  return out;
}

async function openaiOnce(prov, key, model, messages, temperature, maxTokens, tools) {
  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools && tools.length) payload.tools = tools;
  const data = await httpPostJson(
    `${prov.base.replace(/\/$/, "")}/chat/completions`,
    {
      Authorization: `Bearer ${key}`,
      ...(prov.headers || {}),
    },
    payload,
  );
  const msg = (((data.choices || [])[0] || {}).message || {});
  const text = String(msg.content || "").trim();
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

export async function cloudCompleteTools(settings, messages, tools, lane = "boost", temperature = 0.2, maxTokens = 8000) {
  const errors = [];
  for (const prov of chain(settings, lane)) {
    const key = providerKey(settings, prov);
    if (!key) continue;
    try {
      return await openaiOnce(prov, key, modelFor(prov, lane), messages, temperature, maxTokens, tools);
    } catch (e) {
      errors.push(`${prov.id}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  throw new Error(errors.join(" · ") || "CODE needs LEAKY + a cloud key, or pair desktop for GPU code edits");
}

export async function chatComplete(settings, messages, temperature = 0.7, maxTokens = 1024, job = "life") {
  const errors = [];
  for (const prov of chatChain(settings, job)) {
    const key = providerKey(settings, prov);
    if (!key) continue;
    try {
      return await openaiOnce(prov, key, modelFor(prov, "life"), messages, temperature, maxTokens);
    } catch (e) {
      errors.push(`${prov.id}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  throw new Error(errors.join(" · ") || "no cloud brain keyed");
}

export async function cloudComplete(settings, messages, lane = "life", temperature = 0.7, maxTokens = 400) {
  const errors = [];
  for (const prov of chain(settings, lane)) {
    const key = providerKey(settings, prov);
    if (!key) continue;
    try {
      return await openaiOnce(prov, key, modelFor(prov, lane), messages, temperature, maxTokens);
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
