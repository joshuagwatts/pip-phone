/** Pull desktop cloud API keys onto the phone — then call providers directly. */
import { desktopConfigured } from "./desktop.js";
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

/** Fetch keys from paired desktop. Throws on network/auth failure. */
export async function pullCloudKeys(settings) {
  if (!desktopConfigured(settings)) {
    throw new Error("pair desktop first");
  }
  const base = lan(settings);
  let pack;
  try {
    pack = await httpLanGet(`${base}/api/phone/cloud-keys`, 12000, headers(settings));
  } catch (e) {
    const msg = String(e.message || e);
    if (/401|login required/i.test(msg)) {
      throw new Error("session expired — RE-PAIR desktop");
    }
    throw new Error(`key sync failed — ${msg.slice(0, 80)}`);
  }
  const n = applyCloudKeys(settings, pack);
  if (!n && !(pack.keyed || []).length) {
    return { ...pack, applied: 0, keyed: [], empty: true };
  }
  return { ...pack, applied: n, keyed: keyedSummary(settings), empty: false };
}
