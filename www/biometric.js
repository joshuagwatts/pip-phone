/** Biometric unlock — Pip scan UI first. Android system sheet is optional. */

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
      <p class="bio-sub" id="bio-sub">Tap the print to unlock</p>
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
  if (sub) sub.textContent = msg || "Tap the print to unlock";
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
    title: "Pip",
    subtitle: " ",
    description: " ",
    negativeButtonText: "Cancel",
    maxAttempts: 5,
    useFallback: false,
  });
  return true;
}

/**
 * Unlock using Pip's scan UI.
 * By default we do NOT open Android's BiometricPrompt (it covers the dope UI).
 * Enable settings.biometric_native for a real system fingerprint after tapping the print.
 */
export async function biometricUnlock(reason = "Unlock Phone Pip", settings = null) {
  if (settings?.biometric_native && nativePlugin()) {
    await nativeVerify(reason);
  }
  unlocked = true;
  return true;
}

function waitForScanTap(settings) {
  const el = ensureScanDom();
  const ring = el.querySelector(".bio-ring");
  const retry = el.querySelector("#bio-retry");
  const sub = el.querySelector("#bio-sub");

  return new Promise((resolve, reject) => {
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      if (sub) {
        sub.textContent = settings?.biometric_native
          ? "Confirm on the sensor…"
          : "Reading…";
      }
      try {
        await biometricUnlock("Unlock Phone Pip", settings);
        if (sub) sub.textContent = "Identity confirmed";
        hideScanUI(true);
        unlocked = true;
        resolve(true);
      } catch (e) {
        busy = false;
        if (sub) sub.textContent = String(e.message || "scan failed").slice(0, 72);
        el.classList.add("bad");
        if (retry) {
          retry.hidden = false;
          retry.onclick = () => {
            el.classList.remove("bad");
            if (sub) sub.textContent = "Tap the print to unlock";
            retry.hidden = true;
            busy = false;
          };
        }
        reject(new Error(String(e.message || "biometric unlock failed")));
      }
    };
    if (ring) {
      ring.onclick = () => {
        run().catch(() => {});
      };
      ring.onkeydown = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          run().catch(() => {});
        }
      };
    }
    if (retry) {
      retry.onclick = () => {
        el.classList.remove("bad");
        if (sub) sub.textContent = "Tap the print to unlock";
        retry.hidden = true;
        run().catch(() => {});
      };
    }
  });
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
    showScanUI(
      settings?.biometric_native
        ? "Tap the print — then confirm fingerprint"
        : "Tap the print to unlock",
    );
    try {
      return await waitForScanTap(settings || {});
    } finally {
      unlocking = null;
    }
  })();

  return unlocking;
}

export async function guardSecrets(settings, fn) {
  if (!settings.biometric_lock) return fn();
  try {
    showScanUI(
      settings?.biometric_native
        ? "Tap the print — then confirm"
        : "Tap the print to unlock keys",
    );
    await waitForScanTap(settings || {});
    return await fn();
  } catch (e) {
    hideScanUI(false);
    throw new Error(String(e.message || "biometric unlock failed"));
  }
}
