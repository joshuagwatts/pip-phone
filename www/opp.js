import { httpGet } from "./net.js";
import { uid } from "./store.js";

const FB_RE = /FB_PUBLIC_LOAD_DATA_\s*=\s*(.*?);\s*<\/script>/s;
const TYPE_NAME = {
  0: "short",
  1: "paragraph",
  2: "choice",
  3: "dropdown",
  4: "checkboxes",
  5: "scale",
  7: "grid",
  8: "section",
  9: "date",
  10: "time",
  13: "file",
};
const GFORM = /https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+[^"'<\s]*|https:\/\/forms\.gle\/[A-Za-z0-9_-]+/gi;
const NOISE = /food truck|food vendor|vendor booth|sponsor us|job board|indeed\.com|linkedin\.com\/jobs|call to cooks|cook-off|visual studio/i;
const SKIP_HOST = /(?:^|\.)(?:facebook|instagram|tiktok|pinterest|youtube|twitter|x|linkedin|indeed|wikipedia|merriam-webster|visualstudio|bing|duckduckgo|reddit|thisiscolossal|memberful|nectarads|bsky|mastodon)\./i;
const GENERIC_TITLE = /^(apply for call|view call details|read more|learn more|home|click here)$/i;
const CALL_HINT = /open call|call for|application|apply|artist|installation|festival|residency|grant|exhibition|rfp|projection|vj|visual|immersive|mural|public art|viewform|fellowship|deadline/i;
const HUNT_QUERIES = [
  "festival visual artist VJ installation open call 2026 apply",
  "call for artists installation immersive 2026 application",
  "projection mapping public art open call 2026",
];

export function newOpp({ title, url, note }) {
  return {
    id: uid(),
    title: (title || "Untitled call").trim().slice(0, 160),
    url: (url || "").trim(),
    note: (note || "").trim(),
    status: "open",
    questions: [],
    answers: [],
    created_at: Date.now(),
  };
}

export function questionsFromPaste(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  const found = [];
  const seen = new Set();
  for (const line of lines) {
    const q = line.replace(/\s+/g, " ").replace(/^[*_]+|[*_]+$/g, "");
    if (q.length < 8 || q.length > 280) continue;
    const looks = /[?]/.test(q) || /^(describe|explain|why|how|who|what|tell|list|upload|attach|name|email|bio|statement)/i.test(q);
    if (!looks && lines.length > 8) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ prompt: q, q, type: "paragraph", hint: "", required: false });
    if (found.length >= 24) break;
  }
  return found;
}

export function parseGoogleForm(html) {
  const m = String(html || "").match(FB_RE);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const items = data && data[1] && data[1][1];
  if (!Array.isArray(items)) return [];
  let section = "";
  const out = [];
  for (const item of items) {
    if (!Array.isArray(item) || item.length < 4) continue;
    const prompt = String(item[1] || "").trim();
    const hint = item.length > 2 ? String(item[2] || "").trim() : "";
    const qtype = item[3];
    if (qtype === 8) {
      section = prompt;
      continue;
    }
    if (!prompt) continue;
    let options = [];
    let required = false;
    try {
      const block = item[4][0];
      const rawOpts = block[1];
      if (Array.isArray(rawOpts)) options = rawOpts.filter((o) => Array.isArray(o)).map((o) => String(o[0]));
      if (block.length > 2) required = Boolean(block[2]);
    } catch {
      /* ignore */
    }
    out.push({
      prompt,
      q: prompt,
      hint,
      type: TYPE_NAME[qtype] || `type-${qtype}`,
      options,
      required,
      section,
    });
  }
  return out;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{2,}/g, "\n");
}

