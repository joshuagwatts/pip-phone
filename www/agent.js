/** PIP agentic core — the Conductor, pulled forward.
 *
 * ReAct loop over the tool registry (tools.js). Local-first and free:
 *   1. desktop Ollama with NATIVE tools (preferred — the fast path)
 *   2. on-device Qwen with a strict JSON tool-call protocol in-prompt
 *   3. paired desktop companion (same JSON protocol over its text API)
 *   4. cloud models with native tools — only with his explicit per-run consent
 *
 * The loop never throws: max steps / backend failures degrade to a graceful
 * "here's how far I got" summary. Final answers go through sanitizeReply —
 * the crew.js voice lock ("Never tool JSON in chat replies") holds here too.
 */

import { TOOLS, nativeToolSpecs, toolManifestText, execTool } from "./tools.js";
import { sanitizeReply, CREW_LOCK } from "./crew.js";
import { isDesktopShell, pickOllamaModel, ollamaChat, ollamaGuidance } from "./ollama.js";
import { ensurePip } from "./brain.js";
import { desktopConfigured, desktopChat } from "./desktop.js";
import { cloudCompleteTools, keyedProviders, privacyOn } from "./cloud.js";

export const AGENT_MAX_STEPS = 12;
const TOOL_CALLS_PER_ROUND = 4;

/* ------------------------------------------------------- JSON protocol */

const TOOL_BLOCK_RE = /<tool\s+name="([a-z0-9_]+)"\s*>([\s\S]*?)<\/tool>/gi;

export function parseJsonToolBlocks(text) {
  const calls = [];
  TOOL_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = TOOL_BLOCK_RE.exec(String(text || "")))) {
    let args = {};
    const raw = String(m[2]).trim();
    try {
      args = raw ? JSON.parse(raw) : {};
    } catch {
      args = { _raw: raw.slice(0, 2000) };
    }
    calls.push({ name: m[1], args });
  }
  return calls;
}

function agentSystemPrompt(extra = "") {
  const base = [
    "You are Pip — Joshua's agent. You get things DONE with tools, then report back in Pip's voice.",
    CREW_LOCK,
    "You have these tools. Use them when they help the goal; otherwise just answer.",
    "<tools>",
    toolManifestText(),
    "</tools>",
    "To call tools, output ONLY tool blocks, nothing else in that message:",
    '<tool name="memory_search">',
    '{"query": "roofing deadlines"}',
    "</tool>",
    "After each tool result arrives, keep going until the goal is done, then write the final answer.",
    "The final answer is plain Pip voice: summarize what you did and found. NEVER paste tool JSON, schemas, or raw tool output into it.",
    "If a tool errors or is declined, say so plainly and work around it or stop.",
  ].join("\n");
  return extra ? `${base}\n\n${extra}` : base;
}

/** /code mode addendum (Phase 5 — PIP Codes). Appended to the agent system
 *  prompt when ctx.codeMode is set; /agent runs are byte-identical without it. */
export const CODE_SYSTEM_ADDENDUM = [
  "CODE MODE — you are Pip the coder. You read, change, verify, and commit code in Joshua's GitHub repos.",
  "GitHub tools: github_repos (find his repos), github_tree (map a repo), github_read (read a file), github_commit (commit — it ALWAYS shows Joshua an approval preview with repo, branch, message and per-file line counts, and writes nothing unless he taps APPROVE).",
  "RULES:",
  "- Read before you edit: tree the repo, then read every file you will change, in full, this session. Never commit a change to a file you haven't read.",
  "- If the goal doesn't name the repo (owner/repo) AND what change to make, ask for exactly that in your final answer and make no edits (github_repos is allowed to help him pick).",
  "- One commit per coherent change, with a clear message (what + why). Commits are fast-forward only — if github_commit says the branch moved, re-read the file and retry; never force anything.",
  "- DESKTOP BUILD/TEST: if the shell tool is available (desktop app) and the repo is checked out on the desktop — ask where, or clone it there with the shell tool (its own approval applies) — run the repo's build/tests through shell BEFORE committing, and report the real result. NEVER claim a build or test passed that you did not actually run and see pass.",
  "- Report honestly: what changed, the commit sha, and anything that failed, was skipped, or is still unverified.",
].join("\n");

/* ------------------------------------------------------------- backends */

/**
 * Each backend: { kind, label, native, chat(messages) -> { text, tool_calls: [{name, args}] } }.
 * messages are [{role, content}] for JSON-protocol backends; native backends
 * also get the tool specs and return structured tool_calls.
 */

