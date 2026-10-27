/** PIP secrets vault — API keys + desktop token live here, never in plaintext localStorage.
 *
 * Two backends, both encrypted at rest — never a silent plaintext fallback:
 *  1. NATIVE (preferred): @aparajita/capacitor-secure-storage
 *     (Android Keystore / iOS Keychain — Capacitor 8 native).
 *     Requires `npx cap sync` after `npm install`.
 *  2. WEB / desktop-web / native-without-plugin: WebCrypto AES-GCM vault.
 *     Key derived via PBKDF2 (SHA-256, 310k iterations) from a user passphrase
 *     set at first run. Only salt + ciphertext touch localStorage.
 *
 * Usage:
 *   boot.js:  await requireBootAuth() (biometric.js) -> await initSecrets()
 *   runtime:  getSecret(name) — synchronous, from the in-memory Map.
 *             setSecret(name, value) — async write-through. Empty value removes.
 *
 * The in-memory Map is populated once at boot, AFTER the biometric/passphrase
 * gate. Nothing reads secrets before initSecrets() resolves.
 */

import { load as loadStore, save as saveStore } from "./store.js";

/** Every field that must never live in the persisted settings blob. */
export const SECRET_FIELDS = [
  "groq",
  "openrouter",
  "cerebras",
  "mistral",
  "gemini",
  "xai",
  "deepseek",
  "openai",
  "anthropic",
  "nvidia",
  "cloudflare",
  "cloudflare_account",
  "zai",
  "ollama",
  "github",
  "desktop_token",
];

const STORE_KEY = "pip.phone.v1";

/**
 * Vault keys outside SECRET_FIELDS that must still be readable via getSecret()
 * after initSecrets(). The memory DEK is the critical one: without it every
 * boot mints a fresh DEK and can never decrypt the previous boot's blobs.
 * (Kept as a literal here to avoid a secrets.js <-> memory-engine.js cycle.)
 */
const EXTRA_VAULT_KEYS = ["memory_dek"];
const VAULT_META_KEY = "pip.phone.vault.meta.v1";
const VAULT_DATA_KEY = "pip.phone.vault.secrets.v1";
const NATIVE_FLAG_KEY = "pip.phone.vault.native.v1";
const VERIFIER_TEXT = "pip-vault-verified-v1";
const PBKDF2_ITERS = 310000;

const memory = new Map(); // name -> secret value (in-memory only, never persisted)
let backendKind = null; // "native" | "webcrypto"
let webKey = null; // CryptoKey for the webcrypto backend (memory only)
let initialized = false;

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
    /* storage unavailable — caller decides */
  }
}

/** The one normalizer the vault needs (kept local: cloud.js imports this module). */
function cleanSecret(v) {
  return String(v || "").trim();
}

export function isNativePlatform() {
  try {
    const cap = window.Capacitor;
    if (!cap) return false;
    const plat = typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform;
    return plat === "android" || plat === "ios";
  } catch {
    return false;
  }
}

