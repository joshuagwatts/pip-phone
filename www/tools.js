/** PIP tool registry — the agent's hands.
 *
 * Each tool = { name, description, schema (JSON Schema), lane, run }.
 * Lanes: 'local' (on-device, no consent needed), 'network' (leaves the device —
 * per-run consent in SECURE mode), 'desktop' (only exists on the desktop app).
 *
 * Rails live in execTool: lane enforcement, per-session approval for shell
 * (one tap per command-pattern) and file_write (one tap per file), and an
 * append-only run log persisted to localStorage — the seed of the blueprint's
 * consent ledger. Nothing here phones home.
 */

import { privacyOn } from "./cloud.js";
import { shellAvailable, shellExec, shellWhyNot } from "./shell.js";
import { vaultAppendRunLog, vaultRunLog } from "./store-vault.js";
import {
  ghHasToken, ghListRepos, ghGetRepo, ghReadFile, ghListTree, ghCommitFiles, ghLineDiff, isNoTokenError,
} from "./github.js";

/* ---------------------------------------------------------- arg validation */

function checkType(v, t) {
  if (t === "string") return typeof v === "string";
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  if (t === "integer") return Number.isInteger(v);
  if (t === "boolean") return typeof v === "boolean";
  if (t === "array") return Array.isArray(v);
  if (t === "object") return v && typeof v === "object" && !Array.isArray(v);
  return true;
}

export function validateArgs(schema, args) {
  const a = args && typeof args === "object" ? args : {};
  const props = (schema && schema.properties) || {};
  for (const req of schema.required || []) {
    if (a[req] === undefined || a[req] === null || a[req] === "") {
      return { ok: false, error: `missing required arg: ${req}` };
    }
  }
  for (const [k, spec] of Object.entries(props)) {
    const v = a[k];
    if (v === undefined || v === null) continue;
    if (spec.type && !checkType(v, spec.type)) {
      return { ok: false, error: `arg ${k} must be ${spec.type}` };
    }
    if (spec.enum && !spec.enum.includes(v)) {
      return { ok: false, error: `arg ${k} must be one of: ${spec.enum.join(", ")}` };
    }
    if (spec.maxLength && String(v).length > spec.maxLength) {
      return { ok: false, error: `arg ${k} too long (max ${spec.maxLength})` };
    }
    if (spec.minimum !== undefined && Number(v) < spec.minimum) {
      return { ok: false, error: `arg ${k} below minimum ${spec.minimum}` };
    }
    if (spec.maximum !== undefined && Number(v) > spec.maximum) {
      return { ok: false, error: `arg ${k} above maximum ${spec.maximum}` };
    }
  }
  return { ok: true, args: a };
}

/* ------------------------------------------------------------------ calc */

const CALC_FUNCS = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log, log10: Math.log10, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CALC_CONSTS = { pi: Math.PI, e: Math.E };

