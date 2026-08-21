/** Pip phosphor lock — hold the thumbprint. Matches Pip theme; no Android system sheet. */

let unlocked = false;
let unlocking = null;

const HOLD_MS = 1400;
const TICK_MS = 40;

export function biometricAvailable() {
  return true;
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
    // Refresh print glyph after app upgrades (DOM may be stale from prior session).
    const print = el.querySelector(".bio-print");
    if (print && print.dataset.v !== "3") {
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
      <div class="bio-ring" id="bio-ring" role="button" tabindex="0" aria-label="Hold to unlock Pip">
        <svg class="bio-progress" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="bio-progress-track" cx="50" cy="50" r="46" />
          <circle class="bio-progress-fill" id="bio-progress" cx="50" cy="50" r="46" />
        </svg>
        <div class="bio-ring-glow"></div>
        <svg class="bio-print" data-v="3" viewBox="0 0 24 24" aria-hidden="true">
          <!-- Lucide-style fingerprint — readable thumbprint ridges -->
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
      <p class="bio-sub" id="bio-sub">Press & hold the print</p>
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
  setSub(msg || "Press & hold the print");
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
      setSub("Welcome back");
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

export async function biometricUnlock() {
  showScanUI("Press & hold the print");
  await waitForHoldScan();
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
      showScanUI("Press & hold the print");
      await waitForHoldScan();
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
