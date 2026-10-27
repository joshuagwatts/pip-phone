/** Background sync — morning + opps from desktop. No key sync. */
import { desktopConfigured } from "./desktop.js";
import { fullOppSync, fetchOppDigest } from "./oppdesk.js";
import { fullMorningSync } from "./morning.js";
import { setKeepAlive } from "./proton.js";
import { maybeDistill } from "./memory-distill.js";
import { noteTick } from "./briefing.js";
import { enqueue as enqueueOut } from "./outqueue.js";

let timer = null;
let watching = false;

export function startBackground(db, { persist, render, setStatus, softRefresh, flushQueue }) {
  stopBackground();
  const tick = async () => {
    if (!db?.settings) return;
    try {
      await fullMorningSync(db.settings).catch(() => {});
      // Nightly memory distillation — local models only, queued when none
      // reachable. Runs at most once a day; never throws (see memory-distill).
      await maybeDistill(db, { setStatus }).catch(() => {});
      // Briefing Engine heartbeat — this tick is the scheduler per the
      // blueprint (plus quiet-hour gating, which lives in briefing.js).
      // Delivery itself happens on open via app.js runBriefing: a card is
      // only worth posting the moment it can actually be seen.
      try {
        noteTick();
      } catch {
        /* briefing state is best-effort */
      }
      // Phase 4 offline queue: retry what earlier failures queued BEFORE
      // this tick's own sync, so order stays honest.
      if (flushQueue) await flushQueue().catch(() => {});
      if (desktopConfigured(db.settings)) {
        try {
          const out = await fullOppSync(db.settings, db);
          if (out.pushed || out.pulled) {
            persist?.();
            if (softRefresh) softRefresh();
            else render?.();
            setStatus?.(`SYNC · ${out.pushed}↑ ${out.pulled}↓`);
          }
        } catch {
          // Desktop unreachable: the sync intent queues and fires on the
          // next reconnect/tick — it is never silently dropped.
          try {
            enqueueOut("opp-sync", {}, "opp-sync");
          } catch {
            /* queue best-effort */
          }
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
