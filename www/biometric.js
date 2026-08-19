/** Biometric + PIN gate for keys and desktop pairing. */

import { checkPin, pinRequired, setPin } from "./pin.js";

export function biometricAvailable() {
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.BiometricAuth) return true;
  return Boolean(window.PublicKeyCredential);
}

export async function biometricUnlock(reason = "Unlock Phone Pip") {
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.BiometricAuth) {
    await cap.Plugins.BiometricAuth.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
    });
    return true;
  }
  return false;
}

export async function guardSecrets(settings, fn) {
  if (!settings.biometric_lock) return fn();
  if (biometricAvailable()) {
    try {
      await biometricUnlock("Unlock keys and desktop pairing");
      return await fn();
    } catch {
      /* fall through to PIN */
    }
  }
  if (pinRequired(settings)) {
    const pin = window.prompt("Enter Phone Pip PIN");
    if (!(await checkPin(settings, pin || ""))) throw new Error("wrong PIN");
    return fn();
  }
  return fn();
}

export { setPin, checkPin, pinRequired };
