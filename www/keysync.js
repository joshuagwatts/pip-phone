/** Pull desktop cloud API keys onto the phone — then call providers directly. */
import { desktopConfigured, desktopLogin } from "./desktop.js";
import { httpLanGet } from "./net.js";
import { normalizeApiKey } from "./cloud.js";

export const KEY_FIELDS = ["groq", "openrouter", "cerebras", "mistral", "gemini", "xai", "deepseek", "openai", "anthropic"];

function lan(settings) {
  return String(settings.desktop_url || "").replace(/\/+$/, "");
}

function headers(settings) {
  const tok = String(settings.desktop_token || "").trim();
  if (!tok || tok === "loopback") return {};
  return {
    Cookie: `pip_gate=${tok}`,
    "X-Pip-Token": tok,
    Authorization: `Bearer ${tok}`,
  };
}

/** Apply a /api/phone/cloud-keys payload onto phone settings. Returns count of keys set. */
export function applyCloudKeys(settings, pack, { replace = false } = {}) {
  if (!settings || !pack) return 0;
  const keys = pack.keys && typeof pack.keys === "object" ? pack.keys : pack;
  let n = 0;
  for (const field of KEY_FIELDS) {
    const val = normalizeApiKey(keys[field]);
    if (!val) continue;
    if (!replace && settings[`${field}_cleared`]) continue;
    const existing = normalizeApiKey(settings[field]);
    // Phone keys win unless user explicitly SYNC FROM DESKTOP (replace).
    if (existing && !replace) continue;
    delete settings[`${field}_cleared`];
    settings[field] = val;
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
  if (n > 0) {
    /* Keys synced — user toggles SECURE/LEAKY in header when they want cloud. */
  }
  settings.keys_synced_at = new Date().toISOString();
  settings.keys_synced_count = n;
  return n;
}

export function keyedSummary(settings) {
  return KEY_FIELDS.filter((f) => String(settings[f] || "").trim()).map((f) =>
    f === "xai" ? "grok" : f === "anthropic" ? "claude" : f,
  );
}

async function refreshToken(settings) {
  const pass = String(settings.desktop_password || "").trim();
  if (!pass) throw new Error("session expired — RE-PAIR (save desktop password on pair)");
  const out = await desktopLogin(settings, pass);
  const tok = String(out.token || "").trim();
  if (!tok || tok === "loopback") {
    throw new Error("re-login failed — check Phone LAN + password on desktop");
  }
  settings.desktop_token = tok;
  settings.desktop_paired = true;
  return tok;
}

async function fetchKeysOnce(settings) {
  const base = lan(settings);
  return httpLanGet(`${base}/api/phone/cloud-keys`, 12000, headers(settings));
}

/** Fetch keys from paired desktop. Re-auths once on 401 when password is saved. */
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
      try {
        await refreshToken(settings);
        pack = await fetchKeysOnce(settings);
      } catch (e2) {
        throw new Error(`key sync failed — ${String(e2.message || e2).slice(0, 80)}`);
      }
    } else {
      throw new Error(`key sync failed — ${msg.slice(0, 80)}`);
    }
  }
  const n = applyCloudKeys(settings, pack, { replace });
  if (!n && !(pack.keyed || []).length) {
    return { ...pack, applied: 0, keyed: [], empty: true };
  }
  return { ...pack, applied: n, keyed: keyedSummary(settings), empty: false };
}

/** Pull desktop keys when phone has none — used on connect / before chat. */
export async function ensureCloudKeys(settings, { force = false, replace = false } = {}) {
  const local = KEY_FIELDS.filter((f) => normalizeApiKey(settings[f])).length;
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