function nativePlugin() {
  try {
    const cap = window.Capacitor;
    if (!cap || !isNativePlatform()) return null;
    // @aparajita/capacitor-secure-storage registers as "SecureStorage".
    // Capability-check, not just presence: the app never imports the plugin
    // module, so on builds where it isn't registered cap.Plugins.SecureStorage
    // can be a dead object. Only use it when it really implements the API;
    // otherwise the passphrase vault below is the backend (works everywhere).
    const p = cap.Plugins && cap.Plugins.SecureStorage;
    if (
      !p ||
      typeof p.setItem !== "function" ||
      typeof p.getItem !== "function" ||
      typeof p.removeItem !== "function"
    ) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * True when the secrets backend can actually store a secret right now: native
 * secure storage with a working API, or a passphrase-derived web key already
 * in memory. The memory DEK needs a home even on fresh installs with no API
 * keys yet, so boot must ensure this before initMemoryEngine runs.
 */
export function vaultUsable() {
  if (nativePlugin()) return true;
  return Boolean(webKey);
}

export function secretsBackend() {
  return backendKind;
}

/** Synchronous: do we have anything worth protecting? Legacy keys OR an initialized vault. */
export function secretsNeedAuth() {
  try {
    const raw = JSON.parse(lsGet(STORE_KEY) || "null");
    const s = raw && raw.settings;
    if (s && SECRET_FIELDS.some((f) => cleanSecret(s[f]))) return true;
  } catch {
    /* ignore */
  }
  if (lsGet(VAULT_META_KEY)) return true; // webcrypto vault initialized
  if (lsGet(NATIVE_FLAG_KEY) === "1") return true; // native vault used before
  return false;
}

export function hasSecrets() {
  for (const v of memory.values()) if (cleanSecret(v)) return true;
  return false;
}

/** Synchronous read from the in-memory Map. Returns "" when unknown / not initialized. */
export function getSecret(name) {
  const v = memory.get(String(name));
  return v == null ? "" : String(v);
}

function readMeta() {
  try {
    return JSON.parse(lsGet(VAULT_META_KEY) || "null");
  } catch {
    return null;
  }
}

function readVaultData() {
  try {
    return JSON.parse(lsGet(VAULT_DATA_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

async function deriveWebKey(passphrase, saltB64) {
  const salt = b64d(saltB64);
  const base = await crypto.subtle.importKey("raw", te.encode(String(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function webEncrypt(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(String(plaintext)));
  return { iv: b64e(iv), data: b64e(ct) };
}

async function webDecrypt(key, bundle) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64d(bundle.iv)) },
    key,
    b64d(bundle.data),
  );
  return td.decode(pt);
}

export function isWebVaultSetup() {
  const m = readMeta();
  return Boolean(m && m.salt && m.verifier);
}

/** First run on web: create the vault. Throws on weak/short passphrase. */
export async function setupWebVault(passphrase) {
  const pw = String(passphrase || "");
  if (pw.length < 8) throw new Error("Passphrase needs at least 8 characters.");
  if (!crypto.subtle) throw new Error("WebCrypto unavailable — cannot create a secure vault on this device.");
  const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveWebKey(pw, salt);
  const verifier = await webEncrypt(key, VERIFIER_TEXT);
  lsSet(VAULT_META_KEY, JSON.stringify({ salt, verifier, createdAt: new Date().toISOString() }));
  lsSet(VAULT_DATA_KEY, JSON.stringify({}));
  webKey = key;
  backendKind = "webcrypto";
  return true;
}

/** Returning run on web: verify the passphrase and hold the derived key in memory. */
export async function unlockWebVault(passphrase) {
  const m = readMeta();
  if (!m || !m.salt || !m.verifier) throw new Error("Vault not set up on this device.");
  if (!crypto.subtle) throw new Error("WebCrypto unavailable — cannot unlock the vault on this device.");
  const key = await deriveWebKey(String(passphrase || ""), m.salt);
  let ok = false;
  try {
    ok = (await webDecrypt(key, m.verifier)) === VERIFIER_TEXT;
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("Wrong passphrase.");
  webKey = key;
  backendKind = "webcrypto";
  return true;
}

async function makeBackend() {
  const plugin = nativePlugin();
  if (plugin) {
    // @aparajita/capacitor-secure-storage string API:
    // getItem(key) -> string|null · setItem(key, value) · removeItem(key)
    return {
      kind: "native",
      async get(name) {
        try {
          const v = await plugin.getItem(`pip.${name}`);
          return v != null ? String(v) : "";
        } catch {
          return ""; // missing key
        }
      },
      async set(name, value) {
        await plugin.setItem(`pip.${name}`, String(value));
      },
      async remove(name) {
        try {
          await plugin.removeItem(`pip.${name}`);
        } catch {
          /* already gone */
        }
      },
    };
  }
  // WebCrypto fallback (web, desktop-web, or native before `npx cap sync`).
  if (!webKey) {
    throw new Error(
      "Secrets vault is locked — authenticate first. (Native secure storage not available and no vault passphrase in memory.)",
    );
  }
  const key = webKey;
  return {
    kind: "webcrypto",
    async get(name) {
      const data = readVaultData();
      const b = data[name];
      if (!b) return "";
      try {
        return await webDecrypt(key, b);
      } catch {
        return "";
      }
    },
    async set(name, value) {
      const data = readVaultData();
      data[name] = await webEncrypt(key, String(value));
      lsSet(VAULT_DATA_KEY, JSON.stringify(data));
    },
    async remove(name) {
      const data = readVaultData();
      if (data[name]) {
        delete data[name];
        lsSet(VAULT_DATA_KEY, JSON.stringify(data));
      }
    },
  };
}

/**
 * Boot-time: migrate any legacy plaintext keys out of localStorage into the
 * secure backend, wipe them from the persisted blob, then load everything
 * into the in-memory Map. Safe to run when there is nothing to migrate.
 *
 * NOTE: desktop_password is deliberately NOT migrated and NOT preserved.
 * Re-pairing the desktop requires re-entering the password — a stored
 * plaintext password that silently re-mints sessions was a credential risk.
 */
export async function initSecrets() {
  const db = loadStore();
  const s = (db.settings = db.settings || {});
  const backend = await makeBackend();
  backendKind = backend.kind;

  let migrated = 0;
  for (const f of SECRET_FIELDS) {
    const v = cleanSecret(s[f]);
    if (v) {
      await backend.set(f, v);
      migrated += 1;
    }
    if (f in s) delete s[f];
  }
  if ("desktop_password" in s) delete s["desktop_password"];

  memory.clear();
  for (const f of SECRET_FIELDS) {
    const v = await backend.get(f);
    if (cleanSecret(v)) memory.set(f, v);
  }
  // The DEK (and any future non-field vault keys) must be readable via
  // getSecret() or every boot mints a fresh key and loses the old blobs.
  for (const f of EXTRA_VAULT_KEYS) {
    try {
      const v = await backend.get(f);
      if (cleanSecret(v)) memory.set(f, v);
    } catch {
      /* a missing DEK just means "generate one" downstream */
    }
  }

  s.keysConfigured = hasSecrets();
  if (backend.kind === "native") lsSet(NATIVE_FLAG_KEY, "1");
  saveStore(db);
  initialized = true;
  return { migrated, backend: backend.kind, keysConfigured: hasSecrets() };
}

/** Async write-through: secure backend + in-memory Map. Empty value removes the secret. */
export async function setSecret(name, value) {
  const f = String(name);
  const v = cleanSecret(value);
  const backend = await makeBackend();
  if (!v) {
    await backend.remove(f);
    memory.delete(f);
    return false;
  }
  await backend.set(f, v);
  memory.set(f, v);
  return true;
}

/** Remove one secret from backend + memory. */
export async function clearSecret(name) {
  const backend = await makeBackend();
  await backend.remove(String(name));
  memory.delete(String(name));
}

export function secretsInitialized() {
  return initialized;
}
