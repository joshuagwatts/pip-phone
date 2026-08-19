import { SHADERS, SHADER_ORDER } from "./shaders.js";

export const STEM_TAGS = {
  water: ["water", "drink", "eat", "lunch", "glass", "thirst", "ocean", "caustic", "aqua", "sip", "hydrate"],
  face: ["face", "splash", "wash", "cold", "rain", "wake", "skin"],
  mint: ["mint", "teeth", "fresh", "clean", "sparkle", "ice", "proceed"],
  breath: ["breath", "breathe", "patient", "patience", "inward", "audit", "honest", "still", "slow", "inhale", "exhale", "pause", "deep"],
  move: ["move", "going", "after", "body", "grind", "muscle", "run", "push", "act", "do", "next", "work"],
  sendoff: ["roses", "shine", "worth", "dream", "light", "love", "gold", "sun", "inspire", "awesome", "sunrise"],
  tunnel: ["tunnel", "speed", "hyperspace", "focus", "forward", "warp"],
  "bass-pulse": ["bass", "pulse", "kick", "music", "dance", "beat"],
};

const STANCES = [
  { id: "lunch", lo: 12, hi: 14, label: "LUNCH", beats: [
    { shot: "Smell the roses.", kind: "inspire", vibe: "sendoff" },
    { shot: "Feed the body. Then the dream.", kind: "audit", vibe: "breath" },
    { shot: "Eat like you matter.", kind: "act", vibe: "water" },
  ]},
  { id: "grind", lo: 14, hi: 16, label: "KEEP GOING", beats: [
    { shot: "The days compound.", kind: "inspire", vibe: "sendoff" },
    { shot: "Don't wish it easier. Wish you better.", kind: "audit", vibe: "breath" },
    { shot: "One more honest hour.", kind: "act", vibe: "move" },
  ]},
  { id: "still", lo: 16, hi: 18, label: "PATIENCE", beats: [
    { shot: "Happy little progress.", kind: "inspire", vibe: "sendoff" },
    { shot: "Slow is how trees grow.", kind: "audit", vibe: "breath" },
    { shot: "Breathe. Then proceed.", kind: "act", vibe: "mint" },
  ]},
  { id: "push", lo: 18, hi: 20, label: "THE WORK", beats: [
    { shot: "Know your worth.", kind: "inspire", vibe: "sendoff" },
    { shot: "Make it useful. Make it seen.", kind: "audit", vibe: "breath" },
    { shot: "Stay with the thing in front of you.", kind: "act", vibe: "move" },
  ]},
  { id: "dusk", lo: 20, hi: 22, label: "WIND DOWN", beats: [
    { shot: "Shine on.", kind: "inspire", vibe: "sendoff" },
    { shot: "You showed up. That's a life.", kind: "audit", vibe: "breath" },
    { shot: "Go smell the roses.", kind: "act", vibe: "sendoff" },
  ]},
];

const FLOW = { id: "flow", lo: 0, hi: 24, label: "PIP", beats: [] };

const HINTS = {
  inspire: "TAP WHEN IT LANDS",
  audit: "TAP WHEN YOU'VE LOOKED",
  act: "TAP WHEN YOU'VE MOVED",
  pip: "PIP · STILL WITH YOU",
};

const POOL = {
  lunch: ["Eat. The work will wait.", "A good meal is part of the plan.", "Don't skip the simple things.", "Feed yourself like you matter.", "Fuel first. Then Holowatts."],
  grind: ["Success is a few simple disciplines.", "You don't need more information.", "Volume. Then skill. Then volume.", "Work a little on yourself too.", "Document the work. The rest is noise."],
  still: ["Patience is a skill.", "Slow is how trees grow.", "Happy little accidents.", "There's no rush in the important stuff.", "Macro patience. Micro care."],
  push: ["The work is the love.", "You don't need a speech. You need a step.", "Make it useful. Make it seen.", "Give more than you take today.", "Stay with the thing in front of you."],
  dusk: ["You showed up. That's the whole day.", "Let it be enough.", "Rest is part of the discipline.", "Gratitude looks good on you.", "Tomorrow gets a well-fed you."],
  flow: ["You can do this.", "I'm still here. No hurry.", "Keep your word to yourself.", "Plant something today.", "Be grateful you're in the room."],
  any: [
    "You can do this.",
    "Don't wish it easier. Wish you better.",
    "Talent is a pursued interest.",
    "No mistakes. Just happy accidents.",
    "A little every day becomes a life.",
    "Simple. Not easy. Still simple.",
    "If it's useful, it's enough.",
    "You're allowed to enjoy this.",
    "The garden doesn't shout. It grows.",
    "Keep your word to yourself.",
    "The days compound. Be kind to them.",
    "Make something they can walk into.",
    "Your taste is the strategy.",
    "Ship the honest version.",
    "The live room is the point.",
    "Be so good they have to look.",
  ],
};

