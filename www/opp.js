import { httpGet } from "./net.js";
import { uid } from "./store.js";
import { classify, placeRings, TYPE_QUERIES } from "./kind.js";
import { pickLink } from "./digest.js";

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
const CALL_HINT = /open call|call for|application|apply|artist|installation|festival|residency|grant|exhibition|rfp|rfq|projection|vj|visual|immersive|mural|public art|viewform|fellowship|deadline|musician|dj |hiring|career|job/i;
const WAKAAN_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfxRawLshOJjbJuowOCzWFymRE1DEpkViQxh4kN3roNfpysPQ/viewform";
const WAKAAN_QUESTIONS = [
  { prompt: "Legal First Name", q: "Legal First Name", type: "short", hint: "", required: true, section: "Contact Information", options: [] },
  { prompt: "Legal Last Name", q: "Legal Last Name", type: "short", hint: "", required: true, section: "Contact Information", options: [] },
  { prompt: "Artist Name / Moniker / Business Name", q: "Artist Name / Moniker / Business Name", type: "short", hint: "", required: true, section: "Contact Information", options: [] },
  { prompt: "Phone #", q: "Phone #", type: "short", hint: "", required: true, section: "Contact Information", options: [] },
  { prompt: "Email", q: "Email", type: "short", hint: "", required: true, section: "Contact Information", options: [] },
  { prompt: "Artist Bio & Experience", q: "Artist Bio & Experience", type: "paragraph", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "Description of Installation (general overview, specifics will be answered below)", q: "Description of Installation (general overview, specifics will be answered below)", type: "paragraph", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "Description of Installation", q: "Description of Installation", type: "file", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "Budget Request", q: "Budget Request", type: "paragraph", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "Team Size", q: "Team Size", type: "paragraph", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "What is the footprint of your installation? (Approx. how much space you will need.)", q: "What is the footprint of your installation? (Approx. how much space you will need.)", type: "paragraph", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "How much power does your installation pull?", q: "How much power does your installation pull?", type: "paragraph", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "Is there anything else about your Installation that needs to be acknowledged?", q: "Is there anything else about your Installation that needs to be acknowledged?", type: "paragraph", hint: "", required: false, section: "Installation Information", options: [] },
  { prompt: "Is there anything else you require that would like the Wakaan team to know?", q: "Is there anything else you require that would like the Wakaan team to know?", type: "paragraph", hint: "", required: false, section: "Other Information", options: [] },
];
const PINNED = [
  {
    title: "Wakaan Music Festival 2026 application",
    url: WAKAAN_URL,
    note: "Festival visual / art application. Oct 1-3 2026, Mulberry Mountain, Ozark AR.",
    questions: WAKAAN_QUESTIONS,
  },
];

export function newOpp({ title, url, note, questions, kind }) {
  const qs = Array.isArray(questions) ? questions : [];
  const hit = kind || classify(title, url, qs).id;
  return {
    id: uid(),
    title: (title || "Untitled call").trim().slice(0, 160),
    url: (url || "").trim(),
    note: (note || "").trim(),
    status: "open",
    kind: hit,
    questions: qs,
    answers: qs.map((q) => ({ q: q.prompt || q.q || "", a: "", a5: "" })),
    created_at: Date.now(),
  };
}

const MATERIAL_ASKS = [
  [/artist statement|statement of (practice|work|intent)/i, "Artist statement"],
  [/artist bio|biography/i, "Artist bio"],
  [/\bcv\b|resume|curriculum vitae/i, "CV / resume"],
  [/portfolio|work samples|images of (your )?work|support images/i, "Work samples / portfolio"],
  [/project (description|proposal)|describe (your|the) (work|project|installation|piece)/i, "Project description"],
  [/letter of (interest|intent)|why (this|you are applying)/i, "Why this call"],
  [/\bbudget\b/i, "Budget"],
  [/timeline|production schedule/i, "Timeline"],
  [/technical (rider|requirements)|power draw|footprint/i, "Technical / site needs"],
];

function qitem(prompt, type, hint) {
  const p = String(prompt || "").replace(/\s+/g, " ").trim();
  return { prompt: p, q: p, type: type || "paragraph", hint: hint || "", required: false, section: "", options: [] };
}

function mergeQuestions(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const row of list || []) {
      const prompt = String(row.prompt || row.q || "").replace(/\s+/g, " ").trim();
      const key = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!prompt || key.length < 4 || seen.has(key)) continue;
      if (/search|subscribe|password|cookie|captcha|login|sign in|newsletter/i.test(prompt)) continue;
      seen.add(key);
      out.push({ ...row, prompt, q: prompt });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

