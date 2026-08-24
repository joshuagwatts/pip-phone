import { orderFor } from "./command.js";
import { httpPostJson, httpGet } from "./net.js";
import { agentSystem } from "./crew.js";

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
    // llama3.1-8b / llama-3.3-70b deprecated — gpt-oss-120b is current.
    life: "gpt-oss-120b",
    boost: "gpt-oss-120b",
    models: ["gpt-oss-120b", "llama3.1-8b", "llama-3.3-70b"],
    reasoning: true,
    keyUrl: "https://cloud.cerebras.ai",
    tip: "High speed · gpt-oss-120b.",
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
    // gemini-2.0-flash shut down Jun 2026 → 404. Docs now use gemini-3.6-flash.
    life: "gemini-3.6-flash",
    boost: "gemini-3.6-flash",
    models: ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-3-flash-preview", "gemini-flash-latest"],
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
  {
    id: "deepseek",
    label: "DeepSeek",
    field: "deepseek",
    base: "https://api.deepseek.com",
    life: "deepseek-chat",
    boost: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyUrl: "https://platform.deepseek.com/api_keys",
    tip: "Efficient · strong coding · OpenAI-compatible.",
  },
  {
    id: "openai",
    label: "OpenAI",
    field: "openai",
    base: "https://api.openai.com/v1",
    life: "gpt-4o-mini",
    boost: "gpt-4o",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    keyUrl: "https://platform.openai.com/api-keys",
    tip: "ChatGPT family · strong vision via gpt-4o.",
    vision: true,
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
  const mode = String(settings.privacy_mode || "leaky").toLowerCase();
  return mode !== "leaky" && mode !== "leak" && mode !== "0" && mode !== "false" && mode !== "off";
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
    return { ok: false, id: prov.id, error: "no key" };
  }
  try {
    const { body, status } = await httpGet(`${prov.base.replace(/\/$/, "")}/models`, 15000, {
      Authorization: `Bearer ${key}`,
      ...(prov.headers || {}),
    });
    if (!status) throw new Error("network failed (status 0)");
    if (status === 401 || status === 403) throw new Error(`http ${status} unauthorized`);
    if (status >= 400) throw new Error(`http ${status}`);
    let data = {};
    try {
      data = JSON.parse(body || "{}");
    } catch {
      throw new Error("bad JSON from /models");
    }
    const n = Array.isArray(data.data)
      ? data.data.length
      : Array.isArray(data.models)
        ? data.models.length
        : data.object === "list" || data.data
          ? 1
          : 0;
    // Empty {} is NOT success — old bug marked LIVE on network failure.
    if (!n && !Array.isArray(data.data) && body && body.length < 8) throw new Error("empty models");
    if (!n && !data.data && !data.models && !data.object) throw new Error("empty models body");
    markHealth(prov.id, true);
    return { ok: true, id: prov.id, models: n || 1 };
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

function laneForJob(job) {
  if (job === "boost" || job === "code") return "boost";
  return "life";
}

function modelsFor(prov, lane) {
  const primary = modelFor(prov, lane);
  const extras = Array.isArray(prov.models) ? prov.models : [];
  return [...new Set([primary, ...extras].filter(Boolean))];
}

function messageText(msg) {
  if (!msg || typeof msg !== "object") return "";
  const c = msg.content;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (Array.isArray(c)) {
    const joined = c
      .map((p) => {
        if (typeof p === "string") return p;
        if (!p || typeof p !== "object") return "";
        return p.text || p.content || p.output_text || "";
      })
      .join("")
      .trim();
    if (joined) return joined;
  }
  // gpt-oss / reasoning models often put the answer in reasoning fields with empty content.
  const reasoned = String(msg.reasoning || msg.reasoning_content || msg.refusal || "").trim();
  if (!reasoned) return "";
  // Prefer last non-empty paragraph after thinking markers.
  const cleaned = reasoned
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^thinking[:\s].*$/gim, "")
    .trim();
  return cleaned || reasoned;
}

/** LIVE cloud ids (probe ok) — chat should prefer these. */
export function liveProviderIds(settings) {
  const health = providerHealth();
  return keyedProviders(settings)
    .map((p) => p.id)
    .filter((id) => health[id]?.ok === true);
}

/**
 * Pack chat history for cloud APIs:
 * one system (Pip voice) + recent user/assistant turns.
 * Avoids multi-system / long few-shot dumps that free APIs reject.
 */
export function packMessagesForCloud(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const systems = [];
  const turns = [];
  for (const m of list) {
    if (!m || !m.content) continue;
    const role = m.role === "assistant" || m.role === "pip" ? "assistant" : m.role === "system" ? "system" : "user";
    const content = String(m.content).trim();
    if (!content) continue;
    if (role === "system") systems.push(content);
    else turns.push({ role, content: content.slice(0, 6000) });
  }
  const system = systems.join("\n\n").slice(0, 8000);
  const recent = turns.slice(-12);
  const out = [];
  if (system) out.push({ role: "system", content: system });
  out.push(...recent);
  if (!out.length) out.push({ role: "user", content: "hey" });
  return out;
}