const KEY = "pip.phone.motiv.v1";
const HOT = /\b(unleash|harness|beast|devour|crush|dominate|savage|warrior|lock in|kill it|get after)\b/i;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || raw.date !== today()) return { date: today(), beats: {}, radio: {}, recent: [] };
    return raw;
  } catch {
    return { date: today(), beats: {}, radio: {}, recent: [] };
  }
}

function save(st) {
  localStorage.setItem(KEY, JSON.stringify(st));
}

function stance() {
  const h = new Date().getHours();
  return STANCES.find((s) => s.lo <= h && h < s.hi) || FLOW;
}

export function pickShader(text, kind = "", avoid = "") {
  const ordered = String(text || "").toLowerCase().match(/[a-z][a-z0-9_-]{1,24}/g) || [];
  const words = new Set(ordered);
  const bias = { inspire: ["sendoff"], audit: ["breath"], act: ["move", "water"], pip: ["sendoff", "move", "breath"] }[kind] || [];
  let best = SHADER_ORDER[0];
  let bestN = -1;
  const ranked = [];
  for (const stem of SHADER_ORDER) {
    const tags = new Set([stem, ...(STEM_TAGS[stem] || [])]);
    let score = 0;
    ordered.slice(0, 10).forEach((w, i) => {
      if (tags.has(w)) score += i < 2 ? 3.2 : 2;
    });
    if (words.has(stem)) score += 4;
    if (bias.includes(stem)) score += 0.8;
    ranked.push([score, stem]);
    if (score > bestN) {
      bestN = score;
      best = stem;
    }
  }
  ranked.sort((a, b) => b[0] - a[0]);
  if (avoid && SHADER_ORDER.length > 1) {
    const hits = ranked.filter(([sc, st]) => sc >= 2 && st !== avoid);
    if (hits.length) best = hits[0][1];
    else {
      const i = SHADER_ORDER.indexOf(avoid);
      best = SHADER_ORDER[(i + 1) % SHADER_ORDER.length];
    }
  }
  return { stem: best, source: SHADERS[best] };
}

function freshLine(id, recent) {
  const seen = new Set((recent || []).map((x) => String(x).toLowerCase()));
  const pool = [...(POOL[id] || []), ...POOL.any].sort(() => Math.random() - 0.5);
  return pool.find((l) => !seen.has(l.toLowerCase())) || pool[0];
}

export function snapshot() {
  const st = stance();
  const mem = load();
  const idx = Number(mem.beats[st.id] || 0);
  if (st.beats.length && idx < st.beats.length) {
    const beat = { ...st.beats[idx], stance: st.id };
    const hit = pickShader(beat.shot, beat.kind);
    if (hit.stem) beat.vibe = hit.stem;
    return { label: st.label, complete: false, next: beat, hint: HINTS[beat.kind] || "TAP" };
  }
  const radio = mem.radio && mem.radio.stance === st.id && mem.radio.shot
    ? mem.radio
    : advanceRadio(st, mem, false);
  return {
    label: st.label,
    complete: false,
    next: { shot: radio.shot, kind: "pip", vibe: radio.vibe, stance: st.id, radio: true },
    hint: HINTS.pip,
  };
}

function advanceRadio(st, mem, writeIdx) {
  const last = (mem.radio && mem.radio.vibe) || "";
  const shot = freshLine(st.id, mem.recent || []);
  if (HOT.test(shot)) return advanceRadio(st, { ...mem, recent: [...(mem.recent || []), shot] }, writeIdx);
  const vibe = pickShader(shot, "pip", last).stem;
  const rec = { stance: st.id, shot, vibe };
  mem.radio = rec;
  mem.recent = [...(mem.recent || []), shot].slice(-12);
  mem.date = today();
  save(mem);
  return rec;
}

export function tap() {
  const st = stance();
  const mem = load();
  const idx = Number(mem.beats[st.id] || 0);
  if (st.beats.length && idx < st.beats.length) {
    mem.beats[st.id] = idx + 1;
    mem.date = today();
    save(mem);
    return snapshot();
  }
  advanceRadio(st, mem, true);
  return snapshot();
}

export function shaderOf(stem) {
  return SHADERS[stem] || SHADERS.sendoff || SHADERS["bass-pulse"];
}
