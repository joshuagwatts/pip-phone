/** PIP lock — real authentication, Pip-themed.
 *
 * Uses @capgo/capacitor-native-biometric on native (system biometric sheet,
 * with device PIN/pattern fallback via useFallback). On web / devices with no
 * biometric hardware, falls back to the secrets-vault passphrase (setup or
 * verify). The old 1400ms press-and-hold timer is gone — it never
 * authenticated anything.
 */

import { load as loadStore } from "./store.js";
import {
  secretsNeedAuth,
  isNativePlatform,
  isWebVaultSetup,
  setupWebVault,
  unlockWebVault,
  vaultUsable,
} from "./secrets.js";

let unlocked = false;
let unlocking = null;

function nativeBio() {
  try {
    const cap = window.Capacitor;
    if (!cap || !isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.NativeBiometric) || null;
  } catch {
    return null;
  }
}

/** Real capability check — was `return true` unconditionally (theater). */
export async function biometricAvailable() {
  const bio = nativeBio();
  if (!bio) return false;
  try {
    const out = await bio.isAvailable();
    return Boolean(out && out.isAvailable);
  } catch {
    return false;
  }
}

export function isUnlocked() {
  return unlocked;
}

export function lockSession() {
  unlocked = false;
}

async function haptic(kind = "tick") {
  try {
    const H = window.Capacitor?.Plugins?.Haptics;
    if (H) {
      if (kind === "start" && H.impact) {
        await H.impact({ style: "MEDIUM" });
        return;
      }
      if (kind === "ok" && H.notification) {
        await H.notification({ type: "SUCCESS" });
        return;
      }
      if (kind === "bad" && H.notification) {
        await H.notification({ type: "ERROR" });
        return;
      }
      if (H.impact) {
        await H.impact({ style: "LIGHT" });
        return;
      }
      if (H.vibrate) {
        await H.vibrate({ duration: kind === "ok" ? 60 : 28 });
        return;
      }
    }
  } catch {
    /* fall through */
  }
  if (navigator.vibrate) {
    if (kind === "ok") navigator.vibrate([20, 40, 50]);
    else if (kind === "bad") navigator.vibrate([40, 30, 40]);
    else if (kind === "start") navigator.vibrate(35);
    else navigator.vibrate(18);
  }
}