/** Safe expression eval — tiny recursive-descent parser, no eval/Function. */
export function calcEval(src) {
  const s = String(src || "").trim();
  if (!s) throw new Error("empty expression");
  if (s.length > 200) throw new Error("expression too long");
  if (!/^[0-9+\-*/%^().,\s_a-zA-Z]+$/.test(s)) throw new Error("bad characters");
  let i = 0;
  const peek = () => s[i];
  const eat = () => s[i++];
  const skip = () => { while (/\s/.test(peek() || "")) i++; };
  function parseExpr() {
    let v = parseTerm();
    for (;;) {
      skip();
      const c = peek();
      if (c === "+" || c === "-") { eat(); const r = parseTerm(); v = c === "+" ? v + r : v - r; }
      else return v;
    }
  }
  function parseTerm() {
    let v = parseFactor();
    for (;;) {
      skip();
      const c = peek();
      if (c === "*" || c === "/" || c === "%") {
        eat(); const r = parseFactor();
        v = c === "*" ? v * r : c === "/" ? v / r : v % r;
      } else return v;
    }
  }
  function parseFactor() {
    let v = parseUnary();
    skip();
    if (peek() === "^") { eat(); const r = parseFactor(); v = Math.pow(v, r); }
    return v;
  }
  function parseUnary() {
    skip();
    if (peek() === "-") { eat(); return -parseUnary(); }
    if (peek() === "+") { eat(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    skip();
    const c = peek();
    if (c === "(") {
      eat(); const v = parseExpr(); skip();
      if (peek() !== ")") throw new Error("missing )");
      eat(); return v;
    }
    if (/[0-9.]/.test(c || "")) {
      let num = "";
      while (/[0-9.]/.test(peek() || "")) num += eat();
      const v = Number(num);
      if (!Number.isFinite(v)) throw new Error("bad number");
      return v;
    }
    if (/[a-zA-Z_]/.test(c || "")) {
      let name = "";
      while (/[a-zA-Z0-9_]/.test(peek() || "")) name += eat();
      const low = name.toLowerCase();
      skip();
      if (peek() === "(") {
        const fn = CALC_FUNCS[low];
        if (!fn) throw new Error(`unknown function: ${name}`);
        eat();
        const fargs = [];
        skip();
        if (peek() !== ")") {
          fargs.push(parseExpr());
          for (;;) { skip(); if (peek() === ",") { eat(); fargs.push(parseExpr()); } else break; }
        }
        skip();
        if (peek() !== ")") throw new Error("missing )");
        eat();
        const v = fn(...fargs);
        if (!Number.isFinite(v)) throw new Error("not a finite result");
        return v;
      }
      if (low in CALC_CONSTS) return CALC_CONSTS[low];
      throw new Error(`unknown name: ${name}`);
    }
    throw new Error(`unexpected '${c || "end"}'`);
  }
  const v = parseExpr();
  skip();
  if (i < s.length) throw new Error(`trailing junk: '${s.slice(i)}'`);
  if (!Number.isFinite(v)) throw new Error("not a finite result");
  return v;
}

/* ------------------------------------------------------------ web_fetch */

function cleanText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------- reminders */

export function scheduleReminder(db, text, atMs) {
  const ev = (db.events = Array.isArray(db.events) ? db.events : []);
  const r = {
    id: "rem" + Date.now().toString(36),
    kind: "reminder",
    text: String(text || "").slice(0, 280),
    at: Number(atMs) || Date.now() + 3600000,
    done: false,
    created_at: Date.now(),
  };
  ev.push(r);
  return r;
}

/** Due reminders — marks them done so each fires once. Call from the keepalive tick. */
export function dueReminders(db) {
  const now = Date.now();
  const out = [];
  for (const e of db.events || []) {
    if (e && e.kind === "reminder" && !e.done && Number(e.at) <= now) {
      e.done = true;
      out.push(e);
    }
  }
  return out;
}

/** "in 20 minutes" / "in 2 hours" / ISO string -> timestamp. Defaults +60min. */
export function parseWhen(when) {
  const s = String(when || "").trim();
  const m = s.match(/in\s+(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    const ms = u.startsWith("min") ? 60000 : u.startsWith("d") ? 86400000 : 3600000;
    return Date.now() + n * ms;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t) && t > Date.now() - 60000) return t;
  return Date.now() + 3600000;
}

/* --------------------------------------------------------------- run log */

/** Append-only, on-device — seeds the blueprint's consent ledger. */
/* M2: the run log lives in the encrypted sidecar (www/store-vault.js),
 * served from the decrypted in-memory cache. Plaintext key retired. */

function summarizeArgs(tool, args) {
  try {
    if (tool === "shell") return String(args.command || "").slice(0, 200);
    return JSON.stringify(args || {}).slice(0, 200);
  } catch {
    return "";
  }
}

export function logToolCall({ runId, tool, args, lane, backend, ok, ms, note }) {
  try {
    vaultAppendRunLog({
      ts: Date.now(),
      runId: runId || "",
      tool,
      lane: lane || "",
      backend: backend || "",
      ok: Boolean(ok),
      ms: Number(ms) || 0,
      args: summarizeArgs(tool, args),
      note: String(note || "").slice(0, 160),
    });
  } catch {
    /* logging never breaks the run */
  }
}

export function getRunLog(limit = 50) {
  try {
    return vaultRunLog(limit);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ the tools */

const S = (type, description, extra = {}) => ({ type, description, ...extra });

/* --------------------------------------------------------- GitHub tools */

const GH_NO_TOKEN = "no GitHub token — paste one in DATA and the GitHub tools will work.";
const GH_BAD_REPO = "Repo must be owner/repo — e.g. joshuagwatts/pip-phone.";

function splitRepo(repo) {
  const m = String(repo || "").trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  return m ? { owner: m[1], name: m[2].replace(/\.git$/, "") } : null;
}

export const TOOLS = [
  {
    name: "memory_search",
    description: "Search Pip's long-term memory (durable, people, daily, working tiers). Use for anything about Joshua, past decisions, people, goals.",
    lane: "local",
    schema: {
      type: "object",
      properties: {
        query: S("string", "what to search for", { maxLength: 200 }),
        limit: S("integer", "max hits", { minimum: 1, maximum: 12 }),
      },
      required: ["query"],
    },
    run: async ({ query, limit }) => {
      const { searchMem } = await import("./memory-engine.js");
      const { filterByScope } = await import("./scopes.js");
      // Scope contract at the tool assembly point too (job "agent" = the
      // operator explicitly invoked the agent — full tiers, see scopes.js).
      const hits = filterByScope(searchMem(query, { limit: Math.min(Number(limit) || 6, 12) }), "agent");
      if (!hits.length) return "No memories match.";
      return hits
        .map((h) => `· [${h.tier}]${h.title ? " " + h.title : ""}\n${String(h.content || "").slice(0, 400)}`)
        .join("\n\n");
    },
  },
  {
    name: "remember",
    description: "File something into long-term (durable) memory. Only for facts worth keeping — decisions, people, goals, preferences.",
    lane: "local",
    schema: {
      type: "object",
      properties: { content: S("string", "the fact to keep", { maxLength: 1000 }) },
      required: ["content"],
    },
    run: async ({ content }) => {
      const { rememberNow } = await import("./memory-engine.js");
      const e = await rememberNow(content);
      return e ? "Remembered — in long-term now." : "Nothing stored.";
    },
  },
  {
    name: "web_fetch",
    description: "Fetch a public web page and return cleaned text. Public URLs only — private/LAN addresses are refused.",
    lane: "network",
    schema: {
      type: "object",
      properties: { url: S("string", "http(s) URL to fetch", { maxLength: 500 }) },
      required: ["url"],
    },
    run: async ({ url }) => {
      const { httpGet } = await import("./net.js");
      const { url: finalUrl, body } = await httpGet(String(url), 12000);
      const text = cleanText(body).slice(0, 4000);
      return `URL: ${finalUrl}\n\n${text || "(page had no readable text)"}`;
    },
  },
  {
    name: "files_list",
    description: "List the app's editable files (the code overlay workspace).",
    lane: "local",
    schema: { type: "object", properties: {} },
    run: async () => {
      const { listEntries } = await import("./codefs.js");
      const rows = listEntries().slice(0, 60);
      return rows.map((r) => `· ${r.name}${r.overlay ? " (edited)" : ""}`).join("\n") || "(no files)";
    },
  },
  {
    name: "file_read",
    description: "Read a file from the app workspace (overlay first, then the shipped file).",
    lane: "local",
    schema: {
      type: "object",
      properties: { path: S("string", "file name, e.g. style.css", { maxLength: 120 }) },
      required: ["path"],
    },
    run: async ({ path }) => {
      const { readFile } = await import("./codefs.js");
      const f = await readFile(path);
      const body = String(f.body || "");
      const cap = body.slice(0, 8000);
      return `--- ${f.path}${f.overlay ? " (your edited overlay)" : ""} ---\n${cap}${body.length > 8000 ? `\n… (${body.length - 8000} more chars)` : ""}`;
    },
  },
  {
    name: "file_write",
    description: "Write a file into the app workspace (lands in the editable overlay, applied on next reload). One-tap approval per file, per session.",
    lane: "local",
    approve: "file",
    schema: {
      type: "object",
      properties: {
        path: S("string", "file name, e.g. notes.txt", { maxLength: 120 }),
        content: S("string", "full new file content", { maxLength: 60000 }),
      },
      required: ["path", "content"],
    },
    run: async ({ path, content }) => {
      const { writeFile } = await import("./codefs.js");
      const out = writeFile(path, content);
      return `Wrote ${out.path} (${out.bytes} bytes) into the overlay. JS/HTML changes apply on reload.`;
    },
  },
  {
    name: "shell",
    description: "Run a shell command on the DESKTOP (only exists in the desktop app). 60s timeout, output capped. One-tap approval per command pattern, per session.",
    lane: "desktop",
    approve: "shell",
    schema: {
      type: "object",
      properties: { command: S("string", "the exact command to run", { maxLength: 2000 }) },
      required: ["command"],
    },
    run: async ({ command }) => {
      const out = await shellExec(command, { timeoutMs: 60000 });
      const head = (s) => String(s || "").slice(0, 2000);
      return `exit=${out.code}${out.timedOut ? " (TIMED OUT at 60s)" : ""}\n--- stdout ---\n${head(out.stdout) || "(empty)"}\n--- stderr ---\n${head(out.stderr) || "(empty)"}`;
    },
  },
  {
    name: "github_repos",
    description: "List Joshua's own GitHub repos (full name, default branch, last push). Start a code task here when you don't know the exact owner/repo.",
    lane: "network",
    schema: { type: "object", properties: {} },
    run: async () => {
      if (!ghHasToken()) return GH_NO_TOKEN;
      const repos = await ghListRepos();
      if (!repos.length) return "No repos found on that GitHub account.";
      return repos
        .slice(0, 60)
        .map((r) => `· ${r.full_name} (${r.default_branch}${r.private ? ", private" : ""}) — pushed ${String(r.pushed_at).slice(0, 10)}${r.description ? ` · ${r.description.slice(0, 80)}` : ""}`)
        .join("\n");
    },
  },
  {
    name: "github_tree",
    description: "List every file path in a GitHub repo (recursive). Map the repo before editing so you know the layout.",
    lane: "network",
    schema: {
      type: "object",
      properties: {
        repo: S("string", "owner/repo, e.g. joshuagwatts/pip-phone", { maxLength: 140 }),
        ref: S("string", "branch or commit sha (blank = default branch)", { maxLength: 120 }),
      },
      required: ["repo"],
    },
    run: async ({ repo, ref }) => {
      if (!ghHasToken()) return GH_NO_TOKEN;
      const sp = splitRepo(repo);
      if (!sp) return GH_BAD_REPO;
      const out = await ghListTree(sp.owner, sp.name, ref || undefined);
      if (!out.entries.length) return `${sp.owner}/${sp.name} is an empty repo.`;
      const lines = out.entries.map((e) => (e.type === "tree" ? `· ${e.path}/` : `· ${e.path}`));
      return lines.join("\n") + (out.truncated ? `\n… (listing capped — ${out.total} paths total)` : "");
    },
  },
  {
    name: "github_read",
    description: "Read one file from a GitHub repo. Always read a file in full before changing it.",
    lane: "network",
    schema: {
      type: "object",
      properties: {
        repo: S("string", "owner/repo", { maxLength: 140 }),
        path: S("string", "file path in the repo", { maxLength: 300 }),
        ref: S("string", "branch or commit sha (blank = default branch)", { maxLength: 120 }),
      },
      required: ["repo", "path"],
    },
    run: async ({ repo, path, ref }) => {
      if (!ghHasToken()) return GH_NO_TOKEN;
      const sp = splitRepo(repo);
      if (!sp) return GH_BAD_REPO;
      const got = await ghReadFile(sp.owner, sp.name, path, ref || undefined);
      if (got.dir) {
        return `${path} is a directory:\n${got.dir.map((e) => `· ${e.path}${e.type === "tree" ? "/" : ""}`).join("\n")}`;
      }
      if (got.text == null) {
        return `${got.path} — GitHub won't inline this file (${got.size} bytes; too large for the contents API). sha ${got.sha.slice(0, 7)}`;
      }
      if (got.text.includes("\u0000")) {
        return `${got.path} looks binary (${got.size} bytes) — not shown. sha ${got.sha.slice(0, 7)}`;
      }
      const cap = got.text.slice(0, 5000);
      return `--- ${sp.owner}/${sp.name}:${got.path}${ref ? ` @ ${ref}` : ""} (sha ${got.sha.slice(0, 7)}) ---\n${cap}${got.text.length > 5000 ? `\n… (${got.text.length - 5000} more chars — truncated)` : ""}`;
    },
  },
  {
    name: "github_commit",
    description:
      "Commit file changes (and optional deletions) to a GitHub repo branch via the Git Data API. ALWAYS shows Joshua an approval preview first — repo, branch, message, per-file +/- line counts — and writes NOTHING unless he approves. Fast-forward only, never force.",
    lane: "network",
    schema: {
      type: "object",
      properties: {
        repo: S("string", "owner/repo", { maxLength: 140 }),
        branch: S("string", "branch to commit to (blank = the repo's default branch)", { maxLength: 120 }),
        message: S("string", "commit message", { maxLength: 500 }),
        files: {
          type: "array",
          description: "files to create or update: [{path, content}] — full new content per file",
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
        deletes: { type: "array", description: "repo paths to delete", items: { type: "string" } },
      },
      required: ["repo", "message"],
    },
    run: async (args, ctx) => {
      if (!ghHasToken()) return GH_NO_TOKEN;
      const sp = splitRepo(args.repo);
      if (!sp) return GH_BAD_REPO;
      const files = (Array.isArray(args.files) ? args.files : [])
        .filter((f) => f && typeof f.path === "string" && f.path.trim() && typeof f.content === "string")
        .map((f) => ({ path: f.path.trim(), content: f.content }));
      const deletes = (Array.isArray(args.deletes) ? args.deletes : [])
        .filter((p) => typeof p === "string" && p.trim())
        .map((p) => p.trim());
      if (!files.length && !deletes.length) {
        return "Nothing to commit — pass files: [{path, content}] and/or deletes: [paths].";
      }
      if (files.length + deletes.length > 30) {
        return "Too many files in one commit (max 30) — split it into smaller commits.";
      }
      const message = String(args.message || "").trim();
      if (!message) return "A commit message is required.";

      // Read phase (log-free: the commit itself is the one ledger entry) —
      // resolve the branch and compute REAL +/- line counts for the preview,
      // the M3 lesson: the approval card shows exactly what will happen.
      const repoInfo = await ghGetRepo(sp.owner, sp.name, { log: false });
      const branch = String(args.branch || "").trim() || repoInfo.default_branch;
      const rows = [];
      for (const f of files) {
        let cur = null;
        let isNew = false;
        let approx = false;
        try {
          const got = await ghReadFile(sp.owner, sp.name, f.path, branch, { log: false });
          if (got.dir) return `${f.path} is a directory on ${branch} — can't overwrite a directory with a file. Nothing committed.`;
          cur = got.text;
          if (cur === null) approx = true; // too large to inline — counts are new-content lines
        } catch (e) {
          if (isNoTokenError(e)) throw e;
          if (e && e.status === 404) isNew = true;
          else approx = true;
        }
        const d = isNew
          ? { added: f.content ? f.content.split("\n").length : 0, removed: 0 }
          : ghLineDiff(cur || "", f.content);
        rows.push(`  ${f.path}  ${isNew ? "NEW " : ""}+${d.added}/−${d.removed}${d.approx || approx ? " (approx)" : ""}`);
      }
      for (const p of deletes) {
        let n = null;
        try {
          const got = await ghReadFile(sp.owner, sp.name, p, branch, { log: false });
          if (got.text != null) n = got.text.split("\n").length;
        } catch {
          /* deleting a path we can't read still previews honestly below */
        }
        rows.push(`  ${p}  DELETE${n != null ? ` −${n}` : ""}`);
      }
      const detail = [
        `Commit to ${sp.owner}/${sp.name} @ ${branch}`,
        `Message: ${message}`,
        "",
        "Files:",
        ...rows,
        "",
        "Writes to github.com — the commit is created only if you approve. Fast-forward only, never force.",
      ].join("\n");

      // The gate (mirrors the M3 file-write approval): no approver, no write.
      if (!ctx.approve) {
        return "Commits need your approval tap — no approval card is available in this context, so nothing was written.";
      }
      const ok = await ctx.approve("Commit to GitHub?", detail).catch(() => false);
      if (!ok) return "Declined — nothing was committed to GitHub.";

      try {
        const out = await ghCommitFiles(sp.owner, sp.name, branch, message, files, deletes);
        return (
          `Committed ${out.sha.slice(0, 7)} to ${sp.owner}/${sp.name}@${out.branch} — "${message.split("\n")[0].slice(0, 80)}" ` +
          `(${out.changed} file${out.changed === 1 ? "" : "s"} changed, ${out.deleted} deleted). ${out.htmlUrl}`
        );
      } catch (e) {
        if (isNoTokenError(e)) return GH_NO_TOKEN;
        return `Commit failed: ${String((e && e.message) || e).slice(0, 200)}`;
      }
    },
  },
  {
    name: "remind",
    description: "Schedule a reminder — Pip surfaces it in chat when it's due. `when` accepts 'in 20 minutes', 'in 2 hours', or an ISO datetime.",
    lane: "local",
    schema: {
      type: "object",
      properties: {
        text: S("string", "what to remind him of", { maxLength: 280 }),
        when: S("string", "'in 20 minutes' or ISO datetime", { maxLength: 60 }),
      },
      required: ["text", "when"],
    },
    run: async ({ text, when }, ctx) => {
      const at = parseWhen(when);
      scheduleReminder(ctx.db, text, at);
      if (ctx.persist) ctx.persist();
      return `Reminder set for ${new Date(at).toLocaleString()} — I'll bring it up in chat.`;
    },
  },
  {
    name: "calc",
    description: "Evaluate a math expression safely (+ - * / % ^ parentheses, sqrt/sin/cos/log/abs/floor/round/min/max/pi/e).",
    lane: "local",
    schema: {
      type: "object",
      properties: { expression: S("string", "e.g. (2400*0.65)/12", { maxLength: 200 }) },
      required: ["expression"],
    },
    run: async ({ expression }) => `= ${calcEval(expression)}`,
  },
];

/* ------------------------------------------------- manifests for models */

export function nativeToolSpecs() {
  return TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.schema },
  }));
}

export function toolManifestText() {
  return TOOLS.map((t) => {
    const props = Object.entries(t.schema.properties || {})
      .map(([k, v]) => `${k}${(t.schema.required || []).includes(k) ? "*" : ""}: ${v.type} — ${v.description || ""}`)
      .join("; ");
    return `- ${t.name}: ${t.description} Args: { ${props} }`;
  }).join("\n");
}

export function toolByName(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

/* ------------------------------------------------------------- execution */

/** Per-session approval memory: shell patterns + file paths already approved. */
const approvedShell = new Set();
const approvedFiles = new Set();
/** Per-run network consent (SECURE mode asks once per agent run). */
const netConsentedRuns = new Set();

function shellPattern(command) {
  return String(command || "").trim().split(/\s+/)[0].toLowerCase() || "?";
}

/**
 * Execute a tool with rails. ctx: { settings, db, persist, approve(title, detail)->Promise<bool>, runId, backend }.
 * Never throws — returns a result string (errors included) for the model.
 */
export async function execTool(name, args, ctx = {}) {
  const t0 = Date.now();
  const tool = toolByName(name);
  const done = (ok, result, note = "") => {
    logToolCall({ runId: ctx.runId, tool: name, args, lane: tool ? tool.lane : "", backend: ctx.backend, ok, ms: Date.now() - t0, note });
    return String(result);
  };
  if (!tool) return done(false, `Unknown tool: ${name}. Available: ${TOOLS.map((t) => t.name).join(", ")}`);
  const v = validateArgs(tool.schema, args);
  if (!v.ok) return done(false, `Bad args for ${name}: ${v.error}`);

  // Lane enforcement.
  if (tool.lane === "network") {
    const secure = privacyOn(ctx.settings);
    if (secure && ctx.runId && !netConsentedRuns.has(ctx.runId)) {
      const detail = name === "web_fetch" ? `Fetching: ${v.args.url}` : `Network tool: ${name}`;
      const ok = ctx.approve ? await ctx.approve("Web access for this run?", `${detail}\n\nThis leaves the device. SECURE mode asks once per run.`).catch(() => false) : false;
      if (!ok) return done(false, "Declined — web access needs your tap in SECURE mode.", "consent denied");
      netConsentedRuns.add(ctx.runId);
    }
  }
  if (tool.lane === "desktop") {
    if (!shellAvailable()) return done(false, shellWhyNot());
  }

  // Approval rails for acting tools.
  if (tool.approve === "shell") {
    const pat = shellPattern(v.args.command);
    if (!approvedShell.has(pat)) {
      const ok = ctx.approve ? await ctx.approve("Run on your desktop?", String(v.args.command).slice(0, 500)).catch(() => false) : false;
      if (!ok) return done(false, "Declined — command not run.", "approval denied");
      approvedShell.add(pat);
    }
  }
  if (tool.approve === "file") {
    const p = String(v.args.path || "");
    if (!approvedFiles.has(p)) {
      // M3: the card shows WHAT will be written — path, size, and a content
      // preview — so a prompt-injected overlay can't hide behind a filename.
      const content = String(v.args.content || "");
      const preview = content.slice(0, 600);
      const detail =
        `${p}\n(${content.length} bytes into the app overlay)\n` +
        `--- content preview ---\n${preview}` +
        (content.length > 600 ? `\n… (${content.length - 600} more chars)` : "");
      const ok = ctx.approve ? await ctx.approve("Write this file?", detail).catch(() => false) : false;
      if (!ok) return done(false, "Declined — file not written.", "approval denied");
      approvedFiles.add(p);
    }
  }

  try {
    const out = await tool.run(v.args, ctx);
    return done(true, String(out).slice(0, 6000));
  } catch (e) {
    return done(false, `Tool error (${name}): ${String((e && e.message) || e).slice(0, 200)}`);
  }
}
