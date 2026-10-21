/** Proton VPN companion — system VPN detect, open Proton, Wi‑Fi bind for LAN, keepalive.
 *
 * M1: the Wi‑Fi bind (LAN bypass) is NEVER silent anymore. When a system VPN
 * is active, the decision is: ask (once per session) / always / never, stored
 * in settings.vpn_bypass. Without a registered UI asker (e.g. headless),
 * the decision fails safe to "never" — LAN calls fail instead of bypassing.
 */

import { load, save } from "./store.js";

function bridge() {
  return window.Capacitor?.Plugins?.VpnBridge || null;
}

export async function vpnSystemActive() {
  const b = bridge();
  if (!b?.isActive) return false;
  try {
    const hit = await b.isActive();
    return Boolean(hit && hit.active);
  } catch {
    return false;
  }
}

/** Bind process to Wi‑Fi so LAN reaches desktop while Proton is up. */
export async function bindLanWifi() {
  const b = bridge();
  if (!b?.bindWifi) return false;
  try {
    const hit = await b.bindWifi();
    return Boolean(hit && hit.ok);
  } catch {
    return false;
  }
}

export async function unbindLanNetwork() {
  const b = bridge();
  if (!b?.unbindNetwork) return;
  try {
    await b.unbindNetwork();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------- bypass decision (M1) --- */

let bypassAsker = null; // async () => "once" | "always" | "never" (registered by app.js)
let sessionOnce = false; // "allow once" binds for the rest of this session

/** Register the UI prompter for the VPN-bypass question. */
export function setVpnBypassAsker(fn) {
  bypassAsker = typeof fn === "function" ? fn : null;
}

function bypassMode() {
  try {
    const m = load().settings?.vpn_bypass;
    return m === "always" || m === "never" ? m : "ask";
  } catch {
    return "ask";
  }
}

export function setVpnBypassMode(mode) {
  const m = mode === "always" || mode === "never" ? mode : "ask";
  try {
    const db = load();
    db.settings = db.settings || {};
    db.settings.vpn_bypass = m;
    save(db);
  } catch {
    /* ignore */
  }
  return m;
}

export function getVpnBypassMode() {
  return bypassMode();
}

async function vpnBypassDecision() {
  let active = false;
  try {
    active = await vpnSystemActive();
  } catch {
    active = false;
  }
  if (!active) return "nobind"; // no VPN — normal route, nothing to bypass
  const mode = bypassMode();
  if (mode === "always") return "bind";
  if (mode === "never") return "nobind";
  if (sessionOnce) return "bind"; // "allow once" already granted this session
  if (bypassAsker) {
    let pick = "";
    try {
      pick = String((await bypassAsker()) || "").toLowerCase();
    } catch {
      pick = "";
    }
    if (pick === "always") {
      setVpnBypassMode("always");
      return "bind";
    }
    if (pick === "never") {
      setVpnBypassMode("never");
      return "nobind";
    }
    if (pick === "once") {
      sessionOnce = true;
      return "bind";
    }
    return "nobind"; // dismissed — fail safe, never bypass silently
  }
  return "nobind"; // no UI to ask — never bypass silently
}

/** Decide + bind Wi‑Fi for LAN. Returns true when the bind is held (caller must unbind). */
export async function decideLanBind() {
  try {
    if ((await vpnBypassDecision()) !== "bind") return false;
    return await bindLanWifi();
  } catch {
    return false;
  }
}

/** Run fn with Wi‑Fi preferred when the user allows the VPN bypass (M1: never silent). */
export async function withLanBypass(fn) {
  let bound = false;
  try {
    bound = await decideLanBind();
    return await fn();
  } finally {
    if (bound) await unbindLanNetwork();
  }
}

export async function openProtonVpn() {
  const b = bridge();
  if (!b?.openProton) return false;
  try {
    await b.openProton();
    return true;
  } catch {
    try {
      window.open("https://play.google.com/store/apps/details?id=ch.protonvpn.android", "_system");
    } catch {
      /* ignore */
    }
    return false;
  }
}

export async function setKeepAlive(on) {
  const b = bridge();
  if (!b?.setKeepAlive) return false;
  try {
    await b.setKeepAlive({ on: Boolean(on) });
    return true;
  } catch {
    return false;
  }
}

export function protonPairHint(settings) {
  const url = String(settings.vpn_url || settings.proton_url || "").trim();
  if (url) return url;
  const note = String(settings.vpn_note || "").trim();
  if (/proton/i.test(note)) {
    const m = note.match(/https?:\/\/[^\s]+/);
    if (m) return m[0];
  }
  return "";
}

/** Retry desktop pairing when VPN comes up (Proton running in background). */
export async function pairWhenVpnUp(settings, { pairAtUrl, findAndPair, onStatus } = {}) {
  if (!(await vpnSystemActive())) return null;
  const hint = protonPairHint(settings);
  if (hint && pairAtUrl) {
    onStatus?.("VPN UP · PAIRING…");
    try {
      return await pairAtUrl(settings, hint);
    } catch {
      /* try scan */
    }
  }
  if (findAndPair) {
    onStatus?.("VPN UP · FIND DESKTOP…");
    try {
      return await findAndPair(settings);
    } catch {
      return null;
    }
  }
  return null;
}
