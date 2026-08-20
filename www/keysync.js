/** Pull desktop cloud API keys onto the phone — then call providers directly. */
import { desktopConfigured } from "./desktop.js";
import { httpLanGet } from "./net.js";

export const KEY_FIELDS = ["groq", "openrouter", "cerebras", "mistral", "gemini", "xai"];

function lan(settings) {
  return String(settings.desktop_url || "").replace(/\/+$/, "");
}

function headers(settings) {
  const tok = String(settings.desktop_token || "").trim();
  return tok ? { Cookie: `pip_gate=${tok}` } : {};
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
  const pack = await httpLanGet(`${base}/api/phone/cloud-keys`, 15000, headers(settings));
  const n = applyCloudKeys(settings, pack);
  return { ...pack, applied: n, keyed: keyedSummary(settings) };
}
