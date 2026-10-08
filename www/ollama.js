/** Native Ollama client — the "modern agentic speed" path.
 *
 * Talks to Ollama's own HTTP API (default http://localhost:11434) with native
 * `tools` support. This module deliberately bypasses net.js's URL asserts
 * (which forbid localhost) — it ONLY ever talks to 127.0.0.1:11434, never the
 * LAN or WAN. On the phone there is no local Ollama, so every call fails fast
 * and the agent falls through to the next backend.
 *
 * Tool-capable model detection: /api/show returns `capabilities` — models
 * with "tools" in the list get native tool_calls. Verified pick for the
 * guidance message: `ollama pull qwen3:4b` (strongest small tool-caller, ~2.5GB).
 */

const BASE = "http://localhost:11434";

export function ollamaBase() {
  return BASE;
}

/** True when running inside the PIP desktop Electron shell (main.js stamps the UA). */
export function isDesktopShell() {
  try {
    return /PipDesktop\//.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

async function oj(path, { method = "GET", body, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ollama ${path} -> HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("ollama timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Model names from /api/tags — throws when Ollama isn't there. */
export async function ollamaTags(timeoutMs = 4000) {
  const d = await oj("/api/tags", { timeoutMs });
  return (d.models || []).map((m) => m && m.name).filter(Boolean);
}

export async function ollamaCapabilities(name) {
  try {
    const d = await oj("/api/show", { method: "POST", body: { name }, timeoutMs: 8000 });
    return Array.isArray(d.capabilities) ? d.capabilities : [];
  } catch {
    return [];
  }
}

/**
 * Pick the best tool-capable model. Returns
 * { name, toolCapable, models } or null when Ollama is unreachable/empty.
 * Preference order mirrors community consensus (qwen3 family first).
 */
export async function pickOllamaModel() {
  let tags;
  try {
    tags = await ollamaTags();
  } catch {
    return null;
  }
  if (!tags.length) return { name: null, toolCapable: false, models: [] };
  const lower = tags.map((t) => String(t).toLowerCase());
  const find = (prefix) => {
    const i = lower.findIndex((t) => t === prefix || t.startsWith(prefix + ":"));
    return i >= 0 ? tags[i] : null;
  };
  const name =
    find("qwen3") ||
    find("qwen2.5") ||
    find("phi4-mini") ||
    find("llama3.1") ||
    find("mistral-small") ||
    tags[0];
  const caps = await ollamaCapabilities(name);
  return { name, toolCapable: caps.includes("tools"), models: tags };
}

/** Native tool-calling chat. Returns { text, tool_calls: [{name, args}] }. */
export async function ollamaChat({ model, messages, tools, temperature = 0.3, numCtx = 0 }) {
  const d = await oj(
    "/api/chat",
    {
      method: "POST",
      timeoutMs: 180000,
      body: {
        model,
        messages,
        stream: false,
        ...(tools && tools.length ? { tools } : {}),
        options: { temperature, ...(numCtx ? { num_ctx: numCtx } : {}) },
      },
    },
  );
  const msg = d.message || {};
  const calls = [];
  for (const tc of msg.tool_calls || []) {
    const fn = tc.function || {};
    let args = {};
    try {
      args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments || {};
    } catch {
      args = {};
    }
    if (fn.name) calls.push({ name: String(fn.name), args });
  }
  return { text: String(msg.content || ""), tool_calls: calls, model: d.model || model };
}

/** First-run guidance when no tool-capable Ollama model is paired. */
export function ollamaGuidance(pick) {
  const lines = [
    "PIP AGENT // For full agentic speed, your desktop wants a tool-capable local model.",
    "On your PC, in a terminal:  ollama pull qwen3:4b",
    "Free, ~2.5GB, one time. Then /agent runs tools natively — fast.",
  ];
  if (pick && pick.models && pick.models.length && !pick.toolCapable) {
    lines.push(`(Ollama is up, but none of these do native tools: ${pick.models.slice(0, 4).join(", ")}. qwen3:4b fixes that.)`);
  } else if (!pick || !(pick.models || []).length) {
    lines.push("(Couldn't reach Ollama at localhost:11434 — start it with `ollama serve`.)");
  }
  lines.push("Until then I'm working through the on-device model — same tools, slower.");
  return lines.join("\n");
}
