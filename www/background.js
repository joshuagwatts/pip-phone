/** Background sync — morning + opps from desktop. No key sync. */
import { desktopConfigured } from "./desktop.js";
import { fullOppSync, fetchOppDigest } from "./oppdesk.js";
import { fullMorningSync } from "./morning.js";
import { setKeepAlive } from "./proton.js";

let timer = null;
let watching = false;

export function startBackground(db, { persist, render, setStatus, softRefresh }) {
  stopBackground();
  const tick = async () => {
    if (!db?.settings) return;
    try {
      await fullMorningSync(db.settings).catch(() => {});
      if (desktopConfigured(db.settings)) {
        const out = await fullOppSync(db.settings, db);
        if (out.pushed || out.pulled) {
          persist?.();
          if (softRefresh) softRefresh();
          else render?.();
          setStatus?.(`SYNC · ${out.pushed}↑ ${out.pulled}↓`);
        }
        await fetchOppDigest(db.settings, db);
      }
      softRefresh?.();
    } catch {
      /* keep watching */
    }
  };

  const cap = window.Capacitor;
  if (cap?.Plugins?.App?.addListener) {
    if (!watching) {
      watching = true;
      cap.Plugins.App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) tick();
      });
    }
  }

  if (db.settings.keepalive) {
    timer = setInterval(tick, 5 * 60 * 1000);
    setKeepAlive(true).catch(() => {});
    setTimeout(tick, 2500);
  }
}

export function stopBackground() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function toggleKeepAlive(db, on, persist) {
  db.settings.keepalive = Boolean(on);
  persist?.();
  await setKeepAlive(Boolean(on)).catch(() => {});
}
