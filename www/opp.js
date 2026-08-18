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
const NOISE = /food truck|food vendor|vendor booth|sponsor us|job board|indeed\.com|linkedin\.com\/jobs/i;

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

export async function hunt(focus) {
  const q = encodeURIComponent(
    (focus || "festival visual artist VJ installation open call 2026").trim(),
  );
  const page = await httpGet(`https://lite.duckduckgo.com/lite/?q=${q}`);
  const found = [];
  const re = /<a[^>]+href="([^"]*?uddg=[^"]+)"[^>]*>(.*?)<\/a>/gs;
  let m;
  while ((m = re.exec(page.body))) {
    const uddg = /uddg=([^&"]+)/.exec(m[1]);
    const title = stripHtml(m[2]).trim();
    if (!uddg || !title) continue;
    const url = decodeURIComponent(uddg[1]);
    if (NOISE.test(`${title} ${url}`)) continue;
    if (found.some((x) => x.url === url)) continue;
    found.push({ title: title.slice(0, 160), url });
    if (found.length >= 8) break;
  }
  return found;
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