function ollamaBackend(model, extra = "") {
  return {
    kind: "ollama",
    label: `desktop Ollama · ${model}`,
    native: true,
    chat: async (messages) =>
      ollamaChat({
        model,
        // /agent sends no system message (unchanged); code mode prepends one.
        messages: extra ? [{ role: "system", content: agentSystemPrompt(extra) }, ...messages] : messages,
        tools: nativeToolSpecs(),
        temperature: 0.3,
      }),
  };
}

function qwenBackend(eng, extra = "") {
  return {
    kind: "qwen",
    label: "on-device Qwen",
    native: false,
    chat: async (messages) => {
      // Raw complete — NOT brain.js localComplete: sanitizeReply would strip
      // the tool blocks we need to parse.
      const raw = await eng.complete(
        [{ role: "system", content: agentSystemPrompt(extra) }, ...messages],
        0.3, 1200,
      );
      return { text: String(raw || ""), tool_calls: parseJsonToolBlocks(raw) };
    },
  };
}

function companionBackend(settings, extra = "") {
  const serialize = (messages) =>
    [
      agentSystemPrompt(extra),
      "---",
      ...messages.map((m) => `${m.role}: ${String(m.content || "").slice(0, 3000)}`),
      "---",
      "Reply with tool blocks or your final answer.",
    ].join("\n");
  return {
    kind: "companion",
    label: "paired desktop",
    native: false,
    chat: async (messages) => {
      const out = await desktopChat(settings, serialize(messages), 120000);
      return { text: out.text, tool_calls: parseJsonToolBlocks(out.text) };
    },
  };
}

function cloudBackend(settings, extra = "") {
  return {
    kind: "cloud",
    label: "cloud (consented)",
    native: true,
    chat: async (messages) => {
      const out = await cloudCompleteTools(
        settings,
        [{ role: "system", content: agentSystemPrompt(extra) }, ...messages],
        nativeToolSpecs(),
        "boost", 0.2, 4000,
      );
      const calls = [];
      for (const tc of out.tool_calls || []) {
        const fn = tc.function || {};
        let args = {};
        try {
          args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments || {};
        } catch {
          args = {};
        }
        if (fn.name) calls.push({ name: String(fn.name), args });
      }
      return { text: out.text || "", tool_calls: calls };
    },
  };
}

/** Backend order: fastest local thing that can actually run tools. */
export async function pickBackend(ctx = {}, note = () => {}) {
  const extra = ctx.codeMode ? CODE_SYSTEM_ADDENDUM : "";
  // 1. Desktop Ollama, native tools — the modern agentic speed path.
  if (isDesktopShell()) {
    try {
      const pick = await pickOllamaModel();
      if (pick && pick.name && pick.toolCapable) {
        return { backend: ollamaBackend(pick.name, extra), pick };
      }
      if (pick) ctx.ollamaPick = pick; // for the first-run guidance message
    } catch {
      /* fall through */
    }
  }
  // 2. On-device Qwen, JSON tool protocol.
  try {
    const eng = await withTimeout(ensurePip(), 120000, "qwen warmup");
    if (eng) return { backend: qwenBackend(eng, extra), pick: null };
  } catch {
    /* fall through — model not downloaded / warming failed */
  }
  // 3. Paired desktop companion, JSON protocol over its text API.
  try {
    if (ctx.settings && desktopConfigured(ctx.settings)) {
      return { backend: companionBackend(ctx.settings, extra), pick: null };
    }
  } catch {
    /* fall through */
  }
  // 4. Cloud with native tools — explicit per-run consent in SECURE mode.
  try {
    if (ctx.settings && keyedProviders(ctx.settings).length) {
      if (!privacyOn(ctx.settings)) return { backend: cloudBackend(ctx.settings, extra), pick: null };
      if (ctx.approve) {
        const ok = await ctx.approve(
          "Use a cloud model for this run?",
          "No local backend is available. This sends the goal and tool results to a keyed cloud provider.",
        ).catch(() => false);
        if (ok) return { backend: cloudBackend(ctx.settings, extra), pick: null };
      }
    }
  } catch {
    /* fall through */
  }
  return { backend: null, pick: ctx.ollamaPick || null };
}

function withTimeout(promise, ms, label) {
  let t;
  const gate = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(t));
}

/* ------------------------------------------------------------ narration */

const STEP_LINES = {
  memory_search: "Checking my memory…",
  remember: "Filing that away…",
  web_fetch: "Checking the web…",
  files_list: "Looking through the files…",
  file_read: "Reading that file…",
  file_write: "Writing that up…",
  shell: "Running that on your desktop…",
  remind: "Setting that reminder…",
  calc: "Running the numbers…",
  github_repos: "Listing your repos…",
  github_tree: "Mapping the repo…",
  github_read: "Reading that file on GitHub…",
  github_commit: "Committing to GitHub…",
};

function narrate(name) {
  return STEP_LINES[name] || `Using ${name}…`;
}

