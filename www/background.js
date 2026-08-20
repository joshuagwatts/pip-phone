/** Background sync — opps, morning, and cloud keys from desktop. */
import { desktopConfigured } from "./desktop.js";
import { fullOppSync, fetchOppDigest } from "./oppdesk.js";
import { fullMorningSync } from "./morning.js";
import { pullCloudKeys } from "./keysync.js";
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
        try {
          const keys = await pullCloudKeys(db.settings);
          if (keys.applied) persist?.();
        } catch {
          /* keys optional if offline */
        }
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
    cap.Plugins.App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) tick();
    });
  }

  if (db.settings.keepalive) setKeepAlive(true);
  tick();
  timer = setInterval(tick, 5 * 60 * 1000);
  watching = true;
}

export function stopBackground() {
  if (timer) clearInterval(timer);
  timer = null;
  watching = false;
}

export function isWatching() {
  return watching;
}

export async function toggleKeepAlive(db, on, persist) {
  db.settings.keepalive = Boolean(on);
  persist?.();
  await setKeepAlive(on);
  if (on && !watching) {
    /* caller should startBackground */
  } else if (!on) {
    await setKeepAlive(false);
  }
}
