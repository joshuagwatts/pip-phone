/** PIP nightly distillation — Phase 1.
 *
 * Once a day, the day's volatile working captures are distilled into:
 *   1. a dated Daily note (tier 'daily')
 *   2. 0-3 candidates for Durable (tier 'durable', suggested:true — they wait
 *      in the MEMORY tab for one-tap approve/dismiss; nothing auto-promotes)
 *
 * LOCAL ONLY, always: desktop Ollama first, on-device Qwen second (via
 * brain.js localOnlyComplete — which never touches cloud). If no local model
 * is reachable, the job is QUEUED (settings.memory_distill_pending = date)
 * and retried on the next tick/boot. The pending state is shown in the
 * MEMORY tab — never silently skipped.
 *
 * Triggered from the existing 5-minute keepalive tick (background.js) and
 * once at boot (app.js) so missed days still distill. Runs at most once per
 * calendar day.
 */

import { localOnlyComplete } from "./brain.js";
import { save as saveStore } from "./store.js";
import {
  peekWorking,
  consumeWorking,
  addDailyNote,
  suggestDurable,
  persistMemory,
  memoryReady,
} from "./memory-engine.js";

function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function distillDue(db) {
  const s = (db && db.settings) || {};
  return String(s.memory_distill_last || "") !== todayStr();
}

export function distillStatus(db) {
  const s = (db && db.settings) || {};
  return {
    lastRun: String(s.memory_distill_last || ""),
    pending: String(s.memory_distill_pending || ""),
  };
}

/** Exported for testing — tolerant parse of the distiller's reply. */
export function parseDistill(text) {
  const t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : t).trim();
  // 1. Strict JSON first.
  try {
    const obj = JSON.parse(body);
    if (obj && typeof obj === "object") return normDistill(obj);
  } catch {
    /* fall through to tolerant extraction */
  }
  // 2. Tolerant extraction — small local models emit literal newlines inside
  //    strings, which is invalid JSON. [^"\\] matches those literally.
  const unesc = (s) =>
    String(s).replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const dailyM = body.match(/"daily"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  const candsM = body.match(/"candidates"\s*:\s*\[([\s\S]*?)\]/s);
  if (dailyM || candsM) {
    const candidates = [];
    if (candsM) {
      const itemRe = /"((?:[^"\\]|\\.)*)"/g;
      let im;
      while ((im = itemRe.exec(candsM[1])) && candidates.length < 3) {
        const c = unesc(im[1]).trim();
        if (c) candidates.push(c.slice(0, 300));
      }
    }
    return { daily: dailyM ? unesc(dailyM[1]).trim().slice(0, 2000) : "", candidates };
  }
  // 3. Plain-text fallback: whole reply becomes the daily note, no candidates.
  return { daily: t.slice(0, 2000), candidates: [] };
}

function normDistill(obj) {
  return {
    daily: String(obj.daily || "").trim().slice(0, 2000),
    candidates: Array.isArray(obj.candidates)
      ? obj.candidates.map((x) => String(x).trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

const DISTILL_PROMPT = (lines) =>
  [
    "You are PIP's memory distiller. Below are raw captures from the operator's day.",
    "Return ONLY JSON: {\"daily\": \"...\", \"candidates\": [\"...\"]}.",
    "- \"daily\": a dated note, 3-8 short bullet lines, plain language, what actually mattered today.",
    "- \"candidates\": 0 to 3 entries worth remembering LONG-TERM (facts about the operator, decisions, people, goals).",
    "  Only genuinely durable facts — skip small talk, bug reports, and anything already obvious.",
    "- Keep every line under 200 characters. No markdown fences, no commentary.",
    "",
    "Captures:",
    lines,
  ].join("\n");

async function runDistillation(db) {
  const raw = peekWorking();
  if (!raw.length) return { empty: true, daily: 0, candidates: 0 };
  const lines = raw
    .slice(0, 60)
    .map((r) => `- ${String(r.content || "").replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  // Local-only cascade: desktop Ollama -> on-device Qwen. Throws when neither
  // is reachable — the caller queues the job, never falls back to cloud.
  const out = await localOnlyComplete(db.settings, [{ role: "user", content: DISTILL_PROMPT(lines) }], 0.3, 700);
  const parsed = parseDistill(out.text);
  if (!parsed.daily && !parsed.candidates.length) throw new Error("distiller returned nothing usable");
  const consumed = consumeWorking(); // only consume after a usable result
  const stamp = todayStr();
  let nCandidates = 0;
  if (parsed.daily) {
    await addDailyNote(`Daily note · ${stamp}`, parsed.daily, new Date().toISOString());
  }
  for (const c of parsed.candidates) {
    await suggestDurable(c, `distill-${stamp}`);
    nCandidates += 1;
  }
  await persistMemory();
  return { empty: false, daily: parsed.daily ? 1 : 0, candidates: nCandidates, consumed: consumed.length };
}

/**
 * Maybe run today's distillation. Safe to call from any tick — guarded by
 * try/catch at the call site too. Never throws: failure -> pending flag.
 */
export async function maybeDistill(db, { setStatus } = {}) {
  if (!db || !memoryReady()) return { ran: false, reason: "engine not ready" };
  if (!distillDue(db)) return { ran: false, reason: "already ran today" };
  const s = (db.settings = db.settings || {});
  try {
    const out = await runDistillation(db);
    s.memory_distill_last = todayStr();
    s.memory_distill_pending = "";
    saveStore(db);
    if (setStatus && out && !out.empty) setStatus(`MEMORY · distilled ${out.consumed} captures`);
    return { ran: true, ...out };
  } catch (e) {
    // Queued, labeled, retried later — never silently skipped, never cloud.
    s.memory_distill_pending = todayStr();
    saveStore(db);
    if (setStatus) setStatus(`MEMORY · distillation waiting for a local model`);
    return { ran: false, pending: true, error: String((e && e.message) || e) };
  }
}

/** Manual trigger from the MEMORY tab. */
export async function distillNow(db) {
  const s = (db.settings = db.settings || {});
  s.memory_distill_last = ""; // force due
  const out = await maybeDistill(db, {});
  return out;
}