/** Minimal payload when full history/system gets rejected by free-tier APIs. */
export function slimMessagesForCloud(messages) {
  const packed = packMessagesForCloud(messages);
  const system = packed.find((m) => m.role === "system")?.content || "";
  const user = [...packed].reverse().find((m) => m.role === "user");
  const slimSys =
    system
      .split("\n")
      .filter((line) => !/^Voice examples|^Job:/i.test(line.trim()))
      .slice(0, 12)
      .join("\n")
      .slice(0, 1400) || "You are Pip — direct, warm, honest. Stay in character.";
  return [
    { role: "system", content: slimSys },
    { role: "user", content: String(user?.content || "hey").slice(0, 4000) },
  ];
}

async function openaiOnce(prov, key, model, messages, temperature, maxTokens, tools) {
  const packed = packMessagesForCloud(messages);
  const payload = {
    model,
    messages: packed,
    temperature: Math.min(1, Math.max(0, Number(temperature) || 0.7)),
    max_tokens: Math.min(4096, Math.max(64, Number(maxTokens) || 1024)),
  };
  // Only gpt-oss-style models want reasoning_effort — others 400 on unknown fields.
  if (prov.reasoning && /gpt-oss|o1|o3|reasoning/i.test(model)) {
    payload.reasoning_effort = "low";
  }
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
  const models = modelsFor(prov, lane);
  for (const model of models) {
    try {
      return await openaiOnce(prov, key, model, messages, temperature, maxTokens, tools);
    } catch (e) {
      errors.push(String(e.message || e).slice(0, 120));
    }
  }
  const slim = slimMessagesForCloud(messages);
  for (const model of models.slice(0, 3)) {
    try {
      const out = await openaiOnce(prov, key, model, slim, temperature, maxTokens, tools);
      return { ...out, slim: true };
    } catch (e) {
      errors.push(`slim/${model}: ${String(e.message || e).slice(0, 100)}`);
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
      const out = await openaiWithFallback(prov, key, laneForJob(job), messages, temperature, maxTokens);
      markHealth(prov.id, true);
      return out;
    } catch (e) {
      // Soft miss — keep prior LIVE so hierarchy isn't poisoned by one timeout.
      errors.push(`${prov.id}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  throw new Error(errors.join(" · ") || "no cloud brain keyed");
}

/** One-shot chat ping — validates key beyond /models. */
export async function chatPing(settings, prov) {
  const key = providerKey(settings, prov);
  if (!key) return { ok: false, id: prov.id, error: "no key" };
  try {
    const out = await openaiWithFallback(
      prov,
      key,
      "life",
      [
        { role: "system", content: "Reply with exactly: PIP OK" },
        { role: "user", content: "ping" },
      ],
      0,
      16,
    );
    const ok = /pip\s*ok/i.test(out.text || "") || Boolean(String(out.text || "").trim());
    if (ok) markHealth(prov.id, true);
    return { ok, id: prov.id, model: out.model, text: out.text };
  } catch (e) {
    // Do not poison /models LIVE — chat fail is a separate signal.
    return { ok: false, id: prov.id, error: String(e.message || e).slice(0, 160) };
  }
}

/**
 * Parallel compare — every keyed cloud brain at once.
 * Each agent gets its own native system prompt (not Pip's voice).
 * Returns one primary text plus full compare[] for the tabbed UI (ok + fail).
 */
export async function compareComplete(settings, messages, temperature = 0.7, maxTokens = 1024, job = "life") {
  void job;
  const keyed = keyedProviders(settings);
  if (!keyed.length) throw new Error("no keyed chat brains — paste keys in DATA");
  const user = [...(messages || [])].reverse().find((m) => m && m.role === "user");
  const ask = String((user && user.content) || "").trim() || "hey";
  const operator = settings?.operator || "Joshua";

  const jobs = keyed.map(async (prov) => {
    const key = providerKey(settings, prov);
    if (!key) {
      return { provider: prov.id, label: prov.label || prov.id, text: "", error: "no key", ok: false };
    }
    try {
      const perAgent = [
        { role: "system", content: agentSystem(prov.id, operator) },
        { role: "user", content: ask },
      ];
      const out = await openaiWithFallback(prov, key, "life", perAgent, temperature, maxTokens);
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

  const settled = await Promise.all(jobs);
  const ok = settled.filter((r) => r && r.ok && r.text);
  if (!ok.length) {
    throw new Error(settled.map((r) => `${r.label || r.provider}: ${r.error || "fail"}`).join(" · ") || "compare failed");
  }
  return {
    text: ok[0].text,
    provider: ok[0].provider,
    model: ok[0].model,
    tokens: ok[0].tokens,
    compare: settled,
    leaked: true,
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
