/** Pull desktop cloud API keys onto the phone — then call providers directly.
 *
 * Keys are written into the secrets vault (www/secrets.js), never into the
 * persisted settings blob. desktop_password is NEVER persisted: if the
 * desktop session expires, the user re-pairs and re-enters the password.
 */
import { desktopConfigured, desktopLogin } from "./desktop.js";
import { httpLanGet } from "./net.js";
import { normalizeApiKey } from "./cloud.js";
import { setSecret, getSecret, hasSecrets } from "./secrets.js";

export const KEY_FIELDS = ["groq", "openrouter", "cerebras", "mistral", "gemini", "xai", "deepseek", "openai", "anthropic", "nvidia", "cloudflare", "cloudflare_account", "zai", "ollama", "github"];

function lan(settings) {
  return String(settings.desktop_url || "").replace(/\/+$/, "");
}

function headers(settings) {
  const tok = getSecret("desktop_token").trim();
  if (!tok || tok === "loopback") return {};
  return {
    Cookie: `pip_gate=${tok}`,
    "X-Pip-Token": tok,
    Authorization: `Bearer ${tok}`,
  };
}

/**
 * Apply a /api/phone/cloud-keys payload into the secrets vault.
 * Returns count of keys set. Phone keys win unless replace=true (explicit
 * SYNC FROM DESKTOP). Async — writes through to secure storage.
 */
export async function applyCloudKeys(settings, pack, { replace = false } = {}) {
  if (!settings || !pack) return 0;
  const keys = pack.keys && typeof pack.keys === "object" ? pack.keys : pack;
  let n = 0;
  for (const field of KEY_FIELDS) {
    const val = normalizeApiKey(keys[field]);
    if (!val) continue;
    if (!replace && settings[`${field}_cleared`]) continue;
    const existing = getSecret(field);
    // Phone keys win unless user explicitly SYNC FROM DESKTOP (replace).
    if (existing && !replace) continue;
    delete settings[`${field}_cleared`];
    await setSecret(field, val);
    n += 1;
  }
  if (pack.brain_pin) {
    const phonePin = String(settings.brain_pin || "auto").toLowerCase();
    const deskPin = String(pack.brain_pin).trim().toLowerCase();
    if (phonePin === "auto" && deskPin && deskPin !== "desktop") {
      settings.brain_pin = deskPin;
    }
  }
  if (pack.operator) settings.operator = String(pack.operator).trim() || settings.operator;
  settings.keys_synced_at = new Date().toISOString();
  settings.keys_synced_count = n;
  settings.keysConfigured = hasSecrets();
  return n;
}

export function keyedSummary(settings) {
  return KEY_FIELDS.filter((f) => getSecret(f).trim()).map((f) =>
    f === "xai" ? "grok" : f === "anthropic" ? "claude" : f,
  );
}

/**
 * The old refreshToken() silently re-minted desktop sessions from a stored
 * plaintext desktop_password. That password is no longer persisted (see
 * www/secrets.js), so there is nothing to re-mint from: on 401 the user
 * re-pairs and re-enters the password. This function is intentionally gone.
 */

async function fetchKeysOnce(settings) {
  const base = lan(settings);
  return httpLanGet(`${base}/api/phone/cloud-keys`, 12000, headers(settings));
}

/** Fetch keys from paired desktop. On 401, re-pair is required (no silent re-auth). */
export async function pullCloudKeys(settings, { replace = false } = {}) {
  if (!desktopConfigured(settings)) {
    throw new Error("pair desktop first");
  }
  let pack;
  try {
    pack = await fetchKeysOnce(settings);
  } catch (e) {
    const msg = String(e.message || e);
    const status = e.status || 0;
    if (status === 401 || /401|login required/i.test(msg)) {
      throw new Error("desktop session expired — RE-PAIR and re-enter the desktop password");
    }
    throw new Error(`key sync failed — ${msg.slice(0, 80)}`);
  }
  const n = await applyCloudKeys(settings, pack, { replace });
  if (!n && !(pack.keyed || []).length) {
    return { ...pack, applied: 0, keyed: [], empty: true };
  }
  return { ...pack, applied: n, keyed: keyedSummary(settings), empty: false };
}

/** Pull desktop keys when phone has none — used on connect / before chat. */
export async function ensureCloudKeys(settings, { force = false, replace = false } = {}) {
  const local = KEY_FIELDS.filter((f) => getSecret(f).trim()).length;
  if (local >= 1 && !force) return { applied: local, source: "local", keyed: keyedSummary(settings) };
  if (!desktopConfigured(settings)) {
    return { applied: local, source: local ? "local" : "none", keyed: keyedSummary(settings) };
  }
  try {
    const out = await pullCloudKeys(settings, { replace });
    return { ...out, source: "desktop" };
  } catch (e) {
    return {
      applied: local,
      source: local ? "local" : "error",
      keyed: keyedSummary(settings),
      error: String(e.message || e).slice(0, 120),
    };
  }
}
