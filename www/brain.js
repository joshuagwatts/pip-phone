import { FALLBACK, isBlank, talkSystem, SHOTS } from "./crew.js";
import { draftVoice } from "./kind.js";
import { typedLinks } from "./digest.js";

const QWEN_MLC = [
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
];
const QWEN_TF = "onnx-community/Qwen2.5-0.5B-Instruct";

let backend = null;
let loading = null;
let lastProgress = "";
const listeners = new Set();

export function brainReady() {
  return true;
}

export function pipStatus() {
  if (backend) return "PIP ON DECK";
  if (loading) return lastProgress || "PIP // WAKING";
  return "PIP ON DECK";
}

function emit(msg) {
  lastProgress = String(msg || "").slice(0, 56);
  for (const fn of listeners) {
    try { fn(lastProgress); } catch { /* ignore */ }
  }
}

function track(onProgress) {
  if (typeof onProgress === "function") listeners.add(onProgress);
}

async function loadMod(urls) {
  let last = "";
  for (const url of urls) {
    try {
      return await import(url);
    } catch (e) {
      last = String(e.message || e);
    }
  }
  throw new Error(last || "could not load Qwen runtime");
}

async function makeWebLlm() {
  const webllm = await loadMod([
    "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm",
    "https://esm.run/@mlc-ai/web-llm",
  ]);
  const create = webllm.CreateMLCEngine;
  let err = "";
  for (const model of QWEN_MLC) {
    try {
      emit(`QWEN ${model.includes("1.5B") ? "1.5B" : "0.5B"}`);
      const engine = await create(model, {
        initProgressCallback: (p) => {
          const pct = Math.round((p.progress || 0) * 100);
          emit(p.text ? String(p.text).slice(0, 48) : `QWEN ${pct}%`);
        },
      });
      return {
        kind: "webllm",
        complete: async (messages, temperature, maxTokens) => {
          const out = await engine.chat.completions.create({
            messages,
            temperature,
            max_tokens: maxTokens,
          });
          return ((((out.choices || [])[0] || {}).message || {}).content || "").trim();
        },
      };
    } catch (e) {
      err = String(e.message || e);
    }
  }
  throw new Error(err || "WebGPU Qwen would not wake");
}

function tfProgress(info) {
  if (!info || typeof info !== "object") return;
  if (info.status === "progress" && info.total) {
    emit(`QWEN ${Math.round((100 * (info.loaded || 0)) / info.total)}%`);
  } else if (info.status === "download") {
    emit("QWEN FETCH");
  } else if (info.status === "ready" || info.status === "done") {
    emit("PIP ON DECK");
  }
}

function tfText(out) {
  const row = Array.isArray(out) ? out[0] : out;
  const gen = row && row.generated_text;
  if (typeof gen === "string") return gen.trim();
  if (Array.isArray(gen)) {
    for (let i = gen.length - 1; i >= 0; i -= 1) {
      const turn = gen[i];
      if (turn && turn.role === "assistant" && turn.content) return String(turn.content).trim();
    }
    const last = gen[gen.length - 1];
    if (last && last.content) return String(last.content).trim();
  }
  return String((row && (row.text || row.content)) || "").trim();
}

async function makeTransformers() {
  emit("QWEN WASM");
  const tf = await loadMod([
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm",
    "https://esm.sh/@huggingface/transformers@3.5.1",
  ]);
  if (tf.env) {
    tf.env.allowLocalModels = false;
    tf.env.useBrowserCache = true;
  }
  const generator = await tf.pipeline("text-generation", QWEN_TF, {
    dtype: "q4",
    progress_callback: tfProgress,
  });
  return {
    kind: "tf",
    complete: async (messages, temperature, maxTokens) => {
      const out = await generator(messages, {
        max_new_tokens: maxTokens,
        temperature,
        do_sample: temperature > 0.15,
      });
      return tfText(out);
    },
  };
}

export async function ensurePip(onProgress) {
  track(onProgress);
  if (backend) {
    emit("PIP ON DECK");
    return backend;
  }
  if (loading) return loading;
  loading = (async () => {
    emit("PIP // WAKING");
    const errors = [];
    if (navigator.gpu) {
      try {
        backend = await makeWebLlm();
        emit("PIP ON DECK");
        return backend;
      } catch (e) {
        errors.push(String(e.message || e));
      }
    }
    try {
      backend = await makeTransformers();
      emit("PIP ON DECK");
      return backend;
    } catch (e) {
      errors.push(String(e.message || e));
    }
    throw new Error(errors.filter(Boolean).join(" · ") || "Qwen would not wake");
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}

async function complete(messages, temperature = 0.7, maxTokens = 400) {
  const eng = await ensurePip();
  return (await eng.complete(messages, temperature, maxTokens)).trim();
}

export async function chat(settings, history, text, onProgress, kit) {
  track(onProgress);
  const operator = settings.operator || "Joshua";
  const messages = [
    { role: "system", content: talkSystem(operator, settings.humor, settings.honesty, kit) },
    ...SHOTS,
    ...history.slice(-8).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
    { role: "user", content: text },
  ];
  let out = await complete(messages, 0.7, 180);
  if (isBlank(out) || !out) {
    out = await complete(
      [
        { role: "system", content: talkSystem(operator, settings.humor, settings.honesty, kit) },
        ...SHOTS,
        { role: "user", content: text },
        { role: "user", content: "Stay Pip. Two short sentences. No helpdesk." },
      ],
      0.35,
      140,
    );
  }
  if (isBlank(out) || !out) return FALLBACK;
  return out;
}

export async function draftAnswers(settings, { title, kit, questions, kind }, onProgress) {
  track(onProgress);
  const kitBits = { ...kit };
  delete kitBits.email;
  delete kitBits.phone;
  delete kitBits.ready;
  delete kitBits.digest;
  kitBits.links_by_kind = typedLinks(kit);
  kitBits.resume = String(kit.resume || "").slice(0, 2500);
  const asks = questions.map((q) => ({
    q: q.prompt || q.q || "",
    type: q.type || "short",
    hint: q.hint || "",
  }));
  const messages = [
    {
      role: "system",
      content:
        "You draft application answers for Pip's operator from KIT only. " +
        draftVoice(kind) +
        " Ground every sentence in KIT. Do not invent employers, awards, clients, or numbers. " +
        "If a number is required and missing, write ESTIMATE and say they must confirm. " +
        "Match the question. Instagram fields get only the Instagram URL. Website fields get the site. " +
        "Resume/CV fields get the assembled resume. Socials get socials. Do not dump every link into every field. " +
        "No corporate sludge. No emoji. No email or phone. " +
        "Also write a5: the same facts at a 5th-grade reading level. " +
        'Return ONLY JSON {"answers":[{"q":"...","a":"...","a5":"..."}]} one object per question, same q text.',
    },
    {
      role: "user",
      content: `CALL: ${title}\nKIT:\n${JSON.stringify(kitBits)}\nQUESTIONS:\n${JSON.stringify(asks)}`,
    },
  ];
  const raw = await complete(messages, 0.35, 1200);
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
    return { ...q, q: prompt, a: hit.a || q.a || "", a5: hit.a5 || q.a5 || "" };
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
