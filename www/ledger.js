/** Consent ledger + outbound leak-scan — Phase 3 (PIP_REIMAGINED §4).
 *
 * The ledger is an append-only, on-device log of everything that left the
 * phone via a cloud completion: when, which provider/model, which job,
 * what data slice went along (CATEGORIES ONLY — never content), approx
 * tokens, why that brain was picked, and whether the leak-scan stripped
 * something on the way out. Inspectable in DATA, exportable, deletable.
 *
 * Local routes never appear here: desktop Ollama is LAN, on-device Qwen
 * and Pip Lite never leave the phone — nothing left, nothing to log.
 * Fixed-string key-validation pings aren't entries either (they carry no
 * user data — just the word "ping").
 *
 * The leak-scan is the output-side safety net. Before any cloud send it
 * scans the assembled outbound text for (a) actual vault secret VALUES —
 * a key that somehow got pasted or quoted into a prompt can never leave —
 * and (b) secret-shaped strings (sk-…, nvapi-…, ghp_…, AKIA…, long
 * mixed-class base64-ish runs). Hits are replaced with a placeholder and
 * the send's ledger entry is flagged "stripped". Best-effort, honestly
 * labeled as such in DATA — it is a net, not a guarantee.
 */

import { getSecret, SECRET_FIELDS } from "./secrets.js";

export const LEDGER_KEY = "pip.phone.ledger.v1";
const LEDGER_CAP = 500;
export const REDACTED = "[redacted by Pip leak-scan]";

/* ------------------------------------------------------------- storage --- */

function loadList() {
  try {
    const v = JSON.parse(localStorage.getItem(LEDGER_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveList(list) {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — the ledger is best-effort, never a blocker */
  }
}

export function ledgerEntries() {
  return loadList();
}

export function ledgerCount() {
  return loadList().length;
}

/** Append one entry; the log keeps only the newest LEDGER_CAP entries. */
export function appendLedger(entry = {}) {
  const list = loadList();
  const row = {
    ts: Date.now(),
    provider: "",
    model: "",
    job: "chat",
    scope: [],
    tokensIn: 0,
    tokensOut: 0,
    why: "",
    leakScan: "clean",
    ...entry,
  };
  row.scope = Array.isArray(row.scope) ? row.scope.map(String).slice(0, 12) : [];
  row.tokensIn = Number(row.tokensIn) || 0;
  row.tokensOut = Number(row.tokensOut) || 0;
  row.leakScan = row.leakScan === "stripped" ? "stripped" : "clean";
  list.push(row);
  while (list.length > LEDGER_CAP) list.shift();
  saveList(list);
  return row;
}

export function clearLedger() {
  saveList([]);
}

export function ledgerExportJson() {
  return JSON.stringify(loadList(), null, 2);
}

/* ------------------------------------------------- assembly scope note ---
 * memory-engine's assembleMemoryContext notes the slice it just assembled
 * (job + categories) here; the cloud send path attaches those categories
 * to the ledger entry when the send belongs to the same job and the note
 * is fresh. Categories only — content never touches this module. */
let lastScope = { job: "", categories: [], at: 0 };

export function noteScope({ job = "", categories = [] } = {}) {
  lastScope = {
    job: String(job || ""),
    categories: Array.isArray(categories) ? categories.map(String) : [],
    at: Date.now(),
  };
}

export function recentScopeCategories(job, maxAgeMs = 5 * 60 * 1000) {
  if (!lastScope.at || Date.now() - lastScope.at > maxAgeMs) return [];
  if (job && lastScope.job && String(job) !== lastScope.job) return [];
  return [...lastScope.categories];
}

/* ------------------------------------------------------------ leak-scan --- */

// Every vault field, plus the memory DEK (a vault key outside SECRET_FIELDS).
const DENY_FIELDS = [...SECRET_FIELDS, "memory_dek"];

function vaultValues() {
  const out = [];
  for (const f of DENY_FIELDS) {
    try {
      const v = String(getSecret(f) || "");
      if (v.length >= 8) out.push(v);
    } catch {
      /* vault not open yet — nothing to deny with */
    }
  }
  return out;
}

const SHAPED_RES = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /nvapi-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
];
// Long base64-ish runs are only treated as secret-shaped when they mix
// character classes (upper + lower + digit) — a lowercase hex git SHA or a
// long number is not a key and passes through untouched.
const B64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/g;

function looksLikeToken(run) {
  return /[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run);
}

export function scanOutboundText(text) {
  let s = String(text ?? "");
  let stripped = false;
  for (const v of vaultValues()) {
    if (s.includes(v)) {
      s = s.split(v).join(REDACTED);
      stripped = true;
    }
  }
  for (const re of SHAPED_RES) {
    s = s.replace(re, () => {
      stripped = true;
      return REDACTED;
    });
  }
  s = s.replace(B64_RUN, (m) => {
    if (looksLikeToken(m)) {
      stripped = true;
      return REDACTED;
    }
    return m;
  });
  return { text: s, stripped };
}

/**
 * Scan an outbound messages array. String contents are scanned; multipart
 * contents have only their text parts scanned — image_url parts (the
 * operator's own photos) are never touched. Returns a new array when
 * anything changed; the caller's array is never mutated.
 */
export function scanOutbound(messages) {
  let leak = "clean";
  const out = (Array.isArray(messages) ? messages : []).map((m) => {
    if (!m || typeof m !== "object") return m;
    if (typeof m.content === "string") {
      const r = scanOutboundText(m.content);
      if (r.stripped) {
        leak = "stripped";
        return { ...m, content: r.text };
      }
      return m;
    }
    if (Array.isArray(m.content)) {
      let changed = false;
      const parts = m.content.map((p) => {
        if (p && typeof p === "object" && p.type === "text" && typeof p.text === "string") {
          const r = scanOutboundText(p.text);
          if (r.stripped) {
            changed = true;
            leak = "stripped";
            return { ...p, text: r.text };
          }
        }
        return p;
      });
      return changed ? { ...m, content: parts } : m;
    }
    return m;
  });
  return { messages: out, leak };
}

/* --------------------------------------------------------- token estimates --- */

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

/** Rough input-token estimate for a messages array (text parts only). */
export function messagesTokens(messages) {
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m) continue;
    if (typeof m.content === "string") n += estimateTokens(m.content);
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p && typeof p === "object" && p.type === "text") n += estimateTokens(p.text);
      }
    }
  }
  return n;
}
