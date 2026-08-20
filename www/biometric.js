/** Pip lock — real device fingerprint/Face ID when available; hold fallback in browser. */

let unlocked = false;
let unlocking = null;

const HOLD_MS = 1400;
const TICK_MS = 40;

function isNativeApp() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function nativeBiometric() {
  try {
    return window.Capacitor?.Plugins?.NativeBiometric || null;
  } catch {
    return null;
  }
}

export async function biometricAvailable() {
  const plugin = nativeBiometric();
  if (!plugin?.isAvailable) return !isNativeApp();
  try {
    const out = await plugin.isAvailable();
    return Boolean(out?.isAvailable);
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
  if (el) return el;
  el = document.createElement("div");
  el.id = "bio-scan";
  el.className = "bio-scan";
  el.hidden = true;
  el.innerHTML = `
    <div class="bio-scan-inner">
      <div class="bio-ring" id="bio-ring" role="button" tabindex="0" aria-label="Unlock Pip">
        <svg class="bio-progress" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="bio-progress-track" cx="50" cy="50" r="46" />
          <circle class="bio-progress-fill" id="bio-progress" cx="50" cy="50" r="46" />
        </svg>
        <div class="bio-ring-glow"></div>
        <svg class="bio-print" viewBox="0 0 64 64" aria-hidden="true">
          <path d="M32 8c-9.5 0-17 7-17 16.5 0 2.2.4 4.3 1.1 6.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M48.2 30.2c.6-1.8.9-3.7.9-5.7C49.1 15 41.6 8 32 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M20.2 34.5c-1.2 3.4-1.2 7.2.2 10.8 2.8 7.2 9.4 12.2 16.6 12.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M43.8 52c4.8-3.2 8-8.4 8-14.4 0-2.1-.4-4.1-1-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M24.5 22.5c-2.6 2.2-4.2 5.5-4.2 9.2 0 1.6.3 3.1.8 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M43.5 22.8c2.4 2.1 3.9 5.2 3.9 8.9 0 1.4-.2 2.8-.7 4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M27.2 26.2c-1.6 1.6-2.6 3.9-2.6 6.5 0 5.4 3.4 10 8.2 11.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M39.5 26.4c1.5 1.6 2.4 3.8 2.4 6.3 0 4.2-2.1 7.9-5.3 10.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M32 24.5v16.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M29.2 28.5c0 6.2 1.1 11.2 2.8 14.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M34.8 28.5c0 6.2-1.1 11.2-2.8 14.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M26.8 40.2c2.2 4.6 5.4 7.4 9.2 7.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M22.8 38c1.1 5.8 4.6 10.5 9.2 12.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M41.2 38.5c-.8 5.2-3.6 9.5-7.4 11.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <div class="bio-scanline"></div>
      </div>
      <p class="bio-title">PIP</p>
      <p class="bio-sub" id="bio-sub">Fingerprint unlock</p>
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
  setSub(msg || "Fingerprint unlock");
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

function waitForHoldScan() {
  const el = ensureScanDom();
  const ring = el.querySelector("#bio-ring");
  const retry = el.querySelector("#bio-retry");

  return new Promise((resolve) => {
    let holding = false;
    let started = 0;
    let timer = 0;
    let lastBuzz = 0;

    const clear = () => {
      holding = false;
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
      el.classList.remove("holding");
    };

    const fail = async (msg) => {
      clear();
      setProgress(0);
      el.classList.add("bad");
      setSub(msg || "Hold until the ring fills");
      await haptic("bad");
      if (retry) {
        retry.hidden = false;
        retry.onclick = () => {
          el.classList.remove("bad");
          setSub("Press & hold the print");
          retry.hidden = true;
          setProgress(0);
        };
      }
    };

    const succeed = async () => {
      clear();
      setProgress(1);
      setSub("Identity confirmed");
      await haptic("ok");
      unlocked = true;
      hideScanUI(true);
      resolve(true);
    };

    const tick = () => {
      if (!holding) return;
      const p = (Date.now() - started) / HOLD_MS;
      setProgress(p);
      if (Date.now() - lastBuzz >= 160) {
        lastBuzz = Date.now();
        haptic("tick");
      }
      if (p >= 1) succeed();
    };

    const startHold = async (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          if (ev.pointerId != null) ring.setPointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (holding || unlocked) return;
      holding = true;
      started = Date.now();
      lastBuzz = 0;
      el.classList.remove("bad");
      el.classList.add("holding");
      setSub("Scanning… keep holding");
      if (retry) retry.hidden = true;
      await haptic("start");
      timer = setInterval(tick, TICK_MS);
    };

    const endHold = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      if (!holding) return;
      const held = Date.now() - started;
      clear();
      if (held < HOLD_MS) {
        setProgress(0);
        fail("Hold longer — keep your thumb on the print");
      }
    };

    ring.style.touchAction = "none";
    ring.onpointerdown = startHold;
    ring.onpointerup = endHold;
    ring.onpointerleave = endHold;
    ring.onpointercancel = endHold;
    ring.oncontextmenu = (e) => e.preventDefault();
    ring.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        startHold(e);
      }
    };
    ring.onkeyup = (e) => {
      if (e.key === "Enter" || e.key === " ") endHold(e);
    };
  });
}

async function waitForNativeScan() {
  const plugin = nativeBiometric();
  const el = ensureScanDom();
  const retry = el.querySelector("#bio-retry");
  showScanUI("Use fingerprint sensor");
  el.classList.add("holding");
  setProgress(0.35);
  await haptic("start");

  const run = async () => {
    await plugin.verifyIdentity({
      reason: "Unlock Phone Pip",
      title: "Pip",
      subtitle: "Confirm it's you",
      description: "Fingerprint or face unlock",
      negativeButtonText: "Cancel",
      maxAttempts: 5,
      useFallback: true,
    });
    setProgress(1);
    setSub("Identity confirmed");
    await haptic("ok");
    unlocked = true;
    hideScanUI(true);
    return true;
  };

  try {
    return await run();
  } catch (e) {
    el.classList.remove("holding");
    el.classList.add("bad");
    setProgress(0);
    setSub(String(e?.message || e || "Biometric failed").slice(0, 80));
    await haptic("bad");
    if (retry) {
      retry.hidden = false;
      return new Promise((resolve, reject) => {
        retry.onclick = async () => {
          retry.hidden = true;
          el.classList.remove("bad");
          try {
            resolve(await waitForNativeScan());
          } catch (err) {
            reject(err);
          }
        };
      });
    }
    throw e;
  }
}

export async function biometricUnlock() {
  if (isNativeApp() && (await biometricAvailable())) {
    showScanUI("Use fingerprint sensor");
    await waitForNativeScan();
    unlocked = true;
    return true;
  }
  showScanUI("Press & hold the print");
  await waitForHoldScan();
  unlocked = true;
  return true;
}

/** Full-screen gate used on boot when biometric_lock is on. */
export async function requireAppUnlock(settings, { force = false } = {}) {
  if (!settings?.biometric_lock && !force) {
    unlocked = true;
    return true;
  }
  if (unlocked && !force) return true;
  if (unlocking) return unlocking;

  unlocking = (async () => {
    try {
      if (isNativeApp() && (await biometricAvailable())) {
        showScanUI("Use fingerprint sensor");
        await waitForNativeScan();
      } else {
        showScanUI("Press & hold the print");
        await waitForHoldScan();
      }
      unlocked = true;
      return true;
    } finally {
      unlocking = null;
    }
  })();

  return unlocking;
}

export async function guardSecrets(settings, fn) {
  if (!settings.biometric_lock) return fn();
  if (unlocked) return fn();
  await requireAppUnlock(settings, { force: true });
  return fn();
}
