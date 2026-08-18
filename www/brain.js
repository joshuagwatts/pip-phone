import { FALLBACK, isBlank, talkSystem } from "./crew.js";
import { httpPostJson } from "./net.js";

const PROVIDERS = [
  {
    id: "groq",
    key: "groq",
    base: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    headers: () => ({}),
  },
  {
    id: "openrouter",
    key: "openrouter",
    base: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    headers: () => ({ "HTTP-Referer": "https://pip.phone", "X-Title": "Pip Phone" }),
  },
  {
    id: "cerebras",
    key: "cerebras",
    base: "https://api.cerebras.ai/v1/chat/completions",
    model: "llama-3.3-70b",
    headers: () => ({}),
  },
  {
    id: "mistral",
    key: "mistral",
    base: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest",
    headers: () => ({}),
  },
];

export function brainReady(settings) {
  return PROVIDERS.some((p) => (settings[p.key] || "").trim());
}

function pick(settings) {
  return PROVIDERS.filter((p) => (settings[p.key] || "").trim());
}

async function complete(settings, messages, temperature = 0.6) {
  const hosts = pick(settings);
  if (!hosts.length) throw new Error("Paste a Groq or OpenRouter key in DATA.");
  let last = "";
  for (const p of hosts) {
    try {
      const data = await httpPostJson(
        p.base,
        { Authorization: `Bearer ${settings[p.key].trim()}`, ...p.headers() },
        { model: p.model, messages, temperature, max_tokens: 1200 },
      );
      const text = (((data.choices || [])[0] || {}).message || {}).content || "";
      if (text.trim()) return text.trim();
    } catch (e) {
      last = String(e.message || e);
    }
  }
  throw new Error(last || "brain quiet");
}

export async function chat(settings, history, text) {
  const operator = settings.operator || "Operator";
  const messages = [
    { role: "system", content: talkSystem(operator, settings.humor, settings.honesty) },
    ...history.slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    { role: "user", content: text },
  ];
  let out = await complete(settings, messages, 0.7);
  if (isBlank(out)) {
    out = await complete(settings, [...messages, { role: "user", content: "Stay Pip. Answer the actual thing." }], 0.5);
  }
  if (isBlank(out) || !out) return FALLBACK;
  return out;
}

export async function draftAnswers(settings, { title, kit, questions }) {
  const kitBits = { ...kit };
  delete kitBits.email;
  delete kitBits.phone;
  delete kitBits.ready;
  const asks = questions.map((q) => ({
    q: q.prompt || q.q || "",
    type: q.type || "short",
    hint: q.hint || "",
  }));
  const messages = [
    {
      role: "system",
      content:
        "You draft festival / public-art / VJ application answers for Pip's operator. " +
        "Ground every sentence in KIT. Do not invent employers, awards, clients, or numbers. " +
        "If a number is required and missing, write ESTIMATE and say they must confirm. " +
        "No corporate sludge. No emoji. No email or phone. " +
        "Also write a5: same facts, 5th-grade reading level, no extra facts. " +
        'Return ONLY JSON {"answers":[{"q":"...","a":"...","a5":"..."}]} one object per question, same q text. ' +
        "A generic bio that could belong to anyone is a failure.",
    },
    {
      role: "user",
      content: `CALL: ${title}\nKIT:\n${JSON.stringify(kitBits)}\nQUESTIONS:\n${JSON.stringify(asks)}`,
    },
  ];
  const raw = await complete(settings, messages, 0.35);
  const parsed = parseJson(raw);
  const map = new Map();
  for (const item of parsed.answers || []) {
    if (!item || typeof item !== "object") continue;
    const q = String(item.q || item.prompt || "").trim().toLowerCase();
    const a = String(item.a || item.answer || "").trim();
    const a5 = String(item.a5 || item.plain || "").trim();
    if (q && a) map.set(q, { a, a5 });
  }
  return questions.map((q) => {
    const prompt = q.prompt || q.q || "";
    const hit = map.get(prompt.trim().toLowerCase()) || {};
    return {
      ...q,
      q: prompt,
      a: hit.a || q.a || "",
      a5: hit.a5 || q.a5 || "",
    };
  });
}

function parseJson(text) {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) return {};
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return {};
  }
}