function toolCallText(call) {
  // Compact record of the call for native-backend history.
  return `<tool name="${call.name}">${JSON.stringify(call.args).slice(0, 1500)}</tool>`;
}

/** Strip agent protocol markup — tool blocks must never reach the user. */
export function stripToolMarkup(text) {
  return String(text || "")
    .replace(/<tool\s+name="[^"]*"\s*>[\s\S]*?<\/tool>/gi, "")
    .replace(/<result\s+name="[^"]*"\s*>[\s\S]*?<\/result>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------------------------------------------------------------- loop */

/**
 * Run one agent turn. ctx: { settings, db, persist, approve(title,detail)->bool,
 * onStep(text), runId? }. Returns { ok, answer, steps[], backend, runId, guidance? }.
 * Never throws.
 */
export async function runAgent(goal, ctx = {}) {
  const picked = await pickBackend(ctx).catch(() => ({ backend: null, pick: null }));
  return runAgentLoop(String(goal || "").trim(), ctx, picked.backend, picked.pick);
}

/** The loop itself — takes an explicit backend so tests can inject a mock. */
export async function runAgentLoop(goal, ctx = {}, backend = null, ollamaPick = null) {
  const runId = ctx.runId || "ag" + Date.now().toString(36);
  const steps = [];
  const note = (t) => {
    steps.push(t);
    try {
      ctx.onStep && ctx.onStep(t);
    } catch {
      /* narration never breaks the run */
    }
  };
  const graceful = (answer, extra = {}) => ({
    ok: false, answer, steps: [...steps], backend: backend ? backend.kind : "none", runId,
    guidance: guidanceFor(ctx, ollamaPick), ...extra,
  });

  if (!goal) return graceful("Give me a goal — /agent followed by what you want done.");
  if (!backend) {
    return graceful(
      "No backend available for tool runs right now — no desktop Ollama, the on-device model isn't woken, no paired desktop, and no consented cloud. " +
      "Pair the desktop or wake Qwen, then try again.",
    );
  }

  note(`On it — running this through ${backend.label}.`);
  const messages = [{ role: "user", content: goal }];
  const baseCtx = { ...ctx, runId, backend: backend.kind };

  try {
    for (let step = 0; step < AGENT_MAX_STEPS; step++) {
      let out;
      try {
        out = await backend.chat(messages);
      } catch (e) {
        return graceful(
          `The ${backend.label} backend stumbled (${String((e && e.message) || e).slice(0, 120)}). ` +
          (steps.length > 1 ? `Here's how far I got: ${steps.slice(1).join(" ")}` : "Nothing got done this run."),
        );
      }
      const calls = (out.tool_calls || []).slice(0, TOOL_CALLS_PER_ROUND);
      if (!calls.length) {
        const final = sanitizeReply(stripToolMarkup(out.text));
        return {
          ok: true,
          answer: final || "Done — nothing more to add.",
          steps: [...steps], backend: backend.kind, runId,
          guidance: guidanceFor(ctx, ollamaPick),
        };
      }
      // Execute, then feed results back in the backend's native shape.
      const results = [];
      for (const c of calls) {
        note(narrate(c.name));
        const res = await execTool(c.name, c.args || {}, baseCtx);
        results.push({ call: c, res });
      }
      if (backend.native) {
        const lastCalls = calls.map((c, i) => ({
          role: "assistant", content: out.text || "",
          tool_calls: [{ id: `call_${step}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }],
        }));
        messages.push(...lastCalls);
        results.forEach((r, i) => {
          messages.push({ role: "tool", tool_call_id: `call_${step}_${i}`, content: String(r.res).slice(0, 4000) });
        });
      } else {
        messages.push({ role: "assistant", content: calls.map(toolCallText).join("\n") || "(thinking)" });
        for (const r of results) {
          messages.push({ role: "user", content: `<result name="${r.call.name}">\n${String(r.res).slice(0, 4000)}\n</result>` });
        }
      }
    }
    return graceful(
      `I hit the ${AGENT_MAX_STEPS}-step limit. How far I got: ${steps.slice(1).join(" ") || "still scoping it out."} ` +
      "Say /agent again with a narrower goal and I'll pick it back up.",
    );
  } catch (e) {
    return graceful(`Something broke mid-run (${String((e && e.message) || e).slice(0, 120)}). Steps so far: ${steps.slice(1).join(" ") || "none"}.`);
  }
}

/** First-run Ollama guidance — surfaced once by the caller (app.js). */
export function guidanceFor(ctx, ollamaPick) {
  if (!isDesktopShell()) return "";
  if (ctx.settings && ctx.settings.agent_guidance_v1) return "";
  return ollamaGuidance(ollamaPick || ctx.ollamaPick || null);
}
