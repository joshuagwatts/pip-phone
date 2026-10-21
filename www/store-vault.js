/** Encrypted sidecar for chat / events / agent run log (M2).
 *
 * pip.phone.v1 stays plaintext for settings/kit/opps (settings are needed
 * pre-unlock and contain no conversation substance), but db.chat, db.events
 * (reminders), and the agent run log live here under the same DEK envelope
 * as the Memory Engine: AES-GCM, fresh 12-byte IV per save, DEK only in the
 * secrets vault (never localStorage).
 *
 * Boot order (boot.js): requireBootAuth -> initSecrets -> initMemoryEngine
 * -> app.js. app.js calls loadStoreVault(db) first thing in boot(), so the
 * DEK is ready. Decrypt failure throws LOUDLY — the app never runs with a
 * silently-plaintext (or silently-empty) chat.
 *
 * Migration: on first boot after unlock with no vault blob yet, whatever
 * plaintext chat/events/runlog exist are encrypted into the vault. The
 * plaintext originals disappear on the next store.save() (which strips
 * chat/events — see www/store.js) and the legacy runlog key is deleted here.
 */

const VAULT_KEY = "pip.phone.chat.v1";
const LEGACY_RUNLOG_KEY = "pip.agent.runs.v1";
const RUNLOG_CAP = 300;
const SAVE_DEBOUNCE_MS = 2000;

let vaultDb = null;
let runlogCache = [];
let vaultReadyFlag = false;
let saveTimer = null;

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function lsDel(k) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function vaultReady() {
  return vaultReadyFlag;
}

/**
 * Load the encrypted sidecar into db (decrypt), or migrate plaintext on
 * first boot after unlock. Returns counts. Throws on crypto failure.
 */
export async function loadStoreVault(db) {
  const { memoryReady, encryptStoreBlob, decryptStoreBlob } = await import("./memory-engine.js");
  const { setStripChatAtRest } = await import("./store.js");
  if (!memoryReady()) throw new Error("Memory engine not ready — cannot unlock the chat vault.");
  const raw = lsGet(VAULT_KEY);
  if (raw) {
    let bundle;
    try {
      bundle = JSON.parse(raw);
    } catch {
      throw new Error("Chat vault is corrupt (bad envelope) — refusing to start.");
    }
    let obj;
    try {
      obj = await decryptStoreBlob(bundle);
    } catch (e) {
      throw new Error(`Chat vault unreadable: ${String((e && e.message) || e)} — refusing to start without it.`);
    }
    db.chat = Array.isArray(obj.chat) ? obj.chat : [];
    db.events = Array.isArray(obj.events) ? obj.events : [];
    runlogCache = Array.isArray(obj.runlog) ? obj.runlog.slice(-RUNLOG_CAP) : [];
  } else {
    // First boot after unlock: encrypt whatever plaintext exists, then let
    // the next store.save() (which strips chat/events) wipe the plaintext.
    const chat = Array.isArray(db.chat) ? db.chat : [];
    const events = Array.isArray(db.events) ? db.events : [];
    let runlog = [];
    try {
      const r = JSON.parse(lsGet(LEGACY_RUNLOG_KEY) || "[]");
      if (Array.isArray(r)) runlog = r;
    } catch {
      runlog = [];
    }
    runlogCache = runlog.slice(-RUNLOG_CAP);
    let bundle;
    try {
      bundle = await encryptStoreBlob({ chat, events, runlog: runlogCache, saved_at: new Date().toISOString() });
    } catch (e) {
      throw new Error(`Chat vault encrypt failed: ${String((e && e.message) || e)} — refusing to start.`);
    }
    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(bundle));
    } catch (e) {
      throw new Error(`Chat vault write failed: ${String((e && e.message) || e)} — refusing to start.`);
    }
    lsDel(LEGACY_RUNLOG_KEY);
  }
  vaultDb = db || null;
  vaultReadyFlag = true;
  // From here on, store.save() strips chat/events from the plaintext blob —
  // the sidecar is the only at-rest copy. (Saves before this point kept the
  // plaintext so migration couldn't lose it.)
  setStripChatAtRest(true);
  return { chat: db.chat.length, events: db.events.length, runlog: runlogCache.length };
}

/** Encrypt + write chat/events/runlog immediately. */
export async function saveStoreVault(db) {
  if (!vaultReadyFlag) return;
  const { encryptStoreBlob } = await import("./memory-engine.js");
  const target = db || vaultDb;
  if (!target) return;
  const bundle = await encryptStoreBlob({
    chat: Array.isArray(target.chat) ? target.chat : [],
    events: Array.isArray(target.events) ? target.events : [],
    runlog: runlogCache.slice(-RUNLOG_CAP),
    saved_at: new Date().toISOString(),
  });
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(bundle));
  } catch {
    /* storage full — the in-memory state survives; next save retries */
  }
}

/** Debounced encrypted save — call from persist(). */
export function scheduleVaultSave(db) {
  if (db) vaultDb = db;
  if (!vaultReadyFlag) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStoreVault().catch(() => {});
  }, SAVE_DEBOUNCE_MS);
}

/** Flush any pending debounced save (pagehide). Best-effort. */
export function flushVaultSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return saveStoreVault().catch(() => {});
}

/* --------------------------------- run-log access (for www/tools.js) --- */

export function vaultRunLog(limit = 50) {
  return runlogCache.slice(-Math.max(1, limit));
}

export function vaultAppendRunLog(entry) {
  runlogCache.push(entry);
  while (runlogCache.length > RUNLOG_CAP) runlogCache.shift();
  scheduleVaultSave();
}
