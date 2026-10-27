/** PIP Codes — GitHub API client (Phase 5).
 *
 * Fetch-based, OpenAI-free, plain REST against https://api.github.com with
 * the operator's fine-grained PAT from the secrets vault (field "github").
 * The token is read via getSecret at call time and used ONLY as the
 * Authorization header — it never enters a return value, an error string,
 * or a ledger entry.
 *
 * Writes go through the Git Data API (blobs → tree → commit → ref PATCH),
 * fast-forward only: the ref update never sends force, so if the branch
 * moved since our read, GitHub rejects the PATCH and we surface a clean
 * "branch moved — re-read and retry" instead of overwriting anyone.
 *
 * Consent ledger: ONE entry per logical operation (this module's exported
 * operations), job "code", provider "github". Reads are inbound data, but
 * they are still phone→GitHub sends of the repo coordinates, so they log
 * too — with tokensOut 0 (nothing of Joshua's content left the phone on a
 * read; tokensIn estimates what came back). A commit logs tokensOut ≈ the
 * content it pushed. Internal reads made while preparing a commit pass
 * { log: false } so the whole commit stays ONE entry.
 */

import { getSecret } from "./secrets.js";
import { appendLedger, estimateTokens } from "./ledger.js";

const GH_API = "https://api.github.com";
const NO_TOKEN_MSG = "no GitHub token — paste one in DATA";

/* ------------------------------------------------------------------ auth */

export function ghToken() {
  try {
    return String(getSecret("github") || "").trim();
  } catch {
    return "";
  }
}

export function ghHasToken() {
  return Boolean(ghToken());
}

function noTokenError() {
  const err = new Error(NO_TOKEN_MSG);
  err.code = "no-token";
  return err;
}

export function isNoTokenError(e) {
  return Boolean(e && (e.code === "no-token" || String(e.message || e) === NO_TOKEN_MSG));
}

/* ------------------------------------------------------------- transport */

