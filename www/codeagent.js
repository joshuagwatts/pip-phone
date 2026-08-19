/** Phone CODE agent — tool loop against codefs overlay (like desktop CODE tab). */
import { cloudCompleteTools } from "./cloud.js";
import {
  listEntries,
  readFile,
  writeFile,
  grepContent,
  pushCodeChat,
  loadCodeChat,
  needsReload,
} from "./codefs.js";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_code_dir",
      description: "List editable phone Pip www files.",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "read_code_file",
      description: "Read a phone www file before editing.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_code_file",
      description: "Write the full phone www file. Local overlay — RELOAD applies JS/HTML.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, body: { type: "string" } },
        required: ["path", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_code",
      description: "Search phone www files for a pattern.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" } },
        required: ["pattern"],
      },
    },
  },
];

const MAX_ROUNDS = 10;

function codeSystem(openPath) {
  let s =
    "You are Pip in PHONE CODE. Edit Phone Pip's own www source via tools. " +
    "Workspace is the phone app bundle (style.css, app.js, theme.js, etc.). " +
    "Read before write. write_code_file sends the FULL file body. " +
    "CSS changes apply live. JS/HTML need RELOAD after edit — say RELOAD when they should tap reload. " +
    "Never claim you edited disk if tools did not write. No markdown fences in file bodies.";
  if (openPath) s += `\nOpen in editor: ${openPath}`;
  return s;
}

async function dispatchTool(name, args) {
  if (name === "list_code_dir") {
    return JSON.stringify({ ok: true, entries: listEntries() });
  }
  if (name === "read_code_file") {
    const f = await readFile(String(args.path || ""));
    return JSON.stringify({ ok: true, path: f.path, body: f.body, overlay: f.overlay });
  }
  if (name === "write_code_file") {
    const out = writeFile(String(args.path || ""), String(args.body || ""));
    return JSON.stringify({ ok: true, ...out });
  }
  if (name === "grep_code") {
    const hits = await grepContent(String(args.pattern || ""), 30);
    return JSON.stringify({ ok: true, hits });
  }
  return JSON.stringify({ ok: false, error: `unknown ${name}` });
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return {};
  }
}

/**
 * Run local code session. Yields event objects like desktop SSE.
 */
export async function* streamPhoneCode(settings, prompt, openPath = "") {
  const prior = loadCodeChat().slice(-16).map((m) => ({
    role: m.role === "pip" ? "assistant" : "user",
    content: m.text,
  }));
  pushCodeChat("user", prompt);
  const messages = [{ role: "system", content: codeSystem(openPath) }, ...prior, { role: "user", content: prompt }];
  const written = [];
  const toolTrace = [];
  let model = "cloud";
  yield { type: "status", text: "routing", model, root: "phone/www" };

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const turn = await cloudCompleteTools(settings, messages, TOOLS, "boost", 0.2, 8000);
      model = `${turn.provider}/${turn.model}`;
      if (round === 0) yield { type: "status", text: `using ${model}`, model, root: "phone/www" };

      const msg = turn.message || {};
      const content = String(msg.content || turn.text || "").trim();
      const toolCalls = msg.tool_calls || turn.tool_calls || [];

      if (toolCalls.length && round < MAX_ROUNDS - 1) {
        messages.push({ role: "assistant", content, tool_calls: toolCalls });
        for (const call of toolCalls) {
          const fn = call.function || {};
          const name = fn.name || "";
          const args = parseArgs(fn.arguments);
          toolTrace.push(name);
          yield { type: "tool", name, args };
          const result = await dispatchTool(name, args);
          if (name === "write_code_file" && args.path) {
            written.push(String(args.path));
            yield { type: "written", path: String(args.path) };
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id || name,
            content: result,
          });
        }
        continue;
      }

      const final = content || "Done.";
      yield { type: "delta", text: final };
      pushCodeChat("pip", final, toolTrace);
      yield {
        type: "done",
        model,
        written,
        tools: toolTrace,
        reload: needsReload(written) || /RELOAD/i.test(final),
      };
      return;
    }
    yield { type: "delta", text: "Code loop stopped. Ask me to continue." };
    yield { type: "done", model, written, tools: toolTrace, reload: needsReload(written) };
  } catch (e) {
    const err = String(e.message || e);
    pushCodeChat("pip", err, toolTrace);
    yield { type: "error", text: err };
    yield { type: "done", model, written, tools: toolTrace, reload: false };
  }
}
