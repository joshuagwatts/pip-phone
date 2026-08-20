/** Biometric unlock — Pip green scan + real Android fingerprint sheet. */

let unlocked = false;
let unlocking = null;

function nativePlugin() {
  return window.Capacitor?.Plugins?.NativeBiometric || null;
}

function isNativeApp() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
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
      <div class="bio-ring" role="button" tabindex="0" aria-label="Unlock Pip">
        <div class="bio-ring-glow"></div>
        <div class="bio-ring-haze"></div>
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
      <div class="bio-actions">
        <button type="button" class="bio-btn" id="bio-retry" hidden>TRY AGAIN</button>
        <button type="button" class="bio-btn ghost" id="bio-skip" hidden>OPEN ANYWAY</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

export function showScanUI(msg) {
  const el = ensureScanDom();
  el.hidden = false;
  el.classList.remove("ok", "bad", "listening");
  el.classList.add("on");
  const sub = el.querySelector("#bio-sub");
  if (sub) sub.textContent = msg || "Place thumb on the sensor";
  const retry = el.querySelector("#bio-retry");
  const skip = el.querySelector("#bio-skip");
  if (retry) retry.hidden = true;
  if (skip) skip.hidden = true;
  document.body.classList.add("bio-locked");
}

export function hideScanUI(ok) {
  const el = document.getElementById("bio-scan");
  if (!el) {
    document.body.classList.remove("bio-locked");
    return;
  }
  el.classList.remove("listening");
  el.classList.toggle("ok", Boolean(ok));
  el.classList.toggle("bad", ok === false);
  const finish = () => {
    el.classList.remove("on", "ok", "bad", "listening");
    el.hidden = true;
    document.body.classList.remove("bio-locked");
  };
  if (ok) setTimeout(finish, 480);
  else finish();
}

async function nativeVerify(reason) {
  const plugin = nativePlugin();
  if (!plugin) throw new Error("biometric plugin missing — reinstall Pip.apk");
  const avail = await plugin.isAvailable();
  if (!avail?.isAvailable) {
    throw new Error("no fingerprint enrolled — set one in Android settings");
  }
  // Transparent AuthActivity lets Pip’s green UI show through behind the sheet.
  await plugin.verifyIdentity({
    reason: reason || "Unlock Phone Pip",
    title: "PIP",
    subtitle: "Phosphor lock",
    description: "Place your thumb on the sensor",
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
  unlocked = true;
  return true;
}

function setSub(text) {
  const sub = document.querySelector("#bio-sub");
  if (sub) sub.textContent = text;
}

function showRecovery(message, settings) {
  const el = ensureScanDom();
  el.classList.remove("listening");
  el.classList.add("bad");
  setSub(String(message || "scan failed").slice(0, 80));
  const retry = el.querySelector("#bio-retry");
  const skip = el.querySelector("#bio-skip");
  if (retry) {
    retry.hidden = false;
    retry.onclick = () => {
      unlocked = false;
      unlocking = null;
      requireAppUnlock(settings, { force: true }).catch(() => {});
    };
  }
  if (skip) {
    skip.hidden = false;
    skip.onclick = () => {
      unlocked = true;
      hideScanUI(true);
      unlocking = null;
    };
  }
}

/**
 * Real fingerprint when native plugin exists.
 * Pip scan UI stays under Android’s BiometricPrompt (transparent activity).
 */
async function runUnlockFlow(settings) {
  const el = ensureScanDom();
  const hasNative = Boolean(nativePlugin());

  showScanUI(hasNative ? "Warming the phosphor lock…" : "Tap the print to unlock");
  await new Promise((r) => setTimeout(r, 360));

  if (!hasNative) {
    // Browser / no plugin — tap to enter.
    return new Promise((resolve, reject) => {
      setSub("Tap the print to unlock");
      const ring = el.querySelector(".bio-ring");
      const go = () => {
        unlocked = true;
        hideScanUI(true);
        resolve(true);
      };
      if (ring) ring.onclick = go;
      const retry = el.querySelector("#bio-retry");
      if (retry) {
        retry.hidden = false;
        retry.onclick = go;
      }
      // Don't hang forever without a path out
      const skip = el.querySelector("#bio-skip");
      if (skip) {
        skip.hidden = false;
        skip.onclick = () => {
          unlocked = true;
          hideScanUI(true);
          resolve(true);
        };
      }
      if (!ring) reject(new Error("unlock UI missing"));
    });
  }

  el.classList.add("listening");
  setSub("Fingerprint sheet… place your thumb");
  try {
    await nativeVerify("Unlock Phone Pip");
    setSub("Identity confirmed");
    hideScanUI(true);
    unlocked = true;
    return true;
  } catch (e) {
    showRecovery(e.message || "fingerprint canceled", settings);
    throw new Error(String(e.message || "biometric unlock failed"));
  }
}

/** Full-screen gate used on boot when biometric_lock is on. */
export async function requireAppUnlock(settings, { force = false } = {}) {
  if (!settings?.biometric_lock && !force) {
    unlocked = true;
    return true;
  }
  if (!isNativeApp() && !nativePlugin()) {
    unlocked = true;
    return true;
  }
  if (unlocked && !force) return true;
  if (unlocking) return unlocking;

  unlocking = (async () => {
    try {
      return await runUnlockFlow(settings || {});
    } finally {
      unlocking = null;
    }
  })();

  return unlocking;
}

export async function guardSecrets(settings, fn) {
  if (!settings.biometric_lock) return fn();
  try {
    await runUnlockFlow(settings || {});
    return await fn();
  } catch (e) {
    if (!unlocked) {
      hideScanUI(false);
      throw new Error(String(e.message || "biometric unlock failed"));
    }
    return await fn();
  }
}
