/** PIP smart recall — REAL on-device semantic embeddings, opt-in.
 *
 * Uses the same transformers.js WASM runtime the app already runs Qwen on
 * (see brain.js makeTransformers): a feature-extraction pipeline with
 * Xenova/all-MiniLM-L6-v2 (~23MB quantized, one-time download, cached by the
 * browser). Nothing is "semantic" until this module has produced actual
 * vectors — the baseline hybrid recall in memory-recall.js never claims
 * otherwise.
 *
 * Design: lazy and explicit. Nothing downloads on its own — the MEMORY tab's
 * SMART RECALL toggle calls enableSmartRecall(), which downloads the model
 * (progress reported), backfills vectors for existing entries, and stores
 * them on the entries (inside the encrypted blob). Recall blends cosine
 * similarity at 60% only where vectors exist; entries without vectors keep
 * the hybrid score. Works fully offline once the model is cached.
 */

const CDN = [
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm",
  "https://esm.sh/@huggingface/transformers@3.5.1",
];
const MODEL = "Xenova/all-MiniLM-L6-v2";

let extractor = null;
let loading = null;
let failedAt = 0;

async function loadMod(urls) {
  let last = "";
  for (const url of urls) {
    try {
      return await import(url);
    } catch (e) {
      last = String((e && e.message) || e);
    }
  }
  throw new Error(last || "transformers CDN unreachable");
}

/**
 * Load the embedding pipeline. Resolves to { embed(texts) -> number[][] }.
 * Throws on no connectivity / WASM failure — callers fall back to hybrid.
 */
export async function ensureEmbedder(onProgress) {
  if (extractor) return extractor;
  if (loading) return loading;
  // Don't hammer a failed load more than once a minute.
  if (Date.now() - failedAt < 60000) throw new Error("embedding model failed recently — retry shortly");
  loading = (async () => {
    const tf = await loadMod(CDN);
    if (tf.env) {
      tf.env.allowLocalModels = false;
      tf.env.useBrowserCache = true;
    }
    const pipe = await tf.pipeline("feature-extraction", MODEL, {
      dtype: "q8",
      progress_callback: (p) => {
        try {
          onProgress && onProgress(p);
        } catch {
          /* progress is best-effort */
        }
      },
    });
    extractor = {
      kind: "minilm-l6-v2",
      async embed(texts) {
        const arr = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || "").slice(0, 2000));
        if (!arr.length) return [];
        const out = await pipe(arr, { pooling: "mean", normalize: true });
        return out.tolist();
      },
    };
    return extractor;
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null;
    failedAt = Date.now();
    throw e;
  }
}

export function embedderReady() {
  return Boolean(extractor);
}

/**
 * Backfill vectors for entries missing them. Batched; onProgress gets
 * {done, total}. Returns the number embedded. Callers persist afterwards.
 */
export async function backfillEmbeddings(entryList, onProgress) {
  const emb = await ensureEmbedder(onProgress);
  const missing = entryList.filter((e) => !e.deleted && !e.embedding && String(e.content || "").trim());
  const BATCH = 16;
  let done = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const vecs = await emb.embed(batch.map((e) => `${e.title || ""}\n${e.content}`));
    batch.forEach((e, j) => {
      if (vecs[j]) e.embedding = vecs[j];
    });
    done += batch.length;
    try {
      onProgress && onProgress({ status: "backfill", done, total: missing.length });
    } catch {
      /* ignore */
    }
  }
  return done;
}
