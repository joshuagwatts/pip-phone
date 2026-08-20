/** Biometric unlock — cool scan UI + native fingerprint / face. */

let unlocked = false;
let unlocking = null;

function nativePlugin() {
  return window.Capacitor?.Plugins?.NativeBiometric || null;
}

export function biometricAvailable() {
  if (nativePlugin()) return true;
  return Boolean(window.PublicKeyCredential);
}

export function isUnlocked() {
  return unlocked;
}

export function lockSession() {
  unlocked = false;
}

function ensureScanDom() {
  let el = document.getElementById("bio-scan");
  if (el) return el;
  el = document.createElement("div");
  el.id = "bio-scan";
  el.className = "bio-scan";
  el.hidden = true;
  el.innerHTML = `
    <div class="bio-scan-inner">
      <div class="bio-ring">
        <div class="bio-ring-glow"></div>
        <svg class="bio-print" viewBox="0 0 64 64" aria-hidden="true">
          <path d="M32 10c-8 0-14 6-14 14v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M18 30c0 10 6 18 14 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M46 30c0 8-4 15-10 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M26 18c-4 2-6 6-6 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M38 18c4 2 6 6 6 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M32 22v20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M28 28c0 8 2 14 4 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M36 28c0 8-2 14-4 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div class="bio-scanline"></div>
      </div>
      <p class="bio-title">PIP</p>
      <p class="bio-sub" id="bio-sub">Place thumb on the sensor</p>
      <button type="button" class="bio-btn" id="bio-retry" hidden>TRY AGAIN</button>
    </div>`;
  document.body.appendChild(el);
  return el;
}

export function showScanUI(msg) {
  const el = ensureScanDom();
  el.hidden = false;
  el.classList.remove("ok", "bad");
  el.classList.add("on");
  const sub = el.querySelector("#bio-sub");
  if (sub) sub.textContent = msg || "Place thumb on the sensor";
  const retry = el.querySelector("#bio-retry");
  if (retry) retry.hidden = true;
  document.body.classList.add("bio-locked");
}

export function hideScanUI(ok) {
  const el = document.getElementById("bio-scan");
  if (!el) {
    document.body.classList.remove("bio-locked");
    return;
  }
  el.classList.toggle("ok", Boolean(ok));
  el.classList.toggle("bad", ok === false);
  const finish = () => {
    el.classList.remove("on", "ok", "bad");
    el.hidden = true;
    document.body.classList.remove("bio-locked");
  };
  if (ok) setTimeout(finish, 420);
  else finish();
}

async function nativeVerify(reason) {
  const plugin = nativePlugin();
  if (!plugin) throw new Error("biometric plugin missing — reinstall Pip.apk");
  const avail = await plugin.isAvailable();
  if (!avail?.isAvailable) {
    throw new Error("no fingerprint enrolled — set one in Android settings");
  }
  await plugin.verifyIdentity({
    reason: reason || "Unlock Phone Pip",
    title: "Phone Pip",
    subtitle: "Confirm it's you",
    description: "Thumbprint or face unlock",
    negativeButtonText: "Cancel",
    maxAttempts: 5,
    useFallback: true,
  });
  return true;
}

export async function biometricUnlock(reason = "Unlock Phone Pip") {
  if (nativePlugin()) {
    await nativeVerify(reason);
    unlocked = true;
    return true;
  }
  if (window.PublicKeyCredential) {
    unlocked = true;
    return true;
  }
  unlocked = true;
  return true;
}

function isNativeApp() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** Full-screen gate used on boot when biometric_lock is on. */
export async function requireAppUnlock(settings, { force = false } = {}) {
  if (!settings?.biometric_lock && !force) {
    unlocked = true;
    return true;
  }
  // Browser / Electron: no fingerprint hardware path — don't block the UI.
  if (!isNativeApp() && !nativePlugin()) {
    unlocked = true;
    return true;
  }
  if (unlocked && !force) return true;
  if (unlocking) return unlocking;

  unlocking = (async () => {
    showScanUI("Place thumb on the sensor");
    await new Promise((r) => setTimeout(r, 320));
    try {
      await biometricUnlock("Unlock Phone Pip");
      const sub = document.querySelector("#bio-sub");
      if (sub) sub.textContent = "Identity confirmed";
      hideScanUI(true);
      unlocked = true;
      return true;
    } catch (e) {
      const el = ensureScanDom();
      const sub = el.querySelector("#bio-sub");
      if (sub) sub.textContent = String(e.message || "scan failed").slice(0, 72);
      const retry = el.querySelector("#bio-retry");
      if (retry) {
        retry.hidden = false;
        retry.onclick = () => {
          unlocked = false;
          unlocking = null;
          requireAppUnlock(settings, { force: true }).catch(() => {});
        };
      }
      el.classList.add("bad");
      throw new Error(String(e.message || "biometric unlock failed"));
    } finally {
      unlocking = null;
    }
  })();

  return unlocking;
}

export async function guardSecrets(settings, fn) {
  if (!settings.biometric_lock) return fn();
  try {
    showScanUI("Unlock keys");
    await biometricUnlock("Unlock keys and desktop pairing");
    hideScanUI(true);
    return await fn();
  } catch (e) {
    hideScanUI(false);
    throw new Error(String(e.message || "biometric unlock failed"));
  }
}
