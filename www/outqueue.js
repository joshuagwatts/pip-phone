/** Offline out-queue — Phase 4 (PIP_REIMAGINED.md §3 "Freedom", §5
 * "Queued sync", §6 Phase 4).
 *
 * Outbound actions that need the network or the desktop wait here when
 * they can't fire: { id, kind, payload, queuedAt, attempts }. On reconnect
 * (online event, the background tick, app open) the queue flushes IN
 * ORDER through handlers the app registers per kind. A failed item stays
 * queued with attempts bumped — nothing is silently dropped, ever; the
 * only way out is a successful flush or the user clearing it in DATA.
 *
 * DEPENDENCY-FREE like briefing.js: imports nothing, does no I/O beyond
 * its own localStorage key. Handlers (which own the real network work)
 * are injected by app.js.
 */

export const OUTQUEUE_KEY = "pip.phone.outqueue.v1";

function qid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function loadQueue() {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTQUEUE_KEY) || "null");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveQueue(items) {
  try {
    localStorage.setItem(OUTQUEUE_KEY, JSON.stringify(items || []));
  } catch {
    /* best-effort — a lost queue write must never crash the app */
  }
  return items;
}

export function pendingCount() {
  return loadQueue().length;
}

/** Enqueue an outbound action. `dedupeKey` collapses repeats (e.g. one
 *  pending "opp-sync", one pending draft per opp) so a long offline
 *  stretch doesn't stack duplicates of the same intent. Returns the item
 *  (existing one when deduped). */
export function enqueue(kind, payload = {}, dedupeKey = "") {
  const items = loadQueue();
  const key = dedupeKey || "";
  if (key) {
    const existing = items.find((i) => i.kind === kind && (i.dedupeKey || "") === key);
    if (existing) return existing;
  }
  const item = {
    id: qid(),
    kind: String(kind || "misc"),
    payload: payload && typeof payload === "object" ? payload : {},
    dedupeKey: key,
    queuedAt: Date.now(),
    attempts: 0,
  };
  items.push(item);
  saveQueue(items);
  return item;
}

export function removeItem(id) {
  const items = loadQueue().filter((i) => i.id !== id);
  saveQueue(items);
  return items;
}

export function clearQueue() {
  saveQueue([]);
  return [];
}

/** Flush in queue order through `handlers` ({ kind: async (payload, item) }).
 *  Success removes the item; a throw (or a missing handler) keeps it with
 *  attempts+1 and the flush MOVES ON to the next item — the attempt order
 *  is the queue order, and nothing is dropped. Returns a summary; never
 *  throws. */
export async function flushOutQueue(handlers = {}) {
  const items = loadQueue();
  const summary = { flushed: 0, failed: 0, remaining: 0 };
  if (!items.length) return summary;
  const kept = [];
  for (const item of items) {
    const handler = handlers[item.kind];
    if (typeof handler !== "function") {
      item.attempts = Number(item.attempts || 0) + 1;
      kept.push(item);
      summary.failed += 1;
      continue;
    }
    try {
      await handler(item.payload, item);
      summary.flushed += 1;
    } catch {
      item.attempts = Number(item.attempts || 0) + 1;
      kept.push(item);
      summary.failed += 1;
    }
  }
  saveQueue(kept);
  summary.remaining = kept.length;
  return summary;
}
