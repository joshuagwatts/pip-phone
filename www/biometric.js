/** Biometric gate for desktop pairing secrets. Gracefully no-ops when unavailable. */

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
  if (window.PublicKeyCredential) {
    // Web fallback — presence check only; pairing still works without this.
    return true;
  }
  return false;
}

export async function guardSecrets(settings, fn) {
  if (!settings.biometric_lock) return fn();
  try {
    await biometricUnlock("Unlock keys and desktop pairing");
    return await fn();
  } catch (e) {
    throw new Error(String(e.message || "biometric unlock failed"));
  }
}
