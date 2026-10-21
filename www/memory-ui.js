/** MEMORY tab — inspect every tier, search, edit, delete, approve suggestions.
 *
 * Pip's voice, wingman tone (verdict Q3: crew stays behind the curtain until
 * Phase 3). Delete is always a tombstone (sync-merge-ready); the UI says
 * "forget" because that's what it feels like.
 */

import {
  TIERS,
  getTier,
  getSuggestions,
  approveSuggestion,
  dismissSuggestion,
  updateEntry,
  tombstone,
  promoteToDurable,
  addPerson,
  searchMem,
  memoryCounts,
  persistMemory,
} from "./memory-engine.js";
import { distillStatus, distillNow } from "./memory-distill.js";
import { ensureEmbedder, backfillEmbeddings, embedderReady } from "./memory-embed.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let memFilter = "all";
let memQuery = "";
let memEditing = null;
let smartOn = false;
let smartBusy = "";
let vecMap = null; // Map(id -> number[]) when smart recall is on
let vecQuery = null;

const TIER_LABEL = { working: "WORKING", daily: "DAILY", durable: "DURABLE", people: "PEOPLE" };

function dayOf(iso) {
  const s = String(iso || "");
  return s.length >= 10 ? s.slice(0, 10) : "—";
}

function entryCard(e) {
  const meta = `${TIER_LABEL[e.tier] || e.tier} · ${dayOf(e.updated_at || e.created_at)} · ${e.origin === "desktop" ? "DESKTOP" : "PHONE"}${
    e.migrated ? " · migrated" : ""
  }${e.embedding ? " · ✦" : ""}`;
  const canPromote = e.tier === "working" || e.tier === "daily";
  if (memEditing === e.id) {
    return `<div class="mem-card" data-mem="${esc(e.id)}">
      <div class="mem-meta">${esc(meta)}</div>
      <input class="mem-edit-title" value="${esc(e.title || "")}" placeholder="Title" />
      <textarea class="mem-edit-body" rows="4">${esc(e.content || "")}</textarea>
      <div class="mem-actions">
        <button type="button" data-act="save" class="primary">SAVE</button>
        <button type="button" data-act="cancel">CANCEL</button>
      </div>
    </div>`;
  }
  return `<div class="mem-card" data-mem="${esc(e.id)}">
    <div class="mem-meta">${esc(meta)}</div>
    ${e.title ? `<div class="mem-title">${esc(e.title)}</div>` : ""}
    <div class="mem-body">${esc(e.content || "")}</div>
    <div class="mem-actions">
      <button type="button" data-act="edit">EDIT</button>
      ${canPromote ? `<button type="button" data-act="pin" title="Remember long-term">📌 REMEMBER</button>` : ""}
      <button type="button" data-act="forget">FORGET</button>
    </div>
  </div>`;
}

async function currentList() {
  if (memQuery.trim()) {
    let vectors = null;
    if (smartOn && vecQuery && vecMap) vectors = { q: vecQuery, map: vecMap };
    const tiers = memFilter === "all" ? undefined : [memFilter];
    return searchMem(memQuery, { limit: 30, tiers, vectors });
  }
  if (memFilter === "all") {
    const out = [];
    for (const t of ["durable", "people", "daily", "working"]) out.push(...getTier(t).slice(0, 25));
    return out;
  }
  return getTier(memFilter);
}

async function refreshVectorsFor(list) {
  if (!smartOn || !embedderReady()) return;
  try {
    const emb = await ensureEmbedder();
    const missing = list.filter((e) => !e.embedding && String(e.content || "").trim());
    if (missing.length) {
      const vecs = await emb.embed(missing.map((e) => `${e.title || ""}\n${e.content}`));
      missing.forEach((e, i) => {
        if (vecs[i]) e.embedding = vecs[i];
      });
      await persistMemory();
    }
    vecMap = new Map();
    for (const e of list) if (e.embedding) vecMap.set(e.id, e.embedding);
  } catch {
    /* vectors stay best-effort; hybrid still ranks */
  }
}

