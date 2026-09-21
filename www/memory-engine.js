/** PIP Memory Engine — Phase 1 of the holo-muse rebuild.
 *
 * Four tiers replace the old flat "moments" list:
 *   working — this session only. Volatile, NEVER persisted. Captured chat lines.
 *   daily   — auto-distilled dated notes (nightly, local model only).
 *   durable — curated long-term. Entries land here ONLY via explicit
 *             "remember this" or your approval of a suggestion.
 *   people  — one page per person.
 *
 * Sync-merge-ready schema (verdict Q2: device-only now, encrypted desktop sync
 * later). Every persisted entry carries:
 *   { id (uuid), tier, title, content, tags[], role, score,
 *     created_at, updated_at, origin ('phone'|'desktop'),
 *     deleted (tombstone bool), migrated, suggested,
 *     embedding (cached vector or null),
 *     pending_action (reserved — verdict Q1 act-and-draft lands in Phase 4) }
 *
 * Encryption at rest: envelope encryption. A random 256-bit DEK is generated
 * once and kept in the secrets vault (www/secrets.js — native Keystore /
 * Keychain or passphrase vault). Memory blobs are AES-GCM ciphertext in
 * localStorage; the DEK never touches localStorage. One biometric unlock
 * opens both keys and memory.
 *
 * Scope hygiene: the ONLY way memory enters a prompt is
 * assembleMemoryContext(). Vault secret fields can never appear here — memory
 * entries are user content, never key material, and assembly never reads the
 * secrets vault.
 */

import { getSecret, setSecret } from "./secrets.js";
import { load as loadStore, save as saveStore } from "./store.js";
import { rankEntries } from "./memory-recall.js";
import { substanceScore } from "./memory.js";

export const TIERS = ["working", "daily", "durable", "people"];
const LS_KEY = "pip.phone.memory.v1";
const DEK_NAME = "memory_dek";

const te = new TextEncoder();
const td = new TextDecoder();

