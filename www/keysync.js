/** Pull desktop cloud API keys onto the phone — then call providers directly. */
import { desktopConfigured, desktopLogin } from "./desktop.js";
import { httpLanGet } from "./net.js";

export const KEY_FIELDS = ["groq", "openrouter", "cerebras", "mistral", "gemini", "xai"];

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
export function applyCloudKeys(settings, pack) {
  if (!settings || !pack) return 0;
  const keys = pack.keys && typeof pack.keys === "object" ? pack.keys : pack;
  let n = 0;
  for (const field of KEY_FIELDS) {
    const val = String(keys[field] || "").trim();
    if (!val) continue;
    settings[field] = val;
    n += 1;
  }
  if (pack.brain_pin) settings.brain_pin = String(pack.brain_pin).trim() || settings.brain_pin;
  if (pack.operator) settings.operator = String(pack.operator).trim() || settings.operator;
  settings.keys_synced_at = new Date().toISOString();
  settings.keys_synced_count = n;
  return n;
}

export function keyedSummary(settings) {
  return KEY_FIELDS.filter((f) => String(settings[f] || "").trim()).map((f) =>
    f === "xai" ? "grok" : f,
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
export async function pullCloudKeys(settings) {
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
  const n = applyCloudKeys(settings, pack);
  if (!n && !(pack.keyed || []).length) {
    return { ...pack, applied: 0, keyed: [], empty: true };
  }
  return { ...pack, applied: n, keyed: keyedSummary(settings), empty: false };
}