function ensureScanDom() {
  let el = document.getElementById("bio-scan");
  if (el) {
    const print = el.querySelector(".bio-print");
    if (print && print.dataset.v !== "4") {
      el.remove();
      el = null;
    }
  }
  if (el) return el;
  el = document.createElement("div");
  el.id = "bio-scan";
  el.className = "bio-scan";
  el.hidden = true;
  el.innerHTML = `
    <div class="bio-scan-inner">
      <div class="bio-ring" id="bio-ring" role="button" tabindex="0" aria-label="Authenticate to unlock Pip">
        <svg class="bio-progress" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="bio-progress-track" cx="50" cy="50" r="46" />
          <circle class="bio-progress-fill" id="bio-progress" cx="50" cy="50" r="46" />
        </svg>
        <div class="bio-ring-glow"></div>
        <svg class="bio-print" data-v="4" viewBox="0 0 24 24" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
            <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
            <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
            <path d="M2 12a10 10 0 0 1 18-6"/>
            <path d="M2 16h.01"/>
            <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
            <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
            <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
            <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
          </g>
        </svg>
        <div class="bio-scanline"></div>
      </div>
      <p class="bio-title">PIP</p>
      <p class="bio-sub" id="bio-sub">Tap the print to authenticate</p>
      <button type="button" class="bio-btn" id="bio-retry" hidden>TRY AGAIN</button>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function setProgress(p) {
  const circ = 2 * Math.PI * 46;
  const fill = document.getElementById("bio-progress");
  if (!fill) return;
  const t = Math.max(0, Math.min(1, p));
  fill.style.strokeDasharray = `${circ}`;
  fill.style.strokeDashoffset = `${circ * (1 - t)}`;
}

function setSub(text) {
  const sub = document.querySelector("#bio-sub");
  if (sub) sub.textContent = text;
}

export function showScanUI(msg) {
  const el = ensureScanDom();
  el.hidden = false;
  el.classList.remove("ok", "bad", "holding");
  el.classList.add("on");
  setSub(msg || "Tap the print to authenticate");
  setProgress(0);
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
  el.classList.remove("holding");
  el.classList.toggle("ok", Boolean(ok));
  el.classList.toggle("bad", ok === false);
  const finish = () => {
    el.classList.remove("on", "ok", "bad", "holding");
    el.hidden = true;
    document.body.classList.remove("bio-locked");
    setProgress(0);
  };
  if (ok) setTimeout(finish, 420);
  else finish();
}

/** Real auth: system biometric sheet. useFallback lets the OS offer PIN/pattern. */
async function verifyNative() {
  const bio = nativeBio();
  if (!bio) throw new Error("Biometric plugin unavailable.");
  const avail = await bio.isAvailable().catch(() => null);
  if (!avail || !avail.isAvailable) {
    throw new Error("No biometric hardware on this device.");
  }
  await bio.verifyIdentity({
    reason: "Unlock PIP and its secrets vault",
    title: "PIP",
    subtitle: "Authenticate",
    description: "Confirm it's you to unlock PIP.",
    useFallback: true,
    maxAttempts: 5,
  });
  return true;
}

function waitForTapScan() {
  const el = ensureScanDom();
  const ring = el.querySelector("#bio-ring");
  const retry = el.querySelector("#bio-retry");
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = async (msg) => {
      if (done) return;
      setProgress(0);
      el.classList.add("bad");
      setSub(msg || "Authentication failed");
      await haptic("bad");
      if (retry) {
        retry.hidden = false;
        retry.onclick = () => {
          el.classList.remove("bad");
          retry.hidden = true;
          setProgress(0);
          setSub("Tap the print to authenticate");
          attempt();
        };
      }
    };
    const attempt = async () => {
      if (done) return;
      try {
        setSub("Waiting for system prompt…");
        await haptic("start");
        await verifyNative();
        done = true;
        setProgress(1);
        setSub("Welcome back");
        await haptic("ok");
        unlocked = true;
        hideScanUI(true);
        resolve(true);
      } catch (e) {
        const msg = String(e?.message || e || "");
        if (/cancel|dismiss|user/i.test(msg) && !/fail/i.test(msg)) {
          // User backed out of the system sheet — stay locked, no error noise.
          done = true;
          hideScanUI(false);
          reject(new Error("Unlock cancelled."));
          return;
        }
        fail(msg.slice(0, 90) || "Authentication failed");
      }
    };
    ring.style.touchAction = "manipulation";
    ring.onpointerdown = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      if (!done) attempt();
    };
    ring.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!done) attempt();
      }
    };
    ring.oncontextmenu = (e) => e.preventDefault();
  });
}

/* ---------- vault-passphrase fallback (web / no biometric hardware) ---------- */

function ensurePassDom(setup) {
  let el = document.getElementById("bio-pass");
  if (el) el.remove();
  el = document.createElement("div");
  el.id = "bio-pass";
  el.className = "bio-scan";
  el.innerHTML = `
    <div class="bio-scan-inner">
      <p class="bio-title">PIP</p>
      <p class="bio-sub" id="bio-pass-sub">${
        setup
          ? "Set a vault passphrase — it encrypts your API keys on this device. Minimum 8 characters. Don't lose it: PIP can't recover it."
          : "Enter your vault passphrase"
      }</p>
      <input id="bio-pass-in" type="password" autocomplete="new-password" placeholder="passphrase"
        style="font-size:16px;padding:10px 12px;margin:8px 0;width:min(78vw,320px);text-align:center;" />
      ${
        setup
          ? `<input id="bio-pass-in2" type="password" autocomplete="new-password" placeholder="repeat passphrase"
        style="font-size:16px;padding:10px 12px;margin:0 0 8px;width:min(78vw,320px);text-align:center;" />`
          : ""
      }
      <p class="bio-sub" id="bio-pass-err" style="color:#ff7a7a;min-height:1.2em;"></p>
      <button type="button" class="bio-btn" id="bio-pass-go">${setup ? "CREATE VAULT" : "UNLOCK"}</button>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add("bio-locked");
  return el;
}

