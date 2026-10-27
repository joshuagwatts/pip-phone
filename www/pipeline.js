/** Prosperity pipeline — Phase 4 pillar (PIP_REIMAGINED.md §3 "opp.js /
 * oppdesk.js → the Prosperity Desk", §6 Phase 4).
 *
 * A real pipeline stage field on each opp, separate from the older
 * `app_stage` (which tracks the scrape/draft workflow and is mirrored to
 * the desktop in its own vocabulary — that contract is untouched).
 *
 *   found → researching → drafted → submitted → follow-up → won
 *   lost is the side exit, reachable from anywhere.
 *
 * Pure functions over plain opp objects — imports nothing, no fetch.
 * NOTHING here submits anything: a stage only ever changes on a user tap
 * (or when Pip's own draft finishes, which is a draft, not a submission).
 */

export const PIPELINE_STAGES = [
  { id: "found", label: "Found" },
  { id: "researching", label: "Researching" },
  { id: "drafted", label: "Drafted" },
  { id: "submitted", label: "Submitted" },
  { id: "follow-up", label: "Follow-up" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const STAGE_IDS = new Set(PIPELINE_STAGES.map((s) => s.id));
export const FOLLOW_UP_DEFAULT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function pipelineStageLabel(id) {
  return PIPELINE_STAGES.find((s) => s.id === id)?.label || "Found";
}

/** The opp's pipeline stage. Explicit `stage` wins; legacy opps (created
 *  before Phase 4) derive from app_stage/status so the desk reads true
 *  without a migration pass. */
export function oppStage(opp) {
  if (!opp) return "found";
  if (STAGE_IDS.has(opp.stage)) return opp.stage;
  switch (opp.app_stage) {
    case "drafted":
      return "drafted";
    case "submitted":
      return "submitted";
    case "interview":
      return "follow-up";
    case "rejected":
      return "lost";
    case "scraped":
      return "researching";
    default:
      return "found";
  }
}

/** Apply a stage change. Mutates and returns the opp. Entering follow-up
 *  stamps its due date (explicit `followupDue` ISO date wins, else 7 days
 *  after entering). Entering won/lost stamps the decision time. */
export function applyStage(opp, stageId, now = Date.now(), followupDue = "") {
  if (!opp || !STAGE_IDS.has(stageId)) return opp;
  opp.stage = stageId;
  opp.stage_at = now;
  if (stageId === "follow-up") {
    opp.followup_due = followupDue || new Date(now + FOLLOW_UP_DEFAULT_DAYS * DAY_MS).toISOString().slice(0, 10);
  }
  if (stageId === "won" || stageId === "lost") {
    opp.decided_at = new Date(now).toISOString().slice(0, 10);
  }
  opp.updated_at = now;
  return opp;
}

/** The next stage on the happy path (for one-tap advance). */
export function nextStage(stageId) {
  const flow = ["found", "researching", "drafted", "submitted", "follow-up", "won"];
  const i = flow.indexOf(stageId);
  if (i < 0) return "found";
  return flow[Math.min(i + 1, flow.length - 1)];
}

/** When this opp's follow-up comes due (ms epoch), or 0 when not in
 *  follow-up. Explicit followup_due date wins; else stage entry + 7d. */
export function followUpDueAt(opp) {
  if (!opp || oppStage(opp) !== "follow-up") return 0;
  if (opp.followup_due) {
    const t = Date.parse(`${opp.followup_due}T09:00:00`);
    if (Number.isFinite(t)) return t;
  }
  const entered = Number(opp.stage_at || opp.updated_at || opp.created_at || 0);
  return entered ? entered + FOLLOW_UP_DEFAULT_DAYS * DAY_MS : 0;
}

export function isFollowUpDue(opp, now = Date.now()) {
  const due = followUpDueAt(opp);
  return due > 0 && now >= due;
}

export function daysWaiting(opp, now = Date.now()) {
  const entered = Number(opp.stage_at || opp.updated_at || opp.created_at || 0);
  if (!entered) return 0;
  return Math.max(0, Math.floor((now - entered) / DAY_MS));
}

/** Open opps whose follow-up is due, longest-waiting first — the Morning
 *  Brief's recommended-move candidates and the reasoned nudge source. */
export function followUpCandidates(opps, now = Date.now()) {
  return (opps || [])
    .filter((o) => o && o.status !== "done" && isFollowUpDue(o, now))
    .sort((a, b) => followUpDueAt(a) - followUpDueAt(b));
}