export function questionsFromPaste(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  const found = [];
  const seen = new Set();
  for (const line of lines) {
    const q = line.replace(/\s+/g, " ").replace(/^[*_]+|[*_]+$/g, "");
    if (q.length < 6 || q.length > 280) continue;
    const looks =
      /[?]/.test(q) ||
      /describe|explain|why |how |tell us|upload|attach|artist (bio|statement)|statement|portfolio|work samples|project (description|proposal)|cover letter|resume|\bcv\b|budget|timeline|eligibility/i.test(q);
    if (!looks) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(qitem(q, /upload|attach|image|pdf/i.test(q) ? "file" : "paragraph"));
    if (found.length >= 32) break;
  }
  return found;
}

function parseFbBlob(raw) {
  if (!raw) return [];
  let text = String(raw).trim();
  try {
    return parseGoogleItems(JSON.parse(text));
  } catch {
    /* trim to last bracket */
  }
  const end = text.lastIndexOf("]");
  if (end > 8) {
    try {
      return parseGoogleItems(JSON.parse(text.slice(0, end + 1)));
    } catch {
      return [];
    }
  }
  return [];
}

function parseGoogleItems(data) {
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

export function parseGoogleForm(html) {
  const blob = String(html || "");
  const patterns = [
    /FB_PUBLIC_LOAD_DATA_\s*=\s*(.*?);\s*<\/script>/s,
    /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\])\s*<\/script>/,
    /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*)/,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (!m) continue;
    const parsed = parseFbBlob(m[1]);
    if (parsed.length) return parsed;
  }
  return questionsFromGoogleHtml(blob);
}

function questionsFromGoogleHtml(html) {
  const found = [];
  const re = /class="[^"]*(?:M7eMe|freebirdFormviewerComponentsQuestionBaseTitle|Qr7Oae)[^"]*"[^>]*>([\s\S]*?)<\//gi;
  let m;
  while ((m = re.exec(html || ""))) {
    const q = cleanTitle(m[1]);
    if (q.length >= 2 && q.length <= 240) found.push(qitem(q, "paragraph"));
  }
  return found;
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

export async function scrapeUrl(url, { strict } = {}) {
  const seen = new Set();
  return walkPage(url, 0, seen, strict);
}

function pageQuestions(html, { strict } = {}) {
  const gform = parseGoogleForm(html);
  const fields = questionsFromFields(html);
  const paste = strict ? [] : questionsFromPaste(stripHtml(html));
  const guide = strict ? [] : questionsFromGuidelines(html);
  return mergeQuestions(gform, fields, paste, guide);
}

async function walkPage(url, depth, seen, strict) {
  const known = knownForm(url);
  if (!url || seen.has(url) || depth > 3) {
    return known
      ? { url: known.url, title: known.title, questions: known.questions, source: "known" }
      : { url, title: "", questions: [], source: "skip" };
  }
  seen.add(url);
  try {
    const page = await httpGet(url, 18000);
    const html = page.body || "";
    const finalUrl = page.url || url;
    let questions = pageQuestions(html, { strict });
    if (!questions.length) {
      const g = (html.match(GFORM) || [])[0];
      if (g && !seen.has(g)) {
        const form = await walkPage(g, depth + 1, seen, false);
        if (form.questions && form.questions.length) return form;
      }
    }
    const titleM = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleM ? titleM[1].replace(/\s+/g, " ").trim().slice(0, 120) : "";
    let best = {
      url: finalUrl,
      title,
      questions,
      source: questions.length ? "page" : "empty",
    };
    if (questions.length >= 4) return best;
    if (depth < 3) {
      const hrefs = [...applyLinks(html, finalUrl), ...guessApply(finalUrl)];
      for (const href of hrefs.slice(0, 8)) {
        if (seen.has(href)) continue;
        const child = await walkPage(href, depth + 1, seen, false);
        const merged = mergeQuestions(best.questions, child.questions || []);
        if (merged.length > (best.questions || []).length) {
          best = {
            url: (child.questions || []).length >= (best.questions || []).length ? child.url || href : best.url,
            title: child.title || best.title,
            questions: merged,
            source: child.source || best.source,
          };
        }
        if ((best.questions || []).length >= 6) return best;
      }
    }
    if (!(best.questions || []).length && known) {
      return { url: known.url, title: known.title || title, questions: known.questions, source: "known" };
    }
    if (!(best.questions || []).length) {
      const guide = questionsFromGuidelines(html);
      if (guide.length) best = { ...best, questions: guide, source: "guidelines" };
    }
    return best;
  } catch (e) {
    if (known) return { url: known.url, title: known.title, questions: known.questions, source: "known" };
    if (depth === 0) throw e;
    return { url, title: "", questions: [], source: "fail" };
  }
}

function absUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function guessApply(url) {
  const extra = [];
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    const host = u.hostname.toLowerCase();
    if (host.endsWith("artcall.org") && !/\/apply$/i.test(path)) extra.push(`${u.origin}${path}/apply`);
    if (host.includes("submittable.com") && !/\/submit/i.test(path)) extra.push(`${u.origin}${path}/submit`);
    if (host.includes("callforentry.org") && !/entry/i.test(path)) extra.push(`${u.origin}${path}/entry`);
  } catch {
    /* ignore */
  }
  return extra;
}

