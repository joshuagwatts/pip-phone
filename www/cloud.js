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
    // llama-3.3-70b-versatile shut down Aug 16 2026 for free/dev tiers.
    life: "openai/gpt-oss-120b",
    boost: "openai/gpt-oss-120b",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"],
    reasoning: true,
    keyUrl: "https://console.groq.com/keys",
    tip: "Fast · openai/gpt-oss-120b (Llama 3.3 retired).",
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
    // Public catalog is gpt-oss-120b + gemma-4-31b. Old Llama IDs 404.
    life: "gpt-oss-120b",
    boost: "gpt-oss-120b",
    models: ["gpt-oss-120b", "gemma-4-31b"],
    reasoning: true,
    keyUrl: "https://cloud.cerebras.ai",
    tip: "High speed · gpt-oss-120b (402 = add credits on Cerebras).",
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
    models: ["grok-3-mini", "grok-3-mini-latest", "grok-4", "grok-4-0709", "grok-2-1212", "grok-beta"],
    fishy: true,
    keyUrl: "https://console.x.ai/",
    tip: "xAI console key · /models often 404 — chat ping validates.",
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
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano"],
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
  return normalizeApiKey(settings[prov.field]);
}

/** Strip paste cruft — Bearer prefix, quotes, whitespace. */
export function normalizeApiKey(raw) {
  let k = String(raw || "").trim();
  k = k.replace(/^Bearer\s+/i, "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

export function clearHealth(id) {
  delete liveHealth[id];
  return providerHealth();
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
    // Stale /models 404 or model-id misses are not "bad key".
    if (row.ok === false && /http 404|empty models|model.*not found|does not exist|not found for api/i.test(err) && !/http 40[13]|invalid.?api|unauthorized/i.test(err)) {
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

function isAuthFail(msg) {
  return /incorrect.?api.?key|invalid.?api.?key|unauthorized|http 401|authentication/i.test(String(msg || ""));
}

/** Parse "tell Gemini to share with Groq" style relay intents. */
export function parseAgentRelay(text) {
  const agents = "groq|openrouter|gemini|grok|xai|cerebras|mistral|deepseek|openai|chatgpt";
  const norm = (id) => {
    const x = String(id || "").toLowerCase();
    if (x === "grok") return "xai";
    if (x === "chatgpt") return "openai";
    return x;
  };
  const t = String(text || "").trim();
  let m = t.match(
    new RegExp(
      `\\b(?:tell|ask|have|get)\\s+(${agents})\\b[\\s\\S]{0,140}?\\b(?:share|send|pass|relay|forward|give)\\b[\\s\\S]{0,100}?\\b(?:with|to)\\s+(${agents})\\b`,
      "i",
    ),
  );
  if (m) return { from: norm(m[1]), to: norm(m[2]), raw: t };
  m = t.match(new RegExp(`\\b(?:share|send|pass|relay|forward)\\b[\\s\\S]{0,80}?\\b(?:with|to)\\s+(${agents})\\b`, "i"));
  if (m) return { from: null, to: norm(m[1]), raw: t };
  m = t.match(
    new RegExp(`\\b(${agents})\\b[\\s\\S]{0,50}?\\b(?:share|send|pass|relay)\\b[\\s\\S]{0,50}?\\b(?:with|to)\\s+(${agents})\\b`, "i"),
  );
  if (m) return { from: norm(m[1]), to: norm(m[2]), raw: t };
  m = t.match(
    new RegExp(`\\b(?:say|tell|talk|message|ask)\\s+(?:something\\s+)?(?:to\\s+)?(${agents})\\b`, "i"),
  );
  if (m) return { from: null, to: norm(m[1]), raw: t, direct: true };
  return null;
}

/** Source agent prepares a handoff; target agent continues the task. */
export async function agentRelayComplete(
  settings,
  { fromId, toId, payload, operator = "Joshua", temperature = 0.7, maxTokens = 1200 } = {},
) {
  const toProv = PROVIDERS.find((p) => p.id === toId);
  if (!toProv) throw new Error(`Unknown agent: ${toId}`);
  const toKey = providerKey(settings, toProv);
  if (!toKey) throw new Error(`No ${toProv.label} key — paste in DATA`);

  let handoff = String(payload || "").trim();
  let fromLabel = "";
  const fromProv = fromId ? PROVIDERS.find((p) => p.id === fromId) : null;
  if (fromProv && fromId !== toId) {
    const fromKey = providerKey(settings, fromProv);
    if (!fromKey) throw new Error(`No ${fromProv.label} key — paste in DATA`);
    fromLabel = fromProv.label || fromId;
    const prep = await openaiWithFallback(fromProv, fromKey, "life", [
      {
        role: "system",
        content:
          `${agentSystem(fromId, operator)}\n` +
          `Prepare a concise handoff for ${toProv.label}. Include facts, code, lists, or conclusions — no meta commentary.`,
      },
      { role: "user", content: `Hand off to ${toProv.label}:\n\n${handoff}` },
    ], temperature, maxTokens);
    markHealth(fromId, true);
    handoff = String(prep.text || handoff).trim();
  }

  const out = await openaiWithFallback(toProv, toKey, "life", [
    { role: "system", content: agentSystem(toId, operator) },
    {
      role: "user",
      content: fromLabel
        ? `${fromLabel} sent you this:\n\n${handoff}\n\nContinue the task as yourself.`
        : handoff,
    },
  ], temperature, maxTokens);
  markHealth(toId, true);
  return {
    text: out.text,
    provider: out.provider,
    model: out.model,
    from: fromId || null,
    to: toId,
    handoff,
    tokens: Number(out.tokens) || 0,
  };
}

async function validateOne(settings, prov) {
  // xAI + Gemini often 404 on /models even with valid keys — chat ping is truth.
  if (prov.fishy || prov.id === "xai") {
    const ping = await chatPing(settings, prov);
    if (ping.ok) return { ok: true, id: prov.id, models: 1, via: "chat" };
    if (isAuthFail(ping.error)) return { ok: false, id: prov.id, error: ping.error };
    const r = await probeModels(settings, prov);
    if (r.ok) return r;
    return { ok: false, id: prov.id, error: ping.error || r.error, soft: true };
  }
  const ping = await chatPing(settings, prov);
  if (ping.ok) return { ok: true, id: prov.id, models: 1, via: "chat" };
  if (isAuthFail(ping.error)) return { ok: false, id: prov.id, error: ping.error };
  const r = await probeModels(settings, prov);
  if (r.ok) return r;
  if (isAuthFail(r.error)) return { ok: false, id: prov.id, error: r.error };
  return { ok: false, id: prov.id, error: ping.error || r.error, soft: true };
}

export async function probeModels(settings, prov) {
  const key = providerKey(settings, prov);
  if (!key) {
    return { ok: false, id: prov.id, error: "no key" };
  }
  try {
    const { body, status } = await httpGet(`${prov.base.replace(/\/$/, "")}/models`, 12000, {
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
    if (!n && !Array.isArray(data.data) && body && body.length < 8) throw new Error("empty models");
    if (!n && !data.data && !data.models && !data.object) throw new Error("empty models body");
    return { ok: true, id: prov.id, models: n || 1 };
  } catch (e) {
    return { ok: false, id: prov.id, error: String(e.message || e).slice(0, 160) };
  }
}

/**
 * Auto-check keyed APIs (/models auth). Bad keys → red. No manual probe button.
 */
export async function validateKeyed(settings, { only } = {}) {
  let keyed = keyedProviders(settings);
  if (only != null) {
    const id = String(only).toLowerCase();
    keyed = keyed.filter((p) => p.id === id || p.field === id);
  }
  const jobs = keyed.map(async (prov) => {
    const r = await validateOne(settings, prov);
    if (r.ok) markHealth(prov.id, true);
    else if (isAuthFail(r.error)) markHealth(prov.id, false, r.error);
    else clearHealth(prov.id);
    return { id: prov.id, label: prov.label, ...r };
  });
  return Promise.all(jobs);
}

/** @deprecated use validateKeyed */
export async function probeKeyed(settings) {
  return validateKeyed(settings);
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
    if (!m) continue;
    const role = m.role === "assistant" || m.role === "pip" ? "assistant" : m.role === "system" ? "system" : "user";
    if (Array.isArray(m.content)) {
      // Multimodal (text + image_url) — keep structure for vision APIs.
      const parts = m.content
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          if (p.type === "text" && p.text) return { type: "text", text: String(p.text).slice(0, 6000) };
          if (p.type === "image_url" && p.image_url?.url) {
            return { type: "image_url", image_url: { url: String(p.image_url.url) } };
          }
          return null;
        })
        .filter(Boolean);
      if (!parts.length) continue;
      if (role === "system") {
        systems.push(parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"));
      } else {
        turns.push({ role, content: parts });
      }
      continue;
    }
    const content = String(m.content || "").trim();
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
  const user = [...packed].reverse().find((m) => m && m.role === "user");
  const slimSys =
    (typeof system === "string"
      ? system
          .split("\n")
          .filter((line) => !/^Voice examples|^Job:/i.test(line.trim()))
          .slice(0, 12)
          .join("\n")
          .slice(0, 1400)
      : "") || "You are Pip — direct, warm, honest. Stay in character.";
  let userContent = "hey";
  if (user) {
    if (Array.isArray(user.content)) {
      userContent = user.content.map((p) => {
        if (p?.type === "text") return { type: "text", text: String(p.text || "").slice(0, 4000) };
        if (p?.type === "image_url") return p;
        return null;
      }).filter(Boolean);
      if (!userContent.length) userContent = "hey";
    } else {
      userContent = String(user.content || "hey").slice(0, 4000);
    }
  }
  return [
    { role: "system", content: slimSys },
    { role: "user", content: userContent },
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
      const msg = String(e.message || e);
      errors.push(msg.slice(0, 120));
      // Bad key won't magically work on another model ID.
      if (isAuthFail(msg)) break;
    }
  }
  if (!errors.some(isAuthFail)) {
    const slim = slimMessagesForCloud(messages);
    for (const model of models.slice(0, 3)) {
      try {
        const out = await openaiOnce(prov, key, model, slim, temperature, maxTokens, tools);
        return { ...out, slim: true };
      } catch (e) {
        const msg = String(e.message || e);
        errors.push(`slim/${model}: ${msg.slice(0, 100)}`);
        if (isAuthFail(msg)) break;
      }
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
  const keyedIds = keyedProviders(settings).map((p) => p.id);
  // Explicit agent pick (groq/gemini/cerebras/…) — ONLY that brain. Never silent-fallback to another API.
  if (pin && pin !== "auto" && pin !== "compare" && pin !== "all" && pin !== "desktop") {
    const only = PROVIDERS.find((p) => p.id === pin);
    if (only && keyedIds.includes(pin)) return [only];
    return [];
  }
  // Vision pin — only providers that accept image_url.
  if (pin === "vision") {
    const order = ["gemini", "openai", "openrouter"];
    return order.map((id) => PROVIDERS.find((p) => p.id === id)).filter((p) => p && keyedIds.includes(p.id));
  }
  const effectivePin = pin === "compare" || pin === "all" ? "auto" : pin;
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
  const pin = brainPin(settings);
  const pinned =
    pin && pin !== "auto" && pin !== "compare" && pin !== "all" && pin !== "desktop" && pin !== "local" && pin !== "lite" && pin !== "qwen";
  const chainList = chatChain(settings, job);
  if (!chainList.length) {
    if (pinned) throw new Error(`${pin.toUpperCase()} not keyed — paste key in DATA or pick another agent`);
    throw new Error("no keyed chat brains — paste keys in DATA or unpin");
  }
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
  if (pinned) {
    throw new Error(errors[0] || `${pin.toUpperCase()} failed`);
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

const AGENT_ALIASES = {
  grok: "xai",
  chatgpt: "openai",
};

function normAgentId(id) {
  const x = String(id || "").toLowerCase();
  return AGENT_ALIASES[x] || x;
}

/** Brains with keys attached — skip known-bad (KEY BAD) until re-paste/re-validate. */
export function compareProviders(settings, health = null) {
  const h = health || liveHealth;
  return keyedProviders(settings).filter((p) => h[p.id]?.ok !== false);
}

/** "Say something to Gemini" / crew cross-talk in COMPARE. */
export function parseCrossAgentIntent(text) {
  const agents = "groq|openrouter|gemini|grok|xai|cerebras|mistral|deepseek|openai|chatgpt";
  const t = String(text || "").trim();
  let m = t.match(
    new RegExp(
      `\\b(?:say|tell|talk|message|ask|welcome|greet|introduce)\\s+(?:something\\s+)?(?:to\\s+)?(${agents})\\b`,
      "i",
    ),
  );
  if (m) {
    const target = normAgentId(m[1]);
    const prov = PROVIDERS.find((p) => p.id === target);
    return { target, targetLabel: prov?.label || target, raw: t };
  }
  m = t.match(new RegExp(`\\b(?:for|to)\\s+(${agents})\\b`, "i"));
  if (m) {
    const target = normAgentId(m[1]);
    const prov = PROVIDERS.find((p) => p.id === target);
    return { target, targetLabel: prov?.label || target, raw: t };
  }
  return null;
}

function compareUserContent(prov, operator, ask, crossHint, prior) {
  const name = prov.label || prov.id;
  let userContent = ask;
  if (crossHint?.target) {
    if (crossHint.target === prov.id) {
      userContent =
        `Joshua to the crew: "${ask}"\n\n` +
        `You're ${name}. This is directed at you — first impression, make it count. Reply as yourself to Joshua.`;
    } else {
      userContent =
        `Joshua to the crew: "${ask}"\n\n` +
        `You're ${name}. Part of this is for ${crossHint.targetLabel}. ` +
        `Reply to Joshua; you may acknowledge ${crossHint.targetLabel} naturally if it fits.`;
    }
  }
  const priorMsgs = (prior || [])
    .filter((m) => m && m.content && !m.image)
    .slice(-8)
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content).slice(0, 1200),
    }));
  return [
    { role: "system", content: agentSystem(prov.id, operator) },
    ...priorMsgs,
    { role: "user", content: userContent },
  ];
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    }),
  ]);
}