export function vaultPassphraseFlow() {  const setup = !isWebVaultSetup();
  const el = ensurePassDom(setup);
  const err = el.querySelector("#bio-pass-err");
  const go = el.querySelector("#bio-pass-go");
  const input = el.querySelector("#bio-pass-in");
  return new Promise((resolve, reject) => {
    const done = (ok) => {
      el.remove();
      document.body.classList.remove("bio-locked");
      if (ok) {
        unlocked = true;
        resolve(true);
      } else {
        reject(new Error("Unlock cancelled."));
      }
    };
    const submit = async () => {
      err.textContent = "";
      try {
        if (setup) {
          const p1 = input.value;
          const p2 = el.querySelector("#bio-pass-in2").value;
          if (p1 !== p2) throw new Error("Passphrases don't match.");
          await setupWebVault(p1);
        } else {
          await unlockWebVault(input.value);
        }
        await haptic("ok");
        done(true);
      } catch (e) {
        await haptic("bad");
        err.textContent = String(e?.message || e || "Failed").slice(0, 120);
      }
    };
    go.onclick = submit;
    input.onkeydown = (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") done(false);
    };
    setTimeout(() => input.focus(), 60);
  });
}

/* ---------- public API ---------- */

/** Real unlock: system biometric sheet on native, vault passphrase otherwise. */
export async function biometricUnlock() {
  const bio = nativeBio();
  let canNative = false;
  if (bio) {
    try {
      const out = await bio.isAvailable();
      canNative = Boolean(out && out.isAvailable);
    } catch {
      canNative = false;
    }
  }
  if (canNative) {
    showScanUI("Tap the print to authenticate");
    try {
      await waitForTapScan();
    } catch (e) {
      hideScanUI(false);
      throw e;
    }
    unlocked = true;
    return true;
  }
  // No biometric hardware (or web): vault passphrase. Never the press-and-hold timer.
  await vaultPassphraseFlow();
  unlocked = true;
  return true;
}

export async function requireAppUnlock(settings, { force = false } = {}) {
  if (!settings?.biometric_lock && !force) {
    unlocked = true;
    return true;
  }
  if (unlocked && !force) return true;
  if (unlocking) return unlocking;
  unlocking = (async () => {
    try {
      await biometricUnlock();
      unlocked = true;
      return true;
    } finally {
      unlocking = null;
    }
  })();
  return unlocking;
}

/**
 * Boot gate — called from boot.js BEFORE initSecrets() loads keys into memory.
 *
 * Two jobs: (1) the vault backend must be usable — the memory DEK lives there
 * even on fresh installs with no API keys yet, so if neither native secure
 * storage nor a passphrase-derived key is available, the passphrase vault is
 * set up/unlocked here (it works on every platform, no native plugins needed);
 * (2) when there are secrets worth protecting and the user hasn't disabled the
 * lock, require authentication (system biometric sheet on native, vault
 * passphrase otherwise). Respects the biometric_lock toggle (default on).
 */
export async function requireBootAuth() {
  if (unlocked) return true;
  let settings = {};
  try {
    settings = loadStore().settings || {};
  } catch {
    settings = {};
  }
  const lockDisabled = settings.biometric_lock === false;
  if (!vaultUsable()) {
    // No usable vault backend — establish the passphrase vault now, or the
    // memory engine cannot store its key and boot fails downstream.
    await vaultPassphraseFlow();
  } else if (secretsNeedAuth() && !lockDisabled) {
    await biometricUnlock();
  }
  unlocked = true;
  return true;
}

export async function guardSecrets(settings, fn) {
  if (!settings?.biometric_lock) return fn();
  if (unlocked) return fn();
  await requireAppUnlock(settings, { force: true });
  return fn();
}