async function ghApi(method, path, body, { timeoutMs = 30000 } = {}) {
  const token = ghToken();
  if (!token) throw noTokenError();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(GH_API + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Pip",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const msg = String((e && e.message) || e || "fetch failed");
    throw new Error(/abort/i.test(msg) ? "github request timed out" : `github unreachable — ${msg.slice(0, 100)}`);
  } finally {
    clearTimeout(t);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // GitHub's own message only — never headers, never the token.
    const detail = (data && typeof data.message === "string" && data.message) || `http ${res.status}`;
    const err = new Error(`GitHub ${res.status}: ${String(detail).slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------------------------------------------------------- ledger */

function logOp(why, { tokensIn = 0, tokensOut = 0 } = {}) {
  try {
    appendLedger({ provider: "github", model: "", job: "code", scope: [], tokensIn, tokensOut, why });
  } catch {
    /* the ledger is best-effort — never a blocker */
  }
}

/* ---------------------------------------------------------------- base64 */

function b64EncodeText(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64DecodeText(b64) {
  const bin = atob(String(b64 || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const encPath = (p) => String(p || "").split("/").map(encodeURIComponent).join("/");
const encSeg = (s) => encodeURIComponent(String(s || ""));

/* ------------------------------------------------------------- read ops */

/** His own repos, most recently pushed first. */
export async function ghListRepos({ log = true } = {}) {
  const data = await ghApi("GET", "/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner");
  const repos = (Array.isArray(data) ? data : []).map((r) => ({
    full_name: String(r.full_name || ""),
    owner: String((r.owner && r.owner.login) || ""),
    name: String(r.name || ""),
    default_branch: String(r.default_branch || "main"),
    private: Boolean(r.private),
    pushed_at: String(r.pushed_at || ""),
    description: String(r.description || ""),
  }));
  if (log) logOp("github_repos — list your repos", { tokensIn: estimateTokens(JSON.stringify(repos)) });
  return repos;
}

export async function ghGetRepo(owner, repo, { log = true } = {}) {
  const data = await ghApi("GET", `/repos/${encSeg(owner)}/${encSeg(repo)}`);
  const out = {
    full_name: String(data.full_name || `${owner}/${repo}`),
    owner: String((data.owner && data.owner.login) || owner),
    name: String(data.name || repo),
    default_branch: String(data.default_branch || "main"),
    private: Boolean(data.private),
    description: String(data.description || ""),
    html_url: String(data.html_url || ""),
  };
  if (log) logOp(`github_repo ${out.full_name}`, { tokensIn: estimateTokens(JSON.stringify(out)) });
  return out;
}

/**
 * Read one file via the contents API. Returns { path, text, sha, size } —
 * text is null (with tooLarge set) when GitHub won't inline the content.
 * A directory path returns { path, dir: [{name, path, type}] }.
 * Throws with err.status 404 when the path doesn't exist.
 */
export async function ghReadFile(owner, repo, path, ref, { log = true } = {}) {
  const q = ref ? `?ref=${encodeURIComponent(String(ref))}` : "";
  const data = await ghApi("GET", `/repos/${encSeg(owner)}/${encSeg(repo)}/contents/${encPath(path)}${q}`);
  if (Array.isArray(data)) {
    const dir = data.map((e) => ({ name: String(e.name || ""), path: String(e.path || ""), type: String(e.type || "") }));
    if (log) logOp(`github_read ${owner}/${repo}:${path} (directory)`, { tokensIn: estimateTokens(JSON.stringify(dir)) });
    return { path: String(path), dir };
  }
  const out = { path: String(data.path || path), sha: String(data.sha || ""), size: Number(data.size) || 0, text: null, tooLarge: false };
  if (data.type === "file" && data.encoding === "base64" && typeof data.content === "string") {
    out.text = b64DecodeText(data.content);
  } else {
    out.tooLarge = true; // encoding "none" — GitHub won't inline files >1MB
  }
  if (log) {
    logOp(`github_read ${owner}/${repo}:${out.path}`, { tokensIn: estimateTokens(out.text || "") });
  }
  return out;
}

/** Recursive path listing for a ref (branch name or commit sha). Capped. */
export async function ghListTree(owner, repo, ref, { log = true } = {}) {
  let treeSha = String(ref || "");
  if (!/^[0-9a-f]{40}$/i.test(treeSha)) {
    const branch = treeSha || (await ghGetRepo(owner, repo, { log: false })).default_branch;
    const refData = await ghApi("GET", `/repos/${encSeg(owner)}/${encSeg(repo)}/git/ref/heads/${String(branch).split("/").map(encodeURIComponent).join("/")}`);
    const commit = await ghApi("GET", `/repos/${encSeg(owner)}/${encSeg(repo)}/git/commits/${refData.object.sha}`);
    treeSha = String(commit.tree.sha);
  }
  const data = await ghApi("GET", `/repos/${encSeg(owner)}/${encSeg(repo)}/git/trees/${treeSha}?recursive=1`);
  const all = Array.isArray(data.tree) ? data.tree : [];
  const CAP = 500;
  const entries = all.slice(0, CAP).map((e) => ({ path: String(e.path || ""), type: String(e.type || "") }));
  const out = { entries, truncated: Boolean(data.truncated) || all.length > CAP, total: all.length };
  if (log) logOp(`github_tree ${owner}/${repo} (${entries.length} paths)`, { tokensIn: estimateTokens(JSON.stringify(entries)) });
  return out;
}

/* ------------------------------------------------------------ line diff */

/**
 * Added/removed line counts between two texts (LCS length, two-row DP).
 * Falls back to whole-file counts when the DP would be enormous.
 */
export function ghLineDiff(oldText, newText) {
  const a = oldText ? String(oldText).split("\n") : [];
  const b = newText ? String(newText).split("\n") : [];
  if (a.length * b.length > 4_000_000) {
    return { added: b.length, removed: a.length, approx: true };
  }
  let prev = new Array(b.length + 1).fill(0);
  let cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  const lcs = prev[b.length];
  return { added: b.length - lcs, removed: a.length - lcs, approx: false };
}

/* ------------------------------------------------------------ write op */

/**
 * Commit files to a branch via the Git Data API, fast-forward only:
 *   GET ref → GET commit (tree) → POST blobs → POST tree (base_tree)
 *   → POST commit (parents=[head]) → PATCH ref (force never sent).
 * files: [{ path, content }] · deletes: [path] (tree entries with sha null).
 * Returns { sha, htmlUrl, branch, changed, deleted }.
 */
export async function ghCommitFiles(owner, repo, branch, message, files, deletes = []) {
  const o = encSeg(owner);
  const r = encSeg(repo);
  const br = String(branch || "main");
  const brPath = br.split("/").map(encodeURIComponent).join("/");
  const upserts = Array.isArray(files) ? files : [];
  const dels = Array.isArray(deletes) ? deletes : [];

  const refData = await ghApi("GET", `/repos/${o}/${r}/git/ref/heads/${brPath}`);
  const headSha = String(refData.object.sha);
  const headCommit = await ghApi("GET", `/repos/${o}/${r}/git/commits/${headSha}`);
  const baseTree = String(headCommit.tree.sha);

  const treeEntries = [];
  let pushedChars = String(message || "").length;
  for (const f of upserts) {
    const content = String(f.content ?? "");
    pushedChars += content.length;
    const blob = await ghApi("POST", `/repos/${o}/${r}/git/blobs`, { content: b64EncodeText(content), encoding: "base64" });
    treeEntries.push({ path: String(f.path), mode: "100644", type: "blob", sha: String(blob.sha) });
  }
  for (const p of dels) {
    treeEntries.push({ path: String(p), mode: "100644", type: "blob", sha: null });
  }

  const tree = await ghApi("POST", `/repos/${o}/${r}/git/trees`, { base_tree: baseTree, tree: treeEntries });
  const commit = await ghApi("POST", `/repos/${o}/${r}/git/commits`, {
    message: String(message || ""),
    tree: String(tree.sha),
    parents: [headSha],
  });

  try {
    await ghApi("PATCH", `/repos/${o}/${r}/git/refs/heads/${brPath}`, { sha: String(commit.sha) });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if ((e && (e.status === 422 || e.status === 409)) || /fast.?forward|reference update|not a fast/i.test(msg)) {
      throw new Error("branch moved — re-read and retry (nothing was force-pushed; your commit was not applied)");
    }
    throw e;
  }

  logOp(`github_commit ${owner}/${repo}@${br} — ${String(message || "").split("\n")[0].slice(0, 80)}`, {
    tokensOut: Math.ceil(pushedChars / 4),
  });
  return {
    sha: String(commit.sha),
    htmlUrl: String(commit.html_url || ""),
    branch: br,
    changed: upserts.length,
    deleted: dels.length,
  };
}
