/** PIP recall scoring — honest hybrid, no fake semantics.
 *
 * Baseline (always available, fully offline, zero downloads):
 *   token overlap (stopwords removed, light stemming, title weighted 3x)
 *   × recency decay (half-life ~30 days) × tier weight × substance score
 *
 * Semantic upgrade (opt-in, see memory-embed.js): when cached embedding
 * vectors exist for entries and the query, cosine similarity blends in at
 * 60% weight. Without vectors, the hybrid above is the whole score — and it
 * is NOT labeled "semantic" anywhere in the UI.
 */

const STOP = new Set(
  "a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,it,its,this,that,these,those,i,me,my,we,our,you,your,he,she,they,them,his,her,their,what,which,who,whom,when,where,why,how,do,does,did,will,would,can,could,should,not,no,yes,so,very,just,about,into,over,after,before,between,through,during,again,once,here,there,all,any,both,each,few,more,most,other,some,such,only,own,same,than,too".split(
    ",",
  ),
);

function stem(w) {
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

const TIER_W = { durable: 3.0, people: 2.5, daily: 2.0, working: 1.0 };

export function hybridScore(query, entry, nowMs = Date.now()) {
  const q = new Set(tokens(query));
  if (!q.size) return 0;
  const title = new Set(tokens(entry.title));
  const body = new Set(tokens(entry.content));
  let overlap = 0;
  for (const t of q) {
    if (title.has(t)) overlap += 3;
    else if (body.has(t)) overlap += 1;
  }
  if (!overlap) return 0;
  const norm = overlap / Math.sqrt(q.size);
  const ts = Date.parse(entry.updated_at || entry.created_at || "") || nowMs;
  const ageDays = Math.max(0, (nowMs - ts) / 864e5);
  const recency = 1 / (1 + ageDays / 30);
  const tier = TIER_W[entry.tier] || 1;
  const substance = entry.score > 0 ? 1 + Math.min(entry.score, 40) / 80 : 1;
  return norm * (0.5 + 0.5 * recency) * tier * substance;
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * rankEntries(query, entries, vectors?) -> [{entry, score}] sorted desc.
 * vectors = { q: number[], map: Map(id -> number[]) } or null.
 * With vectors, real cosine similarity blends at 60% — but only counts when
 * similarity clears a floor (0.15), so weak semantic noise can't outrank a
 * strong keyword hit.
 */
export function rankEntries(query, entries, vectors = null) {
  const now = Date.now();
  const out = [];
  const useVec = vectors && Array.isArray(vectors.q) && vectors.map instanceof Map;
  for (const e of entries) {
    let s = hybridScore(query, e, now);
    if (useVec) {
      const v = vectors.map.get(e.id);
      if (v) {
        const cos = cosine(vectors.q, v);
        if (cos > 0.15) s = s * 0.4 + cos * 3 * 0.6;
      }
    }
    if (s > 0) out.push({ entry: e, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
