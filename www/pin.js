/** Local PIN fallback when biometric sensor is unavailable. */

async function digest(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function setPin(settings, pin) {
  const clean = String(pin || "").trim();
  if (clean.length < 4) throw new Error("PIN needs at least 4 digits");
  settings.pin_hash = await digest(clean);
}

export async function checkPin(settings, pin) {
  if (!settings.pin_hash) return true;
  const got = await digest(pin);
  return got === settings.pin_hash;
}

export function pinRequired(settings) {
  return Boolean(settings.biometric_lock && settings.pin_hash);
}