function b64e(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64d(s) {
  const bin = atob(String(s || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function nowIso() {
  return new Date().toISOString();
}
function dayOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown-date" : iso.slice(0, 10);
}

// ---------------------------------------------------------------- state ---

const entries = new Map(); // id -> entry (persisted tiers only)
const working = []; // volatile session captures, newest first — never persisted
let dekKey = null; // CryptoKey, memory only
let ready = false;
let initPromise = null;

function newEntry(tier, content, opts = {}) {
  const now = nowIso();
  return {
    id: (crypto.randomUUID && crypto.randomUUID()) || `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    tier,
    title: String(opts.title || "").slice(0, 120),
    content: String(content || "").slice(0, 4000),
    tags: Array.isArray(opts.tags) ? opts.tags.map(String).slice(0, 12) : [],
    role: opts.role === "pip" ? "pip" : "user",
    score: Number(opts.score) || 0,
    created_at: opts.created_at || now,
    updated_at: opts.updated_at || now,
    origin: opts.origin === "desktop" ? "desktop" : "phone",
    deleted: false,
    migrated: Boolean(opts.migrated),
    suggested: Boolean(opts.suggested),
    embedding: Array.isArray(opts.embedding) ? opts.embedding : null,
    // Verdict Q1 (act AND draft): reserved for Phase 4 pending actions.
    pending_action: null,
  };
}

// ------------------------------------------------------------- encryption ---

async function ensureDek() {
  if (dekKey) return dekKey;
  let b64 = String(getSecret(DEK_NAME) || "").trim();
  if (!b64) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    b64 = b64e(raw);
    // Stored in the vault (Keystore/Keychain or passphrase vault) — never localStorage.
    await setSecret(DEK_NAME, b64);
  }
  dekKey = await crypto.subtle.importKey("raw", b64d(b64), "AES-GCM", false, ["encrypt", "decrypt"]);
  return dekKey;
}

async function encryptBlob(obj) {
  const key = await ensureDek();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
  return { v: 1, iv: b64e(iv), data: b64e(ct) };
}

async function decryptBlob(bundle) {
  const key = await ensureDek();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64d(bundle.iv)) },
    key,
    b64d(bundle.data),
  );
  return JSON.parse(td.decode(pt));
}

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage full/unavailable — persistMemory reports via throw */
    throw new Error("localStorage unavailable — memory could not be saved");
  }
}

/** Encrypt + write every persisted-tier entry. Working tier is never written. */
export async function persistMemory() {
  if (!ready) return;
  const list = [];
  for (const e of entries.values()) {
    if (e.tier === "working") continue;
    list.push(e);
  }
  const bundle = await encryptBlob({ entries: list, saved_at: nowIso() });
  lsSet(LS_KEY, JSON.stringify(bundle));
}

function hydrate(list) {
  entries.clear();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== "object" || !raw.id) continue;
    const e = newEntry(raw.tier && TIERS.includes(raw.tier) ? raw.tier : "daily", raw.content || "", {
      title: raw.title,
      tags: raw.tags,
      role: raw.role,
      score: raw.score,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      origin: raw.origin,
      migrated: raw.migrated,
      suggested: raw.suggested,
      embedding: raw.embedding,
    });
    e.id = String(raw.id);
    e.deleted = Boolean(raw.deleted);
    e.pending_action = raw.pending_action || null;
    entries.set(e.id, e);
  }
}

// -------------------------------------------------------------- migration ---

/**
 * Best-effort migration of the old plaintext moments list:
 *   score >= 14 -> durable (kept the old "substantive" bar)
 *   everything else -> grouped by date into one daily entry per day
 * Everything is kept, marked migrated:true. The old list is wiped after.
 */
async function migrateLegacy(db) {
  const s = (db.settings = db.settings || {});
  if (s.memory_migrated_v1) return { migrated: 0, durable: 0, daily: 0 };
  const moments = Array.isArray(db.moments) ? db.moments : [];
  let durable = 0;
  const byDay = new Map();
  for (const m of moments) {
    const content = String((m && m.content) || "").trim();
    if (!content) continue;
    const at = String((m && m.at) || "") || nowIso();
    const tags = String((m && m.tags) || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (Number((m && m.score) || 0) >= 14) {
      const e = newEntry("durable", content, {
        title: content.slice(0, 80),
        tags,
        role: m.role,
        score: m.score,
        created_at: at,
        updated_at: at,
        migrated: true,
      });
      entries.set(e.id, e);
      durable += 1;
    } else {
      const day = dayOf(at);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ content, at });
    }
  }
  let daily = 0;
  for (const [day, rows] of byDay) {
    rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const body = rows.map((r) => `- ${r.content}`).join("\n");
    const e = newEntry("daily", body, {
      title: `Migrated captures · ${day}`,
      tags: ["migrated"],
      created_at: `${day}T23:59:00.000Z`,
      migrated: true,
    });
    entries.set(e.id, e);
    daily += 1;
  }
  // Wipe the old plaintext list only after everything landed in the engine.
  db.moments = [];
  s.memory_migrated_v1 = true;
  saveStore(db);
  await persistMemory();
  return { migrated: moments.length, durable, daily };
}

// ------------------------------------------------------------------ init ---

/**
 * Boot-time init. Must run AFTER the biometric/passphrase gate (boot.js order:
 * requireBootAuth -> initSecrets -> initMemoryEngine). Throws on crypto
 * failure — running the engine unencrypted would silently break the security
 * promise, so boot fails loudly instead.
 */
export function initMemoryEngine() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!crypto.subtle) throw new Error("WebCrypto unavailable — memory cannot be encrypted on this device.");
    await ensureDek();
    const raw = lsGet(LS_KEY);
    if (raw) {
      try {
        const bundle = JSON.parse(raw);
        if (!bundle || !bundle.iv || !bundle.data) throw new Error("bad blob");
        const obj = await decryptBlob(bundle);
        hydrate(obj.entries);
      } catch (e) {
        throw new Error(`Memory vault unreadable: ${String(e.message || e)}`);
      }
    }
    const db = loadStore();
    // ready=true before migration: persistMemory() must actually write the
    // encrypted blob during migrateLegacy (it no-ops while !ready).
    ready = true;
    const mig = await migrateLegacy(db);
    return { entries: entries.size, ...mig };
  })();
  return initPromise;
}

export function memoryReady() {
  return ready;
}

function assertReady() {
  if (!ready) throw new Error("Memory engine not initialized");
}

// ---------------------------------------------------------------- capture ---

/** Session capture — volatile working tier. Uses the old substance heuristic. */
export function capture(text, opts = {}) {
  const t = String(text || "").trim();
  if (!t) return null;
  const score = substanceScore(t);
  if (score < (opts.minScore != null ? opts.minScore : 12)) return null;
  const e = newEntry("working", t, { role: opts.role, score });
  working.unshift(e);
  if (working.length > 200) working.length = 200;
  return e;
}

/** Explicit "remember this" — straight to durable, persisted immediately. */
export async function rememberNow(content, opts = {}) {
  assertReady();
  const t = String(content || "").trim();
  if (!t) return null;
  const e = newEntry("durable", t, {
    title: String(opts.title || t.slice(0, 80)),
    tags: opts.tags,
    role: opts.role,
  });
  entries.set(e.id, e);
  await persistMemory();
  return e;
}

/** Promote any entry (working capture, daily line) to durable. */
export async function promoteToDurable(id, title) {
  assertReady();
  const src = entries.get(id) || working.find((w) => w.id === id);
  if (!src || src.deleted) return null;
  const e = newEntry("durable", src.content, {
    title: title || src.title || src.content.slice(0, 80),
    tags: src.tags,
    role: src.role,
    score: Math.max(src.score || 0, 16),
  });
  entries.set(e.id, e);
  await persistMemory();
  return e;
}

// ------------------------------------------------------------ suggestions ---

/** Distillation proposes 0-3 candidates; they wait here for one-tap verdict. */
export async function suggestDurable(content, source) {
  assertReady();
  const t = String(content || "").trim();
  if (!t) return null;
  const e = newEntry("durable", t, {
    title: t.slice(0, 80),
    tags: source ? ["suggested", String(source)] : ["suggested"],
    suggested: true,
    score: 14,
  });
  entries.set(e.id, e);
  await persistMemory();
  return e;
}

export function getSuggestions() {
  return [...entries.values()]
    .filter((e) => e.suggested && !e.deleted)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export async function approveSuggestion(id) {
  assertReady();
  const e = entries.get(id);
  if (!e || !e.suggested) return null;
  e.suggested = false;
  e.updated_at = nowIso();
  e.tags = (e.tags || []).filter((t) => t !== "suggested");
  await persistMemory();
  return e;
}

export async function dismissSuggestion(id) {
  return tombstone(id);
}

// ------------------------------------------------------------------ CRUD ---

export function getTier(tier, { includeDeleted = false } = {}) {
  const list = [...entries.values()].filter((e) => e.tier === tier && (includeDeleted || !e.deleted));
  if (tier === "working") return working.slice();
  list.sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  return list;
}

export function getEntry(id) {
  return entries.get(id) || working.find((w) => w.id === id) || null;
}

export async function updateEntry(id, patch = {}) {
  assertReady();
  const e = entries.get(id);
  if (!e || e.deleted) return null;
  if (patch.title != null) e.title = String(patch.title).slice(0, 120);
  if (patch.content != null) e.content = String(patch.content).slice(0, 4000);
  e.updated_at = nowIso();
  await persistMemory();
  return e;
}

/** Delete = tombstone (deleted:true, kept for future merge). Never hard-deleted. */
export async function tombstone(id) {
  assertReady();
  const e = entries.get(id);
  if (!e) {
    const wi = working.findIndex((w) => w.id === id);
    if (wi >= 0) working.splice(wi, 1); // working is volatile — just drop it
    return wi >= 0;
  }
  e.deleted = true;
  e.updated_at = nowIso();
  await persistMemory();
  return true;
}

export async function addPerson(name, note) {
  assertReady();
  const n = String(name || "").trim();
  if (!n) return null;
  const e = newEntry("people", String(note || "").trim() || `(page for ${n})`, { title: n, tags: ["person"] });
  entries.set(e.id, e);
  await persistMemory();
  return e;
}

export async function addDailyNote(title, content, dateIso) {
  assertReady();
  const e = newEntry("daily", content, {
    title: title || dayOf(dateIso || nowIso()),
    tags: ["distilled"],
    created_at: dateIso || nowIso(),
  });
  entries.set(e.id, e);
  await persistMemory();
  return e;
}

export function peekWorking() {
  return working.slice();
}

export function consumeWorking() {
  const out = working.slice();
  working.length = 0;
  return out;
}

export function memoryCounts() {
  const c = { working: working.length, daily: 0, durable: 0, people: 0, suggested: getSuggestions().length };
  for (const e of entries.values()) {
    if (e.deleted || e.suggested) continue;
    if (c[e.tier] != null) c[e.tier] += 1;
  }
  return c;
}

// ------------------------------------------------------------------ recall ---

/**
 * Scored recall over durable + daily + people + working. Suggestions are
 * excluded until approved. Pass { vectors: { q, map } } to blend real
 * semantic similarity (see memory-embed.js) — without vectors this is the
 * honest hybrid: token overlap + recency + tier weighting.
 */
export function searchMem(query, { limit = 8, tiers = ["durable", "people", "daily", "working"], vectors = null } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const pool = [];
  for (const t of tiers) {
    if (t === "working") {
      for (const w of working) pool.push(w);
    } else {
      for (const e of entries.values()) {
        if (e.tier === t && !e.deleted && !e.suggested) pool.push(e);
      }
    }
  }
  return rankEntries(q, pool, vectors).slice(0, limit).map((r) => r.entry);
}

/**
 * THE single function that assembles memory for prompts. Every brain path
 * that wants memory calls this — scope hygiene lives here, not scattered
 * across call sites. Vault secrets can never appear: entries are user
 * content only, and this function never touches the secrets vault.
 */
export function assembleMemoryContext({ query = "", limit = 8, tiers } = {}) {
  if (!ready) return "";
  const hits = query ? searchMem(query, { limit, tiers }) : getTier("durable").slice(0, Math.min(limit, 5));
  if (!hits.length) return "";
  const lines = hits.map((e) => {
    const tag = e.tier === "durable" ? "memory" : e.tier === "people" ? `person: ${e.title || "?"}` : e.tier === "daily" ? dayOf(e.created_at) : "today";
    let s = String(e.content || "").replace(/\s+/g, " ").trim();
    if (s.length > 300) s = s.slice(0, 297) + "…";
    return `- [${tag}] ${s}`;
  });
  return "Pip's memory of the operator (on this device, encrypted):\n" + lines.join("\n");
}