/**
 * Parallel compare — streams each brain as it finishes (no waiting on slow/dead APIs).
 * Each agent gets its own native system prompt (not Pip's voice).
 */
export async function compareComplete(
  settings,
  messages,
  temperature = 0.7,
  maxTokens = 1024,
  job = "life",
  { onPartial, timeoutMs = 26000, crossHint, health, prior } = {},
) {
  void job;
  const keyed = compareProviders(settings, health);
  if (!keyed.length) throw new Error("no keyed chat brains — paste keys in DATA");
  const user = [...(messages || [])].reverse().find((m) => m && m.role === "user");
  const ask = String((user && user.content) || "").trim() || "hey";
  const operator = settings?.operator || "Joshua";
  const history = prior || (messages || []).filter((m) => m.role === "user" || m.role === "assistant" || m.role === "pip");
  const slots = keyed.map((prov) => ({
    provider: prov.id,
    label: prov.label || prov.id,
    text: "",
    ok: false,
    pending: true,
  }));

  const emitPartial = (row, index) => {
    slots[index] = { ...row, pending: false };
    const snap = slots.map((r) => ({ ...r }));
    if (onPartial) onPartial(row, snap, { done: snap.filter((r) => !r.pending).length, total: keyed.length });
  };

  if (onPartial) onPartial(null, [...slots], { done: 0, total: keyed.length });

  const jobs = keyed.map((prov, index) => {
    const key = providerKey(settings, prov);
    if (!key) {
      const row = { provider: prov.id, label: prov.label || prov.id, text: "", error: "no key", ok: false };
      emitPartial(row, index);
      return Promise.resolve(row);
    }
    const run = async () => {
      try {
        const perAgent = compareUserContent(prov, operator, ask, crossHint, history);
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
    };
    return withTimeout(run(), timeoutMs, prov.label || prov.id)
      .catch((e) => ({
        provider: prov.id,
        label: prov.label || prov.id,
        text: "",
        error: String(e.message || e).slice(0, 160),
        ok: false,
      }))
      .then((row) => {
        emitPartial(row, index);
        return row;
      });
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