export async function scrapeUrl(url) {
  const page = await httpGet(url);
  let questions = parseGoogleForm(page.body);
  let finalUrl = page.url || url;
  if (!questions.length) {
    const links = page.body.match(GFORM) || [];
    if (links[0]) {
      const form = await httpGet(links[0]);
      questions = parseGoogleForm(form.body);
      if (questions.length) finalUrl = form.url || links[0];
    }
  }
  if (!questions.length) questions = questionsFromPaste(stripHtml(page.body));
  const titleM = page.body.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return { url: finalUrl, title, questions, source: questions.length ? "page" : "empty" };
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanTitle(raw) {
  return decodeEntities(stripHtml(raw)).replace(/\s+/g, " ").trim();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function keepHit(title, url, { needHint = false } = {}) {
  const blob = `${title} ${url}`;
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (NOISE.test(blob)) return false;
  const host = hostOf(url);
  if (!host || SKIP_HOST.test(host) || host.includes("search.brave")) return false;
  if (/\.(css|js|png|jpe?g|gif|svg|woff2?|ico)(\?|$)/i.test(url)) return false;
  if (needHint && !CALL_HINT.test(blob)) return false;
  return Boolean(title);
}

function pushHit(found, title, url, opts) {
  const name = (title || "").slice(0, 160);
  const href = String(url || "").trim();
  if (!keepHit(name, href, opts)) return;
  if (found.some((x) => x.url === href)) return;
  found.push({ title: name, url: href, note: "hunted" });
}

function parseAnchors(html, found, opts = {}) {
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ""))) {
    let href = decodeEntities(m[1]).replace(/&amp;/g, "&");
    if (href.startsWith("//")) href = "https:" + href;
    if (href.includes("uddg=")) {
      const uddg = /uddg=([^&"]+)/.exec(href);
      if (uddg) {
        try { href = decodeURIComponent(uddg[1]); } catch { /* keep */ }
      }
    }
    const title = cleanTitle(m[2]);
    if (GENERIC_TITLE.test(title)) continue;
    pushHit(found, title, href, opts);
    if (found.length >= 16) break;
  }
}

function isBotWall(html) {
  const body = String(html || "");
  return /anomaly\.js|cc=botnet|Just a moment/i.test(body) && !/uddg=/.test(body);
}

async function huntPage(url, found, opts) {
  try {
    const page = await httpGet(url, 16000);
    if (page.status === 202 || isBotWall(page.body)) return;
    parseAnchors(page.body, found, opts);
  } catch {
    /* next source */
  }
}

async function huntArtcall(found) {
  try {
    const page = await httpGet("https://artcall.org/calls", 16000);
    const byUrl = new Map();
    const re = /<a[^>]+href="(https:\/\/(?!www\.)[a-z0-9-]+\.artcall\.org\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(page.body || ""))) {
      const url = m[1].replace(/\/$/, "");
      const title = cleanTitle(m[2]);
      if (!title || GENERIC_TITLE.test(title)) continue;
      if (/cooks|culinary|food truck/i.test(title)) continue;
      const prev = byUrl.get(url) || "";
      if (title.length > prev.length) byUrl.set(url, title);
    }
    for (const [url, title] of byUrl) pushHit(found, title, url, { needHint: false });
  } catch {
    /* brave still runs */
  }
}

async function huntColossal(found) {
  try {
    const cat = await httpGet("https://www.thisiscolossal.com/category/opportunities/", 16000);
    const m = /href="(https:\/\/www\.thisiscolossal\.com\/\d{4}\/\d{2}\/[^"]+)"/i.exec(cat.body || "");
    const article = m
      ? m[1]
      : "https://www.thisiscolossal.com/2026/07/august-2026-open-calls-grants-residencies/";
    await huntPage(article, found, { needHint: true });
  } catch {
    /* artcall still runs */
  }
}

export async function hunt(focus) {
  const found = [];
  const extra = (focus || "").trim();
  const queries = extra ? [extra, ...HUNT_QUERIES.slice(0, 2)] : HUNT_QUERIES;
  await huntArtcall(found);
  await huntColossal(found);
  await Promise.all(
    queries.map((q) =>
      huntPage(`https://search.brave.com/search?q=${encodeURIComponent(q)}`, found, { needHint: true }),
    ),
  );
  if (found.length < 4) {
    await Promise.all(
      queries.slice(0, 2).map((q) =>
        huntPage(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, found, { needHint: true }),
      ),
    );
  }
  return found.slice(0, 12);
}

export function mergeDraft(opp, drafted) {
  const answers = drafted.map((row, i) => ({
    q: row.q || row.prompt || (opp.questions[i] && opp.questions[i].prompt) || "",
    prompt: row.prompt || row.q || "",
    type: row.type || "paragraph",
    hint: row.hint || "",
    required: !!row.required,
    a: row.a || "",
    a5: row.a5 || "",
  }));
  return { ...opp, answers, questions: opp.questions.length ? opp.questions : drafted };
}