function applyLinks(html, base) {
  const out = [];
  const push = (href) => {
    if (!href || out.includes(href)) return;
    if (/login|logout|signup|cart|privacy|terms|facebook|instagram|twitter/i.test(href)) return;
    out.push(href);
  };
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ""))) {
    const href = absUrl(base, decodeEntities(m[1]));
    const text = `${cleanTitle(m[2])} ${href}`;
    if (!/apply|submit|entry|application|viewform|forms\.gle|jotform|typeform|submittable|callforentry|zapplication|caf[eé]|form|guidelines/i.test(text)) continue;
    push(href);
  }
  const ifr = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  while ((m = ifr.exec(html || ""))) {
    const href = absUrl(base, decodeEntities(m[1]));
    if (/forms\.google|forms\.gle|jotform|typeform|submittable|viewform/i.test(href)) push(href);
  }
  return out;
}

function questionsFromFields(html) {
  const found = [];
  const add = (raw) => {
    const q = cleanTitle(raw);
    if (q.length < 3 || q.length > 240) return;
    found.push(qitem(q, "paragraph"));
  };
  const patterns = [
    /<label\b[^>]*>([\s\S]*?)<\/label>/gi,
    /<legend\b[^>]*>([\s\S]*?)<\/legend>/gi,
    /\baria-label=["']([^"']{3,240})["']/gi,
    /\bplaceholder=["']([^"']{8,240})["']/gi,
    /class=["'][^"']*(?:form-label|wpforms-field-label|gfield_label|nf-label|elementor-field-label)[^"']*["'][^>]*>([\s\S]*?)<\//gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html || ""))) add(m[1]);
  }
  return mergeQuestions(found);
}

function questionsFromGuidelines(html) {
  const text = stripHtml(html);
  const found = [];
  const blob = text.toLowerCase();
  if (!/apply|application|submit|open call|call for|eligibility|guidelines/i.test(blob)) return [];
  for (const [rx, prompt] of MATERIAL_ASKS) {
    if (rx.test(blob)) found.push(qitem(prompt, "paragraph", "From the call guidelines"));
  }
  const section = text.match(/(?:how to apply|application materials|what to submit|submission guidelines|to apply)[:\s]+([\s\S]{40,1800})/i);
  if (section) found.push(...questionsFromPaste(section[1]));
  return mergeQuestions(found);
}

function questionsFromLabels(html) {
  return questionsFromFields(html);
}

function knownForm(url) {
  const id = /\/forms\/d\/e\/([^/]+)/.exec(url || "");
  if (id && id[1] === "1FAIpQLSfxRawLshOJjbJuowOCzWFymRE1DEpkViQxh4kN3roNfpysPQ") return PINNED[0];
  if (/wakaan/i.test(url || "")) return PINNED[0];
  return null;
}

function stitch(parts) {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join("\n\n");
}

export function answerFromKit(question, kit, title, qtype, kind) {
  const q = String(question || "").toLowerCase();
  const k = kit || {};
  if (qtype === "file") return "FILE UPLOAD — attach in the live form. Pip cannot put files in this field.";
  const name = String(k.full_name || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0] || "";
  const last = parts.slice(1).join(" ");
  if (/legal first|first name/.test(q)) return first;
  if (/legal last|last name/.test(q)) return last;
  if (/e-?mail/.test(q)) return k.email || "";
  if (/phone|#/.test(q) && !/email/.test(q)) return k.phone || "";
  if (/artist name|moniker|business name|stage name|project name/.test(q)) return k.artist_name || name;
  if (/full name|legal name/.test(q) && !/artist/.test(q)) return name || k.artist_name || "";
  if (/\bname\b/.test(q) && q.length < 24) return name || k.artist_name || "";
  if (/city|based|location|hometown|where do you live/.test(q)) {
    return [k.city, k.state, k.country].filter(Boolean).join(", ");
  }
  const picked = pickLink(question, k);
  if (picked !== null) return picked;
  if (/\b(resume|cv|curriculum)\b/.test(q) && !/cover/.test(q)) {
    return (k.resume || stitch([k.one_liner, k.bio_long || k.bio_short, k.materials])).trim();
  }
  if (/artist bio|bio & experience|artist statement|about yourself|tell us about/.test(q)) {
    const bio = stitch([k.bio_long || k.bio_short, k.origin, k.materials, k.one_liner]);
    if (kind === "job") return stitch([k.one_liner, k.bio_long || k.bio_short, k.materials]);
    if (kind === "music") {
      return stitch([
        bio,
        "Visual / live-visuals first. Music is in the toolkit — not a touring-DJ packet.",
      ]);
    }
    if (kind === "festival_artist") {
      const mural = /mural|paint|wall/i.test(k.materials || "") ? k.materials : stitch([k.materials, "Live visuals and projection more than brush-mural. I'll say that on the wall."]);
      return stitch([k.bio_long || k.bio_short, mural]);
    }
    if (kind === "city_art") return stitch([k.bio_long || k.bio_short, k.materials, "Civic work: site, public, durable."]);
    if (kind === "festival_install" || /wakaan/i.test(title || "")) {
      return stitch([bio, k.resume ? String(k.resume).slice(0, 900) : ""]);
    }
    return bio;
  }
  if (/began|beginning|started|origin|how did you/.test(q)) return k.origin || k.bio_short || "";
  if (/description of installation|what do you make|medium|materials|practice|describe your work|the work/.test(q)) {
    const piece = stitch([k.materials, k.one_liner, k.bio_short]);
    if (kind === "festival_artist") return piece || k.bio_short || "";
    if (kind === "music") return stitch([k.materials, "Sound/Ableton if it's in KIT. Otherwise the live-visuals rig is the honest answer."]);
    return piece;
  }
  if (/why this|why are you applying|why do you want|why apply|why our/.test(q)) {
    const why = (k.why_festivals || k.bio_short || k.one_liner || "").trim();
    if (!why) return "";
    if (kind === "job") return stitch([why, `This role at ${title || "this studio"} is the work I already do.`]);
    if (kind === "city_art") return stitch([why, `${title || "This site"} is a public room for that work.`]);
    if (kind === "music") return stitch([why, `${title || "This stage"} if the music call is real. Visuals come with me.`]);
    return `${why}\n\n${title || "This call"} is a room for that work.`;
  }
  if (/one-liner|tagline|one liner/.test(q)) return k.one_liner || "";
  if (/footprint|how much space|dimensions/.test(q)) {
    if (kind === "job") return "";
    const hit = String(k.materials || k.origin || "").match(/.{0,40}(footprint|ft|feet|meter|space|x\d).{0,40}/i);
    return hit ? hit[0].trim() : "";
  }
  if (/budget/.test(q)) {
    if (kind === "job" || kind === "music") return "";
    const hit = String(k.materials || k.origin || k.bio_long || "").match(/\$[\d,]+|\bbudget\b.{0,40}/i);
    return hit ? hit[0].trim() : "";
  }
  if (/team size|crew/.test(q) && kind !== "job") {
    const hit = String(k.materials || k.origin || "").match(/\b(\d+|solo|two|three|small crew)\b.{0,30}(people|crew|team|person)?/i);
    return hit ? hit[0].trim() : "";
  }
  if (/power/.test(q) && kind !== "job" && kind !== "music") {
    const hit = String(k.materials || k.origin || "").match(/.{0,20}(\d+\s?amp|\d+\s?watt|power|circuit).{0,30}/i);
    return hit ? hit[0].trim() : "";
  }
  if (/anything else|acknowledged|team to know|wakaan team/.test(q)) {
    return stitch([k.one_liner, [k.city, k.state, k.country].filter(Boolean).join(", "), k.links]);
  }
  return "";
}

export function suggestAnswers(questions, kit, title, kind) {
  const hit = kind || classify(title, "", questions).id;
  return (questions || []).map((q) => {
    const prompt = q.prompt || q.q || "";
    const a = q.a || answerFromKit(prompt, kit, title, q.type || "", hit);
    return { ...q, q: prompt, prompt, a, a5: q.a5 || "", kind: hit };
  });
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
  found.push({ title: name, url: href, note: "hunted", kind: classify(name, href).id });
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
    if (found.length >= 48) break;
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

export async function hunt(focus, { city, state, country, onProgress } = {}) {
  const found = PINNED.map((p) => ({
    title: p.title,
    url: p.url,
    note: p.note,
    questions: p.questions,
    kind: "festival_install",
  }));
  const extra = (focus || "").trim();
  if (onProgress) onProgress("HUNT BOARDS");
  await huntArtcall(found);
  await huntColossal(found);
  const rings = placeRings({ city, state, country });
  for (const place of rings) {
    if (found.length >= 40) break;
    if (onProgress) onProgress(`HUNT ${place.toUpperCase()}`);
    const queries = TYPE_QUERIES.map(([, q]) => `${place} ${q} 2026`);
    if (extra) queries.unshift(`${place} ${extra} 2026`);
    await Promise.all(
      queries.map((q) =>
        huntPage(`https://search.brave.com/search?q=${encodeURIComponent(q)}`, found, { needHint: true }),
      ),
    );
  }
  return found.slice(0, 40);
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