export async function renderMemoryTab(ctx) {
  const { db, setStatus, rerender } = ctx;
  const root = document.getElementById("view");
  if (!root) return;
  const counts = memoryCounts();
  const sugg = getSuggestions();
  const st = distillStatus(db);

  const chips = ["all", ...TIERS]
    .map((t) => {
      const n = t === "all" ? counts.durable + counts.daily + counts.people + counts.working : counts[t] || 0;
      const label = t === "all" ? "ALL" : TIER_LABEL[t];
      return `<button type="button" data-chip="${t}" class="${memFilter === t ? "on" : ""}">${label} · ${n}</button>`;
    })
    .join("");

  const distillLine = st.pending
    ? `Distillation <b>waiting for a local model</b> — it'll run on its own when desktop Ollama or on-device Qwen is reachable. Nothing was skipped.`
    : st.lastRun
      ? `Last distilled <b>${esc(st.lastRun)}</b> · next run tonight.`
      : `Not distilled yet today — runs automatically when a local model is reachable.`;

  root.innerHTML = `
  <div class="memory-wrap">
    <h3>PIP REMEMBERS</h3>
    <p class="muted">Everything here lives on this phone, encrypted. Nothing enters DURABLE without your say-so.</p>
    <p class="muted mem-distill">${distillLine}</p>
    <div class="dock mem-distill-row">
      <button type="button" id="mem-distill-now">DISTILL NOW</button>
      <button type="button" id="mem-smart">${smartBusy || (smartOn ? "SMART RECALL · ON ✦" : "SMART RECALL · OFF")}</button>
    </div>
    ${sugg.length ? `<div class="mem-suggest"><h4>PIP SUGGESTS REMEMBERING</h4>${sugg
      .map(
        (e) => `<div class="mem-card mem-sug" data-mem="${esc(e.id)}">
          <div class="mem-body">${esc(e.content || "")}</div>
          <div class="mem-actions">
            <button type="button" data-act="approve" class="primary">REMEMBER IT</button>
            <button type="button" data-act="dismiss">NAH</button>
          </div>
        </div>`,
      )
      .join("")}</div>` : ""}
    <div class="mem-search">
      <input id="mem-q" placeholder="Search memory…" value="${esc(memQuery)}" />
      <button type="button" id="mem-go" class="primary">SEARCH</button>
      ${memQuery ? `<button type="button" id="mem-clear">CLEAR</button>` : ""}
    </div>
    <div class="mem-chips">${chips}</div>
    <div id="mem-list"><p class="muted">…</p></div>
    <div class="mem-add">
      <h4>ADD A PERSON</h4>
      <div class="field"><span>NAME</span><input id="mem-person-name" placeholder="Who" /></div>
      <div class="field"><span>NOTE</span><input id="mem-person-note" placeholder="What to remember about them" /></div>
      <div class="dock"><button type="button" id="mem-person-add" class="primary">ADD</button></div>
    </div>
  </div>`;

  const paintList = async () => {
    const listEl = root.querySelector("#mem-list");
    if (!listEl) return;
    const list = await currentList();
    if (smartOn) await refreshVectorsFor(list);
    listEl.innerHTML = list.length
      ? list.map(entryCard).join("")
      : `<p class="muted">${memQuery ? "Nothing matches — try fewer words." : "Nothing here yet. Chat a little, or tap DISTILL NOW after a session."}</p>`;
    listEl.querySelectorAll("[data-mem]").forEach((card) => {
      const id = card.dataset.mem;
      card.querySelectorAll("[data-act]").forEach((btn) => {
        btn.onclick = async () => {
          const act = btn.dataset.act;
          try {
            if (act === "edit") {
              memEditing = id;
            } else if (act === "cancel") {
              memEditing = null;
            } else if (act === "save") {
              const title = card.querySelector(".mem-edit-title")?.value || "";
              const content = card.querySelector(".mem-edit-body")?.value || "";
              await updateEntry(id, { title, content });
              memEditing = null;
              setStatus && setStatus("MEMORY · saved");
            } else if (act === "forget") {
              if (!confirm("Forget this? (kept as a tombstone for future sync — never readable as content)")) return;
              await tombstone(id);
              setStatus && setStatus("MEMORY · forgotten");
            } else if (act === "pin") {
              const made = await promoteToDurable(id);
              if (made) setStatus && setStatus("MEMORY · remembered long-term");
            } else if (act === "approve") {
              await approveSuggestion(id);
              setStatus && setStatus("MEMORY · remembered");
            } else if (act === "dismiss") {
              await dismissSuggestion(id);
            }
          } catch (e) {
            setStatus && setStatus(`MEMORY · ${String((e && e.message) || e).slice(0, 80)}`);
          }
          rerender();
        };
      });
    });
  };

  root.querySelectorAll("[data-chip]").forEach((b) => {
    b.onclick = () => {
      memFilter = b.dataset.chip;
      memEditing = null;
      paintList();
      root.querySelectorAll("[data-chip]").forEach((x) => x.classList.toggle("on", x.dataset.chip === memFilter));
    };
  });

  const q = root.querySelector("#mem-q");
  const go = () => {
    memQuery = q ? q.value : "";
    if (smartOn) embedQueryForSearch();
    paintList();
  };
  root.querySelector("#mem-go").onclick = go;
  if (q) q.onkeydown = (e) => {
    if (e.key === "Enter") go();
  };
  const clear = root.querySelector("#mem-clear");
  if (clear) clear.onclick = () => { memQuery = ""; vecQuery = null; rerender(); };

  async function embedQueryForSearch() {
    try {
      const emb = await ensureEmbedder();
      const v = await emb.embed([memQuery]);
      vecQuery = v[0] || null;
    } catch {
      vecQuery = null;
    }
  }

  root.querySelector("#mem-distill-now").onclick = async () => {
    setStatus && setStatus("MEMORY · distilling with a local model…");
    try {
      const out = await distillNow(db);
      setStatus && setStatus(out.ran ? `MEMORY · distilled ${out.consumed || 0} captures` : `MEMORY · ${out.pending ? "queued — waiting for a local model" : "nothing to distill"}`);
    } catch (e) {
      setStatus && setStatus(`MEMORY · ${String((e && e.message) || e).slice(0, 90)}`);
    }
    rerender();
  };

  root.querySelector("#mem-smart").onclick = async () => {
    if (smartOn) {
      smartOn = false;
      vecMap = null;
      vecQuery = null;
      setStatus && setStatus("MEMORY · smart recall off — hybrid search stays on");
      rerender();
      return;
    }
    smartBusy = "SMART RECALL · LOADING…";
    rerender();
    try {
      setStatus && setStatus("MEMORY · downloading the embedding model once (~23MB, cached)…");
      const emb = await ensureEmbedder((p) => {
        if (p && p.status === "progress" && p.total) {
          setStatus && setStatus(`MEMORY · model ${Math.round((100 * (p.loaded || 0)) / p.total)}%`);
        }
      });
      smartBusy = "SMART RECALL · INDEXING…";
      const all = [];
      for (const t of ["durable", "people", "daily"]) all.push(...getTier(t));
      await backfillEmbeddings(all, (p) => {
        if (p && p.total) setStatus && setStatus(`MEMORY · indexing ${p.done}/${p.total}`);
      });
      await persistMemory();
      const v = await emb.embed(["warmup"]);
      void v;
      smartOn = true;
      smartBusy = "";
      if (memQuery.trim()) await embedQueryForSearch();
      setStatus && setStatus("MEMORY · smart recall on ✦ — real on-device semantic search");
    } catch (e) {
      smartBusy = "";
      setStatus && setStatus(`MEMORY · smart recall unavailable: ${String((e && e.message) || e).slice(0, 80)}`);
    }
    rerender();
  };

  const addBtn = root.querySelector("#mem-person-add");
  if (addBtn) {
    addBtn.onclick = async () => {
      const name = root.querySelector("#mem-person-name")?.value || "";
      const note = root.querySelector("#mem-person-note")?.value || "";
      const made = await addPerson(name, note).catch((e) => {
        setStatus && setStatus(`MEMORY · ${String((e && e.message) || e).slice(0, 80)}`);
        return null;
      });
      if (made) {
        memFilter = "people";
        memEditing = null;
        setStatus && setStatus(`MEMORY · ${name.trim()} added`);
        rerender();
      }
    };
  }

  if (smartOn && memQuery.trim() && !vecQuery) await embedQueryForSearch();
  await paintList();
}
